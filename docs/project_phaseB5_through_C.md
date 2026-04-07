# Parametric STEP — Phase B.5 through Phase C Plan

## Current State (Post Phase B)

### Implemented Surface Types
| Type | STEP Entity | Detection Method | Phase |
|------|-------------|-----------------|-------|
| Plane | `PLANE` | Normal threshold (|n·axis| > 0.85) | A |
| Cylinder | `CYLINDRICAL_SURFACE` | RANSAC (pyransac3d) | A |
| Torus/Fillet | `TOROIDAL_SURFACE` | Algebraic linear fit, `makeFillet` | B |

### Validated Test Parts
| Part | Vol Ratio | Hausdorff | Coverage |
|------|-----------|-----------|----------|
| MeshRing1.stl | 0.986 | 0.295 mm | 100% (4 TOROIDAL) |
| Station_3_Baseplate | 0.996 | 0.955 mm | 100% (21 CYL) |

### Known Limitations
- **All hole/slot cuts are through-features** — blind holes, counterbores, and partial cylindrical pockets are cut through the full part height
- **Coaxiality constraint** — all cylinders must be within ~11° of the body axis; off-axis cylinders are rejected
- **No sphere detection** — spherical and partial-spherical surfaces fall through to unclaimed faces
- **No depth inference** — cut depth is always `cap_hi - cap_lo + margin`

---

## Phase B.5 — Depth-Aware Cuts & Spheres

Two independent workstreams that share a common theme: correctly handling geometry that isn't a simple through-feature.

### B.5-1 — Blind Hole / Partial Cut Detection

**Problem**: The mold top half (`TestDocs/MeshRing1-mold-top.stl`) has sprue and pin holes that only penetrate ~4mm from the split plane, not through the full 12.87mm height. The converter punches them through, losing 38% of material volume (ratio 0.62, Hausdorff 17.9mm).

**Approach**:
1. After detecting a circular hole cluster, project inlier face centers along the hole axis
2. Compute `depth_min` and `depth_max` from the projection range
3. Compare `depth_span = depth_max - depth_min` against `part_height` along that axis
4. Classification:
   - `depth_span > 0.85 * part_height` → through-hole (current behavior, keep margin extension)
   - `depth_span <= 0.85 * part_height` → blind hole:
     - Set cut height = `depth_span + single-side margin`
     - Place flat bottom cap at the deepest face center projection
     - Anchor cut cylinder from the nearest external face inward
5. Apply same logic to oblong slot cuts (`apply_internal_slot_cuts`): compare slot face Y-range against part height before defaulting to through-cut

**Regression guard**: Baseplate and MeshRing1 slots/holes are genuine through-features (`depth_span / part_height > 0.95` for all). The 0.85 threshold should not reclassify them. Verify by running comparison against both after implementation.

**Test document**: `TestDocs/MeshRing1-mold-top.stl`
**Baseline**: vol ratio 0.62, Hausdorff 17.9mm, 9 CYLINDRICAL_SURFACE
**Success criteria**:
- Mold vol ratio >= 0.90
- Mold Hausdorff < 3.0mm
- MeshRing1 metrics unchanged (vol ratio 0.98-1.02, Hausdorff < 0.5mm)
- Baseplate metrics unchanged (vol ratio 0.99-1.01, Hausdorff < 1.1mm)

### B.5-2 — Sphere & Partial Sphere Detection

**Problem**: `TestDocs/Spheres.stl` consists of multiple simple spheres intersecting one another (81,850 triangles, ~192,000 mm3, extents 75x80x106mm). Current converter has no sphere primitive — these surfaces are entirely unclaimed by Phase A/B detection, producing a triangulated-only output.

**Approach**:
1. **Algebraic sphere fit** on unclaimed faces. The algebraic sphere equation `x2 + y2 + z2 + Dx + Ey + Fz + G = 0` linearizes to a 4-parameter least-squares problem (D, E, F, G). Center = (-D/2, -E/2, -F/2), radius = sqrt(D2/4 + E2/4 + F2/4 - G).
2. **Iterative RANSAC loop** (same pattern as cylinder detection):
   - Sample 4 face centers → fit algebraic sphere → count inliers within distance threshold
   - Consume inliers, repeat for next sphere
   - Distance threshold: ~0.15mm (same as `RANSAC_DIST_THRESHOLD_CYL`)
   - Min inliers: 30 faces
3. **Validation filters**:
   - Radius range: 0.5mm to max_part_dim * 0.8 (spheres can be large)
   - Concavity check: normals should point radially outward (convex) or inward (concave cavity)
   - Residual check: mean distance from fitted surface < threshold
4. **CSG construction**: `Part.makeSphere(radius, center)` for full spheres. For partial spheres (intersected by other geometry), use `Part.makeSphere()` then `.common()` with the current solid to get the intersection region, or build via boolean union/subtraction depending on concavity.
5. **Boolean assembly**: Convex sphere regions → fuse. Concave sphere regions (cavities) → cut.
6. **STEP output**: `SPHERICAL_SURFACE` entities with proper trim curves from the boolean operations.

**Key challenge — intersecting spheres**: When multiple spheres intersect, the intersection curves must be computed via boolean operations. FreeCAD's `BRepAlgoAPI_Fuse` / `BRepAlgoAPI_Cut` handles this natively, producing analytical intersection edges (circles or ellipses on sphere-sphere intersections). The strategy is:
- Detect all spheres first, sort by volume (largest first)
- Build up the solid incrementally: start with the largest sphere, fuse subsequent spheres
- Let OpenCASCADE compute the intersection topology

