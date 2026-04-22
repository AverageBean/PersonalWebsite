# Week 1 Baseline Metrics Summary

Generated: 2026-04-21T16:38:58.662Z

## Overview

These measurements establish baseline metrics for the current texture implementation.
They do NOT validate correctness; Week 2-4 will improve these metrics.

## Test Cases

### BASELINE_METRICS_TEMPLATE.md
```
# Week 1 Baseline Metrics Report

**Date:** [Generated during Week 1 testing]  
**Purpose:** Establish baseline measurements to track improvements in Weeks 2-4  
**Note:** These metrics do NOT validate correctness; they are the current state before fixes.

---

## Test Environment

- **Node.js Version:** [to be filled]
- **Browser:** Chromium (Playwright)
- **Three.js Version:** r128 (CDN)
- **Test Models Location:** `TestDocs/`

---

## Test Case 1: MeshRing1 — Hemispherical Bumps at 5mm Spacing

**Model:** `TestDocs/MeshRing1.stl`  
**Setup:** Load model, select outer curved surface via flood-fill, apply bumps (spacing=5mm, radius=1.5mm)  
**Purpose:** Measure texture behavior on curved surfaces

### Baseline Measurements

| Metric | Value | Target (Week 4) | Status |
|--------|-------|-----------------|--------|
| Coverage % (selected faces with texture) | `[TBD]` | ≥99% | 🔴 To measure |
| Spillover % (texture on unselected) | `[TBD]` | <1% | 🔴 To measure |
| Spacing Mean | `[TBD]` | 5.0mm | 🔴 To measure |
| Spacing Std Dev | `[TBD]` | <0.25mm | 🔴 To measure |
| Spacing Uniformity % | `[TBD]` | >90% | 🔴 To measure |
| Export Validity | `[TBD]` | Valid (0 degenerate triangles) | 🔴 To measure |
| Degenerate Triangles | `[TBD]` | 0 | 🔴 To measure |

### Visual Observations

**Expected Baseline Behavior:**
- Bumps placed on ring outer surface
- Bumps may have inconsistent orientation (averaged normal)
- Possible spacing gaps or clustering (proximity threshold issue)
- May have crinkling or non-uniform appearance

**Observed Baseline Behavior:**
```
[To be filled during testing]
- Ring surface coverage:
- Bump orientation:
- Spacing consistency:
- Visual artifacts:
```

### Screenshots

- **Before:** `2026-04-XX_bump-ring-before.png`
- **After:** `2026-04-XX_bump-ring-after.png`
- **Cross-section:** `2026-04-XX_bump-ring-cross-section.png`

### Export Analysis

**File:** `2026-04-XX_MeshRing1-bumps-baseline.stl`

```json
{
  "spacing_mean": "[TBD]",
  "spacing_std_dev": "[TBD]",
  "spacing_uniformity_percent": "[TBD]",
  "bump_height_mean": "[TBD]",
  "bump_height_std_dev": "[TBD]",
  "geometry_valid": "[TBD]",
  "degenerate_triangles": "[TBD]",
  "zero_area_triangles": "[TBD]",
  "non_manifold_edges": "[TBD]"
}
```

---

## Test Case 2: Baseplate — Mesh Weave at Default Settings

**Model:** `TestDocs/Station_3_Baseplate - Part 1.stl`  
**Setup:** Load model, select flat top surface, apply weave (height=0.5mm, cellSize=5mm, strandWidth=1.5mm)  
**Purpose:** Measure spillover risk (weave applying to side faces)

### Baseline Measurements

| Metric | Value | Target (Week 4) | Status |
|--------|-------|-----------------|--------|
| Coverage % (top surface) | `[TBD]` | ≥99% | 🔴 To measure |
| Spillover % (sides + edges) | `[TBD]` | <1% | 🔴 To measure |
| Weave Uniformity % | `[TBD]` | >90% | 🔴 To measure |
| Export Validity | `[TBD]` | Valid | 🔴 To measure |

### Visual Observations

**Expected Baseline Behavior:**
- Weave pattern on top surface
- Possible texture bleeding to side faces (proximity-based selection over-inclusive)
- Jagged appearance due to coarse mesh on flat surface
- Non-uniform pattern if mesh density varies

**Observed Baseline Behavior:**
```
[To be filled during testing]
- Top surface coverage:
- Side surface spillover:
- Pattern uniformity:
- Visual artifacts:
```

### Screenshots

- **Top view:** `2026-04-XX_weave-baseplate-top.png`
- **Side view:** `2026-04-XX_weave-baseplate-side.png` (check for spillover)
- **Cross-section:** `2026-04-XX_weave-baseplate-cross-section.png`

### Export Analysis

**File:** `2026-04-XX_Baseplate-weave-baseline.stl`

```json
{
  "spacing_mean": "[TBD]",
  "spacing_std_dev": "[TBD]",
  "spacing_uniformity_percent": "[TBD]",
  "geometry_valid": "[TBD]",
  "degenerate_triangles": "[TBD]"
}
```

---

## Test Case 3: Boundary Behavior — Partial Selection

**Model:** `TestDocs/Station_3_Baseplate - Part 1.stl`  
**Setup:** Select small portion of top surface, apply bumps  
**Purpose:** Measure boundary edge effects and gap behavior

### Visual Observations

**Expected Baseline Behavior:**
- Texture may have visible gaps at selection boundary
- May have "edge effect" where bumps cluster or disappear near edge
- May bleed slightly past selection

**Observed Baseline Behavior:**
```
[To be filled during testing]
- Boundary definition:
- Gap presence:
- Bleed extent:
```

### Screenshots

- `2026-04-XX_texture-boundary-baseline.png` (full view)
- `2026-04-XX_texture-boundary-zoom.png` (zoomed to edge)

---

## Summary of Root Causes (Hypothesis Before Week 1)

Based on code review, expected failures:

### Bumps (Geometric Approach)
- [ ] **Averaged normal misalignment:** Single weighted-average normal doesn't align with curved surfaces
- [ ] **Proximity threshold gaps:** 0.7× spacing threshold leaves visible gaps at boundaries
- [ ] **UV projection distortion:** Non-planar selections have distorted UV space

### Weave (Procedural Approach)
- [ ] **Centroid-based over-selection:** Proximity lookup includes unselected faces (bleed)
- [ ] **Mesh-density dependence:** Fine meshes show smooth patterns, coarse show jagged
- [ ] **Vertex ownership tracking:** No explicit triangle ownership → ambiguous boundaries

---

## Week 1 Findings (To Be Completed)

### Coverage Issues Confirmed
- [ ] Bumps: Coverage% = `[TBD]`
- [ ] Bumps: Spillover% = `[TBD]`
- [ ] Weave: Coverage% = `[TBD]`
- [ ] Weave: Spillover% = `[TBD]`

### Root Cause Validation
```
[To be filled after analyzing exported STL files and cross-sections]
- Did averaged normal cause misalignment on Ring?
- Did proximity threshold cause gaps?
- Did weave blend onto side faces?
- How severe is each issue?
```

### Impact on Week 2-4 Plan
```
[To be filled based on findings]
- Which fixes are highest priority?
- Should we change implementation strategy?
- Do baseline metrics require plan revision?
```

---

## Recommendations for Week 2

Based on baseline findings:

1. **If coverage < 95%:** Implement coverage-based face membership tracking (Week 2 priority)
2. **If spillover > 2%:** Add explicit triangle ownership (Week 3 priority)
3. **If export invalid:** Add geometry validation and repair (Week 4 priority)
4. **If uniformity < 85%:** Per-face normal approach needed (Week 2 priority)

---

## Next Steps

1. Run `npm run test:e2e -- tests/texture-baseline.spec.js`
2. Analyze exported STL files with `python tools/analyze-texture-stl.py <file.stl>`
3. Document findings in this report
4. Proceed to Week 2 implementation with confirmed priority list


```

