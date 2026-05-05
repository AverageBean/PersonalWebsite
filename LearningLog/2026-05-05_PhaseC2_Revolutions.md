# Phase C-2 — Surface-of-Revolution Detection
**Date:** 2026-05-05
**Commit:** Implement Phase C-2 surface-of-revolution detection (vase/lathe profiles)

---

## What Changed

The parametric STEP converter now detects **surfaces of revolution** — vases,
turned shafts, lathe profiles — and emits native `SURFACE_OF_REVOLUTION` STEP
entities over a `B_SPLINE_CURVE_WITH_KNOTS` profile. Before this, any
revolved part with non-trivial profile fell through to the box-CSG fallback,
which approximated the curved volume as a rectangular envelope.

Synthetic test (`AIgen_RevolvedOgive.stl`, vase profile through 6 control
points) goes from volume ratio 2.40 (60% over by box envelope) to 0.9985.
Mean deviation drops from 2.99 mm → 0.11 mm.

---

## How the Detector Works

Five gates filter the lateral face cluster down to genuine revolutions:

1. **Axis search** — try the three coordinate axes plus the PCA principal
   direction of unclaimed face centres. Score each by inlier-fraction ×
   theta-coverage / (1 + r-MAD/r-scale) after projecting points into
   cylindrical (z, r, θ) about that candidate axis. Best axis wins.
2. **Score floor** (≥ 0.55) — rejects parts where no axis gives clean
   rotational symmetry (swept posts, freeform B-spline surfaces).
3. **Theta-coverage floor** (≥ 0.75) — rejects partial-arc geometry
   (boxes, posts, parts where the lateral faces don't span the full
   circumference).
4. **Mean r-MAD ceiling** (≤ 3% of r-max) — rejects elliptic cylinders and
   prismatic boxes whose r varies with θ at fixed z. Critical: discriminates
   true revolutions from cross-sections that vary by angle.
5. **Profile smoothness + monotonicity** — the per-bucket median (z, r)
   profile must (a) have at least one dr/dz sign change (rejects pure
   cylinders, stepped cylinders, cones — those go to Phase A), and
   (b) have no consecutive r-jumps exceeding 50% of the r-range
   (rejects annular rings whose median bounces between inner/outer radii).

If all five gates pass, `Part.BSplineCurve.approximate` fits a degree-3-to-5
B-spline through the (z, r) profile to ≤ 0.05 mm tolerance. The profile is
extended to the cluster's true z-extent before fitting (using nearest-bucket
r as anchor) so the resulting solid spans the full geometry height instead
of bucket-centre to bucket-centre.

CSG construction lays the B-spline edge into the axis-local XZ plane,
adds straight closing edges back to the rotation axis (skipping degenerate
edges where r ≈ 0 — the pole edge case), forms a `Part.Face`, and revolves
360° around the local Z axis. A `FreeCAD.Placement` rotates local-Z onto
the world axis and translates to the world origin. STEP export emits the
result as `SURFACE_OF_REVOLUTION(B_SPLINE_CURVE_WITH_KNOTS)`.

---

## Pipeline Integration

Detection runs **after** sphere/elliptic detection, but on the
`used_after_planes` mask — so it sees the full lateral face set regardless
of what cylinder/torus/sphere/elliptic claimed. Routing (in
`build_parametric_solid`) gives revolution **first priority** ahead of
box, elliptic, and cylindrical paths — those all only approximate a true
revolution and would distort the geometry.

Pipeline order:

```
Plane (A) → Cylinder (A) → Torus (B) → Sphere (B.5)
         → Elliptic cyl (C-1) → Revolution (C-2) → routing
```

The five reject gates are what make this safe. Without them, revolution
would steal MeshRing1 (annular ring), AIgen_EllipticCylinder, Baseplate,
ESP35Box, and CurvedMinimalPost from their existing paths. The full test
suite (7/7 + determinism gate) confirms each rejection works.

---

## Bugs I Walked Into

### 1. The post-claims mask sees nothing

My first dry-run had revolution detection running on the standard `used`
mask (after every other detector). For the vase, only 28 of 5070 lateral
faces remained unclaimed by then — Phase A's cylinder RANSAC had locally
fit each height slice as a partial cylinder. Detector skipped, vase
unrecognised.

Fix: detection runs on `used_after_planes` (only plane caps claimed).
Revolution is the most-specific lateral primitive; its reject gates
prevent it from stealing other primitives' faces, so seeing them all
is safe.

### 2. Annular rings produce noise that looks like a revolution

`MeshRing1.stl` (inner r=20, outer r=25) initially scored 1.000 on the
revolution detector. Reason: each z-bucket's median r picks either the
inner or outer cylinder almost uniformly — so the per-bucket r-MAD is
tiny (one r value dominates per bucket) and the score is near-perfect.
But the *profile* across buckets oscillates 25→20→25→20.

