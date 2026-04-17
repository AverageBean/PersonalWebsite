# Surface Texture — Triplanar Upgrade Plan

**Date:** 2026-04-17  
**Status:** Ready to implement  
**Reference tools:** Formlabs Meshy (Texture Engine), BumpMesh / stlTexturizer  
**Goal:** Match the uniformity and surface-following quality of professional tools while retaining face-selective application as our differentiator

---

## Current State (as of this commit)

### What works
- Face selection: flood-fill click (30° normal threshold), shift-click accumulate, Select All, Clear
- Hemispherical bumps: cluster-based placement (30° BFS threshold), per-face normal orientation, centroid fallback for zero-hit clusters
- Mesh weave: explicit triangle ownership, per-face UV sampling (Phase 3), adaptive subdivision
- Apply/Reset lifecycle with single-level undo
- Tests: `tests/texture-phase1-clusters.spec.js` (8/8)

### Benchmark results (Aloy Focus, 5mm spacing, select all)
| Metric | Value |
|--------|-------|
| Clusters | 31 |
| Bumps placed | 68 |
| Expected on flat 45×40mm surface | ~72 |
| Coverage estimate | ~75% (visible gaps at cluster seams) |

### Root cause of remaining gaps
Per-cluster flat projection produces seams at every cluster boundary. Two adjacent clusters
have independent UV frames — neither covers the edge between them. On the Aloy Focus
(31 clusters) this means 31 seam lines, each typically 2–5mm wide.

---

## Target: Triplanar Projection

Triplanar projection eliminates cluster seams by blending three axis-aligned projections
weighted by how much the face normal aligns with each axis:

```
wx = |n.x|^k,  wy = |n.y|^k,  wz = |n.z|^k    (k = 4 → sharp blends, k = 1 → soft)
w_total = wx + wy + wz

pattern_value = (wx · P(v.y, v.z)            // YZ plane (used on X-facing surfaces)
              + wy · P(v.x, v.z)            // XZ plane (used on Y-facing surfaces)
              + wz · P(v.x, v.y))           // XY plane (used on Z-facing surfaces)
              / w_total
```

Where `P(a, b)` is the pattern function sampled at coordinates `(a, b)`.

### Why this solves the seam problem
- No cluster partitioning required — the same formula applies to every face
- Adjacent faces naturally blend because their normals are similar → similar weights → similar pattern values
- Horizontal faces get pure XZ projection; vertical faces get pure XY or YZ; chamfers blend smoothly

### Parameter `k` (blend sharpness)
- `k = 1`: soft blend — visible pattern overlap at transitions (slight smearing)
- `k = 4`: standard — clean transitions with minimal blending zone (~2–3 triangles wide)
- `k = 8`: crisp — nearly hard-cut transitions, can show slight discontinuity on shallow-angle transitions

Expose as UI control "Blend sharpness" (1–8, default 4) or fix at 4 and hide.

---

## Step 1 — Triplanar Weave (est. 0.5 days)

**Target function:** `applyMeshWeaveDisplacement` in `js/app.js`

**Current code (per-face UV):**
```javascript
const val = meshValue(v.dot(uAxis), v.dot(vAxis), cellSize, strandWidth);
```

**New code (triplanar blend):**
```javascript
function triplanarMeshValue(v, n, cellSize, strandWidth, k) {
  const wx = Math.pow(Math.abs(n.x), k);
  const wy = Math.pow(Math.abs(n.y), k);
  const wz = Math.pow(Math.abs(n.z), k);
  const wt = wx + wy + wz || 1;
  return (wx * meshValue(v.y, v.z, cellSize, strandWidth)
        + wy * meshValue(v.x, v.z, cellSize, strandWidth)
        + wz * meshValue(v.x, v.y, cellSize, strandWidth)) / wt;
}
```

Replace the `d(v)` function inside `subdivideAndDisplace`:
```javascript
function d(v) {
  const val = triplanarMeshValue(v, normal, cellSize, strandWidth, 4);
  return v.clone().addScaledVector(normal, height * val);
}
```

