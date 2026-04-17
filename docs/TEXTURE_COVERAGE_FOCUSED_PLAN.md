# Surface Texture Feature — Coverage-Focused Implementation Plan

**Date:** 2026-04-17  
**Requirements:** Printable, coverage-first, uniformity-vital, 4-week timeline  
**Approach:** Per-face normal bumps (Option A from design decision document)  
**Current State (2026-04-17):** Previous broken implementation reverted. Face selection UI + flood-fill highlight is working. `applyTextureToGeometry()` is a stub. Clean baseline ready for Week 2 implementation.

---

## Feature Specification (Revised)

### Primary Goal: Coverage
**Coverage** = texture appears only on selected faces (0 spillover to unselected faces)
- Target: ≥99% of selected faces have texture; <1% of unselected faces affected
- Measurement: Export STL, cross-section analysis, visual inspection

### Secondary Goal: Uniformity
**Uniformity** = texture spacing and appearance are consistent across selected region
- Target: Bump spacing within ±5% of user parameter on flat surfaces
- Target: Bump spacing within ±10% on curved surfaces
- Measurement: STL cross-section, center-to-center distance histograms

### Tertiary Goal: Printability
**Printability** = exported geometry is valid for FreeCAD slicing and 3D printing
- Target: 100% of exports pass STL validation (no degenerate triangles, closed surface)
- Target: 100% of exports slice without errors in FreeCAD
- Measurement: FreeCAD validation, slicer test, physical test print

---

## Root Cause of Poor Coverage (Current Implementation)

### Problem 1: Proximity Threshold Leaves Gaps
**Current Logic:**
```
For each grid point:
  nearestCentroid = find_nearest_centroid(gridPoint)
  distance = gridPoint.distance(nearestCentroid)
  if distance < spacing * 0.7:
    place_bump()
  else:
    skip (no bump)
```

**Failure:** Grid points near face boundaries fail proximity check, leaving visible gaps

**Why it fails on coverage:**
- Grid points near edge of selected region may be far from any centroid
- Centroid of a face is at its center, not at its edges
- Result: No bumps at region boundaries

### Problem 2: No Explicit Face Membership Tracking
**Current Logic (for weave):**
- Proximity-based: "is vertex within threshold of any selected centroid?"
- Over-inclusive: vertices on adjacent unselected faces can be within threshold
- Result: Texture bleeds onto unselected surfaces

**Why it fails on coverage:**
- Hard boundary not enforced
- Ambiguous at edges (is this vertex selected or not?)

---

## Solution: Coverage-Based Face Membership (Not Proximity-Based)

### Core Innovation: Explicit Face Bounds Checking

Instead of "proximity to centroid," use "overlap with face bounds."

**Algorithm for Bumps:**
```
For each grid point (u, v):
  isInSelectedRegion = false
  
  for each selected face:
    // Compute face's UV bounds (from its 3 vertices)
    uvBounds = compute_uv_bounds(face)
    
    // Check if grid point overlaps bounds
    if uvBounds.contains(u, v):
      isInSelectedRegion = true
      bump_normal = face.normal  // per-face normal, not averaged
      break
  
  if isInSelectedRegion:
    place_bump(gridPoint, bump_normal)
```

**Advantages for Coverage:**
- ✅ Geometry-based, not proximity-based
- ✅ Grid points are accepted IFF they overlap selected face bounds
- ✅ No ambiguous edge cases
- ✅ Respects actual face topology
- ✅ Per-face normals ensure correct orientation

**Algorithm for Weave:**
```
// Mark which triangles are selected (binary array)
selectedTriangles = new Set(selectedFaceIndices)

// During subdivision, inherit membership
for each child triangle:
  childSelected[i] = parentSelected[parent_id]

// When displacing vertices
for each vertex v:
  ownerTriangles = triangles_containing_vertex(v)
  isSelected = ownerTriangles.some(t => selectedTriangles.has(t))
  
  if isSelected:
    displace(v)  // only displace if triangle is selected
```

**Advantages for Coverage:**
- ✅ Explicit triangle ownership (no ambiguity)
- ✅ Texture stops cleanly at boundaries
- ✅ No bleed to adjacent faces

---

## 4-Week Implementation Roadmap

### Week 1: Foundation & Testing Framework

**Goal:** Establish baseline metrics, test harness, and failure reproductions

