# Week 1 Testing — Quick Start Guide

**Phase:** Days 1-2 Complete ✅ → Days 3-4 Starting Now 🔄  
**Goal:** Reproduce failures and measure baseline metrics

---

## Infrastructure Ready ✅

The following have been created for Week 1:

### Python Tools
- **`tools/analyze-texture-stl.py`** — Analyzes exported STL files
  - Measures bump spacing uniformity
  - Detects geometry validity issues
  - Compares textured vs baseline models
  
- **`tools/requirements-texture-analysis.txt`** — Python dependencies

### JavaScript/Playwright Framework
- **`tests/texture-metrics-helpers.js`** — Helper functions for tests
  - Coverage measurement
  - Export validity checking
  - Screenshot capture
  - Report formatting

- **`tests/texture-baseline.spec.js`** — Comprehensive baseline tests
  - MeshRing1 bumps test
  - Baseplate weave test  
  - Partial selection boundary test
  - Auto-generates reports

### JavaScript Metrics
- **`js/app.js` (updated)** — Exposes `window.textureMetrics`
  - Available after every model load
  - Tracks: selected face count, textured face count, total faces

### Templates & Documentation
- **`Testoutput/BASELINE_METRICS_TEMPLATE.md`** — Report template (fill during testing)

---

## How to Run Week 1 Tests

### Step 1: Install Python Dependencies (One-Time)

```bash
pip install -r tools/requirements-texture-analysis.txt
```

If you get permission errors, try:
```bash
python -m pip install --user -r tools/requirements-texture-analysis.txt
```

### Step 2: Start the Dev Server

```bash
npm start
```

Wait for output:
```
Webpack dev server listening on port 8081
Converter service listening on port 8090
```

### Step 3: Run the Baseline Tests

In a separate terminal:

```bash
npm run test:e2e -- tests/texture-baseline.spec.js
```

### Step 4: Analyze Results

Tests will output:
- Screenshots in `Testoutput/2026-04-XX_*.png`
- STL exports in `Testoutput/2026-04-XX_*.stl`
- Baseline reports in `Testoutput/BASELINE_*.txt`

### Step 5: Analyze Exported STLs

```bash
python tools/analyze-texture-stl.py Testoutput/2026-04-XX_MeshRing1-bumps-baseline.stl
```

Output:
```json
{
  "spacing_mean": 5.2,
  "spacing_std_dev": 0.42,
  "spacing_uniformity_percent": 92.0,
  "geometry_valid": true,
  "degenerate_triangles": 0
}
```

### Step 6: Fill in Baseline Report

Copy results into `Testoutput/BASELINE_METRICS_TEMPLATE.md` → `Testoutput/BASELINE_METRICS.md`

---

## Expected Output Structure

After running tests, you'll have:

```
Testoutput/
├── 2026-04-XX_bump-ring-baseline.png      # Screenshot: Ring with bumps
├── 2026-04-XX_MeshRing1-bumps-baseline.stl  # Exported geometry
├── 2026-04-XX_weave-baseplate-baseline.png # Screenshot: Baseplate with weave
├── 2026-04-XX_Baseplate-weave-baseline.stl # Exported geometry
├── 2026-04-XX_texture-boundary-baseline.png # Screenshot: Boundary effects
├── BASELINE_MeshRing1_BUMPS.txt            # Test results (Ring)
├── BASELINE_BASEPLATE_WEAVE.txt            # Test results (Baseplate)
├── BASELINE_BOUNDARY_TEST.txt              # Test results (Boundary)
├── BASELINE_SUMMARY.md                     # Auto-generated summary
└── BASELINE_METRICS.md                     # [Fill from template]
```

---

## What to Look For During Testing

### MeshRing1 Bumps

**Visual Inspection:**
1. Are bumps visible on the ring outer surface?
2. Do bumps point "outward" (away from ring center) or "wrong direction"?
3. Are bumps evenly spaced around the ring?
4. Any visible crinkling or non-uniform artifacts?

**Key Question:** Does the curved surface cause bump orientation issues? (Expected: YES, averaged normal problem)

### Baseplate Weave

**Visual Inspection:**
1. Is weave visible on the flat top surface?
2. Does weave appear on the side/vertical faces? (Expected: YES, spillover)
3. Is the pattern uniform or jagged?
4. Where is the boundary between textured and un-textured?

**Key Question:** Does texture bleed onto adjacent unselected faces? (Expected: YES, proximity problem)

### Export Validity

**Cross-Section Analysis:**
1. Open exported STL in cross-section viewer (Google STL viewer, FreeCAD, Fusion 360)
2. Look for:
   - Degenerate/zero-area triangles (looks like isolated vertices or edges)
   - Unclosed surfaces (gaps in geometry)
   - Self-intersecting geometry (overlapping triangles)

**Key Question:** Is exported geometry valid for 3D printing? (Expected: UNKNOWN, to be measured)

---

## Troubleshooting

### Python Script Fails: "ModuleNotFoundError: No module named 'numpy'"
```bash
pip install numpy scipy scikit-learn
```

### Playwright Test Fails: "Timeout waiting for model to load"
- Check that `npm start` dev server is running on port 8081
- Check that `TestDocs/` directory exists with STL files
- Try increasing timeout in test (change `2000` to `5000`ms)

### Texture Panel Doesn't Appear
- After loading a model, look for "Texture" button in bottom-right overlay
- If button doesn't exist, check that texture feature is implemented in `js/app.js`

### Export Button Disabled
- Try applying texture first (click "Apply Bumps")
- Try switching export format
- Check browser console for errors

---

## Key Metrics to Document

After each test, record:

### Coverage
- % of selected faces that received texture
- % of unselected faces that received texture (spillover)

### Uniformity (from STL analysis)
- Mean spacing between bump centers
- Std deviation of spacing
- Uniformity % = 100 × (1 - std_dev / mean)

### Export Validity
- Geometry valid: YES / NO
- Degenerate triangles: [count]
- Can FreeCAD import? YES / NO
- Can FreeCAD slice? YES / NO

---

## When to Move to Week 2

Week 1 is **complete** when you have:

✅ Baseline metrics for MeshRing1 bumps (coverage %, uniformity %)  
✅ Baseline metrics for Baseplate weave (coverage %, spillover %)  
✅ Export validity assessment (any degenerate triangles?)  
✅ Completed `BASELINE_METRICS.md` with all measurements  
✅ Screenshots and cross-section analysis saved  

Then proceed to Week 2 implementation (per-face normals, coverage-based filtering).

---

## Files You'll Need

**To Read:**
- `TEXTURE_REQUIREMENTS_FINALIZED.md` (what we're measuring)
- `docs/CURVED_SURFACE_DESIGN_DECISION.md` (why curved surfaces matter)

**To Use:**
- `tools/analyze-texture-stl.py` (analyze exports)
- `tests/texture-baseline.spec.js` (run tests)
- `tests/texture-metrics-helpers.js` (helper functions)
- `Testoutput/BASELINE_METRICS_TEMPLATE.md` (fill in results)

**To Update:**
- `Testoutput/BASELINE_METRICS.md` (your findings)
- `docs/TEXTURE_FAILURE_REPRODUCTIONS.md` (new doc to create after testing)

---

## Next Milestone

**After Week 1 Testing:**
1. Document exactly what's broken (with data)
2. Update `TEXTURE_FAILURE_REPRODUCTIONS.md` with screenshots and measurements
3. Confirm or revise the Week 2 implementation plan based on findings
4. Start Week 2: Implement per-face normal bumps (Monday)

**Goal:** By Friday (end of Week 1), have clear metrics showing what needs to be fixed.