### BASELINE_SUMMARY.md
```
# Week 1 Baseline Metrics Summary

Generated: 2026-04-17T18:05:39.171Z

## Overview

These measurements establish baseline metrics for the current texture implementation.
They do NOT validate correctness; Week 2-4 will improve these metrics.

## Test Cases

### BASELINE_METRICS_TEMPLATE.md
```
# Week 1 Baseline Metrics Report

**Date:** [Generated during Week 1 testing]  
**Purpose:** Establish baseline measurements to track improvements in Weeks 2-4  
**Note:** These metrics do NOT validate correctness; they are the current state before fixes.

---

## Test Environment

- **Node.js Version:** [to be filled]
- **Browser:** Chromium (Playwright)
- **Three.js Version:** r128 (CDN)
- **Test Models Location:** `TestDocs/`

---

## Test Case 1: MeshRing1 — Hemispherical Bumps at 5mm Spacing

**Model:** `TestDocs/MeshRing1.stl`  
**Setup:** Load model, select outer curved surface via flood-fill, apply bumps (spacing=5mm, radius=1.5mm)  
**Purpose:** Measure texture behavior on curved surfaces

### Baseline Measurements

| Metric | Value | Target (Week 4) | Status |
|--------|-------|-----------------|--------|
| Coverage % (selected faces with texture) | `[TBD]` | ≥99% | 🔴 To measure |
| Spillover % (texture on unselected) | `[TBD]` | <1% | 🔴 To measure |
| Spacing Mean | `[TBD]` | 5.0mm | 🔴 To measure |
| Spacing Std Dev | `[TBD]` | <0.25mm | 🔴 To measure |
| Spacing Uniformity % | `[TBD]` | >90% | 🔴 To measure |
| Export Validity | `[TBD]` | Valid (0 degenerate triangles) | 🔴 To measure |
| Degenerate Triangles | `[TBD]` | 0 | 🔴 To measure |

### Visual Observations

**Expected Baseline Behavior:**
- Bumps placed on ring outer surface
- Bumps may have inconsistent orientation (averaged normal)
- Possible spacing gaps or clustering (proximity threshold issue)
- May have crinkling or non-uniform appearance

**Observed Baseline Behavior:**
```
[To be filled during testing]
- Ring surface coverage:
- Bump orientation:
- Spacing consistency:
- Visual artifacts:
```

### Screenshots

