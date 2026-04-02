# Mold Generator — Two-Part Mold from Any STL

## What changed

A complete mold generation feature was added across 5 files:
1. **`tools/generate-mold-with-freecad.py`** (new) — FreeCAD CSG script
2. **`tools/converter-server.js`** — new endpoint + zip builder
3. **`js/app.js`** — mold UI logic, split plane preview, drag interaction
4. **`index.html`** — mold toggle button and parameter panel
5. **`css/style.css`** — mold panel styles

---

## How the mold is built (FreeCAD CSG pipeline)

The core algorithm uses FreeCAD's OpenCASCADE Part module for boolean solid operations:

```
1. Load STL mesh → convert to solid (Part.makeSolid)
2. If clearance > 0, scale model outward from centroid
3. Create Part.makeBox() sized to model bbox + wall thickness
4. block.cut(model) → cavity mold
5. Bisect with two slab cuts at the split height
6. Add registration pins (bottom.fuse) and holes (top.cut)
7. Add sprue channel (top.cut with cylinder)
8. Export each half as STL via MeshPart.meshFromShape
```

**Key FreeCAD functions used:**
- `Part.makeBox(length, depth, height, origin_vector)` — creates rectangular solids
- `Part.makeCylinder(radius, height, base_point, axis_direction)` — creates pin/hole/sprue geometry
- `shape.cut(other)` — boolean subtraction (CSG)
- `shape.fuse(other)` — boolean union (for adding pins)
- `MeshPart.meshFromShape(shape, LinearDeflection=0.1)` — converts solid to triangulated mesh for STL export

**Important design decisions:**
- Clearance is implemented as a uniform scale from centroid rather than `shape.makeOffsetShape()`, which fails on complex mesh shapes
- Pin holes are 0.3mm larger diameter than pins for printable fit
- Sprue starts 0.5mm below the split plane to ensure the channel connects to the cavity

---

## The zip builder (no npm dependency)

Instead of adding a zip library, a minimal PKZip builder was written using only Node.js built-in `zlib.deflateRawSync()`. The format is straightforward for two files:

```
[Local file header 1][Compressed data 1]
[Local file header 2][Compressed data 2]
[Central directory entry 1]
[Central directory entry 2]
[End of central directory record]
```

Each entry needs a CRC-32 checksum, implemented with the standard ISO 3309 polynomial (`0xEDB88320`). The total zip builder is about 80 lines of code.

---

## Split plane preview (Three.js)

The split plane is a `THREE.PlaneGeometry` with a translucent material (25% opacity, accent color) laid flat on the XZ plane. It lives in the `scene` directly (not inside `currentModelRoot`) so it doesn't scale with the model.

**Drag interaction:** When the user clicks on the plane (detected via `THREE.Raycaster`), orbit controls are disabled and pointer movements translate the plane along Y. The sensitivity is computed as `heightRange / (canvasHeight * 0.4)` — this approximation works well across different zoom levels. On `pointerup`, orbit controls are re-enabled.

---

## Server endpoint pattern

The mold endpoint follows the same patterns as the existing STEP export:
- Raw binary POST body (STL data)
- Parameters in query string
- FreeCAD invocation via `child_process.spawn`
- JSON on stdout for parsing output paths
- Progress/status on stderr
- Temp directory cleanup in `finally` block

One difference: parameters are written as a JSON file and passed as a third argument to the script, rather than encoding everything in CLI args. This keeps the interface clean as the parameter count grows.

---

## Test results

| Spec file | Tests | Status |
|-----------|-------|--------|
| `viewer.spec.js` | 20 | 20 pass |
| `panel-tabs.spec.js` | 6 | 6 pass |
| `overlay-position-check.spec.js` | 2 | 2 pass |
| `viewer-controls.spec.js` | 21 | 21 pass |
| `mold-generator.spec.js` | 6 | 6 pass (1 needs converter) |
| **Total** | **54** | **54 pass** |

---

## Configurable mold parameters

| Parameter | Default | Range | Purpose |
|-----------|---------|-------|---------|
| Wall thickness | 10 mm | 1–50 mm | Material around the cavity |
| Clearance | 0 mm | 0–5 mm | Gap between model and cavity |
| Pin diameter | 5 mm | 2–15 mm | Registration pin/hole size |
| Pin inset | 8 mm | 3–30 mm | Distance from mold edge to pin center |
| Sprue diameter | 6 mm | 2–20 mm | Pour channel diameter |
| Split height | midpoint | model Y range | Where to bisect the mold |
