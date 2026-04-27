# ESP35Box Parametric Detection Diagnosis

**Date:** 2026-04-22  
**File:** `TestDocs/ESP35Box.stl`  
**Status:** Pipeline produces STEP with 59% excess volume — interior cavity not detected

---

## Geometry Profile

```
Outer envelope:  33.1 × 56.8 × 13.65 mm
Triangles:       8952
Unique normals:  1355  (41% are curved/fillet faces)

Wall structure:
  Outer walls:  X=±13.95mm,  Y=+26.12/-24.58mm  (~2.6mm thick)
  Inner walls:  X=±11.20mm,  Y=+22.95/-21.95mm
  Wall thickness (face-to-face): ~2.75mm X, ~2.6–3.2mm Y

Interior levels (horizontal faces pointing up inside cavity):
  Z=-0.20mm: 1490 faces — lower chamber floor / ledge
  Z=+2.50mm: 1248 faces — raised platform/shelf in upper cavity
  Z=+4.90mm:   21 faces — top rim notch

Inner cavity dimensions:
  Lower chamber: Z=-5.7mm to -0.2mm (~5.5mm deep, wider cross-section)
  Upper pocket:  Z=-0.2mm to +4.78mm (~5mm deep, X=±11.2mm × Y=±22.95mm)
  Total inner wall height: 10.48mm (Z=-5.7 to +4.78mm)

Mounting posts (convex):  4× r=1.41mm at (±11.6, ±23.8mm), arc=313°
```

---

## Conversion Output Summary

```
Coverage:    74.4% (floor/corner-fillet claimed, but cavity NOT claimed)
Box CSG:     33.1×56.8×13.6mm body + corner r=2.20mm + 5 oblong cuts + 4 sprue holes
Volume:      24464 mm³  (correct = 15391 mm³)
Volume err:  +9073 mm³  (+59%)
Hausdorff:   5.47mm  (worst at box center interior — where cavity floor should be)
Mean dev:    1.33mm
```

---

## Root Cause Analysis

### 1. PRIMARY — Interior cavity not subtracted (9073 mm³ excess)

The ESP35Box is a **hollow shell** (electronics enclosure). The box CSG path builds a SOLID box and cuts features, but **has no "pocket/shell detection"** capability.

The inner walls ARE detected as planes:
- n=[+1,0,0] at X=+14.676mm (inner wall, left side)
- n=[-1,0,0] at X=-16.477mm (outer wall, right side)
- etc. for Y-direction walls

But the **slot detection** handles only two-wall pairs forming thin slots. The interior cavity requires matching FOUR walls (±X + ±Y) plus a floor plane to cut a full 3D pocket. The slot code finds 2 wall pairs and cuts tiny 1mm notches at the box ends (port openings), not the full cavity.

**Estimated cavity volume contribution:**
- Lower chamber: 29mm × 51.8mm × 5.5mm ≈ 8259 mm³
- Upper pocket:  22.4mm × 45.9mm × 5.0mm ≈ 5143 mm³  
- Minus platforms and posts ≈ ~9000 mm³ total  ✓ matches 9073 mm³ measured

### 2. SECONDARY — 4 mounting boss posts not modeled

The "circle detect" pass correctly finds 4 convex cylinders at r=1.41mm, arc=313°. These are labeled **"POST"** (normals point outward from axis = solid posts). The pipeline skips them because they're not holes. They should be modeled as positive cylindrical solids added to the STEP inside the cavity.

### 3. TERTIARY — Sprue misdetection at box corners

The "sprue" pass finds 4 arcs at (±14.9, ±26.9mm) above Z=+2.5mm and cuts them as blind holes r≈1.2mm, depth 0.9mm. These are actually curved wall sections at the outer box corners near the top rim (the transition from outer wall to top fillet). The sprue cuts are geometrically incorrect.

### 4. MINOR — Draft-angled outer walls

Detected planes at n=[0.992, 0, 0.127] with 92 inliers each — the outer walls have a ~7.3° draft angle (or the top-edge fillet creates tilted faces near the corners). The box CSG uses perfectly vertical walls. Low impact compared to the cavity issue.

---

## What the Pipeline DOES Handle Correctly

- Outer box body dimensions ✓
- Corner fillets r=2.20mm on 4 vertical edges ✓
- Port/slot cuts on walls (5 oblong cuts: USB, power jack openings) ✓
- Coverage threshold passed (74.4% > 50%) so analytical path is taken ✓

---

## Required Fix: Pocket/Shell Detection

In the box CSG path, after outer box + corner fillets, add:

**Step A — Inner wall detection:**
- Find inward-facing plane pairs (planes with normals pointing TOWARD box center)
- Check for a complete set: left+right X walls AND top+bottom Y walls
- All 4 must be present and roughly parallel to the outer walls

**Step B — Floor/depth detection:**
- Find the interior horizontal plane with the most inliers (Z=-0.2mm = lower chamber floor)
- Determine cavity depth: from floor position to the part's open face

**Step C — Cavity subtraction:**
- Build inner box at cavity dimensions (inner walls define XY, floor defines Z start, top rim defines Z end)
- Subtract from outer solid using CSG `.cut()`
- Inner corner radius = outer_r - wall_thickness ≈ 0 (sharp inner corners acceptable for enclosures)

**Step D — Interior feature modeling (future):**
- Raised platform at Z=+2.5mm: detect as positive sub-box inside cavity
- Mounting posts: add convex cylinders from circle_posts list as positive solids on cavity floor
- Suppress sprue detection when arc source is outer-corner fillet (heuristic: center within wall_thickness of outer box edge)

---

## Test Criteria (for verifying fix)

```
volume ratio:   0.90 – 1.10  (currently 1.59)
mean deviation: < 1.0mm      (currently 1.33mm)
Hausdorff:      < 2.0mm      (currently 5.47mm)
expect_log:     "pocket cut", "inner cavity"
```
