# Geodesic Bump Placement

**Status:** in progress
**Replaces:** triplanar global-grid bumps (commit 708ff97, 2026-04-21)

---

## Problem

The triplanar grid algorithm casts three axis-aligned grids (XZ/YZ/XY) at step = spacing, weights candidates by `|n·axis|⁴`, then deduplicates within `spacing/2`. Two failure modes:

1. **Density anisotropy on tilted faces.** A face whose normal sits between two axes (e.g., a 45° plane) gets sampled by two grids and weighted by ~0.5⁴ = 0.0625 each. Grid points project onto its surface at a stride that depends on the projection direction, not the surface itself, producing visibly uneven density compared to axis-aligned faces.
2. **Hard boundary effects on highly curved surfaces.** Grid lines fall on or near silhouette edges; small numerical perturbations move bumps in/out, producing patchy coverage on rings and domes.

The triplanar algorithm was a stepping stone from cluster-based placement. Geodesic placement is the proper fix: spacing should be measured **on the surface**, not in world projection.

---

## Approach: Bridson Surface Poisson-Disk

Standard Bridson dart-throwing, adapted to operate on a triangle-soup selection rather than a parameter domain.

```
1. Pick a seed point on the selection (first face centroid).
2. active = [seed]; accepted = [seed]; insert seed into spatial hash.
3. While active is non-empty:
   - Pop a random active point P (with its host face f).
   - For up to K attempts:
     - Build tangent frame (u, v) in the plane perpendicular to f.normal.
     - Pick random angle θ ∈ [0, 2π) and radius r ∈ [spacing, 2·spacing].
     - Candidate = P + r·(cos θ · u + sin θ · v).
     - Find selected faces whose centroid is within (spacing + edge_pad)
       of the candidate via the face spatial hash.
     - Project candidate onto each near face's plane; first that contains
       it (isInsideTriangle) wins. Snap candidate to that face.
     - If no accepted point within spacing (via accepted spatial hash):
       accept, add to active, insert into accepted hash.
       break out of attempt loop.
   - If no candidate accepted after K attempts: remove P from active.
4. After active empties, scan for any selected face whose centroid is
   farther than spacing from all accepted points (disconnected components).
   If any: re-seed from one of them and resume from step 3.
5. Centroid fallback: ensure each selected face has at least one accepted
   point within spacing — guarantees coverage on tiny isolated faces.
```

### Why this is uniform across curvature

Candidates are generated **in the tangent plane of the host face**. The annulus radius is the same `[spacing, 2·spacing]` regardless of face orientation. After projection onto a near face, the spacing check is 3D Euclidean — a tight underestimate of geodesic distance for samples that are close (which they are; we reject anything closer than `spacing`).

For two points on a smooth surface separated by < `2·spacing`, geodesic distance ≈ Euclidean distance × (1 + O((spacing·κ)²)) where κ is curvature. For typical print textures (spacing ~5 mm, κ ~ 0.1/mm), the error is < 1 %. The dedup check holds.

### K = 20 attempts

Bridson 2007 used K = 30 in 2D. On surfaces with constrained tangent moves, 20 is sufficient; the extra darts mostly miss because they fall off the selection edge, not because the spacing test rejects them.

---

## Spatial Hashes

Two flat hashes, both keyed by 3-integer cell index encoded as a JS number.

| Hash       | Cell size   | Stored                | Use                                    |
|------------|-------------|-----------------------|----------------------------------------|
| `faceHash` | `spacing`   | face index → centroid | candidate → near face lookup           |
| `acceptHash` | `spacing` | accepted point index  | spacing check on candidates            |

A cell is `(floor((x - xMin) / cellSize), …)`. Both hashes search the 3×3×3 neighborhood (27 cells) around the query cell. Cell size = `spacing` keeps neighborhood diameter at `spacing·√3 ≈ 1.73·spacing`, so any point within `spacing` of the query is in the searched neighborhood.

### Key encoding

Pack `(ix, iy, iz)` into a single JS number: `(ix + offset) * BASE² + (iy + offset) * BASE + (iz + offset)` with BASE = 4096, offset = 2048. JS Map keys are then numbers (faster than string concatenation).

For a model with bbox 200 mm and spacing 5 mm, cell counts max at 40³ = 64K — well within range.

---

## Performance Envelope

Aloy Focus is the worst case in `TestDocs/`: 6560 selected faces, ~13 mm × 50 mm bbox, default spacing 5 mm.

