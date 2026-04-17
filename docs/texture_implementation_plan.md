# Surface Texture Feature — Comprehensive Implementation Plan

**Date:** 2026-04-17  
**Status:** Pre-implementation Planning  
**Objective:** Design and validate a robust approach to apply surface textures (bumps, weave) to 3D models with proven uniformity, printability, and visual consistency

---

## Feature Specification (Revised)

### Primary Goal
Apply **predefined texture patterns** to user-selected model surfaces in a way that:
1. **Visual consistency**: Texture appearance is uniform and predictable across the selected region
2. **Printability**: Exported geometry is valid for FreeCAD slicing and 3D printing
3. **Scalability**: Same texture parameters produce visually similar results regardless of model size
4. **User control**: Users can preview texture before applying and reset if unsatisfied

### Texture Patterns (MVP)
1. **Hemispherical bumps**: Regular grid of small domes protruding from surface
2. **Mesh weave**: Diagonal band pattern simulating fabric/fiber texture

### Non-Goals
- Real-time texture painting (future enhancement)
- Normal-map baking (optimization for renderers, not relevant for 3D printing)
- Arbitrary shape textures (constrain to geometric primitives that are reliably valid)

---

## Root Cause Diagnosis and Proposed Solutions

### Problem 1: Averaged Normal Creates Misaligned Bumps on Curved Surfaces

**Root Cause:**
- Current approach computes single weighted-average normal for entire selected region
- On curved geometry, individual face normals diverge significantly
- Single average normal is a best-fit approximation that doesn't align with actual surface

**Example Failure:**
- Select outer surface of MeshRing1 (ring): normals vary 0–360° around circumference
- Average normal points radially outward (or inward, depending on winding)
- Bumps placed on average normal's grid all point in same direction
- Result: bumps on side of ring point perpendicular to surface (look "wrong"), not tangent

**Proposed Solution: Per-Face Normal Bumps**
- For each selected face: compute its own normal
- Instead of single grid, place bumps distributed across all selected faces
- Each bump uses the normal of its nearest selected face
- Trade-off: More bumps, but correctly oriented
- Implementation: Octree or kd-tree for fast "nearest face" queries

**Alternative (Simpler): Limit Selection to Planar Faces**
- Add validation: reject selections where face normals differ by >20° (or user-specified tolerance)
- Inform user: "Selection is not planar. Try selecting faces with similar orientation."
- Simpler implementation, clearer user expectation

**Recommended Approach:** Start with per-face normal bumps (more general), validate on Ring + Baseplate

---

### Problem 2: Proximity Threshold (0.7 × spacing) Creates Gaps and Over-Placement

**Root Cause:**
- Threshold is empirically derived without justification
- Grid points outside threshold are rejected, leaving visible gaps
- On non-convex selections, boundary points fail to match any centroid

**Example Failure:**
- Select a U-shaped region: grid points in the "valley" between the two arms
- Nearest centroid on opposite arm may be far away
- Grid points rejected, creating stripe of missing bumps

**Proposed Solution: Coverage-Based Grid Filtering**

1. For each selected face: compute its bounding box in UV space (from its 3 vertices)
2. For each grid point: check if it overlaps ANY selected face's bounds (not just nearest centroid)
3. Accept grid point if it overlaps at least one selected face

**Algorithm:**
```
for each grid point (u, v):
  isInside = false
  for each selected face:
    if UV_bounds_of_face.contains(grid_point):
      isInside = true
      break
  if isInside:
    bump_normal = normal_of_containing_face
    place_bump(grid_point, bump_normal)
```

**Advantage:** No arbitrary threshold; purely geometric (face containment)

---

### Problem 3: Mesh Weave Vertex Displacement Bleeds Onto Adjacent Faces

**Root Cause:**
- Proximity-based selection (grid cell within threshold of selected face centroid) is over-inclusive
- Vertices on unselected faces can be within threshold, causing texture to "spread"

**Example Failure:**
- Select top face of baseplate
- Vertices on adjacent vertical faces are close to top face centroid
- Mesh weave displaced on vertical faces too (visible artifact)

**Proposed Solution: Explicit Face Membership Tracking**