- **Before:** `2026-04-XX_bump-ring-before.png`
- **After:** `2026-04-XX_bump-ring-after.png`
- **Cross-section:** `2026-04-XX_bump-ring-cross-section.png`

### Export Analysis

**File:** `2026-04-XX_MeshRing1-bumps-baseline.stl`

```json
{
  "spacing_mean": "[TBD]",
  "spacing_std_dev": "[TBD]",
  "spacing_uniformity_percent": "[TBD]",
  "bump_height_mean": "[TBD]",
  "bump_height_std_dev": "[TBD]",
  "geometry_valid": "[TBD]",
  "degenerate_triangles": "[TBD]",
  "zero_area_triangles": "[TBD]",
  "non_manifold_edges": "[TBD]"
}
```

---

## Test Case 2: Baseplate — Mesh Weave at Default Settings

**Model:** `TestDocs/Station_3_Baseplate - Part 1.stl`  
**Setup:** Load model, select flat top surface, apply weave (height=0.5mm, cellSize=5mm, strandWidth=1.5mm)  
**Purpose:** Measure spillover risk (weave applying to side faces)

### Baseline Measurements

| Metric | Value | Target (Week 4) | Status |
|--------|-------|-----------------|--------|
| Coverage % (top surface) | `[TBD]` | ≥99% | 🔴 To measure |
| Spillover % (sides + edges) | `[TBD]` | <1% | 🔴 To measure |
| Weave Uniformity % | `[TBD]` | >90% | 🔴 To measure |
| Export Validity | `[TBD]` | Valid | 🔴 To measure |

### Visual Observations

**Expected Baseline Behavior:**
- Weave pattern on top surface
- Possible texture bleeding to side faces (proximity-based selection over-inclusive)
- Jagged appearance due to coarse mesh on flat surface
- Non-uniform pattern if mesh density varies

**Observed Baseline Behavior:**
```
[To be filled during testing]
- Top surface coverage:
- Side surface spillover:
- Pattern uniformity:
- Visual artifacts:
```

### Screenshots

- **Top view:** `2026-04-XX_weave-baseplate-top.png`
- **Side view:** `2026-04-XX_weave-baseplate-side.png` (check for spillover)
- **Cross-section:** `2026-04-XX_weave-baseplate-cross-section.png`

### Export Analysis

**File:** `2026-04-XX_Baseplate-weave-baseline.stl`

```json
{
  "spacing_mean": "[TBD]",
  "spacing_std_dev": "[TBD]",
  "spacing_uniformity_percent": "[TBD]",
  "geometry_valid": "[TBD]",
  "degenerate_triangles": "[TBD]"
}
```

---

## Test Case 3: Boundary Behavior — Partial Selection

**Model:** `TestDocs/Station_3_Baseplate - Part 1.stl`  
**Setup:** Select small portion of top surface, apply bumps  
**Purpose:** Measure boundary edge effects and gap behavior

### Visual Observations

**Expected Baseline Behavior:**
- Texture may have visible gaps at selection boundary
- May have "edge effect" where bumps cluster or disappear near edge
- May bleed slightly past selection

**Observed Baseline Behavior:**
```
[To be filled during testing]
- Boundary definition:
- Gap presence:
- Bleed extent:
```

### Screenshots

- `2026-04-XX_texture-boundary-baseline.png` (full view)
- `2026-04-XX_texture-boundary-zoom.png` (zoomed to edge)

---

## Summary of Root Causes (Hypothesis Before Week 1)

Based on code review, expected failures:

### Bumps (Geometric Approach)
- [ ] **Averaged normal misalignment:** Single weighted-average normal doesn't align with curved surfaces
- [ ] **Proximity threshold gaps:** 0.7× spacing threshold leaves visible gaps at boundaries
- [ ] **UV projection distortion:** Non-planar selections have distorted UV space

### Weave (Procedural Approach)
- [ ] **Centroid-based over-selection:** Proximity lookup includes unselected faces (bleed)
- [ ] **Mesh-density dependence:** Fine meshes show smooth patterns, coarse show jagged
- [ ] **Vertex ownership tracking:** No explicit triangle ownership → ambiguous boundaries

---

## Week 1 Findings (To Be Completed)

### Coverage Issues Confirmed
- [ ] Bumps: Coverage% = `[TBD]`
- [ ] Bumps: Spillover% = `[TBD]`
- [ ] Weave: Coverage% = `[TBD]`
- [ ] Weave: Spillover% = `[TBD]`

### Root Cause Validation
```
[To be filled after analyzing exported STL files and cross-sections]
- Did averaged normal cause misalignment on Ring?
- Did proximity threshold cause gaps?
- Did weave blend onto side faces?
- How severe is each issue?
```

### Impact on Week 2-4 Plan
```
[To be filled based on findings]
- Which fixes are highest priority?
- Should we change implementation strategy?
- Do baseline metrics require plan revision?
```

---

## Recommendations for Week 2

Based on baseline findings:

1. **If coverage < 95%:** Implement coverage-based face membership tracking (Week 2 priority)
2. **If spillover > 2%:** Add explicit triangle ownership (Week 3 priority)
3. **If export invalid:** Add geometry validation and repair (Week 4 priority)
4. **If uniformity < 85%:** Per-face normal approach needed (Week 2 priority)

