# 2026-03-19 — Dev Server Auto-Start, Crease Normals, Conversion Result Panel

## Overview

This session focused on three quality-of-life improvements to the viewer and one significant rendering fix:

1. Auto-starting the converter service alongside the dev server
2. Animated spinner during STEP conversion
3. Fixing the "missing large triangle" artefact in Solid Fill mode
4. Displaying parametric STEP conversion metrics in a persistent panel

---

## 1. Auto-Starting the Converter Service (`start-dev.js`)

### The Problem

Previously, running `npm start` only launched the webpack dev server. To use any STEP export feature you had to open a second terminal and run `npm run convert:start`. This was easy to forget and caused confusing "failed to fetch" errors.

### The Solution

A new root-level script `start-dev.js` uses Node's built-in `child_process` module to start both processes from a single `npm start` command:

```js
const converter = fork('tools/converter-server.js', [], { stdio: 'inherit' });
const webpack   = spawn('webpack', ['serve', '--hot', ...], { shell: true });
```

`fork()` is a specialised form of `spawn()` for Node.js scripts — it sets up an IPC channel between parent and child. `shell: true` on the webpack spawn lets the OS find `webpack.cmd` in `node_modules/.bin`, which npm adds to PATH automatically when running any `npm` script.

**Key design decisions:**
- A pre-flight `http.get('/api/health')` check runs before forking. If port 8090 is already listening (a leftover session), it reuses it rather than trying to start a second instance that would fail with `EADDRINUSE`.
- If the converter crashes after starting, the `exit` event handler logs a clear message rather than silently failing.
- When webpack exits (e.g. user presses Ctrl+C), the converter is killed too, so no orphan processes are left running.

**Lesson:** `EADDRINUSE` errors from child processes do not surface as `error` events on the parent — they show up as an `exit` event with a non-zero code. Always handle both.

---

## 2. Conversion Spinner

### The Problem

STEP conversion via FreeCAD takes 10–30 seconds. During that time the page looked frozen.

### The Solution

A CSS-animated `<span>` was added inside the status bar that spins during conversion and disappears when done:

```css
@keyframes spin { to { transform: rotate(360deg); } }

.conversion-spinner {
  display: inline-block;
  width: 13px; height: 13px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.75s linear infinite;
}
```

The spinner is shown/hidden by toggling the `hidden` attribute in `downloadCurrentModelExport`. The export button is also disabled during conversion to prevent double-submits, then re-enabled in a `finally` block so it always recovers even if the conversion fails.

**Lesson:** Always use `try/finally` when temporarily disabling UI controls during async operations. If you only re-enable in the `then` path, a network error will leave the button permanently disabled.

**Lesson on `hidden` vs CSS:** The HTML `hidden` attribute sets `display: none` at the UA stylesheet level. If you add your own `display: inline-block` rule, it overrides `hidden` in some browsers. Always add `.my-element[hidden] { display: none; }` to your CSS to ensure the attribute works reliably.

---

## 3. Crease-Angle Normals (Solid Fill Rendering Fix)

### The Problem

The "Solid Fill" view mode showed large triangles as black/missing on the Station 3 Baseplate and similar parts. The large flat top faces appeared completely dark.

### Root Cause

Three.js's `computeVertexNormals()` averages the normals of **all** faces that share a vertex. When a large flat triangle (normal pointing straight up) shared corner vertices with many small fillet triangles (normals pointing at ~45–90°), the averaged vertex normal was pulled far away from vertical. With a directional light overhead, a normal pointing sideways makes the face appear nearly black — visually "missing."

This is the classic **smooth vs hard edge** problem in 3D rendering. All real-time engines must decide which edges to smooth across and which to keep sharp. The angle between adjacent faces at an edge is called the **dihedral angle**.

### The Fix: Crease-Angle Normals

Instead of averaging across all shared vertices unconditionally, a **crease angle** (40° in this implementation) limits which adjacent faces contribute to a vertex's normal:

```
if (adjacent_face_normal · my_face_normal) >= cos(40°):
    include in average
```

Faces more than 40° apart don't share normals — each keeps its own sharp edge. Faces within 40° (gently curved surfaces like cylinders and fillets) smooth together correctly.

