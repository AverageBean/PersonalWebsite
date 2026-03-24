# Phase C Plan — Sweep and Profile Detection for Complex Geometry

## Why Primitive Fitting Has a Ceiling

Phases A and B reconstruct geometry by recognising named mathematical primitives:
plane, cylinder, torus. This works because those three primitives cover the majority of
features in machined and 3D-printed parts — flat faces, round holes, chamfers, fillets.

But some geometry cannot be described by any finite set of primitives. Consider:

- A part with an **elliptical cross-section** — there is no "ellipse-cylinder" primitive
  in any standard CAD kernel
- A **rounded rectangle tube** (phone body, rail, beam) — four arcs + four lines, but as a
  3D surface it is a prism whose profile happens to contain multiple curve types
- A **curved spine** part like the CurvedMinimalPost — the cross-section may be simple but
  the path it follows in 3D space is a free-form curve

These shapes share a common structure: a **2D profile swept along a 3D path**. Detecting
them requires a different paradigm — not fitting a primitive equation, but reverse-engineering
the construction history of the feature.

---

## The Three Levels of Surface Description

Before planning Phase C it helps to understand the spectrum of surface types from simplest
to most general:

### Level 1 — Analytic Primitives

Defined by a closed-form equation with a small number of parameters.

| Surface | Equation | Parameters |
|---------|----------|-----------|
| Plane | ax + by + cz = d | 4 |
| Cylinder | x² + y² = r² (in local frame) | 5 (centre, axis, r) |
| Cone | x² + y² = (r + t·z)² | 6 |
| Sphere | x² + y² + z² = r² | 4 |
| Torus | (√(x²+y²) − R)² + z² = r² | 5 |

All of these map to exact STEP entity types (`PLANE`, `CYLINDRICAL_SURFACE`,
`CONICAL_SURFACE`, `SPHERICAL_SURFACE`, `TOROIDAL_SURFACE`). Onshape and every other
CAD tool treats them as fully parametric — you can select a face and read its exact radius.

**Detected by:** RANSAC fitting (Phases A and B).

---

### Level 2 — Surfaces of Revolution and Linear Extrusions

A 2D profile curve revolved around an axis, or extruded along a straight line.
A cylinder is a special case (circle + linear extrusion). A torus is a special case
(circle + circular revolution). But the profile can be *any* closed 2D curve.

Examples:
- **Lathe profile** — a 2D polyline/spline revolved 360° to produce a turned part
  (bottle, spindle, shaft with undercuts and shoulders)
- **Prismatic extrusion** — a 2D polygon extruded linearly (hex bolt head, rectangular beam,
  I-beam cross-section)
- **Elliptic cylinder** — an ellipse extruded linearly (elliptical boss, oval port)

These map to `SURFACE_OF_REVOLUTION` or `SURFACE_OF_LINEAR_EXTRUSION` in STEP, both of
which take an arbitrary curve as the profile. Onshape can import and display them, and in
some cases can re-edit the profile sketch.

**Detected by:**
1. Find the sweep axis (the axis of revolution, or the direction of linear extrusion)
2. Slice the mesh perpendicularly to the axis at regular intervals
3. Extract the 2D cross-section curve from each slice
4. Verify the cross-section is consistent (or evolves smoothly for lofts)
5. Fit a 2D parametric curve (polyline, arc, ellipse, spline) to the cross-section

---

### Level 3 — General Swept Surfaces (Free Spines)

The most general case: a 2D profile swept along an arbitrary 3D curve (the "spine" or "path").
This is what CAD tools call a **Sweep** or **Pipe** feature.

The spine can be:
- A 3D spline (Bézier, B-spline, NURBS curve)
- A helix (for springs, threads)
- A sequence of line + arc segments

The profile can also vary along the spine (a **loft** or **blend**).

This is the territory of the CurvedMinimalPost. The part is ~3mm × 11mm and almost entirely
curved — 91.9% of face normals have significant XY components with no consistent axis of
revolution or linear direction. It was almost certainly modelled as a swept extrusion of a
small 2D profile along a curved 3D spine.

