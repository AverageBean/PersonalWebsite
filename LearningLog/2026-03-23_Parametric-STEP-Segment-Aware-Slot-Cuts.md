# Parametric STEP — Segment-Aware Slot Cuts and Volume Fidelity

## What changed

`tools/convert-stl-to-step-parametric-with-freecad.py` — `apply_internal_slot_cuts` was
rewritten to cluster face centres along the perpendicular axis before generating cuts.
`tools/slice-stl-profile.py` (new) was created to slice an STL at multiple heights and
reveal the cross-section at each level.

---

## The root cause of 9% volume over-cut

The comparison tool (`compare-step-to-stl.py`) showed:

| Metric | Before | After |
|---|---|---|
| Volume ratio (STEP/STL) | 0.9100 | 0.9925 |
| Symmetric mean deviation | 0.372 mm | 0.041 mm |
| Hausdorff distance | 4.0 mm | 0.956 mm |
| Geometry check | ISSUES | PASS |

The diagnosis required two pieces of evidence:

**1. Cross-section slice confirms all cuts are full-height through-cuts.**
`slice-stl-profile.py` sliced the baseplate at nine Y levels (0.5 – 11.5 mm).  The
cross-section was *identical at every height* — 8 loops at every level — confirming that
every cut feature spans the full 12 mm part thickness with no T-slot profile in Y.

**2. The same wall pair covers two non-contiguous regions.**
The wall at X=[35.0, 40.9] (detected as one plane pair by `detect_planes`) has face centres
at *two separate Z ranges*:

```
Z ≈ [-52.5, -24.5]    ← T-head at Z = -38  (southern pocket)
GAP  Z ∈ (-24.5, 24.5)  ← solid material — should NOT be cut
Z ≈ [+24.5, +52.5]    ← T-head at Z = +38  (northern pocket)
```

The old code computed `perp_min = -52.5` and `perp_max = +52.5` and made **one continuous
box cut** spanning 105 mm, which destroyed 45 mm of solid material in the middle.  This
alone caused ~3,200 mm³ of extra removal per wall pair (×2 pairs = ~6,400 mm³ error).

---

## The fix: gap-aware segment detection

Before cutting, the face centres in the perpendicular direction are sorted and split at
gaps larger than `max(5.0, 2 × slot_width)` mm.  Each contiguous segment becomes its own
independent box + end-cap cylinder pair:

```python
gap_thresh  = max(5.0, width * 2.0)
splits      = np.where(np.diff(perp_sorted) > gap_thresh)[0] + 1
segments    = np.split(perp_sorted, splits)
slot_segs   = [(float(s.min()), float(s.max())) for s in segments]
```

For the X=[35, 40.9] pair this now generates **two separate cuts**:

```
Segment 1: straight=[−52.5, −24.5]  → box + 2 end caps
Segment 2: straight=[+24.5, +52.5]  → box + 2 end caps
```

An additional edge-proximity guard (`EDGE_MARGIN = 2.0 mm`) was added to skip end caps
whose `perp_end` lies within `r_semi + EDGE_MARGIN` of the part boundary.  This prevents
scalloped arcs appearing at edges where the slot exits the part face.  (None of the
baseplate slots triggered this guard in practice, but it is needed for general parts.)

---

## Why wall planes aggregate faces from multiple features

The `detect_planes` function bins all faces with normals pointing in the same direction.
The wall pair at X=[35, 40.9] picks up face centres from:
- The two T-head long walls (at Z = ±38, spanning Z = ±[24.5, 52.5])
- Nothing else for this pair

The Z-axis pairs at Z=[48.5, 54.4] additionally pick up the *short end faces* of the
T-heads (which happen to have Z-normals at Z ≈ 52 and Z ≈ 24.5) in addition to the main
T-neck body at Z ≈ 51.5.  This causes the Z-axis slot to be split into three segments:

```
Segment: X ≈ [−39, −37]  ← T-head end face at X = −38
Segment: X ≈ [−14, +14]  ← T-neck main body
Segment: X ≈ [37, 39]    ← T-head end face at X = +38
```

The two narrow (2 mm) end-face segments produce small redundant cuts that slightly
over-cut at the T-head/T-neck junction.  The residual 0.75% volume error (1,034 mm³)
and 0.956 mm Hausdorff distance come from these small overlaps.

**Phase B improvement:** filter Z-axis wall faces whose XZ position already overlaps a
known X-axis cut segment — these belong to the T-head end faces, not the T-neck proper,
and should be excluded from Z-axis slot pairing.

---

## How to think about this problem class

> **A detected plane pair covers exactly one family of parallel wall faces with the same
> normal.  But a single feature class (T-head walls) can share its normal direction and
> plane position with walls from a different feature (T-neck end faces).  Gap detection in
> the perpendicular direction is the correct general fix: it makes no assumptions about
> the number or type of features — it simply cuts each contiguous face-centre group
> independently.**

This is the same principle used by CNC toolpath planning to avoid air-cuts: the tool path
must follow actual material boundaries, not the bounding box of scattered feature evidence.

---

## Test results

| Test | Result | Key metrics |
|---|---|---|
| MeshRing1 | PASS | 100% coverage, cylindrical path |
| Station 3 Baseplate | PASS | 18 PLANE, 33 CYLINDRICAL_SURFACE entities |

Geometry comparison (Station 3 Baseplate):
- Volume ratio: **0.9925** (ideal = 1.000)
- Symmetric mean deviation: **0.041 mm**
- Hausdorff distance: **0.956 mm**
- All geometry checks PASS