**Face classification order**: Sphere detection should run **after** cylinder and torus detection but **before** any B-spline fallback. Spherical faces have intermediate normals (not axis-aligned), so they won't be claimed by Phase A plane/cylinder detection. However, sphere RANSAC should only operate on faces unclaimed by Phase A + B to avoid false positives on torus geometry.

**Test document**: `TestDocs/Spheres.stl`
**Baseline**: TBD (current converter produces triangulated-only or cylinder-misfit output)
**Success criteria**:
- All individual spheres detected as `SPHERICAL_SURFACE` entities
- Vol ratio >= 0.95
- Hausdorff < 1.0mm
- MeshRing1 and baseplate metrics unchanged (sphere detection must not claim torus or cylinder faces)

---

## Phase C — Swept and Freeform Surfaces

Phases C-1 through C-3 target geometry not representable by the quadric primitives (plane, cylinder, sphere, torus) implemented in A/B/B.5. These operate on faces still unclaimed after all quadric detection passes.

### C-1 — Elliptic Cylinders

Fit ellipse to unclaimed face centres projected onto best-fit plane (`cv2.fitEllipse` or `scipy.optimize`). Output: `SURFACE_OF_LINEAR_EXTRUSION(ELLIPSE)`.

**Prerequisite**: Sphere detection (B.5-2) must run first, otherwise spherical regions may be misidentified as elliptic cylinders (a sphere's cross-section is a circle/ellipse).

### C-2 — Surfaces of Revolution

Project unclaimed faces onto candidate revolution axis; compute radial profile r(z); fit B-spline curve. Output: `SURFACE_OF_REVOLUTION` with B-spline profile.

**Note**: Spheres and tori are special cases of surfaces of revolution. C-2 should skip faces already claimed by B or B.5 detection. This phase targets revolved profiles that aren't constant-radius (e.g., ogive noses, parabolic dishes).

### C-3 — Free Swept Surfaces

Pipeline: medial axis skeleton -> B-spline spine fit -> Frenet frame slicing -> 2D cross-section extraction -> profile classification. Use named STEP entity when profile matches a known type; otherwise fit `B_SPLINE_SURFACE_WITH_KNOTS`.

**Test document**: `TestDocs/CurvedMinimalPost-Onshape.stl`
**Success criterion**: >= 80% B-spline coverage, imports as smooth solid in Onshape, visual match within 0.05mm.

---

## Implementation Order & Dependencies

```
Phase B.5-1 (blind holes)     Phase B.5-2 (spheres)
         \                       /
          \                     /
     Both independent, can be developed in parallel.
     Both must preserve Phase A+B regression baselines.
                    |
                    v
            Phase C-1 (elliptic cylinders)
                    |
                    v
            Phase C-2 (surfaces of revolution)
                    |
                    v
            Phase C-3 (free swept / B-spline)
```

### Detection Pipeline Order (in converter script)
1. Plane detection (Phase A) — |normal·axis| > 0.85
2. Cylinder RANSAC (Phase A) — |normal·axis| < 0.30, coaxial constraint
3. Torus/fillet detection (Phase B) — intermediate normals, foot-circle method
4. **Sphere RANSAC (Phase B.5-2)** — unclaimed faces, algebraic 4-param fit
5. Hole depth classification (Phase B.5-1) — through vs blind, applied during CSG cut stage
6. Elliptic cylinder (C-1) — unclaimed faces after all quadric detection
7. Surface of revolution (C-2) — unclaimed faces with axial symmetry
8. B-spline fallback (C-3) — remaining unclaimed faces

### Regression Test Matrix
Every phase must pass all prior baselines before merge:

| Test Part | Phase Introduced | Key Metrics |
|-----------|-----------------|-------------|
| MeshRing1.stl | A | vol 0.98-1.02, Hausdorff < 0.5mm, 4 TOROIDAL |
| Station_3_Baseplate | A | vol 0.99-1.01, Hausdorff < 1.1mm, 21 CYL |
| MeshRing1-mold-top.stl | B.5-1 | vol >= 0.90, Hausdorff < 3.0mm |
| Spheres.stl | B.5-2 | all spheres detected, vol >= 0.95, Hausdorff < 1.0mm |
| CurvedMinimalPost-Onshape.stl | C-3 | >= 80% B-spline coverage |

### Dependencies & Risks

**B.5-1 (blind holes)**:
- Low risk to existing parts — only changes cut depth logic, threshold guards protect through-features
- Moderate complexity — need to handle both circular blind holes and oblong blind slots
- No new Python dependencies

**B.5-2 (spheres)**:
- Medium risk — sphere RANSAC on unclaimed faces could false-positive on torus faces if tolerance is too loose
- Mitigation: run after torus detection, only on truly unclaimed faces
- pyransac3d does not have a built-in sphere model; will need algebraic fit or custom RANSAC sampler
- FreeCAD `Part.makeSphere()` is well-tested; boolean assembly is the main complexity

**C-1/C-2/C-3**:
- Higher complexity, each builds on prior
- C-3 requires `geomdl` or equivalent B-spline library — verify FreeCAD Python compatibility
- Trim curve computation (`BRepAlgoAPI_Section`) may produce complex topology on organic shapes
