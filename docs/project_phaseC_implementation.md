# Phase C Implementation — Concrete Next Steps

**Last updated:** 2026-04-29
**Status:** Test infrastructure in place. No Phase C code written yet.

---

## What's done

- `tools/test-parametric-step.py` now has a `CurvedMinimalPost-Onshape.stl`
  entry locking in the **pre-Phase-C** state as a regression floor:
  - 6 PLANE entities, 0 cylinders/tori/spheres
  - 45.7 % direct quadric coverage; 73.9 % after box-fillet face claiming
  - Volume ratio 1.473 (the box envelopes the curved-out regions)
  - Mean deviation 0.000 mm, Hausdorff 0.001 mm (sample-density artefact —
    the comparison's STL→STEP nearest-point check finds the box surface
    everywhere along the projected ray, since the box contains the post)
- Phase C work must EITHER preserve those bounds (vol 0.9–1.6) OR improve them
  (vol → 1.0 ± 0.05, dev → 0).

## Immediate next step — Phase C-1 detection

C-1 is the simplest Phase C piece. Implement detection without CSG first:

### Function signature

```python
def detect_elliptic_cylinders(face_centers, face_normals, used,
                               body_axis, total):
    """
    RANSAC-style detection of elliptic-cylinder faces.

    For each candidate axis (start with body_axis from Phase A; fall back to
    PCA on unclaimed face normals if no body_axis was set):
      1. Project face_centers[unclaimed] onto a plane perpendicular to the
         axis.
      2. Fit an ellipse via cv2.fitEllipse OR a 5-parameter least-squares
         (centre x,y; semi-axes a,b; rotation theta).
      3. Reject if axis_ratio (b/a) > 0.95 — that's a circle (would be
         caught by Phase A cylinder detection), not an ellipse.
      4. Reject if residual > 0.5 mm (mean perpendicular distance from
         projected centres to the fitted ellipse).
      5. Inliers = projected centres within 0.3 mm of the fitted ellipse.

    Returns: list of {center, axis, semi_a, semi_b, rotation, inliers}.
    """
```

### Where it slots in

`tools/convert-stl-to-step-parametric-with-freecad.py` — after sphere
detection (around line 800), before the box CSG path. Mark detected faces
in `used[]` so they don't get claimed by box-fillet generosity.

### Validation strategy

The existing test parts have NO clean elliptic-cylinder features. To validate
detection, generate a synthetic STL via FreeCAD scripting:

```python
# Outline only — drop in a tools/generate-elliptic-cylinder-test.py script
import Part, FreeCAD
ellipse = Part.Ellipse(FreeCAD.Vector(0,0,0), 10, 6)  # semi-a=10, semi-b=6
wire = Part.Wire([ellipse.toShape()])
face = Part.Face(wire)
solid = face.extrude(FreeCAD.Vector(0, 0, 30))
Part.export([Part.show(solid)], "TestDocs/EllipticCylinder.stl")
```

Then add a test entry in `test-parametric-step.py` that requires the C-1
detection log line.

### CSG construction (deferred to a later sub-step)

Once detection is solid, build the elliptic cylinder via:
```python
ellipse_curve = Part.Ellipse(centre, semi_a, semi_b)
# rotate to match detected orientation
wire = Part.Wire([ellipse_curve.toShape()])
face = Part.Face(wire)
solid = face.extrude(axis * height)
```

The STEP exporter natively emits `SURFACE_OF_LINEAR_EXTRUSION(ELLIPSE)` for
this construction.

---

## Why C-3 should be deferred

The spec lists C-3 (B-spline fallback) as the catchall for arbitrary curved
surfaces. It's tempting to jump straight there for the
CurvedMinimalPost-Onshape model. Two reasons not to:

1. **C-3 needs B-spline surface fitting.** FreeCAD's Part.BSplineSurface
   can be constructed from a control-point grid, but generating that grid
   from arbitrary face centres requires either (a) parameterising the surface
   onto a 2D domain (hard for general topology) or (b) using a library like
   `geomdl`. Both are a real day or two of work.
2. **C-3 trim curves are non-trivial.** A B-spline patch needs to be trimmed
   to the actual silhouette of the unclaimed face cluster. `BRepAlgoAPI_Section`
   handles this but produces complex topology that can fail boolean ops.

C-1 is straightforward (well-known 5-DOF fit) and gives immediate value for
any test part with elliptic features. Even if existing test parts don't have
them, the synthetic test STL above proves the detection.

---

## Phase C-2 — third in the order

C-2 (surfaces of revolution) requires:
- Finding a candidate axis (longest axis of unclaimed face cluster, or
  axis of symmetry from PCA)
- Projecting face centres into (axial_distance, radial_distance) 2D space
- Fitting a B-spline curve to the (z, r(z)) profile
- Constructing `Part.makeRevolution(spline_face, axis)`

Defer until C-1 detection scaffolding is in place — the projection +
profile-fit machinery is shared.

---

## Risk register

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| C-1 false-positive on torus inner-circle faces | Medium | Run AFTER torus detection; check axis-ratio > 0.95 → reject as circle |
| C-1 false-positive on sphere caps | Low | Sphere detection runs first; spherical faces won't be in `unclaimed` |
| Synthetic test STL doesn't trigger the actual code path | Medium | Verify with geometry comparison — vol ratio close to 1.0 |
| FreeCAD's `Part.Ellipse` orientation conventions | Low | Test with rotated ellipses; document the `.LocalAxis` setup |

---

## Phase C scope for the next 2–3 sessions

- **Session 1**: Implement `detect_elliptic_cylinders()`, generate synthetic
  test STL, add test entry, verify detection log line.
- **Session 2**: Add CSG construction for detected elliptic cylinders.
  Validate via geometry comparison on the synthetic test.
- **Session 3**: Begin C-2 (surfaces of revolution) reusing C-1's projection
  machinery.

C-3 (B-spline freeform) gets its own dedicated arc — multi-day on its own
once C-1 and C-2 are stable.
