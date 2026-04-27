# 2026-04-27 — Coordinate Probe + Parametric STEP Accuracy Fixes

## Overview

This commit covers two parallel workstreams:

1. **New feature: coordinate probe** — a 3D click tool that reads XYZ position and face normal from any loaded model, in the original STL coordinate system.
2. **Parametric STEP accuracy fixes** — targeted improvements to the ESP35Box conversion: fewer false slot cuts, corrected base-channel depth, and suppression of sprue false-positives at the four outer box corners.

Both workstreams were motivated by the same need: being able to probe the converted STEP file and report exact coordinates so hallucinated geometry could be located and fixed.

---

## Feature: Coordinate Probe

### What it does

A crosshair toggle button appears in the lower-right overlay group when a model is loaded. Clicking it switches the canvas cursor to a crosshair. Any subsequent click on the model fires a Three.js raycast against the mesh and displays:

```
X = 7.82   Y = 2.01   Z = 0.53
n = (0.000, 1.000, 0.000)
```

A **Copy** button writes the full string to the clipboard so it can be pasted into a chat message.

### How the coordinates are reconstructed

The viewer transforms the geometry before display: it centers the bounding box at the origin (`centerGeometryAtOrigin`) and lifts the model so its base sits on the grid (`currentModelRoot.position.y = -bounds.min.y`). Returning to original STL space requires reversing both transforms:

1. `worldToLocal(hit.point)` undoes the lift (and any scale).
2. Adding `originalGeomCenter` (the pre-centering bounding box center, captured in `prepareBaseGeometry` before the geometry is shifted) recovers the original position.

`originalGeomCenter` is reset to `(0,0,0)` whenever `maximizeFootprint` or rotation Apply is called, because those operations re-center the geometry in a new frame.

### HTML / CSS additions

- `#probeToggleBtn` — SVG crosshair icon button, disabled until a model is loaded, `aria-pressed` tracks state.
- `#coordProbeReadout` — absolutely-positioned overlay panel (bottom-left of canvas), `hidden` until a hit registers. Contains `.coord-probe-coords`, `.coord-probe-normal`, and a `.coord-probe-copy` button. `aria-live="polite"` so screen readers announce updates.

### Tests (`tests/coord-probe.spec.js`, 6 tests)

| Test | What it verifies |
|------|-----------------|
| probe button enables after load | button is not disabled after file drop |
| probe toggle activates crosshair cursor | `canvas.style.cursor === "crosshair"` |
| coord readout hidden when probe inactive | `#coordProbeReadout` is hidden |
| coord readout appears after click | readout is attached to DOM after canvas click |
| deactivate hides readout | `aria-pressed` false, readout hidden |
| reset on new file load | `aria-pressed` false after re-loading a file |

All 6 pass.

---

## Parametric STEP Fixes

### Background: How the converter works

The converter (`tools/convert-stl-to-step-parametric-with-freecad.py`) takes an STL file and produces an analytical STEP. The pipeline is:

1. **RANSAC detection** — iteratively fits planes, cylinders, tori, and spheres to the triangle mesh.
2. **CSG reconstruction** — builds a FreeCAD solid using the detected geometry (box outer shell → corner fillets → pocket cuts → hole cuts → slot cuts → sprue cuts).
3. **Quality check** — `compare-step-to-stl.py` computes volume ratio and mean surface deviation.

