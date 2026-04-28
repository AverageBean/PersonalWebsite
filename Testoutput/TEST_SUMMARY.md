# Test Output Summary

## Slice / Cross-Section View
**Date:** 2026-04-02
**Status:** Resolved
**Active:** `2026-04-02_slice-helical-y-mid.png`

### Problem
No way to visualize internal geometry of STL models. Users with hollow or internally-featured parts (e.g., helical tubes with internal spirals) had no means of inspecting interior structures without modifying the mesh.

### Tests Used
`tests/slice-view.spec.js` — 9 tests, Chromium:
- Slice toggle disabled before model load, enabled after
- Slice toggle shows/hides panel with correct aria-pressed state
- Panel defaults: Y axis checked, flip unchecked, cap checked, readout shows mm
- Slider range matches model bounding box on Y axis
- Changing axis radio updates slider range
- Panel hides and toggle resets when a new file is loaded
- GPU clipping validation: canvas pixels differ before/after slice at extreme position
- Slice and mold panels can both be open simultaneously
- HelicalTube1 Y midpoint screenshot — visual regression baseline

### Interpretation
9/9 passed. Full suite (63 tests across 6 spec files) all pass. GPU clipping validated via pixel-level comparison. Stencil-buffer cross-section cap fills cut face with solid color. Interactive drag, axis switching (X/Y/Z), flip, and cap toggle all functional. No performance issues with 11MB HelicalTube1.stl.

---

## Mold Generator
**Date:** 2026-04-01
**Status:** Resolved
**Active:** `2026-04-01_mold-generation.zip`

### Problem
No mold generation capability existed. Users needed to create two-part molds from loaded STL models — a rectangular block with the model subtracted, bisected into printable halves with registration pins/holes and a sprue channel.

### Tests Used
`tests/mold-generator.spec.js` — 6 tests, Chromium:
- Mold toggle button disabled when no model loaded, enabled after
- Mold toggle shows/hides mold panel with correct aria-pressed state
- Mold panel has correct default parameter values (wall=10, clearance=0, pin=5, inset=8, sprue=6)
- Split slider range matches model bounding box, readout shows mm
- Mold panel hides and toggle resets when a new file is loaded
- Generate mold produces a non-empty zip download (requires converter service; wall=10mm, split at midpoint)

### Interpretation
6/6 passed. Full suite (54 tests across 5 spec files) all pass including the previously-skipped parametric STEP test (converter running). Mold zip verified: contains top and bottom STL halves, 448KB total for MeshRing1.

---

## Panel Tab Navigation
**Date:** 2026-03-25
**Status:** Resolved
**Active:** none (no visual artifacts)

### Problem
The right panel (viewer-panel) had no tab navigation. Adding tabs required verifying that: (a) only the active tab pane is visible, (b) switching tabs correctly updates `aria-selected` and `is-active` state, and (c) returning to STL Viewer restores viewer controls.

### Tests Used
`tests/panel-tabs.spec.js` — 6 tests, Chromium:
- Tab bar renders all three tabs (STL Viewer, Bonsai Vitals, Train Spotting)
- STL Viewer tab is active by default and viewer controls are visible
- Clicking Bonsai Vitals shows placeholder and hides viewer
- Clicking Train Spotting shows placeholder and hides viewer
- Switching back to STL Viewer restores viewer controls
- Only one tab pane is visible at a time (three-state check across all panes)

### Interpretation
6/6 passed. Tab switching, ARIA state, and pane visibility all behave as specified. Existing 20-test viewer suite also passes unchanged, confirming no regression to STL Viewer functionality.

---

## Viewer Controls and Export Coverage Gaps
**Date:** 2026-03-31
**Status:** Resolved
**Active:** none (no visual artifacts)

### Problem
Multiple viewer features lacked Playwright coverage: camera reset button, grid/bbox toggle click behavior, camera presets, all view styles, all background styles, drag-and-drop file loading, and export downloads (STL/OBJ/GLB). These gaps meant regressions in primary user interactions would go undetected.

### Tests Used
`tests/viewer-controls.spec.js` — 15 tests, Chromium:
- Camera reset with no model shows default-view status
- Camera reset with model loaded shows frame-model status
- Grid toggle button flips aria-pressed and status message (on→off→on)
- Bbox toggle activates after model load and toggles aria-pressed (off→on→off)
- Camera preset selection updates usage tip and status (all 3 presets)
- All view styles apply without error (solid, overlay, wireframe, flat)
- All background styles apply without error (neutral, dark, warm, lab)
- Drop zone activates on dragenter and deactivates on dragleave
- Drop zone click triggers file input
- Dropping an STL file loads the model
- STL export produces a non-empty download
- OBJ export produces a non-empty download
- GLB export produces a non-empty download
- Export button is disabled when no model is loaded
- Export hint updates when format is changed

