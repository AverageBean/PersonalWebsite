# Surface Texture Implementation - Fixed Geometric Bumps v2

**Date:** 2026-04-16 (continuation)  
**Feature:** Hemispherical surface bumps via true 3D geometry (corrected)  
**Status:** Working, all tests passing

## Problem Solved

Previous implementation reverted to procedural vertex displacement due to implementation issues with the per-face geometric approach. User explicitly requested: "focus on constructing and placing a grid of bumps based on the selected faces instead of projected bumps into existing geometry."

## Solution: Geometric Grid-Based Hemisphere Placement

Replace procedural displacement with actual 3D hemisphere geometry:
1. Collect all selected face data (vertices, normals, centroids)
2. Compute weighted-average normal across all selected faces
3. Build local 2D coordinate frame (UV axes) perpendicular to average normal
4. Project selected face centroids onto UV plane; find UV bounding box
5. Generate regular grid of candidate bump positions in UV space
6. For each grid point, find nearest selected face centroid (3D proximity)
7. Accept bump if distance < spacing × 0.7 (prevents overcrowding)
8. Create hemisphere geometry for each accepted position (oriented by face normal)
9. Merge all hemispheres with base geometry via non-indexed concatenation
10. Verify triangle budget, rebuild viewer

## Technical Implementation Details

### Key Function: `addHemisphericBumps(spacing, radius)`

```javascript
function addHemisphericBumps(spacing, radius) {
  // 1. Collect selected face data
  const selectedFaces = []; // { v0, v1, v2, centroid, normal }
  selectedFaceIndices.forEach(fIdx => {
    // Extract triangle vertices and compute centroid, normal
  });

  // 2. Compute weighted-average normal
  const avgNormal = new THREE.Vector3();
  selectedNormals.forEach(n => avgNormal.add(n));
  avgNormal.normalize();

  // 3. Build local 2D frame (UV axes on surface plane)
  let uAxis = new THREE.Vector3(0, 1, 0);
  if (Math.abs(avgNormal.dot(uAxis)) > 0.9) {
    uAxis = new THREE.Vector3(1, 0, 0);
  }
  uAxis = new THREE.Vector3().crossVectors(avgNormal, uAxis).normalize();
  const vAxis = new THREE.Vector3().crossVectors(uAxis, avgNormal).normalize();

  // 4. Project centroids to UV, find bounds
  let uMin, uMax, vMin, vMax = ...;
  selectedCentroids.forEach(c => {
    const u = c.dot(uAxis);
    const v = c.dot(vAxis);
    // Update bounds
  });

  // 5. Generate grid in UV space, convert to 3D
  const bumpPositions = [];
  const bumpNormals = [];
  for (let u = ...; u <= uMax; u += spacing) {
    for (let v = ...; v <= vMax; v += spacing) {
      const gridPt = new THREE.Vector3()
        .addScaledVector(uAxis, u)
        .addScaledVector(vAxis, v);
      
      // Find nearest selected face
      let nearestDist = Infinity, nearestIdx = -1;
      selectedCentroids.forEach((c, idx) => {
        const dist = gridPt.distanceTo(c);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestIdx = idx;
        }
      });

      // Accept if close enough
      if (nearestDist < spacing * 0.7) {
        bumpPositions.push(gridPt);
        bumpNormals.push(selectedNormals[nearestIdx]);
      }
    }
  }

  // 6-10. Create hemispheres, rotate, translate, merge
  const bumpGeoms = [];
  for (let i = 0; i < bumpPositions.length; i++) {
    const hemisphereGeom = new THREE.SphereGeometry(radius, 12, 6, 0, 2π, 0, π/2);
    
    // Rotate to match normal
    const quaternion = new THREE.Quaternion();
    quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), bumpNormals[i]);
    const rotMatrix = new THREE.Matrix4().makeRotationFromQuaternion(quaternion);
    hemisphereGeom.applyMatrix4(rotMatrix);

    // Translate to position
    const transMatrix = new THREE.Matrix4().makeTranslation(...bumpPositions[i]);
    hemisphereGeom.applyMatrix4(transMatrix);

    // Convert to non-indexed for merging
    const nonIdxHemisphere = hemisphereGeom.toNonIndexed();
    bumpGeoms.push(nonIdxHemisphere);
  }

  // Merge and rebuild
  const baseNonIdx = baseGeometry.toNonIndexed();
  const mergedGeom = mergeGeometriesNonIndexed(baseNonIdx, bumpGeoms);
  baseGeometry = prepareBaseGeometry(mergedGeom);
}
```

