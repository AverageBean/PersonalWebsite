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
- **Maximize footprint** — tests all 6 cardinal orientations and reorients the model to the largest XZ bounding-box area (best 3D-print stability); baked into base geometry
- **Model export** — STL, OBJ, GLB, STEP (CAD solid), STEP (analytical surfaces) download (current scale baked into exported vertices)
- **Conversion spinner** — animated indicator in the status bar while STEP conversion is running; export button disabled during conversion to prevent double-submit
- **Metrics panel** — filename, triangle count, bounding-box size (mm) at current scale
- **Camera reset** — fits model to view or resets to default empty-scene pose
- **Mold generator** — creates a two-part mold from any loaded model via FreeCAD CSG: configurable wall thickness, clearance offset, registration pins/holes (configurable tolerance), sprue channel, and adjustable split plane with live 3D preview; exports a zip containing top and bottom STL halves
- **Cross-section / slice view** — GPU-accelerated clipping plane for inspecting internal geometry; X/Y/Z axis selection, position slider with interactive drag, flip side toggle, stencil-buffer cross-section cap for solid fill at the cut face; works with all view styles
- **Surface texture** — apply hemispherical bumps or mesh weave to selected surface regions; click-to-select faces via flood-fill (30° normal threshold); Apply/Reset buttons; preset + spacing/radius/cell/height parameters; geometry merged into base mesh and exported with model
- **Parametric STEP completion ping** — short two-tone Web Audio ding (880 Hz → 1320 Hz) plays when a parametric STEP export finishes (success or failure). Audio context is unlocked on first page interaction so the deferred ping (minutes after the click) is not blocked by autoplay policy

### Train Detection & AC Infinity Control
Real-time train detection system using a SparkFun SEN-12642 sound sensor connected to an ESP32 running ESPHome firmware. Automatically increases the AC Infinity Controller 69 Pro fan speed to 80% when a train passes, compensating for air pressure fluctuations, then restores the previous speed afterward.

- **Hardware** — ESP32 DevKit, SEN-12642 analog sound sensor
- **Firmware** — ESPHome with ADC filtering, tunable threshold, and auto-discovery in Home Assistant
- **Integration** — Home Assistant automations + dalinicus AC Infinity integration
- **Website panel** — live detection indicator, event log, 24-hour sound level chart

See `docs/train-detection-project.md` for full hardware wiring, firmware configuration, and calibration procedures.

### Panel Tab Navigation
Tabbed interface for switching between project sections.

- **STL Viewer** — fully functional 3D model viewer (default active tab)
- **Bonsai Vitals** — placeholder (coming soon)
- **Train Detection** — live detection indicator, event log, and sound analytics

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
| POST | `/api/convert/stl-to-mold?filename=...&wallThickness=10&splitHeight=25&...` | Generate two-part mold (returns zip) |
| POST | `/api/convert/onshape/partstudio-to-stl` | Export STL from Onshape via API |

Onshape export requires `ONSHAPE_ACCESS_KEY` and `ONSHAPE_SECRET_KEY` env vars.

---

## Under Construction / Incomplete

- **Open Graph meta** — `og:url`, `og:image`, `og:image:alt` empty; `og:title` uses "AJ Berry | Software Engineer" which is inconsistent with the page title
- **Bonsai Vitals** — placeholder with no content yet
- **Train Detection website panel** — live indicator and event log implemented; awaiting HA API integration and 24-hour chart rendering
- **Surface Texture Feature** — ⚠️ **UNDER REVIEW** — UI and basic functions exist but comprehensive validation needed. Feature allows applying hemispherical bump and mesh weave textures to selected model surfaces for 3D printing. Status: tests pass functionally but lack visual validation, uniformity verification, and printability confirmation. See `Testoutput/TEXTURE_TEST_SUMMARY.md` and `docs/texture_failure_analysis.md` for details.

## Next Steps

- **Surface Texture Validation** — Execute comprehensive test plan to validate bump uniformity, mesh weave appearance, export geometry validity. Document baseline metrics. See `docs/texture_implementation_plan.md`.
- **Parametric STEP Phase C** — elliptic cylinders, surfaces of revolution, and free swept B-spline surfaces

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

Test files: `tests/viewer.spec.js`, `tests/viewer-controls.spec.js`, `tests/panel-tabs.spec.js`, `tests/overlay-position-check.spec.js`, `tests/mold-generator.spec.js`, `tests/slice-view.spec.js`
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
│   ├── converter-server.js # Conversion HTTP server (SLDPRT, STEP, mold)
│   ├── convert-sldprt-with-freecad.py  # FreeCAD SLDPRT conversion script
│   └── generate-mold-with-freecad.py   # FreeCAD mold generation script
├── tests/viewer.spec.js    # Playwright e2e tests
├── TestDocs/               # Reference test files (.stl, .sldprt)
├── Testoutput/             # Test result artifacts
├── docs/
│   ├── playground-debugging.md
│   └── sldprt-conversion.md
├── specs/reqs.md           # Primary project spec (do not edit without user approval)
├── webpack.common.js
├── webpack.config.dev.js
├── webpack.config.prod.js
└── dist/                   # Production build output
```