- **Build face hash:** O(F) = 6560 ops.
- **Bridson active loop:** target accepted ≈ totalArea / (0.83 · spacing²). For Aloy at spacing 5 mm with surface area ~3000 mm², target ≈ 145 bumps.
- **Per active iteration:** 20 attempts × 27 cell lookups × ~1 face per cell + 27 cell lookups in acceptHash. Constant factor; total work ≈ 145 · 20 · 60 = 174 K ops.
- **Hemisphere mesh build:** unchanged, 144 tri × bumpCount.

Target wall time on Aloy: < 200 ms (was ~150 ms for triplanar). Acceptable.

---

## Determinism

Bridson uses RNG. To make tests stable:

- Seed the RNG from `(faceCount, faceSet.size, spacing, radius)` via a small mixing function. Same input → same output.
- This is mulberry32 or similar; ~10 lines of code.

Without this, every test run produces a different bump count (within ±5 %), and visual regression tests can't snapshot.

---

## Acceptance Tests

Add to `tests/texture-phase1-clusters.spec.js` (or new `texture-geodesic.spec.js`):

| Test | Assertion |
|------|-----------|
| Aloy Focus, all faces, spacing 5 mm | bump count ≥ 100; no bump within `0.95·spacing` of another |
| MeshRing1 outer wall, spacing 4 mm | bumps distributed around full circumference (angular std dev < 0.3 rad) |
| Baseplate top face, spacing 6 mm | hex-like spacing; mean nearest-neighbor distance within ±10 % of `spacing` |
| Same model + params twice | identical bump count and positions (determinism) |
| Disconnected selection (two regions) | both regions populated |

The first assertion is the key one for the original problem (uniformity).

---

## Out of Scope

- True geodesic distance via face-graph BFS (Euclidean is good enough for spacings small relative to curvature; defer if a model breaks the < 1 % envelope above).
- Lloyd-relaxation post-pass (could improve uniformity further; not yet justified).
- Adaptive spacing on high-curvature regions.
- Per-face anisotropy hints from mesh edges.

---

## Aborted Experiment: Face-Graph Dijkstra (2026-04-29)

A Dijkstra-on-face-adjacency variant of the spacing check was attempted to fix
the limitation that opposing surfaces of a thin model (Aloy Focus, 6.9 mm
thick) get blocked by the 3D Euclidean check when the user picks a spacing
larger than the model thickness.

**Implementation:** built local face adjacency (vertex-key matching at 1e-4 mm
precision, faces sharing two vertex keys = shared edge), maintained
`minGeodesicDist[face]` Float32Array, propagated distances via Dijkstra after
each acceptance, replaced the 3D check with `minGeodesicDist[face] < minDist`.

**Failure mode:** Aloy Focus has duplicate or near-duplicate triangles (likely
two-sided thin-shell artefacts; observed `adjMax=30`, `edgeMin≈0.00001 mm`).
Duplicate triangles share all 3 vertices, so they appear as adjacent in the
face graph with edge weight ≈ 0 (centroid-to-centroid distance is essentially
zero between an STL triangle and its near-duplicate).

When Dijkstra propagates from a seed face A:
1. The duplicate A' gets `minGeodesicDist[A'] = 0 + ε` (essentially 0).
2. Propagation continues from A', visiting A's neighbors via A'.
3. Subsequent acceptances on faces "near" A in 3D — but reachable only via
   long-edge or non-adjacent paths in the face graph — pass the spacing check
   because their `minGeodesicDist` was never updated below `minDist`.

Observed result on Aloy Focus at default 5 mm spacing: 1547 bumps accepted
(vs 148 with the 3D Euclidean version), min 3D NN distance ≈ 0 mm — bumps
literally co-located.

**Root cause analysis:**
- Duplicate triangles inflate `adjMax` to 30 and produce zero-weight edges.
- Mean facesVisited per Dijkstra call was 5.5 (vs ~30-50 expected for
  `minDist=2.5mm` with avg edge ~0.5 mm), suggesting propagation gets stuck
  on the duplicate-triangle clusters and dies before reaching a useful
  neighbourhood.

**Reverted** to the 3D Euclidean spatial-hash version (commit before the
attempt). Future work would need either:
- Pre-process step to deduplicate or weld near-duplicate triangles before
  building adjacency.
- Hybrid approach: 3D Euclidean as primary check, face-graph BFS only as
  an escape-hatch verification when the 3D check would otherwise reject.
- Or: full polyhedral geodesic via funnel/MMP algorithm (heavyweight).
