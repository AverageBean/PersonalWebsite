# 2026-04-09: Phase C-0 — Ring Pocket CSG Assembly

## What Changed

One major feature group in `tools/convert-stl-to-step-parametric-with-freecad.py`: correctly detecting and cutting ring-shaped cavities in mold parts.

### 1. Convex Cylinder Tracking

**Problem**: `detect_circle_holes()` silently discarded all convex cylinders (`if dot_avg >= 0: continue`). The inner post of a ring cavity is a convex cylinder — by ignoring it, the converter couldn't pair inner/outer walls to form an annular cut.

**How it works**:
- Convex cylinders now returned as "posts" instead of being skipped
- Partial-arc clusters (arc < 270°) recorded with centroid positions — these are fragments of the inner ring wall that don't form a full circle in any single DBSCAN cluster
- Function now returns 4 values: `(holes, skip_circles, posts, partial_arcs)`

### 2. Deterministic 2D Algebraic Circle Fit

**Problem**: RANSAC cylinder fitting is non-deterministic — the outer ring radius varied 23.96–25.40mm between runs, causing ring pocket pairing to fail intermittently (when the gap between outer_r and inner_r fell below 0.5mm).

**How it works**:
- 2D algebraic circle fit always runs first on projected face centers (least-squares linearization of x² + y² + Dx + Ey + F = 0)
- This gives a deterministic radius every run (~24.51mm for the mold ring)
- RANSAC still runs for concavity classification (needs 3D normals), but its radius is not preferred

**Key lesson**: When you need both a geometric measurement (radius) and a classification (concave/convex), use the right tool for each — deterministic algebraic fit for measurement, RANSAC with normals for classification. Don't force one method to do both.

### 3. Interior Plane Detection for Cavity Depth

**Problem**: Face-center depth span is unreliable for large features after prior detection passes consume faces. The ring cavity's cylindrical wall faces span 9.38mm of the 12.87mm part height, but the actual cavity is only 2.85mm deep (from the split plane down to the cavity floor).

**How it works**:
- After plane detection, cap-aligned planes (|normal·cap_axis| > 0.85) that lie between part top and bottom are identified as interior planes
- XZ bounding boxes computed for each interior plane to determine which cavity they floor
- For large holes (r ≥ 8mm), `_classify_hole_depth()` uses the nearest interior plane as the floor reference instead of face-center depth
- Small holes (r < 8mm, like pin holes) still use face-center depth — they don't have interior floor planes

**Key lesson**: Don't trust face-center depth statistics for features whose walls have been partially consumed by earlier detection passes. Use detected geometric features (planes) as depth references when available.

### 4. Ring Pocket Pairing via Partial-Arc Clusters

**Problem**: The inner ring wall appears as 9 separate partial-arc clusters (each ~215° arc), not a single full-circle detection. Standard circle detection requires ≥270° arc coverage.

**How it works**:
- After circle detection, all partial-arc cluster centroids are collected
- For each large hole, partial-arc centroids within the hole's XZ footprint are gathered
- A circle is fit to these centroids to estimate the inner ring radius (~23.76mm)
- The ring pocket is paired: outer wall (from full-circle detection) + inner wall (from partial-arc centroid fit)

**Why not just lower the arc threshold?** Lowering to 215° would cause false positives on genuinely partial features. The partial-arc centroids carry enough positional information for the inner radius without needing to classify each one as a circle.

### 5. Torus CSG Cut

**How it works**:
- Ring cavity cut as `Part.makeTorus(R_major, r_tube)` where R_major is the partial-arc centroid radius (inner wall center) and r_tube is half the cut height
- The torus creates a ring-shaped solid that, when subtracted from the block, produces the cavity
- Annular cylinder fallback if the torus boolean operation fails

**Limitation**: A torus has a circular cross-section (tube), but the actual ring cavity has a rounded-rectangular cross-section (flat floor, vertical walls, filleted transitions). This causes the Hausdorff distance to peak at 4.39mm where the circular tube diverges most from the flat cavity floor. However, 92.5% of surface samples are within 0.44mm — the approximation is geometrically close everywhere except the cross-section shape corners.

