# Phase 1 Normal-Cluster Bumps — Test Summary

**Date:** 2026-04-17T20:29:45.131Z
**Algorithm change:** Single global UV frame → per-cluster UV frames (20° BFS threshold)

## Test Models

| Model | Normal Directions | Expected Clusters | Purpose |
|-------|------------------|-------------------|---------|
| Aloy Focus.stl | 185 | ≥5 | Primary: curved/discontinuous surface |
| MeshRing1.stl | Radial (cylinder) | ≥2 | Regression: curved outer wall |
| Baseplate.stl | Few flat faces | 1-2 | Regression: simple flat surface |

## Key Assertion
Status message must contain "${N} normal clusters" when N > 1.

## Files
- 2026-04-17_aloy-focus-bumps.png
- 2026-04-17_meshring1-cluster-bumps.png
- 2026-04-17_baseplate-cluster-bumps.png
- 2026-04-17_aloy-focus-bumps-export.stl
