# 2026-03-17 — STL to STEP Parametric Export

## What Was Built

This session added two new STEP export options to the viewer:

| Export option | What it produces |
|---|---|
| **STEP — CAD solid** | A triangulated solid: every original triangle becomes a flat B-rep face. Valid solid body, importable into Onshape, but visually identical to the original mesh — cylinders are still made of hundreds of flat faces. |
| **STEP — analytical surfaces** | A geometrically reconstructed solid: cylinders become true `CYLINDRICAL_SURFACE` entities, flat faces become true `PLANE` entities. The output is a clean, smooth solid that Onshape treats as a real CAD body. |

Both formats require the local converter service (`npm run convert:start`) since they involve server-side FreeCAD processing.

---

## Why STL Can't Be Edited Directly

STL is a **triangle mesh format**. It stores geometry as a list of flat triangular facets with no information above the individual triangle level — no edges, no surfaces, no mathematical description of the shape. A cylinder in STL is just 200 triangles arranged in a tube shape.

CAD tools like Onshape operate on **B-rep (Boundary Representation)** geometry. A B-rep solid is defined by surfaces (planes, cylinders, NURBS), connected by topological edges and vertices. When you import an STL into Onshape it lands as a "mesh body" — you can view it but cannot fillet it, boolean it, or use its faces for sketching.

**STEP (ISO-10303)** is the universal neutral CAD exchange format. It can encode B-rep solids. When we export a STEP file where the cylindrical faces are `CYLINDRICAL_SURFACE` entities instead of hundreds of flat triangles, Onshape imports it as a proper solid with smooth, selectable faces.

---

## The Two Conversion Levels

### Level 1 — Triangulated STEP ("dumb solid")

FreeCAD's `Part.makeShapeFromMesh()` reads each triangle from the STL, creates a flat planar B-rep face for it, and sews them into a solid. The result:

- A valid STEP solid (not a mesh body) — Onshape can operate on it
- Faces correspond 1:1 to triangles — the cylinder is still hundreds of tiny faces
- Useful for boolean operations, drawings, FEA, but face selection is awkward

### Level 2 — Analytical STEP (Phase A of reverse engineering)

The script detects the underlying geometric primitives (cylinders, planes) using RANSAC, then rebuilds the solid using FreeCAD's Part primitives. The result:

- True `CYLINDRICAL_SURFACE` geometry — one smooth face per cylinder
- `PLANE` entities for flat faces — one face per flat region
- Onshape shows a clean, smoothly shaded solid with normal face counts
- Fillet regions remain as sharp edges (Phase B limitation — see below)

---

## How the Algorithm Works

### Step 1 — Normal-guided pre-filtering

Before running any RANSAC, face normals are sorted into two pools:

```
|nz| < 0.30   →  cylinder candidate faces   (normals pointing mostly sideways)
|nz| > 0.85   →  plane candidate faces      (normals pointing mostly up/down)
remainder      →  fillet/transition faces    (left unprocessed)
```

This is the **critical innovation** over naive RANSAC. Without pre-filtering, RANSAC on a mixed mesh greedily detects planes first and consumes cylinder faces that happen to be near a plane (e.g., cylinder faces at the very top or bottom of a short ring). With pre-filtering, each RANSAC run only sees geometrically appropriate faces.

For `MeshRing1.stl`:
- 4608 horiz faces (outer + inner cylinder)
- 8064 vert faces (top + bottom annular planes)
- 9216 fillet faces (~42% of the mesh — unprocessed, would need toroidal surface detection)

### Step 2 — Iterative RANSAC

**RANSAC** (Random Sample Consensus) is a statistical fitting algorithm:

1. Randomly sample the minimum number of points needed to define a shape (3 for a plane, 6 for a cylinder)
2. Fit that shape hypothesis to the sample
3. Count how many other points are within a tolerance threshold of the fitted shape ("inliers")
4. Keep the best fit found after many iterations
5. Remove those inlier points and repeat to find the next shape

We use **pyransac3d** (a lightweight Python library) with a 0.15mm tolerance threshold.

Cylinders are detected first (on horiz faces), then planes (on vert faces). This order matters because if planes ran first with loose tolerances they would absorb faces that are "nearly flat" at the top of a cylinder.

### Step 3 — Inner vs outer classification

Every detected cylinder is classified as a **body surface** (outer) or a **hole** (inner) by examining how its face normals relate to the radial direction from the cylinder axis:

```python
radial_unit = (face_position - axis_foot) / distance_from_axis
dot = mean(face_normal · radial_unit for each inlier face)

dot > 0  →  normals point AWAY from axis  →  outer surface (convex body)
dot < 0  →  normals point TOWARD axis     →  inner surface (hole/concave)
```

This works because a mesh always has outward-facing normals. On the ring's outer surface, the normals point away from the ring's central axis. On the inner bore surface, the normals point toward the axis (i.e., into the hole, which is outward from the solid material).

### Step 4 — Height determination from cap planes

For each detected plane, we check whether its normal is aligned with the cylinder axis (dot product > 0.85). Planes that pass this test are "cap planes" — they define the top and bottom of the cylinder.

The signed distance of each cap plane along the axis gives `h_min` and `h_max`, which define the precise height of the reconstructed solid.

### Step 5 — CSG reconstruction

Once we have the parameters, FreeCAD's Part module builds the solid:

```python
# Build outer cylinder
solid = Part.makeCylinder(outer_radius, height, base_point, axis_direction)

# Subtract each inner cylinder (hole)
for hole in inner_cylinders:
    hole_solid = Part.makeCylinder(hole_radius, height + margin, base_point, axis_direction)
    solid = solid.cut(hole_solid)
```

