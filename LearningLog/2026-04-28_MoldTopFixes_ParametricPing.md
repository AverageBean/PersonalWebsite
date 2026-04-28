# 2026-04-28 — Mold-Top Phase D Regression Fixes + Parametric Export Ping

## Overview

Two parallel workstreams in this commit:

1. **Parametric STEP completion ping** — small Web Audio "ding" plays when a parametric STEP export finishes, so you can leave the tab while the 2-7 minute conversion runs.
2. **Mold-top parametric conversion polish** — three targeted detection fixes restore `MeshRing1-mold-top.stl` to vol_ratio 1.0135 (previously 0.87 with regressions), without regressing ESP35Box.

Mold-top and ESP35Box still need further polish; this commit closes the three documented Phase D regressions and adds a new regression test so the conditions cannot reappear silently.

---

## Feature: Completion Ping

### What it does

After clicking **Download** with format **STEP (parametric)**, the conversion runs for several minutes. When it finishes — success or failure — the page plays a short two-tone sine ding (880 Hz → 1320 Hz, ~220 ms each).

### How the deferred audio is unblocked

Browsers gate audio on user activation. A `click` is a user gesture, but by the time the ping fires (minutes later, after the streaming export resolves), the gesture window has expired. Two mechanisms keep the AudioContext usable:

1. **Click-time priming** — `primePingAudio()` is called at the start of `downloadCurrentModelExport` when format is parametric. This call is inside the synchronous portion of the click handler (before any `await`), so `AudioContext.resume()` is allowed.
2. **Global one-shot prime** — `pointerdown` and `keydown` listeners on `document` (capture-phase, `once: true`) call `primePingAudio()` on the first interaction anywhere on the page. This unlocks the context even if you start the export by some path that bypasses the export-button click.

### The race-condition gotcha

First implementation didn't make any sound on the user's machine despite Playwright tests counting two oscillators created. Root cause: `ctx.resume()` returns a Promise; calling `osc.start(t0)` on the next line schedules the oscillator before the audio thread is actually running, so the schedule is silently dropped.

Fix: chain on the resume promise.

```js
const resumeP = ctx.state === "suspended" ? ctx.resume() : Promise.resolve();
Promise.resolve(resumeP).then(playNow);
```

Also added a 50 ms scheduling lookahead (`ctx.currentTime + 0.05`) so `start(t0)` is comfortably in the future after the audio thread resumes.

### Tests (`tests/parametric-ping.spec.js`, 4 tests, all pass)

- Stub `AudioContext.prototype.createOscillator` via `addInitScript` to count invocations.
- Stub `/api/convert/stl-to-step-parametric` via `page.route` so the test runs offline.
- Asserts: 2 oscillators on parametric success, 2 on parametric failure (server 500), 0 on STL export, 0 on baseline non-parametric click.

Test oscillator counts confirm scheduling but do **not** confirm audibility. Headless audio output cannot be asserted reliably.

---

## Mold-Top Phase D Regression Fixes

### Background

The previous commit (`d8aa5e6`) added Phase D hollow-shell pocket detection for ESP35Box (electronics enclosure) and documented three known regressions on `MeshRing1-mold-top.stl`:

- False rectangular pocket cut (58.7×58.6×3.5 mm) over a circular cavity
- Phase D.5 base-channel detection sampling inside the downward-opening cavity → two false 50×50 / 40×40 mm channels
- Sprue (r=2.99 mm, depth_span=3.4 mm) classified as through-hole because its radius fell below the `CAVITY_FLOOR_MIN_RADIUS = 8 mm` gate, and depth_span exceeded the `BLIND_HOLE_DEPTH_RATIO * part_h = 3.25 mm` threshold

### Fix 1: Wall planarity gate in `detect_inner_pocket`

**Problem:** The inner-pocket detector found 4 inward-facing "walls" inside the mold-top's cylindrical cavity. The cavity inside is round (no flat walls), but as you walk around the curve, face normals point inward at the X and Z extremes. Those face centres clustered near `±29.3 mm` and got averaged into a "wall position".

**Fix:** Pass the full `planes` list (not just `interior_planes`) into `detect_inner_pocket`. After computing each candidate wall position from face centres, require a corresponding accepted axis-aligned plane within 1.5 mm:

```python
if planes is not None:
    matched = False
    for p in planes:
        if abs(p["normal"][axis_idx]) < 0.9:
            continue
        plane_pos = -p["d"] / p["normal"][axis_idx]
        if abs(plane_pos - pos) < 1.5:
            matched = True
            break
    if not matched:
        return None, 0
```

The plane detector earlier rejects curved planes as `spread > 0.45 mm`, so the X and Z planes for a circular cavity never reach the planes list. Wall match fails → wall rejected → no rectangular pocket cut.

ESP35Box's flat inner walls do match real planes (n=[1,0,0,d=14.676] etc.), so ESP35Box continues to detect its rectangular pocket without regression.

### Fix 2: Phase D.5 cavity-direction gate

**Problem:** Base-channel detection slices the mesh at `0.5 * (part_lo + floor_pos)` and looks for closed 2D loops. This assumes solid material below the floor (electronics enclosures with an upward-opening pocket). The mold-top has a **downward-opening** cavity, so the sample plane lands **inside** the cavity and traces the ring impression as 2D loops.

