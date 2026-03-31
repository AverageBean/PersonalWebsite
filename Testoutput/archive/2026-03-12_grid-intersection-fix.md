# Test Run: grid-intersection-fix
Date: 2026-03-12

## Summary
6/6 passed (21.1s) — Chromium

## Tests Run
| # | Test | Result |
|---|------|--------|
| 1 | viewer controls render | ✓ pass |
| 2 | changes viewer background preset | ✓ pass |
| 3 | refinement slider below 1x uses base geometry without mesh holes | ✓ pass |
| 4 | refinement slider at non-power-of-4 applies subdivision without mesh holes | ✓ pass |
| 5 | grid sits below model base after STL load (visual) | ✓ pass |
| 6 | loads stl, switches style, and applies slider multiplier | ✓ pass |

## Screenshots Recorded
- `2026-03-12_grid-below-model-default-view.png` — default camera after load
- `2026-03-12_grid-below-model-low-angle.png` — low-angle rotation to show grid/model relationship

## Bug Fixed
**Root cause**: `centerGeometryAtOrigin` translates the geometry centroid to world origin (0,0,0).
The `THREE.GridHelper` is fixed at Y=0. So the lower half of every loaded model (from Y = -h/2 to 0)
sat below the grid plane, causing the grid to cut visually through the middle of the part.

**Fix** (`js/app.js` `applyGeometryToScene`):
After computing `currentBounds`, `currentModelRoot.position.y` is set to `-currentBounds.min.y`
(i.e. half the model height for a centred geometry). This lifts the entire model group so its lowest
vertex sits exactly on the grid plane (Y=0). `currentBounds` is then shifted into world space
(both `min.y` and `max.y` incremented by `liftY`) so camera framing via `resetCameraToBounds` and
the size metrics remain correct.

## Visual Observation
`CurvedMinimalPost-Onshape.stl` raw coordinate extents are 0.00 × 0.01 × 0.01 — consistent with an
Onshape metre-unit export (0.01 m ≈ 10 mm for a small mechanical post). The model renders as a tiny
object at the grid centre. The model base is flush with the grid plane; no intersection visible.
This is a known scale-label issue (viewer labels all dims as "mm" but reads raw STL coordinates) —
separate from the grid-intersection bug fixed here.
