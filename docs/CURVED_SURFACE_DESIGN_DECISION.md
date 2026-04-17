# Curved Surface Texture: Design Decision Framework

**Date:** 2026-04-17  
**Question:** How should bumps be oriented on curved (non-planar) surfaces?  
**Context:** This decision affects implementation complexity, user experience, and printability

---

## The Problem

Current implementation computes a **single weighted-average normal** for the entire selected region, then places all bumps pointing in that direction.

**Failure Mode on Curved Surfaces:**
- MeshRing1 (ring): Select outer surface → face normals vary ~0–360° around circumference
- Average normal points radially outward (or inward)
- All bumps placed with same orientation
- Result: Bumps on side of ring point perpendicular to surface, not tangent
- Appearance: Wrong, potentially unprintable (geometry artifacts)

**Core Question:** How should we handle this?

---

## Option A: Per-Face Normal Bumps (Maximum Fidelity)

**Approach:**
- For each grid point, determine which selected face it belongs to (or is nearest to)
- Orient that specific bump along that face's actual normal
- Result: Each bump respects its local surface orientation

**Implementation Details:**
```
1. Build spatial index (octree/kd-tree) of selected faces
2. For each grid point:
   a. Query index: which selected face is nearest?
   b. Get that face's actual normal (not weighted average)
   c. Place bump oriented to that normal
3. Grid point only accepted if overlaps selected face's bounds
```

**Advantages:**
- ✅ Bumps naturally follow curved surface (no misalignment)
- ✅ Maximally faithful to actual geometry
- ✅ Works on flat, curved, and complex multi-orientation surfaces
- ✅ Users can texture almost any surface without frustration

**Disadvantages:**
- ❌ More complex: need spatial index (octree) for fast queries
- ❌ More bookkeeping: track per-bump normal vs single average
- ❌ Slightly higher memory usage (spatial structure)
- ❌ ~20–30% more code than current approach

**Printability Implications:**
- ✅ Bumps point outward (respect surface curvature) → solid geometry
- ✅ Lower risk of self-intersection or degenerate geometry
- ⚠️ On highly complex surfaces (e.g., twisted geometry), individual bumps might still intersect each other if spacing is too fine

**Testing Burden:**
- Need tests for: flat, gently curved (ring), sharply curved, twisted surfaces
- Validate bump orientation per surface type

---

## Option B: Planar-Faces-Only Constraint (Simpler, Clearer)

**Approach:**
- Before placing bumps, validate that all selected faces have normals within tolerance (e.g., ±15° deviation from mean)
- If validation fails: reject with user message
- If validation passes: use current approach (weighted-average normal)

**Implementation Details:**
```
1. Compute weighted-average normal
2. For each selected face normal:
   a. Compute angle to average normal
   b. If angle > PLANARITY_THRESHOLD (15°):
      reject with message: "Selection is not planar. 
      Try selecting faces with more similar orientation."
3. If all faces pass: proceed with current algorithm
```

**Advantages:**
- ✅ Simple: one threshold check, minimal code
- ✅ Clear user feedback: "Your selection isn't right, try again"
- ✅ Works perfectly on truly planar surfaces
- ✅ Lower risk of edge cases
- ✅ Easier to test (validation logic is straightforward)

**Disadvantages:**
- ❌ Can't texture gently curved surfaces (e.g., outer face of ring)
- ❌ Frustrating UX: "Try again" doesn't tell user how to fix it
- ❌ Limits feature applicability (excluded use cases)
- ❌ Users might feel feature is "broken" on curved models

**Printability Implications:**
- ✅ Guaranteed solid geometry (all bumps point same direction)
- ✅ No risk of self-intersection
- ✅ Conservative: only accept cases we know work

**Testing Burden:**
- Simple: just test flat surfaces (primary use case)
- Validation tests for boundary cases (faces at ±15° threshold)

---

## Option C: Multi-Region Clustering (Maximum Flexibility)

**Approach:**
- Group selected faces by normal direction (cluster faces with similar normals)
- Each cluster becomes a separate "texture region"
- Apply bumps to each region independently with its own average normal