1. Mark which triangles belong to selected faces (binary array, size = num_triangles)
2. During subdivision: propagate face membership to child triangles
3. When displacing vertices: only displace if the vertex's triangle is marked as selected

**Algorithm:**
```
// Before subdivision
selectedTriangles = new Set(selectedFaceIndices)

// Subdivision: inherit membership
for each child triangle:
  childSelectedTriangles.add(parentTriangleID)

// Displacement
for each vertex v:
  // Find which triangle(s) own this vertex
  ownerTriangles = triangles_containing_vertex(v)
  isSelected = ownerTriangles.some(t => selectedTriangles.has(t))
  if isSelected:
    displace(v)
```

**Trade-off:** Requires tracking triangle ownership through subdivision (more bookkeeping)

---

### Problem 4: Mesh-Dependent Texture Appearance (Procedural Displacement)

**Root Cause:**
- Texture appearance depends on vertex density and distribution
- Fine meshes show smooth texture; coarse meshes show jagged artifacts
- Same parameters don't produce consistent visual appearance

**Example Failure:**
- Apply mesh weave (cellSize=5mm) to MeshRing1 and Baseplate
- Ring (curved, fine mesh): smooth, even weave pattern
- Baseplate (flat, coarse mesh): jagged bands, uneven spacing
- User confusion: same parameters, different appearance

**Proposed Solution: Adaptive Subdivision Before Texture**

1. Compute target edge length based on texture parameters: `targetEdgeLen = textureScale / 3`
2. Subdivide selected region ONLY (not entire model) until edge length ≤ target
3. Then apply texture displacement

**Benefits:**
- Texture appearance becomes scale-independent
- Smaller geometry budget (only selected faces subdivided)
- More predictable user experience

**Implementation:**
```
// Only subdivide selected faces
selectedGeom = extract_faces(baseGeom, selectedFaceIndices)
subdivided = adaptive_subdivide(selectedGeom, targetEdgeLen)
textured = apply_displacement(subdivided)
unselected = extract_faces(baseGeom, NOT selectedFaceIndices)
result = merge(textured, unselected)
```

---

### Problem 5: Test Coverage Gap (No Validation of Actual Texture)

**Root Cause:**
- Tests check function execution, not visual output
- No regression tests for visual uniformity
- No parametric validation (spacing vs output)

**Proposed Solution: Comprehensive Test Suite**

#### Visual Regression Tests (Playwright)
1. **Flatness check**: Load flat model, apply bumps, export, reimport
   - Verify bump height matches parameter (within 1% tolerance)
   - Verify bump spacing matches parameter (within 2% tolerance)
   - Verify texture uniform across surface (check STL cross-section)

2. **Curved surface check**: Load curved model, apply bumps
   - Verify bumps follow surface curvature
   - Verify bumps point outward (not into surface)
   - No crinkling or artifacts in export

3. **Boundary check**: Select partial region, apply texture
   - Texture stops at boundary (no bleed)
   - No gaps at edges
   - Symmetric for symmetric selections

4. **Scale independence**: Apply same texture to models at different scales
   - Spacing parameter should produce visually similar result at 10mm and 100mm scale

#### Parametric Tests
- **Spacing sweep**: Apply bumps at spacing 1, 2, 3, 5, 10mm on same geometry
  - Measure actual spacing in exported STL (cross-section)
  - Verify spacing scales linearly with parameter

- **Radius sweep**: Apply bumps at radius 0.5, 1, 2, 5mm
  - Verify height in exported STL matches parameter

- **Coverage test**: Select 10%, 50%, 100% of faces
  - Verify texture only on selected faces
  - No bleeding to unselected areas

#### Metrics to Track
- **Bump spacing uniformity**: std dev of actual gap between bump centers / mean spacing
- **Bump height accuracy**: measured height vs parameter / parameter
- **Coverage precision**: % of selected faces with texture / total selected faces
- **Export integrity**: reimport and verify triangle count within 0.5% of input

---

## Implementation Roadmap

### Phase 1: Clarification & Validation (Current)
- [x] Identify failure modes and root causes
- [ ] Test current implementation on test models
- [ ] Create failure reproduction cases
- [ ] Measure baseline metrics (spacing uniformity, coverage, etc.)