### Interpretation
15/15 passed. Full suite (42 tests across 4 spec files) runs with 41 passed, 1 skipped (converter-dependent parametric STEP test). No regressions. Coverage now includes all viewer control interactions, all export formats (client-side), and the drag-and-drop flow.

---

## Rotation Controls and Footprint Fix
**Date:** 2026-03-31
**Status:** Resolved
**Active:** none (no visual artifacts)

### Problem
Two issues addressed together:
1. Footprint feature was inverted — selecting the smallest XZ area instead of the largest, causing baseplates to stand on their thin edge rather than lie flat for 3D printing.
2. No rotation controls existed — users had no way to manually orient geometry before export.

### Tests Used
`tests/viewer-controls.spec.js` — 6 rotation tests added (21 total in file), Chromium:
- Rotate toggle button disabled when no model is loaded
- Rotate toggle shows/hides rotation input row
- Apply rotation changes model dimensions (verifies geometry is actually rotated)
- Enter key in rotation input triggers apply
- Reset button clears all rotation inputs to 0
- Rotation row hides when a new file is loaded

### Interpretation
6/6 rotation tests passed. Full suite (48 tests across 4 spec files) runs with 47 passed, 1 skipped (converter-dependent parametric STEP). Footprint fix confirmed manually — baseplate now lies on its widest face after pressing the footprint button.

---

Documents each resolved or ongoing issue: the problem, tests used, and interpretation of outcomes.
Archived artifacts are in `Testoutput/archive/`.

---

## Refinement Slider Mesh Holes
**Date:** 2026-03-12
**Status:** Resolved
**Archive:** `archive/2026-03-12_refinement-slider-fix.md`

### Problem
`buildTriangleSubsetGeometry` used strided triangle sampling that discarded 40–90% of triangles while retaining all vertices. Orphaned vertices and missing faces produced visible holes in the mesh for any slider value that was not exactly 1×, 4×, or 16×.

### Tests Used
Playwright suite (`tests/viewer.spec.js`) — 5 tests, Chromium:
- Viewer controls render
- Background preset change
- Refinement slider <1× uses base geometry without mesh holes
- Refinement slider at non-power-of-4 applies subdivision without mesh holes
- Load STL, switch style, apply slider multiplier

### Interpretation
5/5 passed after removing the subset-sampling step from `buildRenderableGeometry`. Effective slider behavior is: <1→1×, 1.01–4→4×, 4.01–16→16× (ceil-based subdivision, no intermediate subsampling). Issue closed.

---

## Grid Intersecting Loaded Model
**Date:** 2026-03-12
**Status:** Resolved
**Archive:** `archive/2026-03-12_grid-intersection-fix.md`, `archive/2026-03-12_grid-below-model-default-view.png`, `archive/2026-03-12_grid-below-model-low-angle.png`

### Problem
`centerGeometryAtOrigin` translated the mesh centroid to world origin (0,0,0). `THREE.GridHelper` sits at Y=0. The lower half of every loaded model (from Y=−h/2 to 0) fell below the grid plane, causing the grid to cut visually through the middle of the part.

### Tests Used
Playwright suite — 6 tests, Chromium; visual screenshots at default and low-angle camera using `CurvedMinimalPost-Onshape.stl`.

### Interpretation
6/6 passed. Fix: `currentModelRoot.position.y = -currentBounds.min.y` lifts the model group so its lowest vertex sits at Y=0. `currentBounds` shifted into world space to keep camera framing and size metrics consistent. Screenshots show no grid/model intersection at either camera angle. Issue closed.

---

## Zoom-to-Fit for Micro-Scale Models
**Date:** 2026-03-12
**Status:** Resolved
**Archive:** `archive/2026-03-12_zoom-to-fit-fix.md`, `archive/2026-03-12_zoom-to-fit-micro-model.png`

### Problem
`resetCameraToBounds` had three hard-coded unit floors (radius min 0.5, camera.near 0.01, controls.minDistance 0.05). For a 0.014-unit model (Onshape metre-unit export) these placed the camera 71× farther than the model, making it occupy ~0.5% of the viewport.

### Tests Used
Playwright suite — 7 tests, Chromium; visual screenshot of `CurvedMinimalPost-Onshape.stl` after fix.

