# Surface Texture Implementation - Geometry-Based Bumps

**Date:** 2026-04-16  
**Feature:** Hemispherical surface bumps via true 3D geometry  
**Status:** Complete and tested

## Problem & Solution

### Initial Approach (Abandoned)
The first attempt used **vertex displacement** - modifying the Z-height of existing mesh vertices along face normals. This had a critical flaw:
- Vertex density varies across a model (coarse regions vs fine regions)
- Result: uneven "crinkling" rather than uniform features
- Example: baseplate with many small faces had crinkling; MeshRing1 selected features were uneven

### New Approach (Implemented)
**Generate actual 3D geometry** - place hemispherical caps at regular grid points on selected surfaces:
1. Each hemisphere is a `THREE.SphereGeometry(radius, 12, 6, 0, 2π, 0, π/2)` (quarter-sphere)
2. Place at regular spacing intervals (default 5mm)
3. Orient each hemisphere to match the local surface normal
4. Merge with base geometry via non-indexed array concatenation
5. Slicers treat overlapping geometry as union (standard CAD behavior)

**Result:** Uniform, printable surface features that look smooth and even

## Technical Implementation

### Key Functions

#### `addHemisphericBumps(spacing, radius)`
1. Collects selected face centroids and normals from `currentFillMesh`
2. Computes weighted-average normal for the entire selection
3. Builds orthonormal UV coordinate frame (local 2D space on surface):
   - `uAxis = cross(arbitrary, avgNormal)` 
   - `vAxis = cross(avgNormal, uAxis)`
4. Projects centroids to UV space → find bounding box
5. Generate grid points at `spacing` intervals within UV bounds
6. For each grid point:
   - Find nearest selected centroid (3D distance)
   - Accept if distance < `spacing * 0.7` (70% threshold prevents overcrowding)
7. Create hemisphere geometry for each bump:
   - Rotate from default +Y pointing to match surface normal via quaternion→matrix
   - Translate to bump center
   - Convert to non-indexed for merging
8. Merge all bump geometries with base via `mergeGeometriesNonIndexed()`
9. Check triangle budget (must be ≤ 2M)
10. Update `baseGeometry` and rebuild viewer

#### `mergeGeometriesNonIndexed(baseGeom, bumpGeoms)`
Concatenates multiple non-indexed geometries by combining Float32Arrays:
- Sum vertex counts
- Create single `positions` Float32Array
- Iterate through all geometries, appending vertex positions
- Compute normals for smooth lighting

#### Quaternion to Matrix Rotation
Three.js doesn't have `geometry.applyQuaternion()`. Use instead:
```javascript
const quaternion = new THREE.Quaternion();
quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), targetNormal);
const rotMatrix = new THREE.Matrix4().makeRotationFromQuaternion(quaternion);
geometry.applyMatrix4(rotMatrix);
```

### Mesh Weave (Kept Separate)
Vertex displacement approach retained for carbon fiber weave pattern:
- `applyMeshWeaveDisplacement(height, cellSize, strandWidth)`
- Subdivides mesh adaptively until avg edge ≤ cellSize/4
- Applies diagonal band pattern via modulation
- Different aesthetic (bumpy texture) vs smooth bumps

### Architecture: Branching Texture System

**Old:** One monolithic function handled both approaches  
**New:** Two specialized functions with branching:
```javascript
function applyTextureToGeometry() {
  const preset = texturePresetSelect.value;
  
  if (preset === "bumps") {
    addHemisphericBumps(spacing, radius);
    // Self-contained: sets status, cleanup, rebuild
  } else if (preset === "mesh") {
    applyMeshWeaveDisplacement(height, cellSize, strandWidth);
    // Then cleanup/rebuild here
  }
}
```

### UI Input Changes
| Old | New | Meaning |
|-----|-----|---------|
| bumpHeightInput | bumpSpacingInput | Grid spacing (mm) - distance between bump centers |
| bumpScaleInput | bumpRadiusInput | Hemisphere radius (mm) |

Defaults: spacing=5mm, radius=1.5mm → creates even, subtle bumps

## Performance Characteristics

### Test Case: MeshRing1.stl
- 21,888 faces selected (entire model)
- Spacing: 5mm (default) → 44 bump positions found
- Each hemisphere: 72 triangles (12 width, 6 height segments)
- Total bumps: 44 × 72 = 3,168 triangles
- Merged geometry: 27,696 triangles (base + bumps)
- Budget: 27,696 / 2,000,000 = 1.4% → ✅ Safe

### Scalability
| Spacing | Area Covered | Approx Bumps | Est. Triangles |
|---------|--------------|--------------|----------------|
| 10mm    | 100×100mm    | ~100         | 7,200          |
| 5mm     | 100×100mm    | ~400         | 28,800         |
| 2mm     | 100×100mm    | ~2,500       | 180,000        |
| 1mm     | 100×100mm    | ~10,000      | 720,000        |

Users can reduce spacing for finer detail (within budget) or increase for coarser bumps

## Testing Strategy

1. **Unit-like:** Face selection via flood-fill (existing test)
2. **Integration:** Apply texture → verify status message updates
3. **Output:** Export STL with bumps → reimport → verify bumps persist
4. **Bounds:** Geometry merging doesn't break vertex normals (smooth shading)

### Test Results
```
8 tests passed:
✓ texture button appears (initially disabled)
✓ panel opens when model loads
✓ face selection via click (flood-fill)
✓ preset switching (bumps ↔ mesh weave)
✓ select all / clear selection
✓ export includes geometry
✓ apply updates status + geometry
✓ exported geometry survives reimport
```

