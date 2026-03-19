# Phase B Plan — Torus Detection for Fillet Reconstruction

## What Phase A Left Behind

Phase A reconstructed coaxial prismatic parts (cylinders + flat planes) as analytical STEP solids. It works well on parts like MeshRing1 (50mm ring, two cylinders, two cap planes).

The limitation: **fillets** — the rounded transitions between a flat face and a cylinder, or between two flat faces at a corner. Phase A ignores these faces entirely. The result is a STEP solid with analytically perfect cylinders and planes, but with *sharp edges* where filleted edges should be.

For the MeshRing1 test asset, fillet faces account for **~42% of all triangles**. They are not reconstructed. Any part with significant fillets (chamfers, blends, rounds) will have this gap.

---

## What a Fillet Is Geometrically

A fillet is a **partial torus** — a section of the surface you'd get by sweeping a circle of radius `r` (the fillet radius) along a circular path of radius `R` (the spine, which lies at the junction of the two adjacent surfaces).

A torus is defined by:
- **Center** `C` — the centre of the ring
- **Axis** `A` — the axis of rotational symmetry (normal to the ring plane)
- **Major radius** `R` — distance from the axis to the centre of the tube
- **Minor radius** `r` — radius of the tube cross-section

For a fillet connecting a cylinder (outer radius `R_cyl`) to a flat cap plane:
- The fillet torus axis is the same as the cylinder axis
- `R = R_cyl - r` (inner fillet) or `R = R_cyl + r` (outer fillet)
- The torus is coaxial with the cylinder

This coaxiality is the key insight: for prismatic parts (Phase B target), fillet tori share the same axis as the adjacent cylinders and planes. This dramatically simplifies detection.

---

## Step 1 — Torus Face Candidates

Phase A already classifies all faces into three groups:

```
|nz| < 0.30  →  cylinder candidates  (horiz normals)
|nz| > 0.85  →  plane candidates     (vert normals)
remainder    →  fillet/transition faces  ← Phase B works on these
```

The fillet candidates have normals at intermediate angles — neither clearly horizontal nor vertical. On a torus, the normal direction rotates continuously from the adjacent plane's direction to the adjacent cylinder's direction as you travel along the toroidal surface.

For Phase B, we run RANSAC on these remaining faces to fit tori.

---

## Step 2 — Torus RANSAC

`pyransac3d` does not include a torus primitive. We need to implement one.

**Minimum points to define a torus:** 6 (same as a cylinder — centre, axis, major radius, minor radius, plus orientation). In practice RANSAC needs more samples for stability.

**Fitting a torus to a point cloud:**

For points on the surface of a torus with axis A through centre C:
1. Project each point onto the plane perpendicular to A through C → get 2D position in the ring plane
2. The distance from C in this 2D plane is `R ± r·sin(θ)`, where θ is the elevation angle
3. From the face normal: the normal on a torus at point P is:
   ```
   foot = C + R * normalize(P_projected - C)   ← nearest point on spine circle
   N = normalize(P - foot)
   ```
4. So: `foot = P - r * N` — the foot of the normal points to the spine circle

This gives a clean fitting strategy:
```python
foot = face_center - minor_radius * face_normal
# foot should lie on a circle of radius R in the plane perpendicular to axis A
# → fit a circle to the set of foot points
```

