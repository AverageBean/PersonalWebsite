# Test Run: zoom-to-fit-fix
Date: 2026-03-12

## Summary
7/7 passed (22.0s) — Chromium

## Tests Run
| # | Test | Result |
|---|------|--------|
| 1 | viewer controls render | ✓ pass |
| 2 | changes viewer background preset | ✓ pass |
| 3 | refinement slider below 1x uses base geometry without mesh holes | ✓ pass |
| 4 | refinement slider at non-power-of-4 applies subdivision without mesh holes | ✓ pass |
| 5 | grid sits below model base after STL load (visual) | ✓ pass |
| 6 | zoom to fit fills viewport for micro-scale STL (visual) | ✓ pass |
| 7 | loads stl, switches style, and applies slider multiplier | ✓ pass |

## Screenshots Recorded
- `2026-03-12_zoom-to-fit-micro-model.png` — CurvedMinimalPost filling the viewport after fix

## Feature Implemented
**Zoom-to-fit for micro-scale models** — `resetCameraToBounds` in `js/app.js`

### Root cause
Three hard-coded minimums scaled incorrectly for small parts:
| Line | Old | Effect on 0.014-unit model |
|---|---|---|
| `radius = Math.max(..., 0.5)` | 0.5 (71× real size) | camera 1.33 units out; model fills 0.5% of FOV |
| `camera.near = Math.max(..., 0.01)` | 0.01 fixed | near/far ratio 100/0.01 = 10 000 |
| `controls.minDistance = Math.max(..., 0.05)` | 0.05 (7× fitDistance) | user pushed back before model visible |

### Fix (js/app.js resetCameraToBounds)
All three floors replaced with scale-relative equivalents:
- `radius = Math.max(size.length() * 0.5, 1e-4)` — degenerate-geometry floor only
- `camera.near = Math.max(fitDistance - radius*1.5, fitDistance * 0.01)` — proportional to fitDistance
- `camera.far = Math.max(fitDistance + radius*6, camera.near + fitDistance*2)` — proportional
- `controls.minDistance = Math.max(radius * 0.12, fitDistance * 0.01)` — no fixed-unit floor

Normal-sized models are unaffected (the old hard floors only triggered for small parts).

## Renderer Change
Added `preserveDrawingBuffer: true` to `WebGLRenderer` options.
Rationale: enables `gl.readPixels` for pixel-level visual tests. Cost is negligible for
a single-mesh STL portfolio viewer; the swap-chain optimisation it trades away is only
material in high-throughput game-like rendering.

## Test Infrastructure Note
Three.js r128 acquires a WebGL2 context. Pixel tests must use
`canvas.getContext("webgl2")` — calling `getContext("webgl")` on a canvas that already
holds a WebGL2 context returns null per the HTML spec.