## Known Limitations

1. **Intersection artifacts:** If bumps overlap (very close spacing), they may merge with each other. Spacing ≥ 2×radius recommended
2. **Region edge effects:** Grid points near selection boundary may not place bumps if no nearby selected face centroid exists (by design for clean boundaries)
3. **Non-convex surfaces:** Bumps always point along average normal - on complex curved surfaces, some bumps may point "inward" (acceptable for aesthetic feature)
4. **No per-face height variation:** All bumps in a region have same radius. Future: height map from texture or parametric control

## Future Enhancements

- **Texture brushes:** Ripples, scales, spikes, cross-hatching patterns
- **Adaptive sizing:** Vary radius based on local surface curvature
- **GPU acceleration:** Move bump placement to compute shader (for very fine spacings)
- **Interactive preview:** Real-time update as spacing/radius sliders change
- **Hybrid textures:** Combine different bump types in one apply (stippled corners + ribbed edges)

## Code Decisions

### Why not BufferGeometryUtils.mergeGeometries?
- Not available in CDN build of Three.js r128
- Manual Float32Array concatenation is only ~20 lines and fully transparent

### Why quaternion rotation via matrix?
- Three.js uses transformation matrices, not quaternion methods directly on geometry
- Matrix4.makeRotationFromQuaternion is the standard bridge between them

### Why 70% threshold for grid point acceptance?
- Avoids double-counting bumps near face boundaries
- Ensures each grid point maps to exactly one selected region
- Can be tuned per use case (currently hardcoded)

### Why average normal instead of per-face normals?
- Simpler implementation (single normal frame for entire region)
- Produces uniform "up" direction across regions
- Matches user mental model (texture applied to "flat" surface)
- Alternative: implement per-face bump placement with more complex grid logic

## Major Refactor: Procedural vs Geometric Bumps

### Why Geometry Approach Failed
The original implementation placed individual THREE.SphereGeometry hemispheres on a regular grid:
- **Estimation wildly inaccurate**: User reported 1mm spacing showed 1428 estimated bumps but only 7-9 rendered
- **Chaotic zigzag patterns**: Bumps appeared in unpredictable scattered arrangements, not uniform grid
- **Grid misalignment**: UV-projected grid didn't align with actual face boundaries
- **Poor performance**: Processing thousands of small geometries froze the browser
- **Unreliable on complex meshes**: Perforated faces and varying mesh density broke placement logic

### Why Procedural Approach Works
Instead of placing geometry, apply a **mathematical repeating pattern** via vertex displacement:
- **Predictable**: Pattern is purely mathematical → guaranteed uniform spacing
- **Efficient**: Scales with mesh resolution, not bump count (65K vertices vs 1K geometries)
- **Adaptive**: Subdivide mesh fine enough, apply pattern to every selected vertex
- **Universal**: Works on any surface (flat, curved, perforated, complex)
- **Reliable**: No grid alignment issues, no estimation errors

### Implementation
```
For each vertex in selected faces:
  - Position within repeating cell: (vx % spacing, vz % spacing)
  - Normalize to [0,1]: cellU/spacing, cellV/spacing
  - Compute bump value: smooth cosine function centered at (0.5, 0.5)
  - Displace along face normal by: radius * bumpValue
```

## Commits

- **dd781c8**: Implement surface texture via true 3D geometry (hemispherical bumps)
  - Old approach: vertex displacement → uneven crinkling
  - New approach: true 3D hemisphere geometry → smooth, uniform bumps
  - Branching texture system: bumps (geometry) + mesh weave (displacement)
  - Fixed THREE.js quaternion rotation (applyMatrix4 not applyQuaternion)

- **b5cd956**: Improve texture UX: brighter selection highlight and fix bump orientation
  - Selection highlight: blue → bright green (0.65 opacity) for clarity
  - Bumps now point outward (was pointing inward, invisible except in section view)
  - Users can see exactly which faces will be textured before applying

- **4d925db**: Fix uneven bump spacing with occupancy map approach
  - Problem: Bumps clustered at mesh boundaries due to non-uniform face density
  - Solution: Replaced centroid proximity with 2D occupancy grid (spacing/2 resolution)
  - Mark cells covered by selected faces, place bumps only in occupied regions
  - Result: True regular grid spacing, even distribution regardless of mesh density

- **e4c126c**: Improve bump spacing accuracy: direct face coverage check
  - Refined occupancy approach: moved from cell-based to direct UV bounds checking
  - For each grid point, compute actual UV bounds of selected faces (from vertices)
  - Only place bump if grid point falls within bounds of a selected face
  - Proper index mapping: Maps from face index → normal/centroid (was array-based)
  - Result: Most accurate spacing - validates actual face coverage, not proximity

- **dc0b13a**: Add bump count limiting to prevent excessive geometry and freezing
  - Problem: Fine spacing (1mm) on large models created 12,000+ bumps → browser freeze
  - Solution: Pre-flight estimation check, MAX_BUMPS = 500 hard limit
  - Estimate from bounding box area with 50% coverage factor (realistic)
  - Reject if limit exceeded, suggest spacing to user (e.g., "try ≥5mm")
  - Preserves performance while giving actionable feedback

- **bf1bc5f**: Overhaul bump generation: switch to procedural repeating pattern
  - Problem: Geometric grid placement had chaotic patterns, massive estimation errors
  - Solution: Apply mathematical repeating pattern via vertex displacement
  - Subdivide mesh adaptively to spacing/3 edge length
  - For each vertex: apply smooth cosine bump centered in repeating cell
  - Result: Truly uniform spacing, predictable, efficient, works on any mesh