Circle fitting to the foot points gives C, A (as the circle's plane normal), and R. Then `r` is the mean distance from each face centre to its corresponding foot point.

For iterative RANSAC:
1. Sample 6 face centres + normals
2. Compute foot points: `foot_i = centre_i - r_guess * normal_i`
3. Fit a circle to the foot points (3-point circle → generalise with least squares)
4. Count inliers: faces whose foot point lies within tolerance of the fitted circle
5. Keep the best fit, mark inliers as used, repeat

---

## Step 3 — Coaxiality Constraint

As with cylinders in Phase A, we apply a coaxiality constraint: if the detected torus axis is not aligned (within ~11°) with the body cylinder's axis, reject it.

For prismatic parts, all tori share the same axis as the cylinders and planes. This constraint eliminates false positives from noisy RANSAC fits on the fillet face cluster boundaries.

Additionally, we can pre-constrain the axis: since we already know the body axis from Phase A, we can fix the torus axis and only solve for C, R, r. This reduces the RANSAC problem from 4 unknowns to 2 (R and r), making it far more stable.

---

## Step 4 — Trim Curve Computation

This is the **hardest part of Phase B**. A STEP solid is a B-rep (Boundary Representation): every face must be bounded by edges, and every edge must be the exact intersection of two adjacent surfaces.

For the torus-to-cylinder transition, the trim curve is a **3D circle** — the intersection of the torus surface and the cylinder surface. Mathematically:
- Torus: `|sqrt(x²+y²) - R|² + z² = r²`
- Cylinder: `x² + y² = R_cyl²`
- Intersection: a circle of radius `R_cyl` at height `z = ±sqrt(r² - (R_cyl - R)²)`

For the torus-to-plane transition, the trim curve is also a circle (the intersection of a torus and a horizontal plane).

In OpenCASCADE (which FreeCAD uses), the correct way to compute this is:

```python
from OCC.Core.BRepAlgoAPI import BRepAlgoAPI_Section
section = BRepAlgoAPI_Section(torus_face, plane_face)
section.Build()
trim_wire = section.Shape()  # a Wire containing the intersection curve
```

`BRepAlgoAPI_Section` computes the exact intersection curve between two B-rep shapes and returns it as a wire (a chain of edges with underlying curve geometry). This is the same operation a CAD kernel performs internally when it builds a filleted solid.

Alternatively (simpler but less robust): construct the trim circle analytically from the known parameters and use `Part.Edge(Part.Circle(gp_Ax1(centre, axis), radius))` to build it directly.

---

## Step 5 — B-rep Assembly

Once the trim curves are known, the solid is assembled as a proper B-rep rather than CSG:

1. For each analytical surface (cylinder, plane, torus), create a `BRep_Builder` face bounded by its trim curves
2. Assemble faces into a shell using `BRep_Builder.Add(shell, face)`
3. Create a solid from the shell: `BRep_Builder.MakeSolid(shell)`
4. Validate with `BRepCheck_Analyzer`

This produces a STEP file where every face has:
- An exact analytical surface definition (`CYLINDRICAL_SURFACE`, `PLANE`, or `TOROIDAL_SURFACE`)
- Exact trim curves at every edge (circles, lines)
- Correct topological connectivity (each edge shared by exactly two faces)

Onshape treats this as a fully parametric solid with clean, selectable faces and edges.

---

## What Phase B Would Add to the MeshRing1 Output

Currently (Phase A):
- 4 faces: outer cylinder, inner cylinder, top plane, bottom plane
- 0 fillet faces — the sharp edges where fillet regions were

After Phase B:
- 4 original faces (same)
- 4 fillet torus faces: outer-top, outer-bottom, inner-top, inner-bottom
- 8 trim curve edges connecting each torus to its adjacent plane and cylinder
- Total: 8 faces, 16 meaningful edges — a complete B-rep with no sharp artefacts

---

## Implementation Complexity

| Component | Difficulty | Notes |
|-----------|-----------|-------|
| Torus RANSAC (foot-circle method) | Medium | ~100 lines Python; needs circle-fitting utility |
| Coaxiality constraint reuse | Easy | Same logic as Phase A cylinder check |
| Trim curve (analytical) | Medium | Computable directly from known parameters |
| Trim curve (OCC intersection) | Hard | BRepAlgoAPI_Section; requires proper shape preparation |
| B-rep shell assembly | Hard | Must satisfy topological consistency rules |
| CSG fallback (no trim curves) | Easy | `Part.makeTorus()` + booleans, same as Phase A cylinders |

**Recommended starting point:** implement the torus RANSAC and fit the toroids, then use **CSG** (`Part.makeTorus().cut(...)`) as a first-pass output instead of proper B-rep assembly. This gives smooth fillet faces in Onshape without needing to solve the trim curve topology problem. Full B-rep assembly (with correct edge topology) is a separate refinement step.

---

## Coverage Targets After Phase B

For MeshRing1 (currently 57.9% coverage in Phase A):
- Fillet faces are ~42% of the mesh
- Phase B should bring coverage to ~95%+ for coaxial ring/boss parts

For Station 3 Baseplate (currently falls back to triangulated):
- 61.5% cylinder candidates + 17.9% plane candidates + 20.6% fillets
- Phase A should achieve ~79% coverage (enough to attempt CSG)
- Phase B would bring it to ~99%

The baseline test for Phase B will be: load MeshRing1, export parametric STEP, confirm the output contains `TOROIDAL_SURFACE` entities in addition to the existing `CYLINDRICAL_SURFACE` entities.
