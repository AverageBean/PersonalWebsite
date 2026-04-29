# Phase C-1 — Elliptic Cylinder Detection
**Date:** 2026-04-29
**Commit:** Implement Phase C-1 elliptic cylinder detection

---

## What Changed

The parametric STEP converter previously only fit four primitive types: planes, circular cylinders, tori, and spheres. Anything else fell through to either a triangulated mesh or an enveloping-box CSG solid that distorted the model's true volume.

Phase C-1 adds **elliptic cylinder** detection — surfaces formed by extruding an ellipse along an axis. Output: native `SURFACE_OF_LINEAR_EXTRUSION` over an `ELLIPSE` curve. Synthetic test (semi-axes 10 mm × 6 mm, height 30 mm) goes from volume ratio 1.4728 (47 % over by box envelope) to 0.9999.

---

## How the Detector Works

1. Restrict to faces with normals approximately perpendicular to the body axis (Z, default). These are the lateral wall faces.
2. Project their centres onto the XY plane.
3. Fit an ellipse to the projected centres via **Fitzgibbon, Pilu & Fisher (1999)** — a constrained least-squares solver that turns the conic equation `Ax² + Bxy + Cy² + Dx + Ey + F = 0` into a generalised eigenvalue problem with the ellipse-only constraint `4AC − B² = 1` baked in.
4. Convert the conic coefficients to canonical form: centre, semi-axes, rotation.
5. Reject if axis ratio b/a ≥ 0.95 — that's a circle, which Phase A's RANSAC cylinder detector should have caught.
6. Inliers = projected centres whose perpendicular distance to the fitted ellipse is below 0.30 mm.
7. Z extents come from inlier triangle **vertices** (not centroids — for a thin lateral strip of triangles, the centroid Z range is much narrower than the actual extrusion span).

The CSG construction is straightforward: build a `Part.Ellipse` curve in the local frame, wrap it in a wire and a face, and extrude along the axis. FreeCAD's STEP exporter then emits the `SURFACE_OF_LINEAR_EXTRUSION(ELLIPSE)` natively.

---

## Two Bugs I Walked Into

These are documented in `docs/project_phaseC_implementation.md` so the next sub-phase doesn't repeat them. Worth flagging here for the lesson value.

### 1. NumPy eigenvector indexing

The constraint test at the heart of Fitzgibbon's method is:

> Of the three eigenvectors, pick the one whose components satisfy `4AC − B² > 0` (i.e. it represents a real ellipse, not a parabola or hyperbola).

I wrote:
```python
cond = 4 * eigvec[0] * eigvec[2] - eigvec[1] ** 2
```

That's wrong. `np.linalg.eig` returns eigenvectors as **columns**, so `eigvec[0]` is the *first row* across all three eigenvectors — not the first component of the first eigenvector. The correct form is:
```python
cond = 4 * eigvec[0, :] * eigvec[2, :] - eigvec[1, :] ** 2
```

The bug was silent: `cond` came back with shape (3,) and (mostly) negative values, so `valid` was empty and the function returned `None` with an unhelpful "fit degenerate" log line. Adding a debug print on `cond` showed what was happening in seconds.

### 2. Canonical-form sign

Converting `(A, B, C, D, E, F)` to `(cx, cy, semi_a, semi_b, theta)` looks like this in the standard reference:

```python
denom = B² - 4AC                # negative for an ellipse
num   = 2(AE² + CD² - BDE + F·denom)
s     = sqrt((A-C)² + B²)
a²    = -num / (denom · ((A+C) + s))
b²    = -num / (denom · ((A+C) - s))
```

Without the leading `-` on `a²` and `b²`, both come out **negative** (because `num`, `denom`, and the `(A+C) ± s` factor each flip signs in ways that compound), the early-return `if a_sq <= 0` triggers, and again you get a silent `None`. Knowing to negate is a one-character fix; not knowing costs an hour.

The Wikipedia "General ellipse" article happens to have the right formula. Many web references drop the sign and don't notice because their test cases use a different conic-equation normalisation.

---

## Pipeline Order Update

The detection pass slots in **after** sphere detection but **before** any box CSG path:

```
Plane (A) → Cylinder (A) → Torus (B) → Sphere (B.5) → Elliptic cyl (C-1) → Box CSG (D) → Cylindrical CSG → Sphere CSG
```

In `build_parametric_solid`, the elliptic-cylinder path now takes precedence over the cylindrical/sphere paths once a valid elliptic cylinder has been claimed. Reason: Phase A's circular-cylinder RANSAC will *partially* fit an elliptic wall — finding two non-coaxial circular cylinders with different radii (one at the wide axis, one at the narrow axis). The "axes are not coaxial" abort then triggers the box fallback, which envelops the curved-out region and inflates the volume. Letting C-1 take precedence avoids that.

---

## Test Setup

`tools/generate-elliptic-cylinder-test.py` writes `TestDocs/EllipticCylinder.stl` from canonical FreeCAD operations:

```python
ellipse = Part.Ellipse(FreeCAD.Vector(0, 0, 0), 10, 6)
solid   = Part.Face(Part.Wire([ellipse.toShape()])).extrude(FreeCAD.Vector(0, 0, 30))
mesh.addFacets(solid.tessellate(0.1))   # 0.1 mm chord error → 628 triangles
```

The regression entry in `tools/test-parametric-step.py` requires `ELLIPSE` + `SURFACE_OF_LINEAR_EXTRUSION` STEP entities, vol ratio 0.98–1.02, mean dev ≤ 0.05 mm. 6/6 of the parametric tests pass with no regressions on the existing models (MeshRing1, Baseplate, MeshRing1-mold-top, ESP35Box, CurvedMinimalPost-Onshape).

---

## What's Next

C-2 (surfaces of revolution): same lateral-face filter and projection machinery, but the 2D fit becomes a 1D B-spline through `(z, r(z))` points. CSG via `Part.makeRevolution`. Synthetic test would be an ogive shape — also generated via FreeCAD scripting since no existing test part has a clean revolution feature.

C-3 (free swept B-spline) is a multi-day arc on its own. Defer.
