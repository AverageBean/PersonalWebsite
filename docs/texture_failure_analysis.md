# Surface Texture Feature — Failure Analysis and Root Cause Investigation

**Date:** 2026-04-17  
**Status:** Historical reference — described code has been reverted  
**Objective:** Documents the failure modes of the previous implementation to inform the new approach

---

## Executive Summary

The surface texture feature (bumps and mesh weave presets) was implemented with two distinct geometry approaches, documented as "working" in learning logs with "all tests passing." However, user reports indicate:

- **Crinkling** (non-uniform visual artifacts)
- **Non-uniform patterns** (spacing/density inconsistencies)
- **Outright failure** (feature doesn't apply, produces invalid geometry, or exports incorrectly)
- **Test coverage gap**: Existing tests are functional (buttons appear, functions execute) but **do not validate** that textures are actually visible, uniform, or printable

This document systematically identifies failure mechanisms and their root causes.

---

## Known Failure Modes

### 1. Hemispherical Bumps (Geometric Approach)

**Current Implementation (`addHemisphericBumps`):**
- Collects selected face centroids and normals
- Computes weighted-average normal across all selected faces
- Builds local 2D UV coordinate frame (uAxis, vAxis) perpendicular to average normal
- Projects face centroids to UV space; finds bounding box
- Generates regular grid of candidate positions in UV space
- Filters grid points: accept only if nearest centroid is within `spacing * 0.7`
- Creates actual hemisphere geometry for each accepted position
- Merges all hemispheres with base mesh via non-indexed concatenation

**Documented Failures:**
- Earlier attempts resulted in "chaotic zigzag patterns," "crinkling," "massive estimation errors"
- Switch to procedural approach was attempted but later reverted
- Current v2 claims "all tests passing" but lacks evidence of actual texture uniformity

**Root Cause Questions:**

1. **Weighted-Average Normal Assumption**
   - Q: Does average normal accurately represent surface orientation for non-planar selections?
   - Q: On curved surfaces (e.g., MeshRing1), does single averaged normal cause bumps to point in inconsistent directions?
   - **Hypothesis:** Selected faces on curved geometry have heterogeneous normals; averaging them creates a "best-fit" plane that doesn't align with actual surface, causing visual artifacts

2. **UV Space Projection Validity**
   - Q: For non-planar face sets, does UV projection accurately map 3D geometry to 2D space?
   - Q: Does projection distortion cause grid spacing to be non-uniform in world space?
   - **Hypothesis:** On complex geometry, projected faces are non-adjacent in UV space even though they're adjacent in 3D, breaking spatial coherence

3. **Proximity Threshold (70% of spacing)**
   - Q: Why is 0.7 × spacing the decision boundary? Is it empirically validated?
   - Q: Does this threshold create visible gaps or over-placement at region boundaries?
   - **Hypothesis:** Arbitrary threshold may skip valid positions near boundaries, creating jagged edges to textured regions

4. **Grid Point to Face Matching**
   - Q: When a grid point maps to the nearest centroid, is that centroid always on a selected face?
   - Q: On selected regions with poor centroid distribution, do grid points fail to find matches?
   - **Hypothesis:** Centroid-nearest distance doesn't guarantee the point is on a selected face; grid points can land between faces

---

### 2. Mesh Weave (Vertex Displacement Approach)

**Current Implementation (`applyMeshWeaveDisplacement`):**
- Subdivides base geometry adaptively until average edge length ≤ `cellSize / 4`
- Converts to non-indexed geometry for per-vertex processing
- Collects selected face centroids from original mesh
- Builds spatial grid for O(1) proximity queries
- For each vertex: checks if within proximity threshold of any selected centroid
- If selected: applies `meshValue()` formula (diagonal band pattern) and displaces along face normal
- Recomputes vertex normals and re-indexes

**Documented Failures:**
- Initial attempts caused "uneven crinkling" due to non-uniform vertex density
- Displacement formula works but results vary by mesh resolution

**Root Cause Questions:**

1. **Centroid-Based Face Membership**
   - Q: Does proximity to a selected face's centroid guarantee a vertex belongs to that face?
   - Q: On densely subdivided mesh, can a vertex be "selected" even if it's on a nearby unselected face?
   - **Hypothesis:** Grid-based proximity lookup is coarse; vertices can be incorrectly classified as selected, causing texture to "bleed" onto adjacent unselected faces

2. **Vertex Normal Consistency**
   - Q: After subdivision, are face normals smoothly interpolated or are they discontinuous?
   - Q: Does `computeVertexNormals()` properly smooth discontinuities, or does it create creases?
   - **Hypothesis:** Vertex normals may point in unexpected directions on edges between faces, causing displacement vectors to misalign with surface

3. **Subdivision-Dependent Texture Appearance**
   - Q: Does the same input (height, cellSize, strandWidth) produce visually different results on meshes with different density?
   - Q: Is texture appearance scale-invariant (i.e., same relative appearance regardless of face size)?
   - **Hypothesis:** Texture appearance is mesh-dependent, not material-dependent. Fine meshes show smooth texture; coarse meshes show jagged artifacts

4. **Proximity Threshold Adaptation**
   - Q: How is `proximityThreshold` calculated? Is `2 × sqrt(originalFaceArea)` empirically correct?
   - Q: Does threshold adapt correctly to models of different scales (mm vs µm vs cm)?
   - **Hypothesis:** Fixed threshold formula may be too loose on fine meshes (over-select) or too tight on coarse meshes (under-select)

---

### 3. Cross-Cutting Issues

#### Test Coverage Gap
- **Current tests**: Functional (button appears, panel opens, apply executes)
- **Missing tests**: Validate that texture is actually visible and uniform
  - No visual regression tests (export and reimport, check appearance)
  - No parametric sweep tests (vary spacing/height, verify output scales correctly)
  - No cross-section inspection (slice textured model, verify bump geometry)
  - No symmetry tests (texture on symmetric surfaces should produce symmetric results)

#### Geometry Merging Reliability
- **`mergeGeometriesNonIndexed()` function**: Concatenates Float32Arrays from multiple geometries
- **Q:** Does concatenation preserve face integrity? Are normals recomputed correctly?
- **Q:** Does merging cause z-fighting, overlap artifacts, or disconnected components?
- **Hypothesis:** Merged geometry may have subtle topological defects (unreferenced vertices, duplicate faces, degenerate triangles) that render correctly in viewer but fail in slicers

#### Export Format Validation
- **Q:** When textured geometry is exported as STL and reimported, does the texture persist?
- **Q:** Do slicing/printing software correctly interpret the merged hemisphere geometry?
- **Hypothesis:** Exports may be topologically invalid (e.g., unclosed surface, disconnected components) that viewers tolerate but slicers reject

---

## Failure Mechanism Summary

### Bumps Feature

| Mechanism | Evidence | Likely Impact |
|-----------|----------|---------------|
| Average normal misalignment | Curved surfaces (Ring, Baseplate) report crinkling | Bumps point in inconsistent directions |
| UV projection distortion | Non-planar face sets | Grid spacing non-uniform in world space |
| Proximity threshold arbitrariness | "70%" threshold hardcoded | Visible gaps or over-placement at boundaries |
| Centroid-grid mismatch | Grid points may not overlap selected faces | Bumps skip positions or appear in wrong locations |
| Normal recomputation | Merged geometry normal recalculation untested | Merged bumps may have incorrect shading/orientation |

### Mesh Weave Feature

| Mechanism | Evidence | Likely Impact |
|-----------|----------|---------------|
| Centroid-based classification | Proximity-based selection | Texture bleeds onto unselected faces |
| Vertex normal discontinuity | Coarse meshes show jagged artifacts | Displacement vectors misaligned with surface |
| Mesh-dependent appearance | Same parameters vary by density | Not user-friendly; requires re-tuning per mesh |
| Threshold calculation | Formula `2 × sqrt(area)` not validated | Over/under-selection on different scales |
| Displacement formula | `meshValue()` uses hardcoded band widths | May not adapt to model scale properly |

---

## Critical Questions to Answer

### Design Level
1. **What is the intended use case?** Pure visual embellishment, or must texture be printable?
2. **Should texture respect model scale?** Should same spacing (5mm) produce same visual appearance on 10mm and 100mm models?
3. **Is per-face texture variation acceptable?** Or must texture be uniform across entire selected region?
4. **What's the performance budget?** Can we afford sub-1mm resolution on large models?

### Implementation Level
1. **Geometric vs Procedural:** Which approach is more robust? Should we commit to one?
2. **Face membership:** How should we definitively determine which vertices belong to selected faces?
3. **Normal orientation:** How should bumps be oriented on curved surfaces? Per-face normals vs averaged?
4. **Export validity:** What post-processing is needed to ensure exported STL is valid for slicing software?

### Validation Level
1. **Visual uniformity:** How do we automatically detect crinkling or non-uniform spacing?
2. **Printability:** How do we test that exported geometry will actually print correctly?
3. **Regression:** What metrics should we track to prevent re-introduction of failures?

---

## Immediate Next Steps

1. **Manual Testing**: Load test models, apply textures, inspect:
   - Visual appearance in 3D viewer (uniform? oriented correctly?)
   - Exported STL integrity (reimport and verify)
   - Cross-section slices (inspect geometry of bumps/weave)

2. **Root Cause Validation**: For each failure mode above, test:
   - Flat surfaces (expected: uniform spacing, no artifacts)
   - Curved surfaces (expected: bumps follow surface, no crinkling)
   - Small selections (expected: bumps placed consistently)
   - Large selections (expected: no gaps, no boundary artifacts)

3. **Documentation**: Create detailed test report with:
   - Before/after screenshots
   - STL cross-section analysis
   - Parametric sweep results (spacing vs visual output)

4. **Redesign**: Based on findings, propose:
   - Clearer specification of texture behavior
   - More robust implementation strategy
   - Comprehensive test suite covering failure modes