### Phase 2: Redesign (Proposed)
- [ ] Decide: per-face normals vs planar-faces-only constraint
- [ ] Implement coverage-based grid filtering for bumps
- [ ] Implement explicit face membership tracking for weave
- [ ] Add adaptive subdivision for consistent texture appearance

### Phase 3: Validation
- [ ] Implement visual regression tests
- [ ] Implement parametric sweep tests
- [ ] Test on diverse models (flat, curved, complex)
- [ ] Create test report with metrics and comparison to baseline

### Phase 4: Hardening
- [ ] Add user-facing error messages (e.g., "Selection is not planar, try larger selection")
- [ ] Implement undo/redo for texture applications
- [ ] Optimize performance for large models (octree for spatial queries)
- [ ] Export validation (check STL integrity before allowing export)

---

## Technical Design Details

### Geometry Pipeline for Bumps (Per-Face Normal Approach)

```
1. Collect Selected Face Data:
   - Extract all faces in selectedFaceIndices
   - Compute normal for each face
   - Store face ID → normal, centroid, bounds

2. Build Spatial Index:
   - Octree or kd-tree over selected face centroids
   - For O(log n) nearest-face queries

3. Generate Bumps:
   - For each pair of faces: compute average normal (locally), build local UV frame
   - Generate grid of candidate positions in UV space
   - For each grid point: query spatial index for nearest face
   - Check if grid point overlaps nearest face's UV bounds
   - If yes: place bump with that face's normal

4. Merge:
   - Convert base and bump geometries to non-indexed
   - Concatenate vertex/normal/index arrays
   - Recompute indices for merged geometry

5. Validate:
   - Check triangle budget (≤ 2M)
   - Recompute vertex normals for smooth shading
   - Store pre-texture geometry for reset
```

### Geometry Pipeline for Weave (Explicit Face Membership)

```
1. Backup & Mark:
   - Clone baseGeometry → preTextureGeometry
   - Mark selectedFaceIndices in binary array (selectedTriangles)

2. Subdivide:
   - Adaptively subdivide only selected faces to targetEdgeLen
   - Propagate face membership: child triangles inherit parent's selected status

3. Displace:
   - For each vertex: determine if it belongs to any selected triangle
   - If yes: apply meshValue() formula and displace along face normal
   - Recompute vertex normals

4. Rebuild:
   - Re-index geometry
   - Merge selected + unselected components
   - Prepare for rendering
```

---

## Success Criteria

### Visual Uniformity
- [ ] Bump spacing deviation < 5% on flat surfaces
- [ ] Texture appears uniform across curved surfaces (no crinkling)
- [ ] Texture stops cleanly at region boundaries (no bleed)

### Printability
- [ ] Exported STL validates in FreeCAD (no unclosed surfaces, no degenerate triangles)
- [ ] Textured model can be sliced without errors
- [ ] Texture geometry persists through reimport

### User Experience
- [ ] Parameter changes produce proportional visual changes
- [ ] Error messages guide users when texture cannot be applied
- [ ] Reset button always restores original geometry
- [ ] Texture preview visible before apply

### Performance
- [ ] Bump application < 1s for models with 100k triangles
- [ ] Weave application < 2s for models with 100k triangles
- [ ] Memory usage stays within 200MB budget

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Per-face normal approach too complex | Start simpler: planar-faces-only constraint with validation |
| Grid filtering still misses valid positions | Use overlapping UV bounds instead of point containment |
| Exports still invalid for slicing | Add post-processing step to validate/repair geometry |
| Performance degrades on large models | Use spatial indices (octree/kd-tree), limit MAX_BUMPS, add streaming |
| Users confused by texture appearance | Implement real-time preview with immediate visual feedback |

---

## Acceptance Criteria

Implementation is considered **complete and validated** when:

1. ✅ All failure mode tests pass (flat, curved, partial, scale-independent)
2. ✅ Parametric sweep tests show <5% deviation
3. ✅ Export validation confirms STL integrity
4. ✅ User documentation explains texture behavior and limitations
5. ✅ Test report published with metrics and before/after comparisons