**Day 1-2: Test Framework**
- [ ] Create test harness that measures:
  - Coverage precision (% of selected faces with texture)
  - Uniformity (spacing std dev / mean spacing)
  - Export validity (STL integrity, FreeCAD slicing)
- [ ] Create cross-section analyzer tool (slice exported STL at multiple heights)
- [ ] Create metrics dashboard (track baseline before any changes)

**Day 3: Reproduce Failures**
- [ ] Load MeshRing1.stl, apply bumps to outer surface
  - Expected: uniform spacing around ring, bumps point outward
  - Actual: ? (document observed failure)
- [ ] Load Baseplate, apply bumps to flat top
  - Expected: uniform grid, bumps point up
  - Actual: ? (document observed failure)
- [ ] Select partial region (one edge), apply weave
  - Expected: texture stops at boundary
  - Actual: ? (document bleed if any)

**Day 4: Measure Baselines**
- [ ] For each test case above: measure
  - Coverage: % of selected faces with texture
  - Uniformity: spacing std dev
  - Export validity: STL check, FreeCAD slice
- [ ] Create baseline report (BASELINE_METRICS.md)

**Day 5: Document Findings**
- [ ] Write detailed failure reproduction (screenshots, cross-sections, metrics)
- [ ] Update task list with specific fixes needed

**Deliverable:** `BASELINE_METRICS.md` with measured values and target improvements

---

### Week 2: Per-Face Normal Implementation (Bumps)

**Goal:** Replace proximity-threshold with coverage-based face membership

**Day 1-2: Spatial Index**
- [ ] Implement octree for selected face centroids
- [ ] Implement nearest-neighbor query (find closest face to grid point)
- [ ] Implement UV bounds computation (for each face)
- [ ] Test spatial index on test models

**Day 3-4: Bump Placement Algorithm**

Concrete algorithm (replaces old proximity-threshold approach):

```
1. Build per-face data for all selectedFaceIndices:
   - normal, centroid, v0/v1/v2 in world space

2. Compute selection AABB (min/max of all selected face vertices)

3. Build global tangent frame from weighted-average normal:
   - avgNormal = sum of face normals / count
   - uAxis = any perpendicular to avgNormal
   - vAxis = cross(uAxis, avgNormal)

4. Generate global grid:
   for u in [aabb.uMin, aabb.uMax] step spacing:
     for v in [aabb.vMin, aabb.vMax] step spacing:
       gridPt3D = u * uAxis + v * vAxis (world space)

5. For each gridPt3D:
   a. Find nearest selected face F by centroid distance
   b. Project gridPt3D onto F's plane:
      projected = gridPt3D - dot(gridPt3D - F.v0, F.normal) * F.normal
   c. Check if projected is inside triangle (v0, v1, v2) via barycentric coords:
      if NOT inside → skip (no bump here — coverage boundary respected)
   d. If inside:
      bumpCenter = projected  (on the face surface)
      bumpNormal = F.normal   (per-face, not averaged)
      Place SphereGeometry(radius, 12, 6, 0, 2π, 0, π/2)
        → rotate to align Y-up with bumpNormal
        → translate to bumpCenter

6. Merge hemispheres + original baseGeometry (non-indexed concatenation)
```

Key properties:
- Coverage boundary = face triangle edge (not a heuristic threshold)
- No spillover: bumps only placed inside actual selected triangles
- Per-face normals: curved surfaces handled naturally

- [ ] Implement and test on flat surfaces (expected: uniform grid, no gaps at edges)
- [ ] Test on curved surfaces (MeshRing1 outer surface: bumps point radially outward)
- [ ] Measure coverage precision and spacing uniformity

**Day 5: Validation & Refinement**
- [ ] Compare new metrics vs baseline
- [ ] If coverage improved: document improvement
- [ ] If new issues appear: debug and fix

**Deliverable:** Updated `addHemisphericBumps()` with per-face normals, passes Week 1 test cases

---

### Week 3: Explicit Face Membership (Weave)

**Goal:** Replace proximity-based selection with explicit triangle ownership

**Day 1-2: Triangle Ownership Tracking**
- [ ] Build binary array: `selectedTriangles[i]` = is triangle i selected?
- [ ] During subdivision: inherit membership to child triangles
- [ ] Store mapping: vertex → list of owner triangles

**Day 3-4: Displacement with Ownership**
- [ ] Before displacing vertices: check owner triangle's selected status
- [ ] Only displace if owner triangle is selected
- [ ] Recompute normals after displacement