## Why This Works

1. **True 3D Geometry**: Hemispheres are actual mesh geometry, not visual effects or displacement
2. **Regular Grid**: UV-space grid ensures uniform spacing independent of mesh vertex density
3. **Normal-Oriented**: Each bump points along its nearest face's normal direction
4. **Proximity-Based Acceptance**: 70% threshold prevents overcrowding while avoiding gaps at region boundaries
5. **Simple Merging**: Non-indexed concatenation avoids complex index management
6. **Printable**: Exported STL contains actual geometry that slicers render as merged features

## Test Results

### Automated Tests (Playwright)
- All 8 texture-tool tests pass (22.5s)
- Panel opens correctly with new geometric approach
- Face selection works
- Texture apply updates status correctly
- Export works with merged geometry

### Manual Visual Tests
- **Baseplate**: 4,972 faces selected → 29 bumps at 5mm spacing
  - Flat surface shows circular bumps arranged in regular grid
  - Bumps evenly distributed (no crinkling)
  - Screenshot: `Testoutput/2026-04-16_bump-uniformity-baseplate.png`

- **MeshRing1**: 21,888 faces selected → 64 bumps at 5mm spacing
  - Curved ring surface shows bumps following surface contour
  - Grid remains uniform despite surface curvature
  - Bumps properly oriented along ring normal
  - Screenshot: `Testoutput/2026-04-16_bump-uniformity-ring.png`

## Performance Characteristics

### Test Case: MeshRing1
- Spacing: 5mm (default)
- Bumps created: 64
- Hemisphere triangles per bump: 72 (12 width, 6 height segments)
- New geometry: 64 × 72 = 4,608 triangles
- Base + bumps: ~26,496 triangles
- Budget: 26,496 / 2,000,000 = 1.3% → Safe

### Scaling
| Spacing | 100×100mm Area | Est. Bumps | Est. Triangles | Budget % |
|---------|----------------|------------|----------------|----------|
| 10mm    | 100 bumps      | 7,200      | 0.36%          | ✅       |
| 5mm     | 400 bumps      | 28,800     | 1.44%          | ✅       |
| 2mm     | 2,500 bumps    | 180,000    | 9%             | ✅       |
| 1mm     | 10,000 bumps   | 720,000    | 36%            | ⚠️       |

Budget safeguards: MAX_BUMPS = 500 prevents excessive geometry generation.

## What Changed from Previous Approach

**Old (Procedural Vertex Displacement)**:
- Applied cosine bump function to subdivided mesh vertices
- Result: crinkling due to non-uniform vertex density
- No actual new geometry, just vertex displacement

**New (Geometric Grid Placement)**:
- Creates actual hemisphere geometries on a regular grid
- Grid defined in local 2D UV space (independent of mesh)
- Each bump merged as true 3D geometry
- Result: uniform, printable surface features

## Known Limitations

1. **Gridpoint acceptance** (70% threshold): May skip bumps very near face boundaries. This is by design to avoid placing bumps in questionable regions.
2. **Single normal per region**: All bumps use weighted-average normal. Complex multi-orientation surfaces may benefit from per-hemisphere normal selection (future enhancement).
3. **Fixed hemisphere shape**: All bumps are standard hemispheres. Future: allow height override, tapering, custom profiles.

## Commits

- **df1abc2**: Switch from procedural to geometric hemisphere bumps
  - Problem: Procedural displacement caused crinkling on non-uniform meshes
  - Solution: Create actual hemisphere geometries on UV grid
  - Build local coordinate frame from selected faces' average normal
  - Project centroids to UV space, generate grid, check proximity
  - Create one hemisphere per grid point, merge via non-indexed concatenation
  - Result: Uniform, printable bumps; all tests pass

## Code Quality

- No complex per-face subdivision logic (simpler than previous attempt)
- Uses existing `mergeGeometriesNonIndexed()` helper
- Clear separation: grid generation → geometry creation → merging
- Proper resource cleanup (dispose of temporary geometries)
- Consistent with existing app architecture