**Implementation Details:**
```
1. Collect all selected face normals
2. Cluster normals using angle distance:
   - Start with first face's normal as cluster center
   - Add other faces if angle < CLUSTER_TOLERANCE (20°)
   - If angle > tolerance: start new cluster
3. For each cluster:
   - Compute local average normal
   - Place bumps only for faces in that cluster
4. Merge all bumps into final geometry
```

**Advantages:**
- ✅ Handles multi-orientation surfaces (e.g., entire baseplate: top + sides)
- ✅ Each region textured appropriately
- ✅ More flexible than Option B

**Disadvantages:**
- ❌ More complex: need clustering algorithm
- ❌ Edge cases at cluster boundaries (visible transitions?)
- ❌ Harder to debug/test
- ❌ More bookkeeping than Option B, less optimal than Option A

**Printability Implications:**
- ⚠️ Works but creates region boundaries that might be visible
- ⚠️ Not as principled as per-face approach (Option A)

**Testing Burden:**
- Need multi-region test models
- Validate cluster boundaries look clean
- Harder to predict behavior

---

## Decision Matrix

| Criterion | Option A | Option B | Option C |
|-----------|----------|----------|----------|
| **Complexity** | Medium | Low | Medium-High |
| **User Satisfaction** | High | Medium | Medium-High |
| **Curved Surface Support** | ✅ Yes | ❌ No | ⚠️ Partial |
| **Testing Difficulty** | Medium | Low | High |
| **Risk of Printability Issues** | Lower | Lowest | Medium |
| **Implementation Time** | 5–7 days | 2–3 days | 4–6 days |
| **Maintenance Burden** | Medium | Low | Medium-High |
| **Lines of New Code** | ~150–200 | ~50–80 | ~120–150 |

---

## Recommendation (Based on User Requirements)

**User said:** 
- Feature must be printable ✅
- Coverage is PRIMARY criteria (ensure texture applies to all selected faces)
- Uniformity is VITAL but secondary
- Willing to spend 4 weeks

**Recommendation: Start with Option A (Per-Face Normals)**

**Rationale:**
1. **Coverage alignment:** Per-face approach naturally respects face boundaries (no bleed to unselected faces) → better coverage precision
2. **Printability:** Bumps follow actual surface → lowest risk of geometry artifacts
3. **User experience:** Works on any selected surface → no frustrating "try again" messages
4. **Timeline:** 4-week timeline supports the implementation complexity
5. **Testability:** Clear test cases for each surface type (flat, curved, complex)

**Fallback:** If per-face approach encounters unexpected complexity, Option B (planar-only) is a quick pivot that still ships a solid feature.

---

## Implementation Approach (Option A)

### Phase 1: Spatial Index
1. Build octree for selected face centroids
2. Optimize for O(log n) nearest-neighbor queries
3. Store face ID → normal, centroid, UV bounds

### Phase 2: Bump Placement
1. For each grid point in UV space:
   - Query octree: find nearest selected face
   - Get that face's normal (not weighted average)
   - Check if grid point overlaps face bounds
   - If yes: create bump with that face's normal

### Phase 3: Validation
1. Ensure no bumps intersect (check spacing ≥ 2 × radius)
2. Validate final geometry (no degenerate triangles)
3. Export and reimport test

### Test Coverage
- Flat surface: bumps uniform, properly spaced
- Gently curved surface (ring): bumps follow curvature
- Sharply curved surface: bumps maintain orientation
- Multi-orientation surface (baseplate top + sides): each region textured appropriately
- Boundary effects: no texture bleed to unselected faces

---

## Alternative Question: Do We Need to Support Curved Surfaces at Minimum?

**If answer is "flat surfaces only":** Option B (planar-only) is fastest (2–3 days), simplest, lowest risk.

**If answer is "support all surfaces":** Option A (per-face) is best despite complexity (5–7 days), enables future expansion.

**My assessment:** Given "coverage is primary" and willingness to spend 4 weeks, **Option A makes sense**. Curved surface support is a natural consequence of correct coverage logic.

