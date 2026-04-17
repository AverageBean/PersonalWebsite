# Surface Texture — Upgrade Plan

**Date:** 2026-04-17  
**Current State:** Bumps work well on flat surfaces; mesh weave has full coverage; both fail on curved surfaces  
**Goal:** Extend coverage to curved and compound surfaces, improve uniformity, harden for 3D printing

---

## Known UX Deficiencies

### Face selection is imprecise and context-unaware

The flood-fill click-to-select works well on large, clearly distinct flat panels, but breaks
down in several common scenarios:

1. **Edge and boundary faces are misfires.** The 30° normal threshold is relative to the first
   clicked face. Clicking near a fillet or rounded edge selects the transitional faces between
   two flat regions, which then propagates across the entire model. There is no way to know
   what region will be selected until after the click.

2. **No visual preview before clicking.** The user cannot see which region will be selected
   before committing the click. On a complex model with many face orientations, finding the
   right face requires trial and error.

3. **Re-selection after Apply is disorienting.** After Apply completes, the texture panel
   closes and `clearTextureSelection()` removes the highlight overlay. If the user re-opens
   the panel to apply a second texture pass, the geometry has changed (new triangle topology
   from the bump/weave merge), so the flood-fill region will differ from what was originally
   selected. Edges and normals shift, especially near bump attachment points.

4. **Only flood-fill; no paint/brush mode.** There is no way to refine a selection
   (add or remove individual faces). Shift-click accumulates regions but does not support
   subtraction. A misclick anywhere forces a full Clear and restart.

5. **The 30° threshold is a single fixed constant.** Complex models with shallow angles
   between faces (like a chamfered edge at 15°) either over-select (spreading onto the
   chamfer) or under-select (stopping too early) depending on where the seed click lands.
   There is no per-selection threshold control.

6. **No selection undo.** An accidental click that wipes the current selection (non-shift
   click on empty space) cannot be undone.

### Recommended selection improvements (future work)

- **Threshold slider** in the panel (10°–60°, default 30°) so users can tune flood-fill
  sensitivity per model without code changes.
- **Shift-right-click deselect** to remove a region from the current selection, mirroring
  the Shift-click add behaviour.
- **Selection lock**: after Apply, offer to re-open the panel with the *pre-apply* face
  indices still active (stored separately from `selectedFaceIndices`) so a second pass can
  target the same logical region even though the geometry has changed.
- **Hover highlight**: show a temporary colour on the face under the cursor while the panel
  is open, so the user can see the seed face before committing to a click.

---

## Root Cause Analysis: Why Curved Surfaces Fail

### Bumps fail on curves — one global tangent frame

`addHemisphericBumps` builds **one** tangent frame for the entire selection:

```
avgNormal = weighted average of all selected face normals
uAxis = perpendicular to avgNormal
vAxis = uAxis × avgNormal
```

A flat 2D grid is then cast in (uAxis, vAxis) space and projected onto the mesh.  
On flat surfaces this is exact. On curved surfaces the average normal points "between" all the
face normals. Grid points that fall near faces whose normal deviates significantly from
`avgNormal` project far above or below those faces, fail the barycentric containment test,
and leave those areas unbumped.

**Concrete example:** The outer cylindrical wall of MeshRing1 has faces pointing radially outward
at 360° of angles. Their average normal is undefined (they cancel). The single tangent frame
can only cover the hemisphere of faces closest to one arbitrary direction, leaving the far
side of the ring bare.

### Mesh weave fails on curves — world-space XZ sampling

`meshValue(v.x, v.z, cellSize, strandWidth)` indexes the stripe pattern using **world** x and z
coordinates. On a horizontal face this is consistent. On a tilted or vertical face:
- The stripe spacing compresses or expands with the cosine of the surface tilt
- A vertical wall (normal pointing in X) produces stripes that run vertically in 3D space
  but may span the face at inconsistent projected widths
- A curved surface gets stripes whose 3D pitch varies continuously across the surface

---

## Upgrade Phases

### Phase 1 — Normal-Cluster Bumps (Medium difficulty, high impact)

**Target:** Flat-but-multi-oriented surfaces (baseplate edges, chamfers, anything with distinct
flat regions at different angles).

**Approach:** Before building the tangent frame, partition `selectedFaceIndices` into
**normal-similarity clusters**. Each cluster's faces share approximately the same normal
direction (e.g. top face, front wall, left wall become three clusters). Run the existing
bump placement algorithm independently per cluster.

```
clusters = kmeans_or_greedy_normal_clustering(selectedFaceIndices, angleThreshold=20°)
for each cluster:
    clusterAvgNormal = weighted average of cluster face normals
    build uAxis, vAxis from clusterAvgNormal
    run grid → project → barycentric test on only cluster's faces
    add bump centers to global list
```

**Why this helps:** Each flat region gets its own frame, so coverage is exact for all
distinct flat panels. The ring's top surface, outer cylinder wall, and inner cylinder wall
each become their own cluster.

