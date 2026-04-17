# Surface Texture Feature — Finalized Requirements & Design Decisions

**Date:** 2026-04-17  
**Status:** Ready for implementation  
**Timeline:** 4 weeks (start immediately after approval)

---

## Requirements (From User Input)

### 1. Must Be Printable ✅
- Feature is NOT pure visual embellishment
- Exported geometry must be valid for:
  - FreeCAD import and slicing
  - 3D printer slicer software
  - Actual physical printing
- Consequence: Requires STL validation before export, geometric repairs if needed

### 2. Coverage is PRIMARY Criteria ✅
- **Definition:** Texture appears only on selected faces (no spillover to unselected)
- **Target:** ≥99% of selected faces have texture; <1% spillover
- **Measurement:** Cross-section analysis, visual inspection, automated metrics
- **Why it matters:** Users expect "texture this region" to be respected precisely

### 3. Uniformity is VITAL (But Secondary) ✅
- **Definition:** Texture spacing/appearance consistent across selected region
- **Target:** Spacing within ±5% on flat surfaces, ±10% on curved
- **Why secondary:** Even if slightly non-uniform, good coverage beats uniform spillover
- **Consequence:** Fixes that improve coverage take priority over uniformity polish

### 4. 4-Week Timeline with "Do It Well" Philosophy ✅
- No time pressure to rush a weak solution
- Can afford proper testing, validation, and documentation
- Can invest in robust implementation (e.g., octree, spatial indices)
- Result: Production-quality feature

---

## Design Decisions Made

### Decision 1: Curved Surface Support = Per-Face Normals (Option A)

**Question:** How should bumps be oriented on curved/non-planar surfaces?