False-positive cuts (geometry the converter invents that doesn't exist in the original) create visible notches and bars on the STEP surface.

---

### Fix 1: SLOT_MAX_WIDTH reduction (25 mm → 15 mm)

**Problem:** ESP35Box outer walls have a ~7.3° draft angle. Their RANSAC normals include a small Z-component: `n = [0.992, 0, 0.127]`. The slot detector finds pairs of planar walls facing each other. The draft-angled outer walls on opposite sides of the box paired up, creating a "slot" 20.5 mm wide that was then cut as a long rectangular channel.

**Fix:** Reduced `SLOT_MAX_WIDTH` from 25 mm to 15 mm. The real port openings (USB / power connectors) are 1.4 mm wide; the false outer-wall pair at 20.5 mm is now above the threshold and ignored.

**Why 15 mm is the right threshold:** The real slots are ≤ 5 mm wide. 15 mm gives 3× headroom above the real maximum while being well below 20.5 mm.

---

### Fix 2: Degenerate zero-length segment guard

**Problem:** Slot detection produced a segment with `straight = [1.0, 1.0]` (zero length). The T-junction extension code then expanded it to `[0.0, 1.0]` and cut a small box.

**Fix:** Added `if seg_max - seg_min < 1.0: continue` before the T-junction logic. Any segment shorter than 1 mm is skipped.

---

### Fix 3: Base-channel depth (single margin instead of double)

**Problem:** The base channel cut height was `abs(floor_pos - part_lo) + 2 × HOLE_CUT_MARGIN`. With `floor_pos = -0.2 mm` and `HOLE_CUT_MARGIN = 0.5 mm`, the channel top landed at `-0.2 + 0.5 = +0.3 mm` — 0.3 mm above the cavity floor. The coordinate probe confirmed this: the horizontal bar face was at `Z = 0.31 mm`.

**Fix:** Changed to `+ HOLE_CUT_MARGIN` (single, bottom-only). The bottom needs a margin so FreeCAD's Boolean doesn't fail on a flush cut; the top should stop exactly at `floor_pos` with no overshoot.

After the fix, the probe moved from `Z = 0.31 mm` to `Z = 0.53 mm`. The Y coordinate stayed constant at Y = 2.01 mm, which pointed to a different source (see Fix 4).

---

### Fix 4: Sprue corner suppression

**Problem:** The four outer corners of the ESP35Box have fillet-transition geometry — where the draft-angled wall meets the top rim, there is a curved cluster of triangular faces. These clusters are arc-shaped, ~1.1–1.3 mm radius, ~224° arc coverage. They pass every filter in the sprue detector (radius 0.5–5 mm, arc ≥ 180°), so the detector cuts four blind cylindrical holes at `(±14.9, ±26.9)` — exactly the outer corner positions.

**Root cause of the Y = 2.01 horizontal face:** The four sprue cylinders at the outer corners cut through the region where the outer wall meets the inner pocket wall. This intersection produced a planar face at the pocket-wall height (Y ≈ 2.01 mm in STL coordinates). Removing the false sprue cuts eliminated the face.

**Fix:** After radius, arc, and pocket-footprint filters, compute the 2D distance from the candidate center `(cx, cz)` to each of the four outer-box corners:

```python
CORNER_PROXIMITY_MM = 3.5
outer_corners_2d = [
    (fc_min[la], fc_min[lb]),
    (fc_min[la], fc_max[lb]),
    (fc_max[la], fc_min[lb]),
    (fc_max[la], fc_max[lb]),
]
min_corner_dist = min(sqrt((cx-ocx)²+(cz-ocz)²) for (ocx,ocz) in outer_corners_2d)
if min_corner_dist < CORNER_PROXIMITY_MM:
    skip
```

All four corner clusters are at dist 2.2–2.4 mm from their respective corners and are now suppressed. Real sprue holes (feed channels at the center or mid-wall of a mold cavity) are never within 3.5 mm of a box corner.

**Test assertion added:** `"sprue hole cut"` added to `reject_log` for the ESP35Box test case. ESP35Box has no real sprues; this assertion will catch any regression.

---

### ESP35Box final metrics

| Metric | Before fixes | After all fixes |
|--------|-------------|-----------------|
| Volume ratio | 0.966 | 0.9984 |
| Mean deviation | 0.226 mm | 0.099 mm |
| False slot cuts | 5 (3 false) | 2 (0 false) |
| False sprue cuts | 4 | 0 |

---

## Known Regression: Mold-Top (MeshRing1-mold-top.stl)

The mold-top conversion worked well after Phase C-0 (vol ratio ≈ 1.019). Two Phase D features introduced regressions that are documented here for future fixing.

### Regression A: False base channels from Phase D.5

**Phase D.5** added base-channel detection: slice the mesh at a level inside the base region, find enclosed loops, and cut each as a rectangular channel. This was designed for ESP35Box, which has a **upward-opening** pocket. The cross-section is taken below the pocket floor, in the solid base material, finding real cable-guide channels.

The mold-top has a **downward-opening** cavity (the ring mold impression opens from the bottom face). The pocket floor is near the top of the part (Y ≈ 5.98 mm in a 13 mm tall part with bottom at Y = 3 mm). The base-channel code computes:

```
z_sample = 0.5 × (part_lo + floor_pos) = 0.5 × (3 + 5.98) = 4.49 mm
```

This samples directly **inside the ring cavity** (between the bottom opening at Y = 3 mm and the floor at Y = 5.98 mm). The trimesh cross-section through the cavity finds the concentric rings of the mold impression as 2D loops. These loops — 50 × 50 mm and 40 × 40 mm — pass the "area > 50 mm²" filter and are incorrectly cut as base channels.

**Why the existing guard doesn't catch it:** The "skip if loop fully contains the main pocket" filter only skips loops **larger** than the pocket. These inner loops are **smaller** than the pocket (pocket is 58.6 × 58.6 mm) so they are not skipped.

**Future fix:** Gate Phase D.5 on `inner_pockets[0]["open_toward_hi"] == True`. Downward-opening pockets do not have channels in the base-material sense; their "base" is the top of the part, which is solid. Alternatively, check that `z_sample` is in the solid region (below the opening level) rather than inside the cavity.

### Regression B: Sprue classified as through-hole

The mold-top has a real sprue channel at `r = 2.99 mm, center = (-24.0, 0.0)`. The face centers of its triangles span Y = [9.27, 12.67], giving `depth_span = 3.4 mm`. The classification threshold is:

```
BLIND_HOLE_DEPTH_RATIO × part_h = 0.25 × 13 = 3.25 mm
```

Since 3.4 mm > 3.25 mm the hole is classified as **through**, cutting a full-height cylinder. The sprue should be a blind hole from the top (approximately 10 mm deep into the 13 mm part).

**Why the interior-plane cross-check is bypassed:** `CAVITY_FLOOR_MIN_RADIUS = 8.0 mm`. The sprue radius is only 2.99 mm, so the radius check `ch["radius"] >= CAVITY_FLOOR_MIN_RADIUS` fails, and the interior-plane depth lookup (which would correctly identify the floor at Y = 5.98 mm and produce a blind cut) is never reached.

**Future fix:** Lower `CAVITY_FLOOR_MIN_RADIUS` to a value closer to the sprue radius, or add an explicit check against the pocket floor for any hole whose face-centre depth classification is close to the through/blind boundary.

### Summary of mold-top state

| Feature | State |
|---------|-------|
| Ring cavity (torus CSG) | Detected and cut correctly |
| 4 mold pin holes | Detected and cut correctly |
| Sprue channel | Present — misclassified as through-hole |
| Base channels | Two false square cuts (50×50, 40×40 mm) from sampling inside cavity |

---

## How to use the coordinate probe for future debugging

When a converted STEP file shows a visible artefact:
1. Load the STEP-derived STL in the viewer.
2. Click the crosshair button (bottom-right overlay).
3. Click the suspicious face.
4. Copy the readout (X, Y, Z, n).
5. Match X/Y against detector output lines in the conversion log:
   - `sprue detected: ... center=(cx,cz)` — compare X/Z to cx/cz
   - `oblong cut axis=N: walls=[...]` — compare the perpendicular coordinate to the wall positions
   - `inner pocket (hi/lo): la=[...] lb=[...]` — compare against pocket bounds
   - `base channel: WxHxD @ la=... lb=...` — compare la/lb to X/Z of the face

This workflow identified every false feature in the ESP35Box within two probing iterations.