`normal` is already passed as a parameter — no further changes needed to the call chain.
The cluster loop and frame computation are removed from the weave path entirely.

**What to remove:** The `uAxis/vAxis` frame construction and `subdivideAndDisplace` parameter
threading added in Phase 3 are replaced by the triplanar function. Phase 3's explicit
triangle ownership (no proximity bleed) is preserved — only the UV sampling changes.

**Expected result:** Weave stripes align with world-space grid but adapt smoothly to surface
orientation. No per-cluster seams. Pattern pitch is consistent on flat, tilted, and curved faces.

---

## Step 2 — Triplanar Bump Placement (est. 1–2 days)

**Target function:** `addHemisphericBumps`

**Current approach:** Per-cluster flat grid → barycentric test → per-face normal.

**New approach:** Global triplanar grid → bump at every point where the grid function exceeds
a threshold, projected onto the nearest selected face.

### Algorithm

```
1. Compute global AABB of all selected faces in world space.

2. For each world-space grid point (x, y, z) on the three axis-aligned grids
   at step = spacing:
   
   XY grid: for z = z_min; z <= z_max; z += spacing
              for x = x_min; x <= x_max; x += spacing
                candidate = (x, 0, z) → project onto selection

   YZ grid: for x = x_min; ...
              for y = y_min; ...
                candidate = (0, y, z) → project onto selection

   XZ grid: for x = x_min; ...
              for z = z_min; ...
                candidate = (x, y, 0) → project onto selection

3. For each candidate grid point:
   a. Find nearest selected face by centroid distance.
   b. Project candidate onto that face's plane.
   c. Run barycentric containment test against that face.
   d. If inside: weight = |n · axis|^k for the axis this grid came from.
   e. Accumulate candidate with its weight.

4. After all three grids: deduplicate candidates within spacing/2 of each other
   (keep the one with highest weight sum). This prevents double-bumps at
   surfaces that score highly on two axes (e.g. a 45° chamfer).

5. Place hemisphere at each accepted candidate using the face's own normal.
```

### Deduplication detail
Two candidates A and B from different grid axes are duplicates if:
`|A.position - B.position| < spacing × 0.5`
Keep whichever has the higher `|n · axis|` weight. Discard the other.

**Expected result:** Bumps placed uniformly across all orientations. A chamfer face gets
bumps from the grid axis most aligned to it. A 45° face gets bumps from whichever axis wins.
No cluster seams. Coverage approaches ~95%+ on the Aloy Focus.

---

## Step 3 — Pattern Library (est. 1 day)

Add pattern type selector to the texture panel. Each pattern is a `patternValue(u, v)` function
returning 0–1. The triplanar and displacement infrastructure is shared across all patterns.

### Pattern A — Diagonal Weave (current, keep)
```javascript
function meshValue(u, v, cellSize, strandWidth) { ... }  // existing
```

### Pattern B — Diamond Grid
Bumps placed on a diamond lattice (45°-rotated square grid).
```javascript
function diamondValue(u, v, cellSize, featureSize) {
  const p = (u + v) / cellSize % 1;
  const q = (u - v) / cellSize % 1;
  const pu = Math.abs(((p + 1) % 1) - 0.5) * 2;
  const pv = Math.abs(((q + 1) % 1) - 0.5) * 2;
  const r = featureSize / cellSize;
  return (pu < r && pv < r) ? 1 : 0;  // square diamond center
}
```

### Pattern C — Hexagonal Grid
Bumps at hexagonally-packed positions (closest-packing, ~15% denser than square grid).
```javascript
function hexValue(u, v, cellSize, featureSize) {
  // Row-offset hex lattice
  const row = Math.round(v / (cellSize * 0.866));
  const colOffset = (row % 2) * cellSize * 0.5;
  const col = Math.round((u - colOffset) / cellSize);
  const cx = col * cellSize + colOffset;
  const cy = row * cellSize * 0.866;
  const dist = Math.sqrt((u - cx) ** 2 + (v - cy) ** 2);
  return dist < featureSize ? 1 : 0;
}
```

