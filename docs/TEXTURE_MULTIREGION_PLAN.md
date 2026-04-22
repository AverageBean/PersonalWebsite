# Persistent Multi-Region Texture Plan

**Goal:** Allow the user to apply different textures to different face regions of a single model, with all regions coexisting in the scene and export.

**Current state:** Each Apply call starts from `baseGeometry`, displaces `selectedFaceIndices`, and replaces `baseGeometry` with the result. A second Apply call overwrites the first. `preTextureBaseGeometry` stores only the state before the _last_ apply, so Reset only undoes the most recent operation.

---

## Core Data Model Change

Introduce a **texture layer registry** — a list of immutable layer records, each capturing everything needed to reproduce one region's displacement:

```javascript
// New state in app.js (alongside selectedFaceIndices, baseGeometry, etc.)
let textureLayerRegistry = [];   // Array<TextureLayer>
let textureLayerCounter  = 0;

// TextureLayer shape:
// {
//   id:         number,           // unique incrementing ID
//   type:       'bumps'|'mesh',   // which algorithm
//   faceSet:    Set<number>,      // face indices from originalBaseGeometry
//   params:     object,           // {spacing, radius} or {height, cellSize, strandWidth}
//   label:      string,           // "Bumps — 12 faces", shown in UI list
// }
```

Add a second geometry anchor:

```javascript
let originalBaseGeometry = null;  // geometry at file-load time, never modified
                                   // (replaces the role of preTextureBaseGeometry)
```

**Why two anchors?**
- `originalBaseGeometry` is set once on file load and never touched. It is the recompute source.
- `baseGeometry` remains the live working geometry that Three.js renders and exports from.
  After every Apply, `baseGeometry` is replaced by the full composite of all layers.
- `preTextureBaseGeometry` is removed; its single-step-undo role is superseded by the layer list.

---

## Recompute Pipeline

All layers are always recomputed from `originalBaseGeometry` in order:

```
originalBaseGeometry
    │  layer 0 (bumps, faces A)
    ▼
intermediate_0
    │  layer 1 (weave, faces B)
    ▼
intermediate_1
    │  layer N …
    ▼
baseGeometry  ←  scene renders this, export uses this
```

Each layer's `faceSet` references indices in `originalBaseGeometry`. Since layers are applied in order, a face that appears in multiple layers gets the last layer's displacement (last-write-wins). This is the simplest coherent rule.

**Key function:**

```javascript
async function recomputeAllLayers() {
  let geom = originalBaseGeometry.clone();
  for (const layer of textureLayerRegistry) {
    geom = applyLayerToGeometry(geom, layer);  // returns new geometry
  }
  if (baseGeometry) baseGeometry.dispose();
  baseGeometry = geom;
  rebuildRenderMesh(baseGeometry);
  updateTriangleCount();
}
```

`applyLayerToGeometry(geom, layer)` is a pure function — takes geometry + layer record, returns new geometry. It is extracted from the existing `addHemisphericBumps` / `applyMeshWeaveDisplacement` functions, which currently mutate `baseGeometry` as a side effect.

---

## Apply Flow (New)

1. User selects faces (existing flood-fill, unchanged).
2. User picks preset + parameters.
3. Click **Apply**:
   - Budget check runs against `originalBaseGeometry` face data (same logic, but reads from the stable source).
   - New `TextureLayer` record is pushed to `textureLayerRegistry`.
   - `recomputeAllLayers()` runs (async, spinner shown).
   - On completion: selection is cleared, face highlight redrawn, region list refreshed.
   - Panel stays open (user can immediately select another region).

**Panel no longer closes on Apply.** The current auto-close was a workaround for the single-apply limitation.

---

## Reset / Remove Flow

- **Remove one region:** user clicks ✕ next to a layer in the region list →
  splice that layer from `textureLayerRegistry` → `recomputeAllLayers()`.
- **Clear all:** empty `textureLayerRegistry` → copy `originalBaseGeometry` into `baseGeometry` → rebuild mesh. No recompute needed.
- **Reset button** (existing) → "Clear all" behaviour, disabled when registry is empty.

---

## UI Changes

### Texture Panel — Region List

Add a scrollable list below the existing controls:

```
┌─────────────────────────────────────┐
│ Applied regions                     │
│ ─────────────────────────────────── │
│ 1  Bumps   367 faces  5mm   [✕]     │
│ 2  Weave   924 faces  12mm  [✕]     │
│ ─────────────────────────────────── │
│ Clear all                           │
└─────────────────────────────────────┘
```

- Each row: type label, face count, primary param, remove button.
- Empty state: "No regions applied."
- "Clear all" button enabled only when list is non-empty.

### Face Highlight Colour Coding

The current highlight uses a single overlay colour for `selectedFaceIndices`.
Extend to also colour faces that belong to committed layers:

