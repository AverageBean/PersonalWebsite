# Geodesic Bump Placement (Stratified Surface Poisson)

**Date:** 2026-04-28
**Commit:** Replace triplanar bump grid with stratified surface Poisson

---

## What Changed

The bump-distribution algorithm in `computeBumpGeometry` (`js/app.js:2934`) was rewritten. The previous "triplanar global grid" approach cast three axis-aligned grids (XZ/YZ/XY) at step = `spacing` and weighted each candidate by `|n·axis|⁴`. It produced visibly uneven density on faces tilted between two world axes — exactly the kind of anisotropy a "uniform spacing" feature is supposed to avoid.

The new approach is **stratified surface Poisson-disk**:

1. For each selected face, generate `⌈4 · area / minDist²⌉` candidate points at uniformly-random barycentric positions inside the triangle. Tiny faces still get one candidate (their centroid).
2. Seed a `mulberry32` RNG from `(vertexCount, faceSetSize, spacing, radius)` so identical inputs always produce identical outputs.
3. Fisher-Yates-shuffle the candidate pool.
4. Greedy accept: walk the shuffled pool, accept each candidate if no prior accepted is within `minDist` (3D Euclidean). Use a flat 3-int spatial hash with cell = `minDist` for an O(1)-average distance check.
5. Place a hemisphere at each accepted site oriented along its host face normal.

`MIN_DIST_FRACTION = 0.5` — the minimum 3D distance is `spacing/2`, matching the historical triplanar dedup distance. This preserves the user-facing meaning of the "spacing" UI param so existing models don't suddenly produce 4× fewer bumps.

---

## Why Not Bridson Tangent Dart-Throwing

The first attempt used classic Bridson dart-throwing: from each active sample, generate K = 20 candidates in its tangent annulus `[r, 2r]`, project to the nearest face, accept if no neighbour within `r`. Two failure modes surfaced:

1. **Projection-shortening on curved surfaces.** A candidate at distance `r` in face F1's tangent plane, projected onto a neighbouring tilted face F2, ends up closer to the active sample by `cos(α)` where α is the inter-face tilt. On the Aloy Focus model (185 unique normals, contoured), this rejected ~half of all darts at the lower bound of the annulus.
2. **Annulus exceeds model thickness.** On thin models like Aloy Focus (6.9 mm in the thinnest axis), a 5–10 mm annulus pushes most candidates off the surface entirely. Padding the inner bound to 1.1× spacing made it worse, not better.

Stratified candidate generation avoids both: candidates are *constructed* on the surface, never projected, and never escape the geometry.

---

## Algorithmic Trade-offs

| | Triplanar grid (old) | Stratified Poisson (new) |
|---|---|---|
| Density | 3 grids × `1/spacing²` minus dedup | `~A / (0.83 · minDist²)` everywhere |
| Uniformity on tilted faces | Anisotropic (axis-bias) | Isotropic |
| Determinism | Yes | Yes (seeded RNG + sorted face order) |
| Aloy Focus (6560 tri) | 155 bumps | 148 bumps |
| MeshRing1 (curved cylinder) | 68 bumps | 262 bumps |
| Baseplate (flat) | 254 bumps | 1038 bumps |
| Failure mode on thin/curved | Sparse on tilted faces | None observed |

The Baseplate count tripled because the old triplanar effectively under-sampled flat surfaces — only one of the three grids contributed meaningfully to a Z-up plate. The new algorithm gives the Baseplate the same per-area density as Aloy and the Ring.

---

## Why a Seeded RNG Matters

Without determinism, every test run produces a slightly different bump count (±5 %). Visual regression baselines and exact-count assertions would fail at random. The mulberry32 PRNG is ~10 lines of code and identical across browsers — the seed is built from the inputs, so different models or different parameters still produce different outputs.

---

## Test Results

Canonical baseline (phase1-clusters + triplanar + multiregion): **19/19 pass**.

Eight failures in the older `texture-apply` / `texture-baseline` / `texture-tool` suites are pre-existing — verified by running the pre-change `main` against those files. They predate the multi-region commit (02550b9): they assert panel auto-close on Apply (since removed) and the old single-line status format.

---

## Files Touched

| File | Change |
|------|--------|
| `js/app.js:2934-3119` | `computeBumpGeometry` rewritten |
| `README.MD` | Surface texture description updated, "UNDER REVIEW" status removed, Next Steps refreshed |
| `Testoutput/TEXTURE_TEST_SUMMARY.md` | Full rewrite — phase table, current architecture, test inventory, open items |
| `docs/texture_geodesic_placement.md` | New — design rationale and algorithm doc |
| `LearningLog/2026-04-28_GeodesicBumpPlacement.md` | This file |

---

## Lesson — Match the User's Existing Mental Model When Possible

My first cut used `MIN_DIST_FRACTION = 1.0`: the natural Poisson interpretation where "spacing" is the strict minimum distance. It produced 37 bumps on Aloy and 192 on the Baseplate — geometrically correct, but a 4× regression in counts versus the triplanar code the user had been working with for weeks. Users had calibrated their `spacing` slider to the triplanar density.

Setting `MIN_DIST_FRACTION = 0.5` keeps the same per-`spacing` density as the prior algorithm so users don't have to recalibrate, while still delivering the actual win (uniform density across curvature). When swapping out an algorithm, preserve the user-facing knob's meaning even if the new algorithm has a more "natural" alternative interpretation.
