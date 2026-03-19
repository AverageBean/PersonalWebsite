# Joseph Berryman — Personal Website

Personal portfolio site hosting engineering and science projects.

---

## Live Features

### STL/SLDPRT Viewer (`index.html` + `js/app.js`)
Interactive browser-based 3D model viewer powered by Three.js r128.

- **File input** — drag-and-drop or file-browser; accepts `.stl` and `.sldprt`
- **SLDPRT conversion** — uploads to local converter service (see below); falls back to CloudConvert
- **View styles** — Solid Fill, Solid + Triangle Lines, Triangle Lines Only, Flat Shaded, Sharp Edges Only
- **Background themes** — Lab Light, Neutral Gray, Dark Studio, Warm Paper
- **Camera control presets** — Web Orbit, Onshape-like, SolidWorks-like
- **Grid toggle** — show/hide ground grid
- **Triangle refinement slider** — 0.10x–16.00x; hard cap at 2,000,000 triangles; 140 ms debounce
- **Uniform scale** — ½× and 2× buttons in the viewer overlay; persists across refinement rebuilds, resets on new file load; scale baked into export
- **Minimize footprint** — tests all 6 cardinal orientations and reorients the model to the smallest XZ bounding-box area (print-bed optimization); baked into base geometry
- **Model export** — STL, OBJ, GLB, STEP (CAD solid), STEP (analytical surfaces) download (current scale baked into exported vertices)
- **Conversion spinner** — animated indicator in the status bar while STEP conversion is running; export button disabled during conversion to prevent double-submit
- **Metrics panel** — filename, triangle count, bounding-box size (mm) at current scale
- **Camera reset** — fits model to view or resets to default empty-scene pose

### SLDPRT / STEP Converter Service (`tools/converter-server.js`)
Local HTTP server providing SLDPRT→STL and STL→STEP conversion.

- **Auto-started** by `npm start` via `start-dev.js` — no separate terminal needed
- Manual start: `npm run convert:start` → `http://127.0.0.1:8090`
- Primary: FreeCAD (auto-detected; override with `FREECAD_CMD` env var)
- Fallback: CloudConvert (requires `CLOUDCONVERT_API_KEY` env var)

API endpoints:
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | Reports FreeCAD/CloudConvert/Onshape config |
| POST | `/api/convert/sldprt-to-stl?filename=<name>.sldprt` | Convert uploaded SLDPRT to STL |
| POST | `/api/convert/onshape/partstudio-to-stl` | Export STL from Onshape via API |

Onshape export requires `ONSHAPE_ACCESS_KEY` and `ONSHAPE_SECRET_KEY` env vars.

---

## Under Construction / Incomplete

- **Intro panel bio** — eyebrow, summary, and role text written from resume content
- **Open Graph meta** — `og:url`, `og:image`, `og:image:alt` empty in `index.html`
- **Additional project pages** — only the viewer exists; no other projects hosted yet
- **`package.json` metadata** — ✓ filled (name, author, description, license, keywords)

---

## Development

```powershell
npm install          # install dependencies
npm start            # dev server + converter service together → :8081 / :8090
npm run build        # production build → dist/
npm run convert:start  # start converter service standalone → http://127.0.0.1:8090
```

### Testing (Playwright)

```powershell
npm run pw:install       # install Chromium once
npm run test:e2e         # run all tests
npm run test:e2e:debug   # step-through debug
npm run test:e2e:ui      # interactive UI runner
npm run test:e2e:report  # open last HTML report
```

Test files: `tests/viewer.spec.js`
Test output: `Testoutput/` (date_time_testname format)
Test assets: `TestDocs/` (never test against newly generated files)

---

## Performance Limits (Recorded)

| Constraint | Value | Location |
|------------|-------|----------|
| Max triangles (refinement budget) | 2,000,000 | `js/app.js` `MAX_TRIANGLES` |
| Max pixel ratio | 2× | `js/app.js` `renderer.setPixelRatio` |
| Max upload size (converter) | 120 MB | `tools/converter-server.js` `MAX_UPLOAD_BYTES` |
| Slider debounce | 140 ms | `js/app.js` `scheduleSliderRebuild` |

---

## Project Structure

```
PersonalWebsite/
├── index.html              # Main page
├── js/app.js               # Viewer logic (Three.js)
├── css/style.css           # Styles
├── tools/
│   ├── converter-server.js # SLDPRT→STL conversion HTTP server
│   └── convert-sldprt-with-freecad.py  # FreeCAD conversion script
├── tests/viewer.spec.js    # Playwright e2e tests
├── TestDocs/               # Reference test files (.stl, .sldprt)
├── Testoutput/             # Test result artifacts
├── docs/
│   ├── playwright-debugging.md
│   └── sldprt-conversion.md
├── specs/reqs.md           # Primary project spec (do not edit without user approval)
├── webpack.common.js
├── webpack.config.dev.js
├── webpack.config.prod.js
└── dist/                   # Production build output
```