---

## Next Steps

1. Run `npm run test:e2e -- tests/texture-baseline.spec.js`
2. Analyze exported STL files with `python tools/analyze-texture-stl.py <file.stl>`
3. Document findings in this report
4. Proceed to Week 2 implementation with confirmed priority list


```

### BASELINE_SUMMARY.md
```
# Week 1 Baseline Metrics Summary

Generated: 2026-04-17T16:01:59.350Z

## Overview

These measurements establish baseline metrics for the current texture implementation.
They do NOT validate correctness; Week 2-4 will improve these metrics.

## Test Cases

### BASELINE_METRICS_TEMPLATE.md
```
# Week 1 Baseline Metrics Report

**Date:** [Generated during Week 1 testing]  
**Purpose:** Establish baseline measurements to track improvements in Weeks 2-4  
**Note:** These metrics do NOT validate correctness; they are the current state before fixes.

---

## Test Environment

- **Node.js Version:** [to be filled]
- **Browser:** Chromium (Playwright)
- **Three.js Version:** r128 (CDN)
- **Test Models Location:** `TestDocs/`

---

## Test Case 1: MeshRing1 — Hemispherical Bumps at 5mm Spacing

**Model:** `TestDocs/MeshRing1.stl`  
**Setup:** Load model, select outer curved surface via flood-fill, apply bumps (spacing=5mm, radius=1.5mm)  
**Purpose:** Measure texture behavior on curved surfaces

### Baseline Measurements

| Metric | Value | Target (Week 4) | Status |
|--------|-------|-----------------|--------|
| Coverage % (selected faces with texture) | `[TBD]` | ≥99% | 🔴 To measure |
| Spillover % (texture on unselected) | `[TBD]` | <1% | 🔴 To measure |
| Spacing Mean | `[TBD]` | 5.0mm | 🔴 To measure |
| Spacing Std Dev | `[TBD]` | <0.25mm | 🔴 To measure |
| Spacing Uniformity % | `[TBD]` | >90% | 🔴 To measure |
| Export Validity | `[TBD]` | Valid (0 degenerate triangles) | 🔴 To measure |
| Degenerate Triangles | `[TBD]` | 0 | 🔴 To measure |

### Visual Observations

**Expected Baseline Behavior:**
- Bumps placed on ring outer surface
- Bumps may have inconsistent orientation (averaged normal)
- Possible spacing gaps or clustering (proximity threshold issue)
- May have crinkling or non-uniform appearance

**Observed Baseline Behavior:**
```
[To be filled during testing]
- Ring surface coverage:
- Bump orientation:
- Spacing consistency:
- Visual artifacts:
```

### Screenshots

- **Before:** `2026-04-XX_bump-ring-before.png`
- **After:** `2026-04-XX_bump-ring-after.png`
- **Cross-section:** `2026-04-XX_bump-ring-cross-section.png`

### Export Analysis

**File:** `2026-04-XX_MeshRing1-bumps-baseline.stl`

```json
{
  "spacing_mean": "[TBD]",
  "spacing_std_dev": "[TBD]",
  "spacing_uniformity_percent": "[TBD]",
  "bump_height_mean": "[TBD]",
  "bump_height_std_dev": "[TBD]",
  "geometry_valid": "[TBD]",
  "degenerate_triangles": "[TBD]",
  "zero_area_triangles": "[TBD]",
  "non_manifold_edges": "[TBD]"
}
```

---

## Test Case 2: Baseplate — Mesh Weave at Default Settings

**Model:** `TestDocs/Station_3_Baseplate - Part 1.stl`  
**Setup:** Load model, select flat top surface, apply weave (height=0.5mm, cellSize=5mm, strandWidth=1.5mm)  
**Purpose:** Measure spillover risk (weave applying to side faces)

### Baseline Measurements

| Metric | Value | Target (Week 4) | Status |
|--------|-------|-----------------|--------|
| Coverage % (top surface) | `[TBD]` | ≥99% | 🔴 To measure |
| Spillover % (sides + edges) | `[TBD]` | <1% | 🔴 To measure |
| Weave Uniformity % | `[TBD]` | >90% | 🔴 To measure |
| Export Validity | `[TBD]` | Valid | 🔴 To measure |

### Visual Observations

**Expected Baseline Behavior:**
- Weave pattern on top surface
- Possible texture bleeding to side faces (proximity-based selection over-inclusive)
- Jagged appearance due to coarse mesh on flat surface
- Non-uniform pattern if mesh density varies

**Observed Baseline Behavior:**
```
[To be filled during testing]
- Top surface coverage:
- Side surface spillover:
- Pattern uniformity:
- Visual artifacts:
```

### Screenshots

- **Top view:** `2026-04-XX_weave-baseplate-top.png`
- **Side view:** `2026-04-XX_weave-baseplate-side.png` (check for spillover)
- **Cross-section:** `2026-04-XX_weave-baseplate-cross-section.png`

### Export Analysis

**File:** `2026-04-XX_Baseplate-weave-baseline.stl`

```json
{
  "spacing_mean": "[TBD]",
  "spacing_std_dev": "[TBD]",
  "spacing_uniformity_percent": "[TBD]",
  "geometry_valid": "[TBD]",
  "degenerate_triangles": "[TBD]"
}
```

---

## Test Case 3: Boundary Behavior — Partial Selection

**Model:** `TestDocs/Station_3_Baseplate - Part 1.stl`  
**Setup:** Select small portion of top surface, apply bumps  
**Purpose:** Measure boundary edge effects and gap behavior

### Visual Observations

**Expected Baseline Behavior:**
- Texture may have visible gaps at selection boundary
- May have "edge effect" where bumps cluster or disappear near edge
- May bleed slightly past selection

**Observed Baseline Behavior:**
```
[To be filled during testing]
- Boundary definition:
- Gap presence:
- Bleed extent:
```

### Screenshots

- `2026-04-XX_texture-boundary-baseline.png` (full view)
- `2026-04-XX_texture-boundary-zoom.png` (zoomed to edge)

---

## Summary of Root Causes (Hypothesis Before Week 1)

Based on code review, expected failures:

### Bumps (Geometric Approach)
- [ ] **Averaged normal misalignment:** Single weighted-average normal doesn't align with curved surfaces
- [ ] **Proximity threshold gaps:** 0.7× spacing threshold leaves visible gaps at boundaries
- [ ] **UV projection distortion:** Non-planar selections have distorted UV space

### Weave (Procedural Approach)
- [ ] **Centroid-based over-selection:** Proximity lookup includes unselected faces (bleed)
- [ ] **Mesh-density dependence:** Fine meshes show smooth patterns, coarse show jagged
- [ ] **Vertex ownership tracking:** No explicit triangle ownership → ambiguous boundaries

---

## Week 1 Findings (To Be Completed)

### Coverage Issues Confirmed
- [ ] Bumps: Coverage% = `[TBD]`
- [ ] Bumps: Spillover% = `[TBD]`
- [ ] Weave: Coverage% = `[TBD]`
- [ ] Weave: Spillover% = `[TBD]`

### Root Cause Validation
```
[To be filled after analyzing exported STL files and cross-sections]
- Did averaged normal cause misalignment on Ring?
- Did proximity threshold cause gaps?
- Did weave blend onto side faces?
- How severe is each issue?
```

### Impact on Week 2-4 Plan
```
[To be filled based on findings]
- Which fixes are highest priority?
- Should we change implementation strategy?
- Do baseline metrics require plan revision?
```

---

## Recommendations for Week 2

Based on baseline findings:

1. **If coverage < 95%:** Implement coverage-based face membership tracking (Week 2 priority)
2. **If spillover > 2%:** Add explicit triangle ownership (Week 3 priority)
3. **If export invalid:** Add geometry validation and repair (Week 4 priority)
4. **If uniformity < 85%:** Per-face normal approach needed (Week 2 priority)

---

## Next Steps

1. Run `npm run test:e2e -- tests/texture-baseline.spec.js`
2. Analyze exported STL files with `python tools/analyze-texture-stl.py <file.stl>`
3. Document findings in this report
4. Proceed to Week 2 implementation with confirmed priority list


```

