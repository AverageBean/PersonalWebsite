# Surface Texture — Phase 1 Clusters + Phase 3 Per-Face UV

**Date:** 2026-04-17  
**Commit scope:** Normal-cluster bump placement, per-face UV weave, uniformity improvements (30° threshold + centroid fallback), ASCII STL analysis support

---

## What Changed and Why

### The Problem We Were Solving

The original bump algorithm used a single weighted-average normal across all selected faces to build one flat UV grid. This worked on flat surfaces but failed completely on curved or multi-oriented surfaces:

- On a ring's outer cylinder, face normals point radially in all directions — the average normal is undefined (they cancel). The flat grid only covered the hemisphere of faces closest to one arbitrary direction.
- On the Aloy Focus test part (185 unique normal directions), the single frame pointed nowhere useful, producing almost no bumps across large portions of the surface.

The original weave sampled `meshValue(v.x, v.z, ...)` using world XZ coordinates. On a tilted or vertical face, those world coordinates compress with the cosine of the tilt angle — stripes appeared denser on steep faces and wider on shallow ones.

---

## Phase 1 — Normal-Cluster Bump Placement

### The Idea

Instead of one global UV frame, partition the selected faces into **clusters** — groups of contiguous faces whose normals are within 30° of each other. Each cluster gets its own independent UV frame and grid.

This is exactly what a flat panel, a cylinder arc, or a chamfer face is: a group of faces all pointing in roughly the same direction. Each gets proper coverage from its own frame.

### How Clustering Works

The algorithm uses **greedy BFS** (breadth-first search) on the face adjacency graph:

```
for each unassigned face (seed):
    cluster = []
    queue = [seed]
    while queue has faces:
        f = dequeue()
        if normal(f) · normal(seed) ≥ cos(30°):
            add f to cluster
            enqueue all unassigned selected neighbors of f
```

`faceAdjacency` (a Map of face → Set of adjacent face indices, built by shared edges) was already computed by `initTexturePanel()`. The BFS reuses it.

**Why 30° and not tighter?** The face selection flood-fill itself uses 30° — faces selected in one click are already within 30° of the seed. Clustering at the same angle means a single flat region becomes one cluster. Tighter (20°, our first attempt) created 48 micro-clusters for the Aloy Focus; widening to 30° reduced it to 31 larger clusters with more grid hits each.

### Centroid Fallback (Option B)

Some clusters are too small for the regular grid to hit — their AABB is smaller than one grid cell (`spacing`). Previously these contributed zero bumps, creating visible empty patches.

The fix: after each cluster's grid loop, if no bumps were placed, compute the **area-weighted centroid** of the cluster faces and project it onto the nearest face plane. One bump guaranteed per cluster regardless of size.

```javascript
const priorCount = bumpCenters.length;
// ... grid loop ...
if (bumpCenters.length === priorCount) {
    // area-weighted centroid of cluster → project to nearest face
    bumpCenters.push(projected);
}
```

The area weighting ensures the fallback bump lands on the largest face in the cluster (the most representative position), not just the first face's centroid.

### Results

| Model | Before (single frame) | After (30° clusters + fallback) |
|-------|-----------------------|----------------------------------|
| Aloy Focus (all faces) | ~0 useful bumps | **68 bumps, 31 clusters** |
| MeshRing1 (all faces) | ~20 bumps (near side only) | **85 bumps, 53 clusters** |
| Baseplate (top face) | 254 bumps | **254 bumps** (no regression) |

---

## Phase 3 — Per-Face UV Weave

### The Problem

`meshValue(v.x, v.z, cellSize, strandWidth)` samples the stripe pattern in world XZ space. On a 45° tilted face, the projection of world XZ onto the face surface compresses the pattern — stripes appear ~1.4× denser than on a horizontal face. On a vertical face, stripes run vertically in world space and may appear at any width depending on the face's orientation.

### The Fix

Build a **per-face tangent frame** from the face normal and sample the pattern in face-local UV space:

```javascript
// Per-face frame (same construction as bumps)
const uAxis = new THREE.Vector3(0, 1, 0);
if (Math.abs(normal.dot(uAxis)) > 0.9) uAxis.set(1, 0, 0);  // avoid parallel
uAxis.crossVectors(normal, uAxis).normalize();
const vAxis = new THREE.Vector3().crossVectors(uAxis, normal).normalize();

// Sample in face-local coordinates
const val = meshValue(v.dot(uAxis), v.dot(vAxis), cellSize, strandWidth);
```

The `uAxis` and `vAxis` are threaded as parameters through the recursive `subdivideAndDisplace` function so child triangles inherit the same frame as their parent face.

### Why This Works

`v.dot(uAxis)` projects the vertex onto the face's tangent direction — a coordinate that increases at the same rate as you move along the face surface, regardless of how the face is oriented in the world. The stripe pitch is now measured in surface distance, not world distance.

**Edge case:** When the face normal is nearly parallel to world Y (a nearly-horizontal face), the initial `uAxis = (0,1,0)` would be parallel to the normal, making `crossVectors` undefined. The `if (dot > 0.9)` check switches to world X in that case.

---

## New Test Model: Aloy Focus

`TestDocs/Aloy Focus.stl` (6,560 triangles, 45×6.9×39.8mm) is now the primary texture test model because:
- 185 unique normal directions — maximum stress on any orientation-dependent algorithm
- Contoured, discontinuous surface — representative of real engineering/design parts
- Small enough (6K triangles) that tests run in < 5 seconds

The baseline test for a flat surface (Baseplate) remains as a **regression guard** — any change that reduces the Baseplate's 254 bumps is a regression.

---

## STL Analyzer Fix

`tools/analyze-texture-stl.py` previously only handled binary STL. The Three.js `STLExporter` outputs ASCII format (`{ binary: false }`) by default. Added `_read_ascii_stl` and `_read_binary_stl` dispatch based on the first 5 bytes of the file.

---

## Key Concepts Introduced

**Greedy BFS clustering on a face adjacency graph**  
The face adjacency graph maps each face to the set of faces that share an edge with it (built using shared vertex position keys). BFS on this graph with a normal-similarity filter is a standard region-growing algorithm used in mesh segmentation. We reuse it here for a different purpose: grouping faces into flat patches for UV frame assignment.

**Area-weighted centroid**  
The centroid of a triangle mesh region should weight each face's contribution by its area, not just count faces equally. A large triangle and a tiny sliver should not contribute equal weight. Area = 0.5 × |cross(v1-v0, v2-v0)|.

**Triplanar projection (next step)**  
The per-face UV approach still has one limitation: adjacent faces in different clusters have independent frames, creating a seam. Triplanar projection (planned) eliminates seams by blending three axis-aligned projections weighted by the face normal — no cluster partitioning required. See `docs/TEXTURE_TRIPLANAR_PLAN.md`.

---

## What's Next

Triplanar projection (Step 1 of `TEXTURE_TRIPLANAR_PLAN.md`) replaces both the per-cluster grid and the per-face UV frame with a single seamless formula. It is the last major algorithmic change needed to match the quality of Formlabs Meshy and BumpMesh.