### Pattern D — Linear Ribs
Parallel ridges running along one axis. Useful for grip surfaces.
```javascript
function ribValue(u, v, cellSize, strandWidth) {
  const t = Math.abs(((u / cellSize % 1) + 1) % 1 - 0.5) * 2;
  return t < strandWidth / cellSize ? 1 : 0;
}
```

### UI addition
Replace current preset selector (Bumps / Mesh Weave) with:
```
Texture type:  [ Bumps ▼ ]
Pattern:       [ Diagonal Weave ▼ ]  (Diagonal Weave / Diamond / Hexagonal / Ribs)
```
Bumps always use the hemisphere geometry; the pattern type controls placement grid shape.
Weave uses displacement; pattern type controls the stripe/grid shape.

---

## Step 4 — Image-Based Displacement (est. 1 day)

Allow users to upload a greyscale PNG as the displacement function, matching BumpMesh's
core feature.

### Implementation
```javascript
// Load user PNG into offscreen canvas
const img = new Image();
img.onload = () => {
  const canvas = document.createElement('canvas');
  canvas.width = img.width; canvas.height = img.height;
  canvas.getContext('2d').drawImage(img, 0, 0);
  heightmapData = canvas.getContext('2d').getImageData(0, 0, img.width, img.height);
};

// Sample function (replaces patternValue)
function imageDisplacementValue(u, v, cellSize) {
  const tx = ((u / cellSize) % 1 + 1) % 1;  // tile
  const ty = ((v / cellSize) % 1 + 1) % 1;
  const px = Math.floor(tx * heightmapData.width);
  const py = Math.floor(ty * heightmapData.height);
  return heightmapData.data[(py * heightmapData.width + px) * 4] / 255;  // R channel
}
```

The triplanar infrastructure from Steps 1–2 is reused unchanged.

---

## Implementation Sequence

| Step | Feature | Effort | Unlocks |
|------|---------|--------|---------|
| 1 | Triplanar weave | 0.5 days | Seamless weave on all surfaces |
| 2 | Triplanar bump placement | 1–2 days | Seamless bumps, ~95%+ coverage |
| 3 | Pattern library (diamond, hex, ribs) | 1 day | Visual variety, printability options |
| 4 | Image-based displacement | 1 day | User-supplied textures |

Total: ~4–5 days to full feature parity with Meshy/BumpMesh + face-selective advantage.

---

## Test Plan

### Regression (each step)
- Run `tests/texture-phase1-clusters.spec.js` — all 8 tests must pass
- MeshRing1 bump count must not decrease from 85
- Baseplate bump count must not decrease from 254

### New tests (Step 1)
- `texture-triplanar.spec.js`
- Aloy Focus weave: screenshot diff vs per-face UV — no visible stripe compression on tilted faces
- Baseplate weave: pattern pitch on top vs side face — should be equal with triplanar, was unequal before

### New tests (Step 2)
- Aloy Focus bumps: count ≥ 100 (up from 68 with cluster approach)
- Coverage metric: zero visible gaps > 2× spacing in exported STL cross-section

### Acceptance criteria
| Metric | Current | Target (after Step 2) |
|--------|---------|----------------------|
| Aloy Focus bump count | 68 | ≥ 100 |
| Visible seam lines | ~31 cluster boundaries | 0 |
| Weave pitch uniformity | Varies by face angle | ±5% across any orientation |
| Export validity (degenerate tris) | 0 | 0 |

---

## Files to Modify

| File | Change |
|------|--------|
| `js/app.js` | Replace UV sampling in `subdivideAndDisplace`; replace cluster loop in `addHemisphericBumps` |
| `index.html` | Add pattern type selector to texture panel |
| `css/style.css` | Style pattern selector |
| `tests/texture-triplanar.spec.js` | New test file |

---

## Reference

- BumpMesh triplanar projection: `wx=|n.x|^k, wy=|n.y|^k, wz=|n.z|^k` — standard technique
- Three.js r128 vertex displacement: existing `subdivideAndDisplace` pattern
- Face selection: existing `selectedFaceIndices` Set — unchanged throughout all steps
- Pattern functions: pure math, no Three.js dependency — unit-testable