**Answer:** Per-face normal bumps (each bump points along its nearest selected face's actual normal)

**Why:**
- ✅ Best coverage (respects actual face geometry, no misalignment)
- ✅ Works on all surface types (flat, curved, complex)
- ✅ Avoids frustrating "try again" user experience
- ✅ Aligns with coverage-first priority (coverage naturally correct when bumps respect geometry)
- ✅ 4-week timeline supports implementation complexity

**Implementation:** Octree spatial index + UV bounds checking (not proximity threshold)

**Trade-off:** ~5–7 days implementation vs ~2–3 days for simpler "planar-only" approach

---

### Decision 2: Coverage Mechanism = Face Bounds Checking (Not Proximity)

**Current Failure:** Proximity threshold (0.7 × spacing) leaves gaps at region boundaries

**New Approach:**
- **For bumps:** Grid point accepted only if it overlaps an actual selected face's UV bounds
- **For weave:** Vertices displaced only if they belong to a selected triangle (explicit ownership)

**Why:**
- ✅ Geometry-based, not heuristic-based
- ✅ No ambiguous edge cases
- ✅ Naturally enforces boundaries
- ✅ Enables >99% coverage

---

### Decision 3: Priority Hierarchy for Trade-Offs

**If conflicting goals, resolve in this order:**
1. **Coverage** (must be >99%)
2. **Printability** (must be valid for slicing)
3. **Uniformity** (should be <10% deviation, but OK if coverage perfect)
4. **Performance** (should be <1s for typical models, but OK if slower)

**Example:** If improving uniformity breaks coverage, revert and keep current approach.

---

## Specification Summary

### Hemispherical Bumps (Geometric Approach)

**Parameters:**
- Spacing (mm): distance between bump centers (default 5mm)
- Radius (mm): height/width of each bump (default 1.5mm)

**Behavior:**
- User selects faces (flood-fill + shift-click)
- Click "Apply Bumps"
- For each selected face: compute its normal (NOT averaged)
- Place bumps in regular grid using per-face normals
- Bumps only on selected faces (no spillover)
- Export includes merged geometry

**Visual Result:**
- Flat surface: regular grid of hemispherical domes
- Curved surface: bumps follow surface curvature naturally
- Boundary: clean edge, no bleed

**Printable:** Yes, each bump is solid 3D geometry

---

### Mesh Weave (Procedural Approach)

**Parameters:**
- Height (mm): displacement magnitude (default 0.5mm)
- Cell Size (mm): repeat period of pattern (default 5mm)
- Strand Width (mm): width of diagonal bands (default 1.5mm)

**Behavior:**
- User selects faces
- Click "Apply Weave"
- Subdivide selected faces adaptively until edges are fine enough
- Apply diagonal band displacement formula
- Only displace vertices in selected triangles (explicit ownership)
- Export includes textured geometry

**Visual Result:**
- Flat surface: diagonal weave pattern (carbon-fiber-like)
- Curved surface: pattern adapts to surface
- Boundary: clean edge, no bleed

**Printable:** Yes, displacement is along surface normals

---

## Metrics & Acceptance Criteria

### Week 1: Baseline Measurement
- Current coverage precision (% of selected with texture)
- Current uniformity (spacing std dev)
- Current export validity (can FreeCAD slice?)
- Document specific failure cases (Ring outer surface, Baseplate with weave, etc.)

### Week 4: Final Validation
| Metric | Target | Measurement |
|--------|--------|-------------|
| Coverage | ≥99% selected | % with texture / total selected |
| Spillover | <1% unselected | % affected / total unselected |
| Uniformity (flat) | ±5% spacing | std dev / mean of gaps |
| Uniformity (curved) | ±10% spacing | std dev / mean of gaps |
| Export validity | 100% pass | FreeCAD import + slice test |
| Performance | <1s for 100K tri | measured on test models |

### Regression Prevention
- Automate coverage & uniformity checks in Playwright tests
- Track metrics in git history for trend analysis
- Alert if coverage drops below 95% or uniformity exceeds ±15%

---

## Implementation Approach

### Foundation (Week 1)
1. Create test harness (coverage/uniformity metrics)
2. Establish baseline measurements
3. Reproduce failures with data

### Per-Face Normal Bumps (Week 2)
1. Build octree spatial index
2. Replace proximity threshold with UV bounds checking
3. Use per-face normals (not weighted-average)
4. Validate on flat & curved test cases

### Triangle Ownership Weave (Week 3)
1. Track selected triangle ownership through subdivision
2. Only displace vertices in selected triangles
3. Validate on flat & curved test cases

### Validation & Hardening (Week 4)
1. Add STL validity checking
2. Implement geometry repair if needed
3. Document user guide
4. Final test suite and sign-off

---

## Known Unknowns (Week 1 Will Answer)

1. **How bad is current coverage?** (Measured at Week 1)
2. **What's the exact failure mode on Ring?** (Reproduced at Week 1)
3. **How much does weave bleed?** (Measured at Week 1)
4. **Do octree/bounds-checking fix coverage?** (Validated at Week 2)
5. **What export issues exist?** (Discovered at Week 4)

---

## Success Looks Like (Week 4)

- ✅ MeshRing1 outer surface: bumps follow curvature, >99% coverage, clean boundary
- ✅ Baseplate flat top: uniform grid of bumps, ±5% spacing, no bleed to sides
- ✅ Baseplate with weave: pattern on top only, clean boundary, no spillover
- ✅ Export: STL validates in FreeCAD, can be sliced without errors
- ✅ User: "This feature works reliably and does what I expect"

---

## Go/No-Go Checklist

**Proceed with implementation if:**
- [x] Coverage is primary (>99% target)
- [x] Printability is required (must validate exports)
- [x] Uniformity is secondary (accept ±10% on curves)
- [x] Per-face normals approach approved
- [x] 4-week timeline is acceptable
- [x] User willing to accept imperfect uniformity if coverage is perfect

**All items checked.** ✅ **Ready to start Week 1 immediately.**

---

## File References

| Document | Purpose |
|----------|---------|
| `CURVED_SURFACE_DESIGN_DECISION.md` | Design options and rationale |
| `TEXTURE_COVERAGE_FOCUSED_PLAN.md` | 4-week roadmap with daily tasks |
| `texture_failure_analysis.md` | Root cause investigation |
| `texture_implementation_plan.md` | Technical design details |
| `TEXTURE_TEST_SUMMARY.md` | Test coverage audit |
| `TEXTURE_EXECUTIVE_SUMMARY.md` | High-level overview |

---

## Next Step

**Ready for Week 1 startup?** 

If yes, I will immediately:
1. Create test framework (metrics dashboard, cross-section analyzer)
2. Load test models and apply current textures
3. Measure baseline metrics (coverage, uniformity, export validity)
4. Document specific failures with data
5. Deliver `BASELINE_METRICS.md` with findings

**Expected Week 1 output:** Clear understanding of exactly what's broken and how much improvement each fix will deliver.