STEP represents these as `B_SPLINE_SURFACE_WITH_KNOTS` or, if the sweep history is
preserved, as `SWEPT_SURFACE`. In practice most CAD exports produce B-spline surfaces.

**Detected by:** the full Phase C pipeline described below.

---

## How B-Spline Surfaces Work

A **B-spline surface** is a smooth mathematical surface defined by a grid of **control points**
and two sets of **knot vectors** (one per parametric direction U and V).

Think of it like a rubber sheet held at a grid of pins. Each control point pulls the sheet
toward it with a weight determined by **basis functions**. Moving one control point smoothly
deforms a local region of the surface without affecting the rest — this is the **local
support** property that makes B-splines practical.

A **NURBS surface** (Non-Uniform Rational B-Spline) adds weights to each control point,
allowing exact representation of circles and conics (which ordinary B-splines can only
approximate). All analytic primitives can be represented exactly as NURBS, making NURBS the
universal surface type in CAD.

For Phase C, detecting a B-spline surface from a mesh means:
1. Identifying which face cluster belongs to one smooth surface patch
2. Fitting a NURBS surface to those face centres/normals
3. Trimming it with the correct boundary curves

This is an active research area. Libraries like `geomdl` (Python) provide NURBS fitting.

---

## Phase C Goals

### Goal 1 — Sweep Axis Detection

For parts like the CurvedMinimalPost, detect the 3D spine curve that the part was swept along.

**Method:**
The spine of a swept surface lies equidistant from the surface boundary on both sides.
For a tube-like part (roughly constant cross-section), the spine is the **medial axis** —
the locus of centres of maximally inscribed spheres.

Practical approach using trimesh:
1. Compute the mesh skeleton using `trimesh.path.skeleton` or via voxelisation + distance transform
2. Fit a B-spline curve to the skeleton points
3. Validate: check that the cross-sectional area is approximately constant along the skeleton

---

### Goal 2 — Cross-Section Profile Extraction

Given a spine curve, extract the 2D cross-section at regular intervals.

**Method:**
1. At each sample point on the spine, compute the **Frenet frame**: tangent T, normal N, binormal B
2. Slice the mesh with a plane through the sample point with normal T
3. The intersection of this plane with the mesh is a 2D curve in the (N, B) coordinate frame
4. Fit a 2D shape to this curve:
   - If it is circular → standard cylinder/revolution (already handled by Phase A)
   - If it is elliptical → `ELLIPSE` curve type (exact representation possible)
   - If it is a rounded rectangle → line+arc profile
   - Otherwise → B-spline curve approximation

This step converts the 3D detection problem into a series of 2D curve-fitting problems,
which are much better studied and have more available libraries.

---

### Goal 3 — Profile Consistency Check and Classification

Verify that the extracted cross-sections are consistent (same shape, possibly rotated/scaled
along the spine) and classify the sweep type:

| Profile shape | Spine shape | Result |
|--------------|------------|--------|
| Circle | Straight line | Cylinder (Phase A) |
| Circle | Circle | Torus (Phase B) |
| Circle | Free curve | `SURFACE_OF_REVOLUTION` or B-spline tube |
| Ellipse | Straight line | Elliptic cylinder — `SURFACE_OF_LINEAR_EXTRUSION(ellipse)` |
| Rounded rectangle | Straight line | Prismatic extrusion — `SURFACE_OF_LINEAR_EXTRUSION(compound curve)` |
| Arbitrary closed curve | Free curve | B-spline surface (general case) |

If the profile is consistent and matches a named type, output the corresponding STEP entity.
If not, fall back to a fitted B-spline surface.

---

### Goal 4 — NURBS Surface Fitting (Fallback)

When the profile does not match any named type, fit a B-spline surface patch directly to the
mesh face cluster.