| State                  | Colour          |
|------------------------|-----------------|
| Currently selected     | cyan (existing) |
| Committed — bumps      | amber           |
| Committed — weave      | green           |
| Overlap (selected over committed) | cyan (selection wins visually) |

Implementation: after `recomputeAllLayers()`, rebuild the highlight attribute buffer — write layer colours for committed faces, then overwrite with selection colour for currently selected faces.

### Panel Stays Open After Apply

Remove the `texturePanelVisible = false` block from `applyTextureToGeometry`. Panel stays open so the user can immediately select the next region.

---

## Code Refactor — Extraction of Pure Apply Functions

The two existing apply functions (`addHemisphericBumps`, `applyMeshWeaveDisplacement`) currently:
1. Read `selectedFaceIndices` (global)
2. Read/write `baseGeometry` (global)
3. Call `prepareBaseGeometry` (rebuilds render mesh)
4. Set status text

They need to become pure functions that accept input geometry + face set + params and return output geometry:

```javascript
// New signatures:
function computeBumpGeometry(srcGeometry, faceSet, spacing, radius)  → BufferGeometry
function computeWeaveGeometry(srcGeometry, faceSet, height, cellSize, strandWidth) → BufferGeometry
```

The existing wrapper `applyTextureToGeometry()` becomes:

```javascript
function applyTextureToGeometry() {
  // 1. Validate selection
  // 2. Build layer record
  // 3. Push to registry
  // 4. recomputeAllLayers()
}
```

This separation also makes it straightforward to add new texture types later — each type is just a new `computeXGeometry()` function.

---

## File Load / Model Reset Behaviour

On new file load:
- `textureLayerRegistry = []`
- `originalBaseGeometry` = geometry after `prepareBaseGeometry` (first preparation)
- `baseGeometry` = `originalBaseGeometry.clone()` (live working copy)
- Region list cleared
- Face highlights cleared

On scale/rotation bake:
- These currently modify `baseGeometry` and call `prepareBaseGeometry`.
- With multi-region: must also bake the transform into `originalBaseGeometry` and reapply all layers. Otherwise, after a scale bake, layer face indices reference the pre-scale geometry and the recompute produces wrong results.
- Simplest rule: **disable scale/rotation bake while any texture layer is applied** (show tooltip "Clear all texture regions before scaling/rotating"). Acceptable limitation for V1.

---

## Budget Check Update

The current budget check reads face data from the live render mesh (which may already have texture geometry on it). After refactor, budget check reads from `originalBaseGeometry` — always stable, always correct face count for the region being added.

---

## Implementation Phases

### Phase 1 — Core (no UI changes yet)
- Add `originalBaseGeometry`, `textureLayerRegistry`, `textureLayerCounter`.
- Extract `computeBumpGeometry()` and `computeWeaveGeometry()` pure functions.
- Write `recomputeAllLayers()`.
- Rewrite `applyTextureToGeometry()` to push a layer + call recompute.
- Rewrite Reset to clear registry.
- Set `originalBaseGeometry` on file load.
- Test: manual two-apply sequence produces both textures. Reset clears both.

### Phase 2 — Region List UI
- Add HTML region list section to `#texturePanel`.
- `renderRegionList()` function: builds DOM rows from `textureLayerRegistry`.
- Remove (✕) button per row calls `removeLayer(id)` + recompute.
- "Clear all" button.
- Update region list after every apply / remove / clear.

### Phase 3 — Colour-Coded Face Highlights
- Extend `updateFaceHighlight()` to colour committed-layer faces by type.
- Selection colour overwrites committed colour for currently selected faces.

### Phase 4 — Panel Stays Open + UX Polish
- Remove auto-close on Apply.
- Keep Apply button enabled when selection is present (allow immediate re-selection).
- Status text shows cumulative state: "2 regions applied — 1291 faces total."
- Disable scale/rotation bake with tooltip when layers are present.

---

## Tests

New test file: `tests/texture-multiregion.spec.js`

| Test | Assertion |
|------|-----------|
| Apply bumps to region A, weave to region B, export | Export contains both texture types; triangle count > either alone |
| Apply bumps twice to same region | Second apply overwrites first (last-write-wins); no doubled geometry |
| Remove region 1 of 2 | Geometry reverts to only region 2's texture |
| Clear all | Geometry matches original baseplate (triangle count restored) |
| Apply → Reset | Geometry identical to pre-apply baseline |
| Region list DOM | Correct row count and labels after each apply/remove |

---

## What This Does NOT Change (Out of Scope for This PR)

- Geodesic bump placement (uniformity — separate item)
- Texture parameter editing on committed layers (would require per-layer re-render)
- Layer reordering
- New texture types
- Export of per-region metadata