**Limitations:** Still fails on continuously curving surfaces (e.g. a sphere, a fillet, the
ring's curved cross-section). Clusters with too few faces produce sparse coverage near
cluster boundaries.

**Effort:** ~1–2 days. Greedy clustering by flood-fill with tighter normal threshold
(20° rather than 30°) reuses existing `buildFaceAdjacency`.

---

### Phase 2 — Surface-Walking Bump Placement (High difficulty, high impact)

**Target:** Continuously curved surfaces — cylinders, fillets, spheres, organic shapes.

**Approach:** Abandon the 2D projected grid entirely. Instead, walk the mesh surface using
geodesic distances to place bumps at consistent surface spacing.

```
Algorithm (Poisson disk on mesh):
1. Place first bump at any seed face centroid
2. Maintain priority queue sorted by surface distance from nearest placed bump
3. For each candidate face centroid:
   a. If min geodesic distance to any existing bump >= spacing → place new bump
   b. Normal = that face's normal
4. Build adjacency-weighted BFS to approximate geodesic distance (graph distance)
```

**Why this helps:** Bump spacing is measured along the actual surface, not projected in a plane.
Coverage is independent of surface curvature. Works on cylinders, spheres, and free-form
surfaces.

**Limitations:** Graph geodesic (shortest path on mesh edges) is an approximation of true
geodesic distance; on coarse meshes the approximation degrades. Performance: Dijkstra on
21K faces is manageable (~50ms) but 100K+ faces may be slow.

**Effort:** ~3–4 days. Dijkstra/BFS on the face adjacency graph; the existing adjacency map
can be reused.

---

### Phase 3 — Surface-Parameterized Mesh Weave (High difficulty, medium impact)

**Target:** Weave stripes that follow the surface rather than world XZ axes.

**Approach:** Replace `meshValue(v.x, v.z, ...)` with a surface-intrinsic coordinate:

```
For each selected face:
    Build local frame: uAxis_face, vAxis_face from face normal (same per-face frame as bumps)
    u_local = v · uAxis_face  (project vertex onto face's u-axis)
    v_local = v · vAxis_face
    displacement = meshValue(u_local, v_local, cellSize, strandWidth)
```

This makes the weave pattern align with the local face orientation rather than world space.

**Limitation:** Adjacent faces may have discontinuous UV coordinates, causing stripe
misalignment at face boundaries. Full continuity requires solving a global parameterization
problem (conformal mapping), which is significantly more complex. For typical use cases
(texturing a single flat-ish region) per-face UV is sufficient.

**Effort:** ~1 day (simple change, the per-face UV calculation already exists in bumps code).

---

### Phase 4 — Geometry Validation and Repair (Medium difficulty, required for 3D printing)

**Target:** Ensure all exported geometry is valid — no degenerate triangles, no zero-area faces,
no T-junctions introduced at bump/base boundaries.

**Known issues with current implementation:**
- Bump hemispheres are merged via Float32Array concatenation, leaving the base mesh geometry
  open at each bump site (no boolean subtraction or welding). This creates T-junctions and
  overlapping surfaces at the base of each bump.
- Degenerate triangles can form near bump edges when the projection clips a large triangle.

**Approach:**
1. After merge, run a degenerate-triangle filter: remove faces with area < 1e-8 mm²
2. Report to user if T-junction count exceeds threshold (informational, not blocking)
3. Long-term: implement boolean trim (remove base mesh triangles covered by bump footprints)

**Effort:** ~1 day for validation filter; full boolean trim is a major undertaking (weeks).

---

### Phase 5 — UX and Performance (Low difficulty, polish)

- **Live preview**: Display bump centers as points before applying (immediate feedback,
  no mesh rebuild). Use `THREE.Points` with the list of `bumpCenters`.
- **Bump count estimate**: Show predicted bump count in the panel before Apply is clicked.
- **Density control**: Add a "coverage density" percentage slider that scales the effective
  `spacing` parameter.
- **Progress feedback**: For large meshes, show progress (bump N of M) during apply.
- **Cancel**: Allow cancelling a slow apply operation (requires yielding with setTimeout).

---

## Priority and Timeline Estimate

| Phase | Impact on curved surfaces | Difficulty | Est. Effort |
|-------|--------------------------|------------|-------------|
| 1: Normal-cluster bumps | High (multi-flat bodies) | Medium | 1–2 days |
| 3: Per-face UV weave | Medium (removes stripe skew) | Low | 1 day |
| 4: Geometry validation | Required for printing | Medium | 1–2 days |
| 2: Surface-walking bumps | High (true curves) | High | 3–5 days |
| 5: UX polish | Low (feels better) | Low | 1 day |

**Recommended sequence:** Phase 3 first (quick win, fixes weave on tilted faces), then Phase 1
(cluster bumps, handles the majority of real engineering models), then Phase 4 (print safety),
then Phase 2 if curved-surface fidelity becomes a hard requirement.

---

## What Will Remain Hard

- **Closed curved surfaces** (full cylinder or sphere selected): Phase 2 handles placement but
  bump density still varies with surface curvature unless geodesic Poisson disk is used.
- **Very coarse meshes**: Models with large triangles (>5× bump spacing) leave large gaps between
  bumps regardless of algorithm. User should subdivide the base mesh first.
- **Boolean subtraction at bump bases**: Full watertight geometry at bump attachment points
  requires mesh boolean operations (OpenCASCADE or libigl level of complexity).
- **Weave on developable-only surfaces**: True surface parameterization with zero distortion
  is only achievable on developable surfaces (cones, cylinders, planes). Spheres and
  free-form surfaces will always have some stripe distortion.