### BASELINE_SUMMARY.md
```
# Week 1 Baseline Metrics Summary

Generated: 2026-04-17T15:44:20.573Z

## Overview

These measurements establish baseline metrics for the current texture implementation.
They do NOT validate correctness; Week 2-4 will improve these metrics.

## Test Cases

### BASELINE_METRICS_TEMPLATE.md
```
# Week 1 Baseline Metrics Report

**Date:** [Generated during Week 1 testing]  
**Purpose:** Establish baseline measurements to track improvements in Weeks 2-4  
**Note:** These metrics do NOT validate correctness; they are the current state before fixes.

---

## Test Environment

- **Node.js Version:** [to be filled]
- **Browser:** Chromium (Playwright)
- **Three.js Version:** r128 (CDN)
- **Test Models Location:** `TestDocs/`

---

## Test Case 1: MeshRing1 — Hemispherical Bumps at 5mm Spacing

**Model:** `TestDocs/MeshRing1.stl`  
**Setup:** Load model, select outer curved surface via flood-fill, apply bumps (spacing=5mm, radius=1.5mm)  
**Purpose:** Measure texture behavior on curved surfaces

### Baseline Measurements

| Metric | Value | Target (Week 4) | Status |
|--------|-------|-----------------|--------|
| Coverage % (selected faces with texture) | `[TBD]` | ≥99% | 🔴 To measure |
| Spillover % (texture on unselected) | `[TBD]` | <1% | 🔴 To measure |
| Spacing Mean | `[TBD]` | 5.0mm | 🔴 To measure |
| Spacing Std Dev | `[TBD]` | <0.25mm | 🔴 To measure |
| Spacing Uniformity % | `[TBD]` | >90% | 🔴 To measure |
| Export Validity | `[TBD]` | Valid (0 degenerate triangles) | 🔴 To measure |
| Degenerate Triangles | `[TBD]` | 0 | 🔴 To measure |

### Visual Observations

