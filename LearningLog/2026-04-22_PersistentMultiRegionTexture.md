# Persistent Multi-Region Texture System
**Date:** 2026-04-22
**Commit:** Implement persistent multi-region texture layer registry

---

## What Changed

The texture feature previously let you apply one texture at a time — each new Apply call erased the previous one. This commit replaces that single-apply model with a **layer registry**: you can now apply bumps to one region, weave to another, and both coexist in the exported geometry.

---

## Key Concepts

### 1. Immutable Geometry Anchor (`originalBaseGeometry`)
A second geometry reference is now stored at file-load time and **never modified**. Before this change, `preTextureBaseGeometry` only undid the last operation. Now `originalBaseGeometry` is the permanent source of truth for all recomputation.

```
File loaded → originalBaseGeometry = geometry (frozen copy)
                                         ↓
Apply bumps → baseGeometry = bumped version
                                         ↓
Apply weave → baseGeometry = bumped + woven version
                                         ↓
Remove bumps → recompute from originalBaseGeometry → baseGeometry = woven only
```

### 2. Layer Registry
Every Apply call pushes a record into `textureLayerRegistry`:
```javascript
{ id: 2, type: 'mesh', faceSet: Set{0,1,...,N}, params: {height, cellSize, strandWidth}, label: 'Weave — 924 faces' }
```
The `faceSet` captures which face indices were selected at apply time. These are indices into the non-indexed form of `baseGeometry` at that moment.

### 3. Pure Compute Functions
`addHemisphericBumps` and `applyMeshWeaveDisplacement` used to mutate global state. They were refactored into pure functions that take geometry + a face set and return new geometry:
- `computeBumpGeometry(srcGeom, faceSet, spacing, radius)` → `{geom, count}`
- `computeWeaveGeometry(srcGeom, faceSet, height, cellSize, strandWidth)` → `{geom, selCount}`

No globals are read or written. This makes them safe to call repeatedly during layer recomputation.

### 4. Sequential Recompute (`recomputeAllLayers`)
When a layer is removed, the system replays all remaining layers from `originalBaseGeometry`:
```
originalBaseGeometry → apply layer[0] → intermediate → apply layer[1] → baseGeometry
```
This is the core operation that makes multi-region work. Without the immutable anchor, removing a layer would have no stable starting point.

### 5. Face Index Clamping
A subtle bug: when the weave layer was applied after bumps, `selectAllFaces()` captured indices `{0..K-1}` where K = bumped face count. When recomputing against `originalBaseGeometry` (N < K faces), allocating `(N - K) * 9` bytes for unselected positions is negative — causing a `RangeError` that silently aborted the remove operation, leaving stale DOM rows.

Fix in `recomputeAllLayers()`:
```javascript
const validFaceSet = layer.faceSet.size <= faceCount
  ? layer.faceSet
  : new Set([...layer.faceSet].filter(i => i < faceCount));
```
Since the set originally covered `{0..K-1}` (all faces) and K > N, the filtered set = `{0..N-1}` = all original faces. Semantically correct: "apply to all faces" still applies to all original faces after recompute.

### 6. `clearCurrentModel()` Persistence
Every `rebuildModelFromSettings()` call goes through `clearCurrentModel()` which cleans up the Three.js scene. Previously, texture cleanup was placed there — wiping the registry on every rebuild. The fix: registry cleanup now lives only in the file-load paths (`parseStlArrayBuffer`, `loadGeometryIntoViewer`).

### 7. Panel Persistence Pattern
`clearCurrentModel()` sets `texturePanelVisible = false`. The Apply and Remove flows both save the panel state before rebuild and restore it after:
```javascript
const wasPanelVisible = texturePanelVisible;
clearTextureSelection();
rebuildModelFromSettings();          // ← sets texturePanelVisible = false internally
if (wasPanelVisible) {
  texturePanelVisible = true;
  texturePanel.style.display = "";
  initTexturePanel();                // re-attaches raycaster click handler
}
```

---

## UI Changes

- **Panel stays open after Apply** — removed the auto-close that was a workaround for single-apply limitation
- **Region list** appears below controls showing each committed layer with a ✕ remove button
- **"Clear All" button** (renamed from "Reset") empties the registry and restores original geometry
- Region list DOM: always clears `innerHTML` before rebuilding, even on the empty-registry early-return path (otherwise stale rows persist after reset)

---

## New Test File: `tests/texture-multiregion.spec.js`

5 tests covering:
1. Panel stays open after apply
2. Bumps then weave on separate canvas-click regions (baseplate)
3. Reset restores original triangle count (MeshRing1)
4. Remove one of two layers — geometry and row count update correctly
5. Two layers on same region (MeshRing1)

All 18 texture tests pass: phase1-clusters (6), triplanar (6), multiregion (5 → all fixed).

---

## Architecture Lesson: Where to Place Cleanup

The `clearCurrentModel()` function is called on **every model rebuild**, not just on file load. Placing persistent state cleanup there caused it to fire far more often than intended. The lesson: always trace the full call chain before deciding where cleanup belongs. In this case, two entry points (`parseStlArrayBuffer` and `loadGeometryIntoViewer`) were the correct and only places for registry reset.
