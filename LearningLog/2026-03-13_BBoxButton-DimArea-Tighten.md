# 2026-03-13 — BBox Button Cabinet Projection Restore & Dim Area Tighten

## Changes Made

### 1. Tightened X / Y / Z dimension input area (`css/style.css`)
- Reduced `.viewer-dim-group` gap from `0.45rem` → `0.28rem`
- Reduced `.dim-input` width from `3.6rem` → `3.2rem`

The transform row was slightly too spread out. Tighter gap and narrower inputs give it a more compact, instrument-panel feel while keeping all three axis labels and values legible.

### 2. Restored cabinet-projection look to bbox toggle button (`index.html`)

Replaced the generic isometric cube SVG with a **static cabinet-projection wireframe** identical in style to the old dynamic preview, but never updating — it always shows a 1:1:1 cube with X, Y, Z axis labels.

**What is cabinet projection?**
A type of axonometric drawing where:
- The front face is drawn true (no foreshortening)
- Depth recedes at 45° at **half** the true length (hence "cabinet" — used for furniture drawings)
- Formula: `depth_drawn = depth_true × 0.5 × sin(45°) ≈ 0.354`

**SVG construction:**
- Cube side S = 30px, depth offset C = S × 0.354 ≈ 10.6px
- Front face: `(35,50)–(65,50)–(65,80)–(35,80)` (top-left to bottom-right)
- Back offset: each front corner shifts `+10.6, -10.6` → rear vertex at `(24.4, 39.4)` etc.
- Solid edges: all visible front face + right side + top face
- Dashed edges: three hidden back edges (opacity 0.55, `stroke-dasharray="2,2"`)
- Labels: `X` at right (+x direction), `Y` at bottom-left (−y direction into ground), `Z` at top-left (+z depth)

**ViewBox trick:** The full drawing space is `0 0 120 90` but all content sits in the lower region. By cropping to `viewBox="0 36 120 54"` the SVG element only occupies the drawn content area (27px rendered at `width=60`), eliminating dead whitespace.

**Why static?**
The old version dynamically re-drew proportions matching the loaded model's X:Y:Z ratio. This was visually confusing — it looked like a live preview rather than a toggle control. A fixed 1:1:1 cube is unambiguous as a UI button and still communicates "3D bounding box" clearly, with the added benefit of X/Y/Z labels for axis orientation reference.

### 3. Test update (`tests/overlay-position-check.spec.js`)
Removed the height-equality assertion between grid button and bbox button. Since the buttons now intentionally differ in size (bbox icon is 35×68px; grid icon is 30×30px), testing height equality is no longer meaningful. The alignment test that matters — tops within 2px — still passes.

## What to Learn
- Cabinet projection is a simple, classic engineering drawing technique. It can be encoded as a static SVG with just 9 lines of path data.
- Cropping SVG viewBox is the cleanest way to remove dead space without changing the layout of the drawn content.
- UI buttons that dynamically change their icon to mirror data they control are a UX anti-pattern when the icon is meant to be a simple toggle — it conflates the control with a display.
