# Triplanar Global-Grid Bumps — Test Summary

**Date:** 2026-04-28T17:18:37.231Z
**Algorithm change:** Per-cluster UV frames → triplanar global grid (XZ/YZ/XY, weight = |n.axis|^4)

## Test Models

| Model | Normal Directions | Expected Bumps | Purpose |
|-------|------------------|----------------|---------|
| Aloy Focus.stl | 185 | ≥100 | Primary: curved/discontinuous surface |
| MeshRing1.stl | Radial (cylinder) | >0 | Regression: curved outer wall |
| Baseplate.stl | Few flat faces | >0 | Regression: simple flat surface |

## Key Assertions
- Aloy Focus bump count ≥100 (up from 68 with cluster approach)
- No "normal clusters" in status message (clusters eliminated)
- Export geometry valid, zero degenerate triangles

## Files
- 2026-04-28_aloy-focus-bumps.png
- 2026-04-28_meshring1-cluster-bumps.png
- 2026-04-28_baseplate-cluster-bumps.png
- 2026-04-28_aloy-focus-bumps-export.stl