### Interpretation
7/7 passed. All three fixed floors replaced with scale-relative values proportional to `fitDistance` and `radius`. Models at normal scale are unaffected (old floors only triggered for sub-millimetre raw coordinates). Screenshot confirms the micro-model fills the viewport. `preserveDrawingBuffer: true` added to the renderer to support pixel-level visual tests — negligible cost for a single-mesh viewer. Issue closed.

---

## Overlay and UI Layout Regression (Post-BBox Button Changes)
**Date:** 2026-03-13
**Status:** Regression check — no failures detected
**Archive:** `archive/2026-03-13_overlay-no-model.png`, `archive/2026-03-13_overlay-with-model.png`

### Problem
After replacing the dynamic bbox SVG preview with a static cube toggle button and tightening the dimension input area, a visual check was needed to confirm the overlay layout was not broken.

### Tests Used
Visual screenshots via Playwright: viewer in empty state and with a loaded model.

### Interpretation
No layout breakage observed in either state. Overlay renders as intended. No follow-up action required.

---

## Crease Normals, Solid Fill Artefact, and Conversion Panel (QoL)
**Date:** 2026-03-19
**Status:** Resolved
**Archive:** `archive/2026-03-19_ui-no-model.png`, `archive/2026-03-19_ui-with-model.png`, `archive/2026-03-19_baseplate-solid-fill-creasefix.png`, `archive/2026-03-19_conversion-result-panel.png`, `archive/2026-03-19_conversion-result-visible.png`

### Problem
Three issues addressed together:
1. Large-triangle artefact in Solid Fill mode on `Station_3_Baseplate - Part 1.stl` — crease normals not applied.
2. No user feedback during or after STEP conversion (no spinner, no result metrics).
3. Dev server required two separate terminal commands (`npm start` + `npm run convert:start`).

### Tests Used
Visual screenshots: UI empty state, UI with model loaded, baseplate in solid fill after crease-normal fix, conversion result panel during and after export.

### Interpretation
Screenshots confirm: crease normal fix eliminates the large-triangle artefact; spinner appears during export; result panel shows metrics (coverage %, volume ratio, Hausdorff) after completion. Dev server auto-start consolidated into `start-dev.js` via `child_process.fork`. All three issues closed.

---

## Parametric STEP Export — MeshRing1
**Dates:** 2026-03-17 (initial), 2026-03-20 (intermediate), 2026-03-23 (current)
**Status:** Phase A complete; Phase B (tori) pending
**Active:** `2026-03-23_parametric_MeshRing1.step`
**Archive:** `archive/2026-03-17_MeshRing1_parametric.step`, `archive/2026-03-17_MeshRing1_parametric_v2.step`, `archive/2026-03-17_MeshRing1_viewer.png`, `archive/2026-03-20_parametric_MeshRing1.step`

### Problem
Convert `TestDocs/MeshRing1.stl` to an analytical STEP solid via RANSAC-detected cylinders and planes. Early outputs failed coaxiality checks or had insufficient surface coverage.

### Tests Used
`tools/test-parametric-step.py` (timeout 240s); `tools/compare-step-to-stl.py` (volume ratio, Hausdorff distance, surface deviation histogram).

### Interpretation
Phase A (cylinders + planes) meets the ≥57.9% analytical coverage criterion. The 2026-03-17 outputs are early-iteration baselines with lower coverage; the 2026-03-20 output is a mid-iteration intermediate. The 2026-03-23 file is the current baseline for Phase B work (tori for fillet coverage; target ≥95%).

---

## Parametric STEP Export — Baseplate
**Dates:** 2026-03-20 (initial), 2026-03-23 (segment-aware fix)
**Status:** Phase A complete (PASS); Phase B pending
**Active:** `2026-03-23_parametric_Station_3_Baseplate_-_Part_1.step`, `2026-03-23_baseplate_segmented.step`
**Archive:** `archive/2026-03-20_parametric_Station_3_Baseplate_-_Part_1.step`

### Problem
Baseplate slot cuts were merging T-head end-face pairs from opposite ends of the part, producing over-long cuts that removed material where none should be removed. Root cause: perpendicular segmentation did not detect the gap between non-contiguous face groups.

### Tests Used
`tools/test-parametric-step.py`; `tools/compare-step-to-stl.py`; `tools/slice-stl-profile.py` (cross-sections at multiple heights to expose cut geometry).

