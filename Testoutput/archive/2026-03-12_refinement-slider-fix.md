# Test Run: refinement-slider-fix
Date: 2026-03-12

## Summary
5/5 passed (24.7s) — Chromium

## Tests Run
| # | Test | Result |
|---|------|--------|
| 1 | viewer controls render | ✓ pass |
| 2 | changes viewer background preset | ✓ pass |
| 3 | refinement slider below 1x uses base geometry without mesh holes | ✓ pass |
| 4 | refinement slider at non-power-of-4 applies subdivision without mesh holes | ✓ pass |
| 5 | loads stl, switches style, and applies slider multiplier | ✓ pass |

## Bug Fixed
**Root cause**: `buildTriangleSubsetGeometry` in `js/app.js` used strided triangle sampling — it kept ALL vertices
but discarded ~40–90% of triangles depending on the requested ratio. Orphaned vertices and missing faces produced
visible holes in the mesh for any slider value that was not exactly 1×, 4×, or 16×.

**When triggered**: slider value != 1, 4, or 16 (e.g. 2.4×, 0.5×, 1.5×, etc.)

**Fix** (`js/app.js` `buildRenderableGeometry`):
- Removed the `buildTriangleSubsetGeometry` call and `reductionRatio` calculation entirely.
- Subdivision step is kept as-is (ceil-based, powers of 4).
- Effective behavior:
  - slider < 1: base geometry (1× triangles)
  - slider 1.01–4.0: 1 subdivision (4×)
  - slider 4.01–16.0: 2 subdivisions (16×)
