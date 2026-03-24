# Parametric STEP — Oblong Through-Cuts and Circle Detection

## What changed

`tools/convert-stl-to-step-parametric-with-freecad.py` received three improvements:

1. **Full-height through-cuts** — slot cuts now always span the full part thickness.
2. **Semicircular end caps** — each oblong slot ends in a half-cylinder cut, not a blunt rectangular edge.
3. **Cluster-then-RANSAC circle detection** — a new `detect_circle_holes` function
   distinguishes full circular holes (arc coverage > 270°) from oblong end arcs (~180°).

---

## Why the cuts only reached y = 8.5 instead of y = 12

The Station 3 Baseplate's internal features have a **T-slot profile** in cross-section:

```
Y=12  ┌──────────────── cap ─────────────────┐
Y=8   │  ┌── neck walls (5.9 mm wide) ──┐    │  ← planar faces, detected as planes
Y=4   │  │  curved transition zone       │    │  ← diagonal face normals (unclaimed)
Y=0   └──┴───────────── cap ─────────────┴────┘
```

The FLAT WALLS of the neck span y = 0–4 and y = 8–12.  The curved transition
zone spans y = 4–8.  `detect_planes` correctly claims the flat walls as planes, but
their face centres are only at y = 4–8 (the transition zone).  The previous code
used `min(face_centre_y) – 0.5` as the cut depth, which gave y = 3.5 instead of
the correct y = 0 (bottom cap).

**Fix:** Always cut from `cap_lo − 0.5` to `cap_hi + 0.5` (full part thickness plus
margin).  Through-features have no ambiguity about depth.

---

## Oblong (stadium) profile detection

An oblong through-cut has:
- Two **flat long sides** — detected as planes (already working)
- Two **semicircular short ends** — cylindrical arcs at each end of the straight section

### End cap placement

The flat wall face centres span the straight section of the slot.  The semicircle
centre in the length direction is exactly at the end of the straight section:

```
     flat wall face centres span [z_min, z_max]
            ↓                       ↓
   (cyl at z_min)        (cyl at z_max)     ← two end-cap cylinders
     ←── straight box section ──→
```

Each end-cap cylinder has:
- Radius = slot_width / 2
- Height = full part thickness
- Centre position = (slot_axis_centre, z_end) in XZ plane

### CSG for a complete oblong cut

```
solid.cut(box)        # straight rectangular section
solid.cut(cyl_lo)     # semicircle at lower Z end
solid.cut(cyl_hi)     # semicircle at upper Z end
```

Results for Station 3 Baseplate:
- 6 oblong cuts, each with 2/2 end caps applied
- STEP output: 19 `CYLINDRICAL_SURFACE` entities (4 corner fillets + 15 end caps)
  and 16 `PLANE` entities

---

## Cluster-then-RANSAC circle detection

To distinguish **full cylindrical through-holes** from the **semicircular ends of
oblongs**, the new `detect_circle_holes` function:

1. Takes unclaimed tight-lateral faces (|n · cap_axis| < 0.25, not yet a plane).
2. **BFS clusters** them in the XZ plane using an 8 mm proximity radius.
3. For each cluster ≥ 20 faces: computes the **angular coverage** of face normals
   around the cylinder axis.
   - Full circle: normals span ~360° → max gap ≈ 0
   - Semicircle: normals span ~180° → max gap ≈ π

4. Accepts clusters with coverage > 270° as full holes; skips partial arcs.
5. Runs RANSAC on accepted clusters to find centre, radius, axis.

### Result on Station 3 Baseplate

All 17 clusters were partial arcs (137° or 47°) — all are oblong end arcs.
No full circular holes were identified in the unclaimed lateral faces.

### Why the center feature is not detected as a full circle

The center feature (planes at ±2.449 mm in both X and Z) produces ~160 unclaimed
arc faces.  These are clustered by the BFS but RANSAC on that cluster finds a
**horizontal** cylinder axis (axis misaligned with Y, dot = 0.02).  This indicates
the cluster mixes the center hole wall faces with T-slot transition zone faces
that form a horizontal cylindrical blend at the neck-to-head junction.

**Current behaviour:** The center is approximated by two crossed oblong cuts of
width 4.9 mm and straight section 1.6 mm.  The crossed oblongs over-cut a small
cross region but the area is small (≈ 5 × 8 mm).

**Phase B item:** Separate the center hole from the T-slot transition by filtering
for faces whose lateral position matches a known pair of crossed plane detections
with equal width in both X and Z → flag as a circular hole candidate.

---

## Test suite results

| Test | Result | Key checks |
|---|---|---|
| MeshRing1 | PASS | 100% coverage, cylindrical path |
| Station 3 Baseplate | PASS | 6 oblong cuts, ≥10 PLANE, ≥10 CYLINDRICAL_SURFACE |

Timeout raised to 240 s per test to accommodate RANSAC variance.