**Library:** `geomdl` (pip-installable into FreeCAD's Python)

```python
from geomdl import fitting

# face_centres: (N, 3) array of points sampled from the mesh patch
surf = fitting.approximate_surface(
    face_centres.tolist(),
    size_u=m,  # number of points in U direction
    size_v=n,  # number of points in V direction
    degree_u=3,
    degree_v=3
)
```

The result is a NURBS surface that can be exported directly as `B_SPLINE_SURFACE_WITH_KNOTS`
in STEP format.

The key challenge is **parameterisation** — determining the (u, v) coordinates for each
input point. Good parameterisation (chord-length or centripetal) is essential for a smooth
fit. Poor parameterisation produces oscillating surfaces.

---

### Goal 5 — Trim Curve Integration with B-rep

As in Phase B, the hardest part is the topology: each B-spline surface patch must be bounded
by exact trim curves where it meets adjacent patches (other B-spline surfaces, planes,
cylinders, or tori from earlier phases).

For Phase C the trim curves are general space curves, not simple circles. They are computed
using OpenCASCADE's `BRepAlgoAPI_Section`, the same tool mentioned in the Phase B plan.

The output is a STEP solid where:
- Analytic regions (flat faces, cylinders, detected tori) have exact primitive surfaces
- Swept/curved regions have B-spline surfaces
- All edges carry exact intersection curves computed by OpenCASCADE
- The result is fully valid for import into Onshape as a smooth solid body

---

## Scope for Phase C Implementation

A realistic Phase C would deliver in three sub-phases:

### Phase C-1 — Elliptic Cylinder Detection (Low Effort, High Value)

Before tackling full sweep detection, add ellipse fitting to the cross-section step.
Many bosses, ports, and features in biomedical and aerospace parts use elliptical
rather than circular cross-sections.

Implementation: after clustering the "unclaimed" faces (not cylinders, planes, or tori),
attempt to fit an ellipse to each cluster's face centres projected onto a best-fit plane.
Use `cv2.fitEllipse` or `scipy.optimize` for the 2D ellipse fit.

Output: `SURFACE_OF_LINEAR_EXTRUSION` with an `ELLIPSE` profile entity in STEP.

Testable with: a custom STL of an oval boss, or the CurvedMinimalPost if it turns out to
have an elliptical cross-section.

---

### Phase C-2 — Axis-Symmetric Sweep Detection (Medium Effort)

For parts that are surfaces of revolution (lathe profiles, turned parts) — detect the axis
of revolution and extract the profile curve.

Implementation:
1. Project all unclaimed face centres onto a candidate axis (iteratively searched)
2. Compute radial distance r(z) along the axis — the 2D profile
3. Fit a B-spline curve to r(z) in the (z, r) plane
4. Export as `SURFACE_OF_REVOLUTION` with the B-spline profile

Testable with: a turned shaft or bottle shape STL.

---

### Phase C-3 — Free Spine Swept Surface (High Effort)

The full pipeline described above: medial axis → Frenet frame slicing → profile extraction →
B-spline surface fitting → trim curves.

Target test asset: `CurvedMinimalPost-Onshape.stl` (3mm × 11mm × 6.8mm, 91.9% curved faces).

Success criterion: output STEP contains `B_SPLINE_SURFACE_WITH_KNOTS` entities covering
≥80% of the part faces, imports into Onshape as a smooth solid, and visually matches the
original STL within 0.05mm.

---

## Summary: What Each Phase Reconstructs

| Phase | Surfaces handled | STEP entities | CurvedMinimalPost | Baseplate |
|-------|-----------------|---------------|------------------|-----------|
| A (done) | Cylinders, planes | `CYLINDRICAL_SURFACE`, `PLANE` | Fails (too curved) | Partial (no fillets) |
| B (next) | + Tori (fillets) | + `TOROIDAL_SURFACE` | Fails | Full |
| C-1 | + Elliptic cylinders | + `SURFACE_OF_LINEAR_EXTRUSION(ellipse)` | Maybe | Full |
| C-2 | + Revolution profiles | + `SURFACE_OF_REVOLUTION` | Maybe | Full |
| C-3 | + Free sweeps | + `B_SPLINE_SURFACE_WITH_KNOTS` | Full | Full |