### Interpretation
Gap-aware perpendicular segmentation (2026-03-23) splits wall pairs with non-contiguous face centres into separate cuts. Fidelity metrics after fix: vol ratio=0.9925, mean deviation=0.041mm, Hausdorff=0.956mm — all within PASS thresholds. The 2026-03-20 output is retained in archive as a pre-fix baseline for comparison. `2026-03-23_baseplate_segmented.step` records the segmented intermediate geometry used during debugging.

---

## Mold-Top Phase D Regression Fixes (false rect pocket, false base channels, through-sprue)
**Date:** 2026-04-27
**Status:** Resolved
**Active:** `Testoutput/2026-04-27_parametric_MeshRing1-mold-top.step`
**Archive:** —

### Problem
Three regressions on `MeshRing1-mold-top.stl` introduced by the Phase D ESP35Box work:
1. `detect_inner_pocket` mis-identified the cylindrical inside of a circular cavity as 4 rectangular walls and applied a 58.7×58.6×3.5mm rectangular pocket cut.
2. Phase D.5 sampled at `0.5*(part_lo+floor_pos)` for a downward-opening cavity, which lands inside the cavity and traced the ring impression as 50×50 / 40×40 false base channels.
3. Sprue (r=2.99mm, depth_span=3.4mm) was classified as through because its radius fell below the 8mm gate that triggers the interior-plane lookup, and depth_span exceeded the 0.25*part_h=3.25mm through threshold.

### Fixes
- **Wall planarity gate** in `detect_inner_pocket`: each detected wall position must match an accepted (non-curvature-rejected) axis-aligned plane within 1.5 mm. Curved cavities have their X/Z planes pre-rejected as `spread > 0.45 mm`, so no match → no false rectangular pocket.
- **Phase D.5 cavity-direction gate**: skip base-channel detection when `inner_pockets[0]["open_toward_hi"] == False`. Base-channel concept assumes solid material below the floor.
- **Boundary-case sprue classifier** in `_classify_hole_depth`: when face-centre depth_span is within ±25% of the through/blind threshold AND a substantial interior plane (≥500 inliers) overlaps the hole footprint, use the plane as the cavity floor. Opening side determined by `(part_hi - d_max) < (d_min - part_lo)`.

### Tests Used
`tools/test-parametric-step.py`, 4/4 PASS.
- MeshRing1 (Phase A baseline) — PASS
- Station_3_Baseplate (Phase A box) — PASS
- ESP35Box (Phase D regression check) — vol ratio 0.9984, mean dev 0.100 mm — PASS
- MeshRing1-mold-top (NEW) — vol ratio 1.0135, asserts no `base channel`, no `pocket cut:`, no `sprue hole cut: r=2.99mm, through`; expects `blind-pocket`, `ring pocket cut` — PASS

### Interpretation
Mold-top vol_ratio restored to 1.0135 (matches Phase C-0 baseline of 1.019). ESP35Box vol_ratio retained at 0.9984 (no regression from the new wall planarity gate, since ESP35Box's inner walls correspond to actual detected planes). Sprue is now correctly classified as blind from the top face down to the cavity floor at Y=5.98mm.

---

## Parametric STEP Completion Ping
**Date:** 2026-04-27
**Status:** Resolved
**Active:** `tests/parametric-ping.spec.js` (4 tests)
**Archive:** —

### Problem
Parametric STEP conversions take 2-7 minutes; user wanted an audible cue when the export finishes (success or failure) so the wait can be done in another window.

### Tests Used
`tests/parametric-ping.spec.js`, chromium, 4/4 pass. Tests stub `AudioContext.prototype.createOscillator` to count calls and stub the `/api/convert/stl-to-step-parametric` endpoint via `page.route` so no converter service is needed.
- ping fires after successful parametric STEP export (osc=2)
- ping fires after parametric STEP failure / 500 (osc=2)
- ping does NOT fire after STL export (osc=0)
- AudioContext spy not triggered by non-parametric paths (osc=0)

Regression: `tests/viewer-controls.spec.js` 21/21 pass.

### Interpretation
Two-tone ding (880 Hz, then 1320 Hz, 180 ms each) plays in the export's `finally` block when `formatKey === "step-parametric"`. AudioContext is lazy-created and resumed inside the click's user-gesture window so the deferred ping (minutes after the click) is not blocked by autoplay policy. Audio failures are swallowed so a missing/blocked AudioContext cannot break the export.

---

## Temp / Unlabeled Outputs
**Archive:** `archive/tmp_conversion_test.js`, `archive/test_meshring1_quick.step`

Created without date-prefixed naming during exploratory testing. No associated problem statement or result record. Archived rather than deleted in case they are needed for reference.
