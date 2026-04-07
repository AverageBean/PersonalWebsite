# 2026-04-07: Phase B.5 — Sphere Detection & Blind Hole Inference

## What Changed

Three additions to the parametric STEP converter (`tools/convert-stl-to-step-parametric-with-freecad.py`):

### 1. Sphere Detection (B.5-2)

**Problem**: Geometry composed of spherical surfaces (e.g. `TestDocs/Spheres.stl` — 5 intersecting spheres, 81,850 triangles) produced a 90MB triangulated STEP fallback with zero analytical surfaces.

**How it works**:
- `detect_spheres()` runs iterative RANSAC via `pyransac3d.Sphere` on faces unclaimed by plane/cylinder/torus detection
- Each round fits a sphere, classifies it as convex (body) or concave (cavity) via normal dot-product with radial direction
- Detected spheres are assembled via `build_sphere_solid()`: convex spheres fused (`Part.makeSphere` + `.fuse()`), concave spheres subtracted (`.cut()`)
- New routing in `build_parametric_solid()`: if box and cylindrical paths fail and spheres were detected, falls through to sphere CSG path

**Result**: 5 `SPHERICAL_SURFACE` entities, 7.6KB output, volume ratio 1.008, mean deviation 0.093mm.

### 2. Blind Hole Depth Inference (B.5-1)

**Problem**: The mold top half (`TestDocs/MeshRing1-mold-top.stl`) has pin holes that only penetrate ~1.3mm from the split plane. The converter cut them through the full 12.87mm height, losing 38% of material.

**How it works**:
- `detect_circle_holes()` now records `depth_min` and `depth_max` for each hole cluster — the min/max of face-centre coordinates along the cap axis
- In `build_box_solid()`, each hole's depth span is compared against `BLIND_HOLE_DEPTH_RATIO * part_height` (threshold = 0.25)
- Below threshold → blind hole: cut extends from the nearest external face inward to the actual depth
- Above threshold → through-hole: existing full-height cut with margin

**Key calibration issue**: The baseplate's center hole (a genuine through-hole) has face-centre span of only 33% of the part height because intersecting slot cuts remove portions of the cylindrical wall. Setting the threshold at 0.25 (not 0.85 or 0.40) correctly classifies both the baseplate center hole (0.33 > 0.25 → through) and mold pin holes (0.10 < 0.25 → blind).

### 3. Cylinder RANSAC Early-Exit

**Problem**: On sphere-dominated geometry, cylinder RANSAC runs 10 rounds × 3000 iterations fitting spurious great-circle slices, taking ~7.5 minutes on 31k horizontal faces.

**How it works**:
- After 3 RANSAC rounds, check if detected cylinder axes are consistent (pairwise dot product > 0.98)
- If all three axes diverge → non-cylindrical geometry → rollback all claimed faces and return empty
- Spheres.stl conversion: 7.5 min → 2.5 min (3× speedup)

### 4. Streaming Parametric Conversion Progress

**What**: The converter server now supports `?stream=true` for NDJSON progress streaming. The webapp shows real-time phase updates ("Detecting cylindrical surfaces…", "Coverage: 93.7%", etc.) during parametric STEP export.

**Files changed**:
- `tools/converter-server.js`: `runFreeCadParametricConversion` accepts `onProgress` callback, streams `[parametric]` log lines as NDJSON events
- `js/app.js`: `convertStlBlobToStepStreaming()` reads the NDJSON stream, maps phase headers to user-friendly status messages

## Key Lessons

### Face-Centre Span ≠ Feature Depth
When intersecting features (slot cuts through a cylindrical hole) remove wall faces, the remaining face centres only cover a fraction of the actual hole depth. Depth classification thresholds must be set low enough to account for this — 0.25 handles the worst observed case (baseplate: 33% span for a through-hole).

### Great Circles Are Spurious Cylinders
Sphere surfaces have great circles that RANSAC fits as cylinders with high inlier counts. The tell: successive fits produce wildly varying axes (a real part has coaxial cylinders). Checking axis consistency after 3 rounds catches this with minimal wasted computation.

### Sphere CSG Is Straightforward
Unlike torus detection (which required algebraic fitting + `makeFillet` to avoid topological fragmentation), spheres work cleanly with `Part.makeSphere()` + boolean fuse/cut. OpenCASCADE computes analytical sphere-sphere intersection curves natively.

## Metrics Impact

| Part | Metric | Phase B | Phase B.5 |
|------|--------|---------|-----------|
| Spheres.stl | File size | 90 MB | **7.6 KB** |
| Spheres.stl | SPHERICAL_SURFACE | 0 | **5** |
| Spheres.stl | Vol ratio | N/A | **1.008** |
| MeshRing1 | Vol ratio | 0.986 | 0.984 (unchanged) |
| MeshRing1 | Hausdorff | 0.295mm | 0.339mm (unchanged) |
| Baseplate | Vol ratio | 0.996 | 0.996 (unchanged) |
| Baseplate | Hausdorff | 0.955mm | 0.955mm (unchanged) |
| Mold top | Vol ratio | 0.621 | 0.741 (pin holes fixed) |
| Spheres.stl | Convert time | ~7.5 min | **2.5 min** |