**Implementation:** The function `applyCreaseNormals()` works on non-indexed geometry (each triangle has its own 3 vertex slots). It:
1. Computes one face normal per triangle
2. Builds a map from 3D position (rounded to 5 decimal places) → list of face indices that touch that position
3. For each vertex slot, iterates over all faces at that position and averages only those within the crease angle

The fill mesh uses this non-indexed crease-normal geometry. The wire/edge meshes keep the original indexed geometry (Three.js's `EdgesGeometry` requires indexed input to correctly identify shared edges).

**Why non-indexed for the fill mesh?** Crease normals require vertex-splitting at hard edges: two triangles sharing a position but not sharing a normal must have *separate* vertex entries in the buffer. Non-indexed geometry gives each triangle its own 3 vertices automatically, so each vertex slot can receive an independent normal.

**Performance:** For 5K–50K triangle models this runs in milliseconds. For the 2M triangle cap: the O(n × avg_adj_faces) complexity would be ~14M operations, which is slower but still reasonable (sub-second on modern hardware).

---

## 4. Conversion Result Panel

### What It Shows

After a successful parametric STEP export, a panel appears inside the export section showing:

| Row | Data |
|-----|------|
| Face classification | Cyl faces %, Plane faces %, Fillet/other % |
| Detection results | Cylinders found, Planes found, Coverage % |
| Mode | "Analytical surfaces" (blue) or "Triangulated fallback" (gray) |

### How the Data Flows

1. **Converter script** (`convert-stl-to-step-parametric-with-freecad.py`) logs stats to stdout: `[parametric] pre-filter: 4608 horiz (cyl), 8064 vert (plane), 9216 fillet/other` and `coverage=57.9% (2 cyl, 2 plane)`.

2. **Converter server** (`converter-server.js`) parses stdout with regex and adds the values as custom HTTP response headers: `X-Coverage`, `X-Detected-Cylinders`, `X-Detected-Planes`, `X-Pct-Cyl`, `X-Pct-Plane`, `X-Pct-Fillet`.

3. **Browser** reads the headers via `response.headers.get('X-Coverage')` etc. in `convertStlBlobToStep`.

### The CORS `Access-Control-Expose-Headers` Bug

The page is served from `:8081` and the converter runs on `:8090` — a cross-origin request. Browsers implement the **CORS** (Cross-Origin Resource Sharing) standard, which restricts which response headers JavaScript can read from cross-origin responses.

By default, only "safe" headers (Content-Type, Content-Length, etc.) are accessible. Custom `X-*` headers are silently blocked unless the server explicitly opts them in:

```
Access-Control-Expose-Headers: X-Coverage, X-Detected-Cylinders, ...
```

Without this header, `response.headers.get('X-Coverage')` returns `null` in the browser even though the header IS present in the HTTP response. This was the root cause of the panel never appearing: all `meta.*` fields were null, so the panel stayed hidden.

**Fix:** `sendBinary()` in `converter-server.js` was updated to automatically build the expose list from the keys of `extraHeaders` and include it in every binary response.

### Layout Fix: Grid vs Flexbox

The initial layout used `display: flex; justify-content: space-between` for the stats rows. This distributes items at floating positions based on their natural widths, so "Cyl faces" and "Cylinders" in different rows don't visually align.

Fix: `display: grid; grid-template-columns: 1fr 1fr 1fr` — all three cells are equal width, so columns stay perfectly aligned between rows. Each cell uses its own `display: flex; justify-content: space-between` to put the label on the left and the value on the right.

---

## Files Changed

| File | Change |
|------|--------|
| `start-dev.js` | New — starts converter + webpack together |
| `package.json` | `start` script now runs `node start-dev.js` |
| `index.html` | Spinner in status bar; conversion result panel; flat shaded default |
| `css/style.css` | Spinner keyframe + styles; conversion result grid layout |
| `js/app.js` | `applyCreaseNormals()`; fill mesh split from wire mesh; STEP meta headers; panel populate/hide logic |
| `tools/converter-server.js` | Parse pre-filter stats from stdout; add 6 new response headers; `Access-Control-Expose-Headers` |
| `README.MD` | Updated feature list and dev instructions |
| `TestDocs/Station_3_Baseplate - Part 1.stl` | New test asset |