**Expected Baseline Behavior:**
- Bumps placed on ring outer surface
- Bumps may have inconsistent orientation (averaged normal)
- Possible spacing gaps or clustering (proximity threshold issue)
- May have crinkling or non-uniform appearance

**Observed Baseline Behavior:**
```
[To be filled during testing]
- Ring surface coverage:
- Bump orientation:
- Spacing consistency:
- Visual artifacts:
```

### Screenshots

- **Before:** `2026-04-XX_bump-ring-before.png`
- **After:** `2026-04-XX_bump-ring-after.png`
- **Cross-section:** `2026-04-XX_bump-ring-cross-section.png`

### Export Analysis

**File:** `2026-04-XX_MeshRing1-bumps-baseline.stl`

```json
{
  "spacing_mean": "[TBD]",
  "spacing_std_dev": "[TBD]",
  "spacing_uniformity_percent": "[TBD]",
  "bump_height_mean": "[TBD]",
  "bump_height_std_dev": "[TBD]",
  "geometry_valid": "[TBD]",
  "degenerate_triangles": "[TBD]",
  "zero_area_triangles": "[TBD]",
  "non_manifold_edges": "[TBD]"
}
```

---

## Test Case 2: Baseplate — Mesh Weave at Default Settings

**Model:** `TestDocs/Station_3_Baseplate - Part 1.stl`  
**Setup:** Load model, select flat top surface, apply weave (height=0.5mm, cellSize=5mm, strandWidth=1.5mm)  
**Purpose:** Measure spillover risk (weave applying to side faces)

### Baseline Measurements

| Metric | Value | Target (Week 4) | Status |
|--------|-------|-----------------|--------|
| Coverage % (top surface) | `[TBD]` | ≥99% | 🔴 To measure |
| Spillover % (sides + edges) | `[TBD]` | <1% | 🔴 To measure |
| Weave Uniformity % | `[TBD]` | >90% | 🔴 To measure |
| Export Validity | `[TBD]` | Valid | 🔴 To measure |

### Visual Observations

**Expected Baseline Behavior:**
- Weave pattern on top surface
- Possible texture bleeding to side faces (proximity-based selection over-inclusive)
- Jagged appearance due to coarse mesh on flat surface
- Non-uniform pattern if mesh density varies

**Observed Baseline Behavior:**
```
[To be filled during testing]
- Top surface coverage:
- Side surface spillover:
- Pattern uniformity:
- Visual artifacts:
```

### Screenshots

- **Top view:** `2026-04-XX_weave-baseplate-top.png`
- **Side view:** `2026-04-XX_weave-baseplate-side.png` (check for spillover)
- **Cross-section:** `2026-04-XX_weave-baseplate-cross-section.png`

### Export Analysis

**File:** `2026-04-XX_Baseplate-weave-baseline.stl`

```json
{
  "spacing_mean": "[TBD]",
  "spacing_std_dev": "[TBD]",
  "spacing_uniformity_percent": "[TBD]",
  "geometry_valid": "[TBD]",
  "degenerate_triangles": "[TBD]"
}
```

---

## Test Case 3: Boundary Behavior — Partial Selection

**Model:** `TestDocs/Station_3_Baseplate - Part 1.stl`  
**Setup:** Select small portion of top surface, apply bumps  
**Purpose:** Measure boundary edge effects and gap behavior

### Visual Observations

**Expected Baseline Behavior:**
- Texture may have visible gaps at selection boundary
- May have "edge effect" where bumps cluster or disappear near edge
- May bleed slightly past selection

**Observed Baseline Behavior:**
```
[To be filled during testing]
- Boundary definition:
- Gap presence:
- Bleed extent:
```

### Screenshots

- `2026-04-XX_texture-boundary-baseline.png` (full view)
- `2026-04-XX_texture-boundary-zoom.png` (zoomed to edge)

---

## Summary of Root Causes (Hypothesis Before Week 1)

Based on code review, expected failures:

### Bumps (Geometric Approach)
- [ ] **Averaged normal misalignment:** Single weighted-average normal doesn't align with curved surfaces
- [ ] **Proximity threshold gaps:** 0.7× spacing threshold leaves visible gaps at boundaries
- [ ] **UV projection distortion:** Non-planar selections have distorted UV space

### Weave (Procedural Approach)
- [ ] **Centroid-based over-selection:** Proximity lookup includes unselected faces (bleed)
- [ ] **Mesh-density dependence:** Fine meshes show smooth patterns, coarse show jagged
- [ ] **Vertex ownership tracking:** No explicit triangle ownership → ambiguous boundaries

---

## Week 1 Findings (To Be Completed)

### Coverage Issues Confirmed
- [ ] Bumps: Coverage% = `[TBD]`
- [ ] Bumps: Spillover% = `[TBD]`
- [ ] Weave: Coverage% = `[TBD]`
- [ ] Weave: Spillover% = `[TBD]`

### Root Cause Validation
```
[To be filled after analyzing exported STL files and cross-sections]
- Did averaged normal cause misalignment on Ring?
- Did proximity threshold cause gaps?
- Did weave blend onto side faces?
- How severe is each issue?
```