This is **CSG (Constructive Solid Geometry)** — building complex shapes by combining simple primitives using boolean operations (union, subtraction, intersection). It's the same approach parametric CAD tools use internally.

The output is an analytically exact ring: a true mathematical cylinder minus a true mathematical inner bore.

---

## The Bug: D-Shaped Cut

The first version produced a ring with a flat diagonal face closing off part of the inner hole — a "D" shape when viewed from above.

**Root cause:** pyransac3d returns a `center` point for each detected cylinder — some point that lies on the detected axis. With the inner cylinder having only 288 inlier faces (vs 4320 for the outer), RANSAC located that point with lower accuracy. The inner cylinder's detected axis passed through a slightly different X-Y position than the outer cylinder's axis.

When `Part.makeCylinder(inner_r, h, inner_center, axis)` was called at this offset position, the inner and outer cylinders were **parallel but not coaxial**. The boolean `.cut()` only removes the overlap volume. Where the offset inner cylinder fell outside the ring material, no material was removed — leaving a flat chord-shaped residual face.

**Fix:** For all hole cylinders, discard their RANSAC-detected center entirely and use the body cylinder's axis line. Each hole contributes only its **radius** to the final geometry; position and direction come from the body:

```python
# Before (buggy): used hole's own axis center
hole_base = hole["center"] + hole["axis"] * hole_min

# After (fixed): use body cylinder's axis line for all holes
hole_base = body_center + body_axis * (h_min - HOLE_CUT_MARGIN)
hole_solid = Part.makeCylinder(hole["radius"], hole_h, hole_base, body_axis)
```

This guarantees perfect coaxiality regardless of how accurately RANSAC found the inner axis.

---

## What the Reconstructed STEP Contains

For `MeshRing1.stl` (50mm OD, 20mm ID, 6mm tall, 21888 triangles):

| | Triangulated STEP | Analytical STEP |
|---|---|---|
| File size | ~20,000 lines | 157 lines |
| Surface type | Hundreds of `PLANE` (triangles) | 2× `CYLINDRICAL_SURFACE` + `PLANE` caps |
| Onshape face count | ~21000 tiny faces | 4 faces (outer cyl, inner cyl, top, bottom) |
| Filleting edges in Onshape | Impractical | Works correctly |
| Parametric editing | No | No (but the geometry is exact) |

---

## What Phase B Would Add

Phase A handles **coaxial prismatic parts** — any geometry that can be described as cylinders and planes sharing a common axis. The fillet surfaces (toroidal) are left as sharp edges in the output.

Phase B would require:

1. **Toroidal surface detection** — extending pyransac3d to fit torus primitives to the fillet face clusters
2. **Trim curve computation** — computing the exact 3D circle where a cylinder meets a plane (or a torus meets both), and using it as the topological edge in the B-rep
3. **Non-coaxial assembly** — parts with multiple features on different axes (e.g., a shaft with cross-holes)

The trim curve step is the hard part. It requires using OpenCASCADE's intersection routines (`BRepAlgoAPI_Section`) to find the exact curve where two analytical surfaces meet — essentially re-implementing what a CAD kernel does at feature-build time, in reverse.

---

## Files Changed

| File | Change |
|---|---|
| `tools/convert-stl-to-step-with-freecad.py` | New — triangulated STEP export via FreeCAD mesh sewing |
| `tools/convert-stl-to-step-parametric-with-freecad.py` | New — RANSAC surface detection + CSG reconstruction |
| `tools/converter-server.js` | Added `/api/convert/stl-to-step` and `/api/convert/stl-to-step-parametric` endpoints |
| `js/app.js` | Added `step` and `step-parametric` export formats; `convertStlBlobToStep()` function |
| `index.html` | Added two new STEP options to export dropdown |
| `tests/viewer.spec.js` | 4 new tests: UI presence, hint text, API validation (CYLINDRICAL_SURFACE check), bounding box |
| `TestDocs/MeshRing1.stl` | New test asset — 50mm ring with filleted edges |

---

## Key Concepts Introduced

**RANSAC** — A probabilistic algorithm for fitting geometric models to noisy data. Widely used in computer vision and geometry processing. Its strength is robustness to outliers: even if 40% of your data doesn't fit the model (fillet faces), it still finds the correct cylinder through the remaining 60%.

**B-rep (Boundary Representation)** — The dominant geometric representation in CAD. A solid is defined by its boundary: a set of faces (each bounded by edges, each edge bounded by vertices), where each face is associated with an underlying mathematical surface. OpenCASCADE is the open-source B-rep kernel; FreeCAD, Solvespace, and many others are built on it.

**CSG (Constructive Solid Geometry)** — Building complex solids by combining simple primitives using boolean operations. Parametric CAD (Onshape, SolidWorks) ultimately resolves features into CSG operations internally.

**STEP AP214** — The specific STEP protocol used for general mechanical design data. The "AP" stands for Application Protocol. AP214 supports full B-rep geometry, colours, and assembly structure. When FreeCAD exports a `Part.makeCylinder()` result, it writes a `CYLINDRICAL_SURFACE` entity in STEP AP214 format.

**Coaxiality** — Two cylinders are coaxial if they share the same axis line in 3D space (same direction AND same X-Y position). pyransac3d's axis direction check is sufficient to catch non-parallel cylinders, but does not guarantee they share the same line. The bug was caused by cylinders that were parallel (direction check passed) but not coaxial (X-Y centres differed).