**Fix:** Skip Phase D.5 when `inner_pockets[0]["open_toward_hi"] == False`.

After Fix 1 also removes the false rectangular pocket, this gate is double-protected — no inner_pockets means D.5 never runs anyway.

### Fix 3: Boundary-case sprue classifier

**Problem:** The sprue's face centres span [9.27, 12.67] mm — only the middle of a ~10 mm channel that goes from the top face down to the cavity floor at Y=5.98 mm. Visible span 3.4 mm exceeds the `BLIND_HOLE_DEPTH_RATIO * 13 = 3.25 mm` threshold by 0.15 mm, so it gets classified as through. The radius (2.99 mm) falls below the existing `CAVITY_FLOOR_MIN_RADIUS = 8 mm` gate, so the interior-plane lookup that would catch this case is skipped.

**Fix:** New "boundary case" branch in `_classify_hole_depth`:

```python
threshold = BLIND_HOLE_DEPTH_RATIO * part_h
if abs(depth_span - threshold) < 0.25 * threshold and interior_planes:
    for ip in interior_planes:
        if ip.get("inliers", 0) < 500:        # require substantial plane
            continue
        if not (ip["la_min"] <= cx <= ip["la_max"] and
                ip["lb_min"] <= cz <= ip["lb_max"]):
            continue
        floor_pos     = ip["pos"]
        opens_from_hi = (part_hi - d_max) < (d_min - part_lo)
        if opens_from_hi:
            cut_y0 = floor_pos
            cut_h  = (part_hi - floor_pos) + HOLE_CUT_MARGIN
        else:
            cut_y0 = part_lo - HOLE_CUT_MARGIN
            cut_h  = (floor_pos - part_lo) + HOLE_CUT_MARGIN
        return cut_y0, cut_h, f"blind-pocket(floor@{floor_pos:.2f})"
```

Two non-obvious choices:

- **Substantial plane filter (`inliers >= 500`)**: protects mounting holes. Without this, any small interior plane that happens to overlap a hole's footprint could be misused as a "floor". The mold-top's cavity floor at Y=5.98 has 2656 inliers (20.6% of all faces), well above the threshold.
- **Opening-side heuristic (`(part_hi - d_max) < (d_min - part_lo)`)**: the existing logic compares `floor_pos` to `part_lo`/`part_hi` to decide which side is open, but that fails for a sprue whose floor is closer to one boundary than the other yet enters from the *opposite* side. Instead, look at which **visible face** is closest to the part boundary — that's the side where the rim was claimed by another detector pass and therefore the side the hole opens from.

The boundary band (±25% of the through/blind threshold) keeps clear blind holes (mounting holes with depth_span 1.34 << 3.25) and clear through holes (depth_span >> 3.25) in the existing face-centre branch. Only ambiguous cases reach the new path.

### ESP35Box impact

None — Fix 1 added a wall-planarity gate that ESP35Box's real flat walls satisfy; Fix 2's gate doesn't fire because ESP35Box opens upward; Fix 3 fires only on ambiguous depth_span values that ESP35Box mounting holes don't hit. Final ESP35Box metrics: vol ratio 0.9984, mean dev 0.100 mm — unchanged from the previous commit.

### Mold-top final metrics

| Metric | Pre-Phase-D (C-0) | Phase D regression state | After fixes |
|--------|-------------------|--------------------------|-------------|
| Volume ratio | 1.019 | 0.87 | **1.0135** |
| False base channels | 0 | 2 | **0** |
| False rect pocket | 0 | 1 | **0** |
| Sprue classification | (no Phase D path) | through (wrong) | **blind-pocket(floor@5.98)** |

### New regression test

`MeshRing1-mold-top.stl` added to `tools/test-parametric-step.py`:

- `expect_log`: `ring pocket cut`, `sprue hole cut`, `blind-pocket`
- `reject_log`: `base channel`, `pocket cut:`, `sprue hole cut: r=2.99mm, through`
- `vol_ratio` band 0.95–1.05

This locks in all three fixes — any regression on any of them will fail the test.

---

## Test Results

```
TEST: MeshRing1.stl                                   PASSED
TEST: Station_3_Baseplate - Part 1.stl                PASSED
TEST: MeshRing1-mold-top.stl                          PASSED  vol=1.0135
TEST: ESP35Box.stl                                    PASSED  vol=0.9984, dev=0.100mm

Overall: ALL TESTS PASSED
```

Plus `tests/parametric-ping.spec.js` (4/4) and `tests/viewer-controls.spec.js` (21/21) for regression coverage.

---

## Remaining polish items (not in this commit)

- **Mold-top mean deviation** not yet asserted (`max_mean_dev_mm` omitted from the test). The current Hausdorff is bounded by the cross-section shape limit of the torus CSG approximation; a tighter assertion needs a dedicated investigation.
- **ESP35Box draft-angled outer walls** still modeled as perfectly vertical. Low impact (vol ratio 0.9984) but eventually worth handling.
- **Phase C-1 / C-2 / C-3** — elliptic cylinders, surfaces of revolution, free swept B-splines — still not implemented.

These are non-blocking for current parts but are documented for future work.
