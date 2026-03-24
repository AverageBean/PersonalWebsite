# Parametric STEP Phase A — Internal Slot Detection

## What changed

`tools/convert-stl-to-step-parametric-with-freecad.py` gained a new function,
`apply_internal_slot_cuts`, which detects rectangular slot features in prismatic
parts and subtracts them from the CSG solid.  The test suite in
`tools/test-parametric-step.py` was updated with slot-specific assertions.

---

## The problem

The parametric STEP exporter could produce a box with rounded external corners
(Phase A corner fillet work) but lost all internal features — the T-slots
machined into the top face of `Station_3_Baseplate`.

The cause: `build_box_solid` created the outer shell and fillets, then stopped.
The 16 internal wall planes detected by `detect_planes` (stored in each result's
`"indices"` key) were unused.

---

## How internal slot detection works

### Plane data available

`detect_planes` bins every face by normal direction (±X, ±Y, ±Z) and applies a
flatness check.  For the baseplate it finds 22 planes:

| Role | Count | Example positions |
|---|---|---|
| Cap planes (±Y) | 2 | y = 0, y = 12 mm |
| Outer wall planes (±X, ±Z) | 4 | x = ±50, z = ±63.4 |
| Internal wall planes | 16 | x = ±2.4, ±16.4, ±35.0, ±40.9 mm |

Each result stores `"indices"`: the face indices whose centres define the plane.
These face-centre positions encode where the wall exists in 3D space.

### Slot definition from plane pairs

A rectangular slot cut from one cap face has two wall types:

- **Left wall** — outward normal points **into the slot** (+X for a slot that
  opens in the +X direction).  Detected as a "positive-axis" plane.
- **Right wall** — outward normal points in the opposite direction (−X).
  Detected as a "negative-axis" plane.

A valid slot pair: one pos-plane at position `x1` and one neg-plane at `x2 > x1`,
with `slot_width = x2 − x1` in the range [1, 25] mm.

### Greedy pair matching

All valid (pos, neg) combinations within the width range are collected, sorted
by width smallest-first, then matched greedily (each plane used at most once).
This prevents the same wall from appearing in two overlapping slots.

### Slot geometry from face centres

Once a pair is matched, the face indices from both planes are pooled.  The face
centres along the cap axis (Y for this part) give:

- **Slot bottom** — `min(face_centres_y) − 0.5 mm`
- **Cut top** — `cap_hi + 0.5 mm` (cut through from the open cap face)

The face centres along the perpendicular lateral axis give the slot's length
extent, so blind slots are bounded correctly (not cut through the full part).

### T-slot geometry handled

The Station 3 Baseplate has T-slots.  A T-slot has:

- **Neck** (≈ 5.9 mm wide) — the narrow opening at the top face.
- **Head** (≈ 32–45 mm wide) — the wider undercut at depth.

The function detects both.  SLOT_MAX_WIDTH = 25 mm excludes the T-head widths
(32–45 mm are outside range), so only the neck is cut.  Phase B or a raised
SLOT_MAX_WIDTH can add the T-head once the depth logic is confirmed correct.

**Results for Station 3 Baseplate:**

| Axis | Slot positions | Width |
|---|---|---|
| X | [−40.9, −35.0] | 5.9 mm (left T-neck) |
| X | [−2.4, +2.4] | 4.9 mm (centre cross) |
| X | [+35.0, +40.9] | 5.9 mm (right T-neck) |
| Z | [−54.4, −48.5] | 5.9 mm (front T-neck) |
| Z | [−2.4, +2.4] | 4.9 mm (centre cross) |
| Z | [+48.5, +54.4] | 5.9 mm (rear T-neck) |

6 slot cuts applied.  STEP output: 48 PLANE entities + 4 CYLINDRICAL_SURFACE
(corner fillets).

---

## Test coverage

| Test | Result | Key assertions |
|---|---|---|
| MeshRing1 (Phase A baseline) | PASS | 100% coverage, cylindrical path, no box routing |
| Station 3 Baseplate | PASS | corner_r=7.5 mm, 6 slot cuts, ≥10 PLANE in STEP |

The test for the baseplate now explicitly checks:

- stdout contains `"applied"` (matches "applied N slot cut(s)")
- STEP PLANE count ≥ 10 (inner slot walls add substantially to the face count)

---

## Concepts introduced

**Outward face normal direction encodes concavity:**  In an STL, face normals
point *away from the solid*.  A slot wall's normal therefore points into the
open space of the slot, not into the surrounding material.  This is what lets
the pairing logic distinguish left from right walls.

**Greedy interval matching:**  Matching slot walls by minimum width first
prevents a narrow real slot from being obscured by a spurious wide pairing
involving the same plane.

**Face-centre extents for feature geometry:**  Rather than relying on the plane
equation (which has no bounds), the face-centre positions from `"indices"`
directly encode where the feature begins and ends in all three dimensions.
