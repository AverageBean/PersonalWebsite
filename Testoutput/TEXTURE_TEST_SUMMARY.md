# Surface Texture Feature — Test Summary and Status

**Last updated:** 2026-04-28
**Feature:** Surface texture (bumps + mesh weave) for the STL viewer
**Status:** **LIVE** — multi-region layer registry shipped 2026-04-22 (commit 02550b9). Geodesic bump placement is the active in-progress refinement.

---

## Implementation Phases

| Phase | Description | Shipped | Commit |
|-------|-------------|---------|--------|
| 0     | Single-apply UI (selection, presets, params, Apply/Reset) | 2026-04-16 | dd781c8 |
| 1     | Normal-cluster bumps (BFS, 30°, centroid fallback) | 2026-04-17 | 9b8253a |
| 3     | Per-face UV weave (tangent frame, fixes tilt compression) | 2026-04-17 | 9b8253a |
| Triplanar | Global-grid bumps (XZ/YZ/XY, weight \|n·axis\|⁴) — replaces clusters | 2026-04-21 | 708ff97 |
| Multi-region | Persistent layer registry, per-row remove, immutable anchor | 2026-04-22 | 02550b9 |
| **Geodesic bumps** | On-surface Poisson-disk sampling — uniform spacing across curvature | _in progress_ | — |

---

## Architecture (Post Multi-Region)

- `originalBaseGeometry` — frozen at file load, never mutated. Source for replay.
- `textureLayerRegistry` — array of `{id, type, faceSet, params, label}`. Each Apply pushes one record.
- `computeBumpGeometry()` / `computeWeaveGeometry()` — pure functions. No globals read or written.
- `recomputeAllLayers()` — replays every layer in order from `originalBaseGeometry` to produce a new `baseGeometry`.
- Region list UI in `#texturePanel` with per-row ✕ remove and Clear All.
- Panel stays open after Apply so the user can immediately select another region.

Key invariants:
- `clearCurrentModel()` must NOT clear the registry (it runs on every rebuild). Only the file-load paths reset it.
- Face-set indices are clamped to current geometry's face count during recompute (handles ordering with bumps that grow geometry).

---

## Active Test Files

| Spec file | Tests | What it covers |
|-----------|-------|----------------|
| `tests/texture-phase1-clusters.spec.js` | 10 | Phase 1 bumps + Phase 3 weave on Aloy Focus, MeshRing1, Baseplate |
| `tests/texture-triplanar.spec.js` | 7 | Triplanar global-grid bumps, weave on tilted faces, export validity |
| `tests/texture-multiregion.spec.js` | 7 | Layer registry, panel persistence, remove, recompute on Reset |
| `tests/texture-tool.spec.js` | 10 | UI controls, button states, preset switching |
| `tests/texture-apply.spec.js` | 11 | Apply/Reset flow, status messages, error paths |
| `tests/texture-baseline.spec.js` | 7 | Baseline geometry sanity, panel open/close |
| `tests/texture-week1-simple.spec.js` | 6 | Smoke tests from initial Week 1 plan |

Memory baseline (2026-04-22): the canonical three suites — phase1-clusters + triplanar + multiregion — passed 18/18 at the multi-region landing.

---

## Test Assets (`TestDocs/`)

| File | Use |
|------|-----|
| `Aloy Focus.stl` | Primary curved/contoured model (6560 tri, 185 unique normals, 45×6.9×39.8 mm) |
| `MeshRing1.stl` | Ring with curved outer wall (regression for cylindrical surfaces) |
| `Station_3_Baseplate - Part 1.stl` | Mostly flat reference (regression for planar surfaces) |

Never test against newly generated STLs — only files from `TestDocs/`.

---

## Known Limits

| Constraint | Value | Source |
|------------|-------|--------|
| Max bumps per layer | 2000 | `MAX_BUMPS` in `computeBumpGeometry` |
| Max triangles total (export budget) | 2,000,000 | `MAX_TRIANGLES` in `js/app.js` |
| Hemisphere triangle cost | 144 tri / bump | `SphereGeometry(r, 12, 6, …, 0, π/2)` |
| Weave subdivision cap | 5 levels (1024×) | `computeWeaveGeometry` `estimatedLevels` |

---

## Open Items

1. **Geodesic bump placement** — triplanar grid still produces uneven density on faces tilted ~45° between two axes; in progress.
2. **Scale/rotation bake while textured** — currently allowed; layer face indices reference pre-transform geometry, recompute may be wrong. Multi-region plan flagged this as "disable while layers present"; not yet enforced.
3. **Per-layer parameter editing** — only remove + re-apply; not in scope yet.