### Impact on Week 2-4 Plan
```
[To be filled based on findings]
- Which fixes are highest priority?
- Should we change implementation strategy?
- Do baseline metrics require plan revision?
```

---

## Recommendations for Week 2

Based on baseline findings:

1. **If coverage < 95%:** Implement coverage-based face membership tracking (Week 2 priority)
2. **If spillover > 2%:** Add explicit triangle ownership (Week 3 priority)
3. **If export invalid:** Add geometry validation and repair (Week 4 priority)
4. **If uniformity < 85%:** Per-face normal approach needed (Week 2 priority)

---

## Next Steps

1. Run `npm run test:e2e -- tests/texture-baseline.spec.js`
2. Analyze exported STL files with `python tools/analyze-texture-stl.py <file.stl>`
3. Document findings in this report
4. Proceed to Week 2 implementation with confirmed priority list


```

### BASELINE_SUMMARY.md
```
# Week 1 Baseline Metrics Summary

Generated: 2026-04-17T15:25:12.247Z

## Overview

These measurements establish baseline metrics for the current texture implementation.
They do NOT validate correctness; Week 2-4 will improve these metrics.

## Test Cases

### BASELINE_METRICS_TEMPLATE.md
```
# Week 1 Baseline Metrics Report

**Date:** [Generated during Week 1 testing]  
**Purpose:** Establish baseline measurements to track improvements in Weeks 2-4  
**Note:** These metrics do NOT validate correctness; they are the current state before fixes.

---

## Test Environment

- **Node.js Version:** [to be filled]
- **Browser:** Chromium (Playwright)
- **Three.js Version:** r128 (CDN)
- **Test Models Location:** `TestDocs/`

---

## Test Case 1: MeshRing1 — Hemispherical Bumps at 5mm Spacing

**Model:** `TestDocs/MeshRing1.stl`  
**Setup:** Load model, select outer curved surface via flood-fill, apply bumps (spacing=5mm, radius=1.5mm)  
**Purpose:** Measure texture behavior on curved surfaces

### Baseline Measurements

| Metric | Value | Target (Week 4) | Status |
|--------|-------|-----------------|--------|
| Coverage % (selected faces with texture) | `[TBD]` | ≥99% | 🔴 To measure |
| Spillover % (texture on unselected) | `[TBD]` | <1% | 🔴 To measure |
| Spacing Mean | `[TBD]` | 5.0mm | 🔴 To measure |
| Spacing Std Dev | `[TBD]` | <0.25mm | 🔴 To measure |
| Spacing Uniformity % | `[TBD]` | >90% | 🔴 To measure |
| Export Validity | `[TBD]` | Valid (0 degenerate triangles) | 🔴 To measure |
| Degenerate Triangles | `[TBD]` | 0 | 🔴 To measure |

### Visual Observations

**Expected Baseline Behavior:**
- Bumps placed on ring outer surface
- Bumps may have inconsistent orientation (averaged normal)
- Possible spacing gaps or clustering (proximity threshold issue)
- May have crinkling or non-uniform appearance

**Observed Baseline Behavior:**
```
[To be filled during testing]
- Ring surface coverage:
- Bump orientation:
- Spacing consistency:
- Visual artifacts:
```

### Screenshots

- **Before:** `2026-04-XX_bump-ring-before.png`
- **After:** `2026-04-XX_bump-ring-after.png`
- **Cross-section:** `2026-04-XX_bump-ring-cross-section.png`

### Export Analysis

**File:** `2026-04-XX_MeshRing1-bumps-baseline.stl`

```json
{
  "spacing_mean": "[TBD]",
  "spacing_std_dev": "[TBD]",
  "spacing_uniformity_percent": "[TBD]",
  "bump_height_mean": "[TBD]",
  "bump_height_std_dev": "[TBD]",
  "geometry_valid": "[TBD]",
  "degenerate_triangles": "[TBD]",
  "zero_area_triangles": "[TBD]",
  "non_manifold_edges": "[TBD]"
}
```

---

## Test Case 2: Baseplate — Mesh Weave at Default Settings

**Model:** `TestDocs/Station_3_Baseplate - Part 1.stl`  
**Setup:** Load model, select flat top surface, apply weave (height=0.5mm, cellSize=5mm, strandWidth=1.5mm)  
**Purpose:** Measure spillover risk (weave applying to side faces)

### Baseline Measurements

| Metric | Value | Target (Week 4) | Status |
|--------|-------|-----------------|--------|
| Coverage % (top surface) | `[TBD]` | ≥99% | 🔴 To measure |
| Spillover % (sides + edges) | `[TBD]` | <1% | 🔴 To measure |
| Weave Uniformity % | `[TBD]` | >90% | 🔴 To measure |
| Export Validity | `[TBD]` | Valid | 🔴 To measure |

### Visual Observations

**Expected Baseline Behavior:**
- Weave pattern on top surface
- Possible texture bleeding to side faces (proximity-based selection over-inclusive)
- Jagged appearance due to coarse mesh on flat surface
- Non-uniform pattern if mesh density varies

**Observed Baseline Behavior:**
```
[To be filled during testing]
- Top surface coverage:
- Side surface spillover:
- Pattern uniformity:
- Visual artifacts:
```

### Screenshots

- **Top view:** `2026-04-XX_weave-baseplate-top.png`
- **Side view:** `2026-04-XX_weave-baseplate-side.png` (check for spillover)
- **Cross-section:** `2026-04-XX_weave-baseplate-cross-section.png`

### Export Analysis

**File:** `2026-04-XX_Baseplate-weave-baseline.stl`

```json
{
  "spacing_mean": "[TBD]",
  "spacing_std_dev": "[TBD]",
  "spacing_uniformity_percent": "[TBD]",
  "geometry_valid": "[TBD]",
  "degenerate_triangles": "[TBD]"
}
```

---

## Test Case 3: Boundary Behavior — Partial Selection

**Model:** `TestDocs/Station_3_Baseplate - Part 1.stl`  
**Setup:** Select small portion of top surface, apply bumps  
**Purpose:** Measure boundary edge effects and gap behavior

### Visual Observations

**Expected Baseline Behavior:**
- Texture may have visible gaps at selection boundary
- May have "edge effect" where bumps cluster or disappear near edge
- May bleed slightly past selection

**Observed Baseline Behavior:**
```
[To be filled during testing]
- Boundary definition:
- Gap presence:
- Bleed extent:
```

### Screenshots

- `2026-04-XX_texture-boundary-baseline.png` (full view)
- `2026-04-XX_texture-boundary-zoom.png` (zoomed to edge)

---

## Summary of Root Causes (Hypothesis Before Week 1)

Based on code review, expected failures:

### Bumps (Geometric Approach)
- [ ] **Averaged normal misalignment:** Single weighted-average normal doesn't align with curved surfaces
- [ ] **Proximity threshold gaps:** 0.7× spacing threshold leaves visible gaps at boundaries
- [ ] **UV projection distortion:** Non-planar selections have distorted UV space

### Weave (Procedural Approach)
- [ ] **Centroid-based over-selection:** Proximity lookup includes unselected faces (bleed)
- [ ] **Mesh-density dependence:** Fine meshes show smooth patterns, coarse show jagged
- [ ] **Vertex ownership tracking:** No explicit triangle ownership → ambiguous boundaries

---

## Week 1 Findings (To Be Completed)

### Coverage Issues Confirmed
- [ ] Bumps: Coverage% = `[TBD]`
- [ ] Bumps: Spillover% = `[TBD]`
- [ ] Weave: Coverage% = `[TBD]`
- [ ] Weave: Spillover% = `[TBD]`

### Root Cause Validation
```
[To be filled after analyzing exported STL files and cross-sections]
- Did averaged normal cause misalignment on Ring?
- Did proximity threshold cause gaps?
- Did weave blend onto side faces?
- How severe is each issue?
```

### Impact on Week 2-4 Plan
```
[To be filled based on findings]
- Which fixes are highest priority?
- Should we change implementation strategy?
- Do baseline metrics require plan revision?
```

---

## Recommendations for Week 2

Based on baseline findings:

1. **If coverage < 95%:** Implement coverage-based face membership tracking (Week 2 priority)
2. **If spillover > 2%:** Add explicit triangle ownership (Week 3 priority)
3. **If export invalid:** Add geometry validation and repair (Week 4 priority)
4. **If uniformity < 85%:** Per-face normal approach needed (Week 2 priority)

---

## Next Steps

1. Run `npm run test:e2e -- tests/texture-baseline.spec.js`
2. Analyze exported STL files with `python tools/analyze-texture-stl.py <file.stl>`
3. Document findings in this report
4. Proceed to Week 2 implementation with confirmed priority list


```