Fix: profile smoothness check. Reject if any consecutive |dr| exceeds
50% of the r-range. Vase: 36% max-jump (smooth shoulder transition,
within tolerance). MeshRing1: 100% max-jump (REJECTED, falls through
to cylinder + torus path as before).

### 3. `Part.export([raw_shape], path)` writes empty STEP

The debug export wrapped a raw `Part.Solid` and called `Part.export([sol], path)`.
The resulting STEP file had a `SHAPE_REPRESENTATION` but no geometric
entities — just a header and context. The shape never made it in.

Fix: `Part.export` requires Document features, not raw shapes. Wrap in
`doc.addObject("Part::Feature", ...).Shape = sol; doc.recompute()` before
exporting. The production export path already does this.

### 4. Bucket-centre profile under-fills the solid

Initial CSG produced vol 6666 / target 6996 = 95% match — the solid was
~5% short on each end. Reason: profile (z, r) points sample at z-bucket
centres, so the first/last point sits half a bucket inside the actual
extent. The B-spline curve tracks bucket centres faithfully and the wire
ends there too.

Fix: `extract_profile_zr` accepts `z_extent` and prepends/appends sample
points at the true cluster z-bounds (using nearest-bucket r as anchor).
Vase volume becomes 6972 / 6996 = 99.66%.

### 5. Unicode arrow in console output crashes Windows cp1252

`print(f"... {n} pts → degree {d}")` died on Windows console encoding.
ASCII `->` works. Easy fix; worth noting for any future debug-print line
that wants pretty Unicode.

---

## Test Setup

`tools/generate-revolved-profile-test.py` writes
`TestDocs/AIgen_RevolvedOgive.stl` (ASCII STL with `solid AIgen_RevolvedOgive`
header) by:

```python
profile_pts = [Vector(r, 0, z) for r, z in [(12,0), (11,5), (7,12), (6,18), (9,24), (4,30)]]
bspline = Part.BSplineCurve(); bspline.interpolate(profile_pts)
wire    = Part.Wire([bspline.toShape(), top_edge, axis_edge, bottom_edge])
solid   = Part.Face(wire).revolve(Vector(0,0,0), Vector(0,0,1), 360)
mesh    = Mesh.Mesh(); mesh.addFacets(solid.tessellate(0.05))
mesh.write(stl_path, "AST")
# Header patch: replace `solid Mesh` → `solid AIgen_RevolvedOgive`
```

The asset is registered in `TestDocs/README_AI_GENERATED.md` (a new
sidecar), labelled with the `AIgen_` filename prefix per a new naming
convention introduced this session. The pre-existing
`EllipticCylinder.stl` was renamed to `AIgen_EllipticCylinder.stl` for
consistency.

The regression entry in `tools/test-parametric-step.py` requires
`SURFACE_OF_REVOLUTION` + `B_SPLINE_CURVE_WITH_KNOTS` STEP entities,
vol ratio 0.98–1.02, mean dev ≤ 0.20 mm. 7/7 of the parametric tests
pass with no regressions on the existing models.

---

## Debug Tooling

Step 0 of the C-2 plan built a debug harness *before* the detector code
to avoid the C-1 silent-`None` lesson. Two pieces:

- **`tools/debug-revolution-fit.py`** — standalone (no FreeCAD needed
  for detection — uses trimesh + numpy + matplotlib). Loads any STL,
  scores the four candidate axes, dumps a JSON of profile + scores and
  two PNG plots: (z, r) profile + theta-coverage scatter. Useful for
  validating any new test asset before running it through the converter.
- **`--debug-c2` flag** on the main converter. Adds verbose per-axis
  scoring, profile extraction, B-spline fit, and CSG-build diagnostics.
  Off by default to keep production logs clean.

Both proved their value during integration: the harness predicted the
right axis on every test asset before the detector existed; the
`--debug-c2` flag isolated the annular-ring false-positive in seconds
when the suite first hit MeshRing1.

---

## What's Next

C-3 (free swept B-spline surfaces) — the territory of the
CurvedMinimalPost-Onshape.stl test asset (3 × 11 × 6.8 mm, 91.9% curved
faces, no consistent axis of revolution). Multi-day arc on its own:

1. Medial-axis spine extraction (trimesh skeleton or voxel-distance)
2. Frenet-frame slicing to extract 2D profiles along the spine
3. Profile fitting per slice
4. NURBS surface fitting via control-point grid (likely needs `geomdl`)
5. Trim-curve integration via `BRepAlgoAPI_Section`

Worth deferring until a real swept-spine part shows up in user uploads.
The current test asset is the only known case in the corpus.