**Day 5: Validation & Refinement**
- [ ] Test on test cases from Week 1
- [ ] Measure coverage precision (should be >99%)
- [ ] Compare metrics vs baseline

**Deliverable:** Updated `applyMeshWeaveDisplacement()` with explicit ownership, passes Week 1 test cases

---

### Week 4: Export Validation & Hardening

**Goal:** Ensure all exports are valid for 3D printing; finalize feature

**Day 1-2: Export Validation**
- [ ] After texture applied: run validation checks
  - STL geometry check (no degenerate triangles, closed surface)
  - FreeCAD import test (can model be imported?)
  - Slicer test (can FreeCAD slice the model?)
- [ ] If validation fails: display user-friendly error message
- [ ] If validation passes: enable export button

**Day 3-4: User Documentation & Error Handling**
- [ ] Write user guide: "How to use surface texture" (with examples)
- [ ] Add error messages for unsupported selections
  - "Selection is not planar" (if using planar-only mode)
  - "Texture crosses model boundary" (if geometry becomes invalid)
  - "Spacing too fine for this model" (if geometry too complex)

**Day 5: Final Testing & Sign-Off**
- [ ] Run full test suite (all Playwright tests pass)
- [ ] Test on diverse models (flat, curved, complex)
- [ ] Visual regression (compare to baseline, verify improvements)
- [ ] Create final test report with before/after metrics

**Deliverable:** Production-ready texture feature with validation and documentation

---

## Success Metrics (Week 4 Acceptance Criteria)

### Coverage
- [ ] ≥99% of selected faces have texture applied
- [ ] <1% spillover to unselected faces
- [ ] Boundary is clean (no gradient bleed)

### Uniformity
- [ ] Flat surfaces: spacing std dev < 5% of parameter
- [ ] Curved surfaces: spacing std dev < 10% of parameter
- [ ] Texture appears predictable and user-controllable

### Printability
- [ ] 100% of exports pass STL validation
- [ ] 100% of exports can be imported in FreeCAD
- [ ] 100% of exports can be sliced without errors
- [ ] Physical test print successful (if applicable)

### User Experience
- [ ] Feature works on flat, curved, and complex surfaces
- [ ] Error messages guide users on invalid selections
- [ ] Documentation explains behavior and limitations
- [ ] No crashes or unexpected failures

---

## Technical Decisions Already Made

### Approach: Per-Face Normals (Option A)
- ✅ Provides best coverage (respects actual geometry)
- ✅ Supports all surface types
- ✅ Aligns with 4-week timeline

### Metric Priority: Coverage > Uniformity > Printability
- ✅ Coverage is hard gate (must be >99%)
- ✅ Uniformity is quality gate (must be <10%)
- ✅ Printability is final validation gate

### Export Requirement: Must be Valid for 3D Printing
- ✅ Validation checks built into apply process
- ✅ Geometric repairs applied if needed
- ✅ User informed if geometry is unprintable

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Per-face normal too complex | Start with octree (well-understood data structure), add unit tests |
| Coverage still imperfect after changes | Week 1 baseline makes delta clear; pivot to simpler approach if needed |
| Export validation too strict | Implement geometry repair (weld vertices, remove degenerates) before export |
| Weave triangle ownership breaks subdivision | Add regression tests for subdivision + ownership propagation |
| Timeline slips | Prioritize: coverage (must-have), uniformity (should-have), printability (must-validate) |

---

## Definition of Done

Feature is **complete and validated** when:

1. ✅ All Week 1 test cases pass with measured improvements
2. ✅ Per-face normal bumps implemented (Week 2)
3. ✅ Explicit triangle ownership weave implemented (Week 3)
4. ✅ Export validation in place (Week 4)
5. ✅ Coverage > 99%, uniformity < 10%, printability 100%
6. ✅ User documentation published
7. ✅ All Playwright tests pass (including new coverage/uniformity tests)
8. ✅ Feature can be shipped to production

---

## Next Immediate Action

**Ready to proceed?** If you confirm the design decisions (per-face normals, coverage-first priority), I will:

1. Start Week 1 immediately: create test framework and baseline measurements
2. Identify exact failure mechanisms with data
3. Propose Week 2+ fixes based on Week 1 findings

Timeline: ~1 week for foundation, ~3 weeks for implementation = ready by ~2026-05-15