**Future fix**: Phase C-2 (surfaces of revolution) would allow fitting the actual cross-section profile and revolving it, producing an exact ring cavity shape.

## Sprue Investigation

The test file `MeshRing1-mold-top.stl` has no sprue feature. Mesh analysis confirmed zero faces near center-top that could be sprue geometry. The mold generator code does add sprue channels, but this particular test file was generated without one (or before the sprue feature existed). Non-issue.

## Key Lessons

### RANSAC Radius Is Non-Deterministic — Use Algebraic Fit
When the same measurement needs to be consistent across runs (e.g., for pairing concentric features), don't rely on RANSAC's random sampling. A deterministic algebraic fit gives the same answer every time, even if RANSAC's answer is statistically "better" on any single run. Consistency matters more than precision for feature pairing.

### Partial Features Carry Positional Signal
Nine partial-arc clusters that individually fail circle detection (each <270° arc) collectively encode the inner ring center and radius through their centroid positions. Don't discard partial detections — aggregate their metadata.

### Interior Planes Are Better Depth References Than Face Statistics
When detection passes consume wall faces, depth statistics computed from remaining face centers become unreliable. Detected planes provide exact, stable depth references that aren't affected by which faces earlier passes claimed.

### Torus ≠ Ring Cavity (Cross-Section Matters)
A torus is the simplest ring-shaped solid, but its circular cross-section doesn't match a machined ring pocket's rectangular-with-fillets profile. The volume match is good (1.019) because the circular tube approximates the total material removed, but the shape deviation peaks where the tube curves vs the pocket has flat walls. Proper fix requires revolving the actual cross-section profile.

### 6. Second-Pass Sprue Detection

**Problem**: The sprue channel (r=3mm at X=-24, Z=0) overlaps with the ring cavity wall (r=24mm, passing through X≈-25, Z≈0) in XZ space. BFS clustering (8mm radius) merges sprue faces with ring wall faces into a single cluster. The combined cluster gets the ring's circle fit (r≈24mm), and the sprue is lost.

**Why simple fixes failed**:
- Y-gap splitting the cluster broke ring detection (arc coverage dropped from 318° to 215°, below the 270° threshold)
- Lowering arc threshold caused all ring inner-wall partial arcs to be classified as full circles, breaking ring pocket pairing
- Residual inner-cylinder detection failed because the sprue center lies ON the ring radius (24mm from origin), making sprue faces circle-fit INLIERS, not outliers

**How it works**:
- Second pass runs AFTER main circle detection and ring pocket pairing complete
- Filters to lateral faces (cos_cap < 0.25) above the highest interior plane (cavity floor)
- Uses tighter BFS cluster radius (5mm vs 8mm) — since ring wall faces are below the cavity floor, they're excluded by the Y filter, and the sprue faces cluster independently
- 2D algebraic circle fit on each cluster; accepts r < 5mm with arc ≥ 180°
- Skips any circle already covered by a detected hole/ring (dedup check)
- Detected sprues cut as simple cylindrical through-holes

**Key lesson**: When two features overlap spatially in one projection (XZ) but separate in another dimension (Y), use the separating dimension as a filter rather than trying to split them within the overlapping projection. The Y-height filter above the cavity floor is the key insight — it's a natural boundary in mold geometry where the cavity ends and the mold wall begins.

## Metrics Impact

| Part | Metric | Phase B.5 | Phase C-0 | + Sprue |
|------|--------|-----------|-----------|---------|
| Mold-top | Vol ratio | 0.741 | 1.019 | **1.013** |
| Mold-top | Hausdorff | ~17.9mm | 4.386mm | **2.587mm** |
| MeshRing1 | Vol ratio | 0.984 | 0.987 | 0.978 |
| MeshRing1 | Hausdorff | 0.250mm | 0.228mm | 0.335mm |
| Baseplate | Vol ratio | 0.996 | 0.996 | 0.996 |
| Baseplate | Hausdorff | 0.955mm | 0.955mm | 0.955mm |
| Spheres | Vol ratio | 1.006 | 1.007 | 1.008 |
| Spheres | Hausdorff | — | 3.173mm | 3.281mm |
