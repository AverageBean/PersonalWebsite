# 2026-03-13 — Uniform Scale & Minimize Footprint

## What was added
Two new buttons appear in the bottom-right corner of the STL viewer canvas after a model is loaded:

- **½× / 2×** — scale the model down or up by a factor of 2. Repeated presses compound (1× → 2× → 4×, etc.). Clamped to [1/64, 64].
- **Min Footprint** — tests all 6 axis-aligned orientations (each cardinal face pointing down), picks the one with the smallest XZ bounding-box area, and bakes that rotation into the base geometry. Useful for orienting a part so it takes up minimal space on a print bed.

## Key design decisions and lessons

### 1. Scale lives on the Group node, not the geometry
Three.js lets you set `object.scale` rather than transforming every vertex. This is efficient. The catch is that the *model root* had a `position.y` offset (the "grid lift") computed from the original-size geometry. When scale changes, that lift must be recalculated:

```
liftY = -localBounds.min.y × scale
```

So we save `savedLocalBounds` (the geometry bounding box before any lift or scale) and recompute the world-space bounds and lift every time scale changes via a single `applyModelTransform(scale)` function.

### 2. Scale must persist across refinement rebuilds but reset on new file load
When the refinement slider fires, the app completely destroys and re-creates the mesh via `applyGeometryToScene`. Without explicit handling, this would reset the scale. The fix:
- Store `currentModelScale` as a module-level variable.
- On every `applyGeometryToScene` call, re-apply `applyModelTransform(currentModelScale)` after the new mesh is built.
- Only reset `currentModelScale = 1.0` in `parseStlArrayBuffer` (new file load), not in the rebuild path.

### 3. Export must bake the scale into vertex positions
The STL/OBJ/GLB exporters walk the geometry's vertex buffer directly. They do not apply the Three.js scene graph transform. So if scale = 2 is set on the Group but the geometry vertices are still 1× size, the exported file will be 1×. The fix is `buildScaledExportGeometry()`: clone the geometry and apply `Matrix4.makeScale(s,s,s)` before export, then dispose the clone.

### 4. Footprint orientation is baked, not stored as a rotation
The "Minimize Footprint" button permanently transforms `baseGeometry` (the source used for all subsequent refinement rebuilds). This means the orientation is preserved through slider changes and exported files automatically — no extra transform-baking step needed at export time.

### 5. Overlay positioning without breaking existing CSS
The canvas frame uses `overflow: hidden` + `border-radius` to clip the Three.js canvas to rounded corners. Adding an absolutely-positioned overlay *inside* that frame would be clipped. The solution: wrap the frame in a new `.viewer-canvas-wrapper` with `position: relative`. The overlay is a sibling of the frame (not a child), so it sits on top of the canvas visually but is not clipped by the frame's overflow.

### 6. `pointer-events: none` on the overlay background
The orbit controls listen for mouse events on the canvas. An overlay div sitting on top of the canvas would absorb those events and break rotation/pan/zoom. Setting `pointer-events: none` on the overlay container and `pointer-events: auto` only on the actual buttons fixes this — the canvas remains fully interactive in the empty areas of the overlay.

## Files changed
- `index.html` — added `.viewer-canvas-wrapper`, `#modelToolsOverlay`, `#scaleHalfBtn`, `#scaleDoubleBtn`, `#scaleDisplay`, `#minimizeFootprintBtn`
- `css/style.css` — added `.viewer-canvas-wrapper`, `.model-tools-overlay`, `.model-tool-btn`, `.model-tool-scale-display`, `.model-tool-btn--wide`
- `js/app.js` — added `currentModelScale`, `savedLocalBounds`, `applyModelTransform()`, `minimizeFootprint()`, `buildScaledExportGeometry()`, `updateModelToolsVisibility()`, refactored `applyGeometryToScene`, updated all export branches
- `tests/viewer.spec.js` — 6 new tests covering overlay visibility, scale display, scale reset, scale persistence, scaled dimensions, and footprint reorientation