## Key Findings for Week 2+

Based on baselines above, Week 2-4 implementation should:

1. Improve coverage precision (target: >99% selected, <1% spillover)

2. Ensure clean boundaries (no visible gaps or bleed)

3. Verify export geometry validity in FreeCAD

4. Measure spacing uniformity with cross-section analysis

```

## Key Findings for Week 2+

Based on baselines above, Week 2-4 implementation should:

1. Improve coverage precision (target: >99% selected, <1% spillover)

2. Ensure clean boundaries (no visible gaps or bleed)

3. Verify export geometry validity in FreeCAD

4. Measure spacing uniformity with cross-section analysis

```

## Key Findings for Week 2+

Based on baselines above, Week 2-4 implementation should:

1. Improve coverage precision (target: >99% selected, <1% spillover)

2. Ensure clean boundaries (no visible gaps or bleed)

3. Verify export geometry validity in FreeCAD

4. Measure spacing uniformity with cross-section analysis

```

## Key Findings for Week 2+

Based on baselines above, Week 2-4 implementation should:

1. Improve coverage precision (target: >99% selected, <1% spillover)

2. Ensure clean boundaries (no visible gaps or bleed)

3. Verify export geometry validity in FreeCAD

4. Measure spacing uniformity with cross-section analysis

```

## Key Findings for Week 2+

Based on baselines above, Week 2-4 implementation should:

1. Improve coverage precision (target: >99% selected, <1% spillover)

2. Ensure clean boundaries (no visible gaps or bleed)

3. Verify export geometry validity in FreeCAD

4. Measure spacing uniformity with cross-section analysis
