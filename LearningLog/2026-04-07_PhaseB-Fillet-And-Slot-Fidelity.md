# 2026-04-07: Phase B Parametric STEP Fillet & Slot Fidelity

## What Changed

Two targeted fixes to the parametric STEP converter (`tools/convert-stl-to-step-parametric-with-freecad.py`):

### 1. T-Junction End Cap Fix (Baseplate)

**Problem**: Oblong slot cuts at T-junctions (where perpendicular slots cross) were producing flat rectangular ends instead of semicircular (cylindrical) ends. 4 of the baseplate's 12 half-cylinder slot ends were affected.

**How slot cutting works**: The converter detects pairs of internal wall planes, computes the slot width, and cuts a box (straight section) plus two cylinder end caps. At T-junctions where slots intersect, the code extends the box to fill the gap but was *suppressing* the end cap entirely.

**The insight**: Not all T-junctions are the same. A long slot segment (28mm) terminating at a perpendicular slot has a real rounded end. A short fragment (2mm) inside the perpendicular slot's gap is just leftover geometry with no physical rounded end. The discriminator: `seg_length > width`.

**Key code** (line ~1417):
```python
elif treatment == "extend" and seg_length > width:
    # T-junction with a long segment -- place rounded end cap
    pass
```

### 2. Fillet Merge Fix (Ring)

**Problem**: The MeshRing1 output had 10 TOROIDAL_SURFACE entities (visible as "tube-like" edges) instead of the expected 4 clean toroidal surfaces.

**Root cause -- three compounding bugs**:

1. **Radius grouping too granular**: The algebraic torus fit produces slightly different minor radii for top (r=0.52mm) vs bottom (r=0.55mm) fillets. These rounded to different dictionary keys, triggering *separate* `makeFillet` calls.

2. **Edge consumption**: FreeCAD's `makeFillet` transforms the edges it operates on. The first call consumed all 4 circular edges. The second call found no edges and failed.

3. **CSG fallback re-fused everything**: The fallback code `for t2 in tori:` iterated ALL tori (including the already-applied one), creating `Part.makeTorus()` + `.common()` + `.fuse()` operations that produced fragmented topology.

**The fix**: 
- Merge tori with similar minor_r (within 25% tolerance) into a single group
- Compute weighted-average radius by inlier count
- Apply one `makeFillet` call with the merged radius
- Remove the CSG torus fallback entirely (it creates worse artifacts than missing fillets)

## Key Lessons

### Surface Detection is Noisy -- Merge Before Acting
RANSAC and algebraic fitting on mesh face data inherently produces slightly different parameters for geometrically identical features (different face populations, numerical conditioning). Always merge detected features by tolerance before using them for CSG operations. Don't assume matching features will have identical parameters.

### CSG Boolean Operations Fragment Topology
`Part.makeTorus().common(cylinder).fuse(solid)` creates many small surface patches and complex edge topology. FreeCAD's `makeFillet()` produces clean analytical surfaces with proper trim curves. Prefer parametric operations (fillet, chamfer) over raw CSG when the feature type is known.

### Segment Length Distinguishes Real vs Fragment Geometry
When face-centre clustering splits a feature into segments, short segments (shorter than the feature width) at intersection regions are artifacts of the segmentation, not real geometric endpoints. Use the segment-to-feature ratio to decide whether to apply endpoint treatments.

## Metrics Impact

| Metric | Ring Before | Ring After | Baseplate Before | Baseplate After |
|--------|-------------|------------|------------------|-----------------|
| Hausdorff | 1.250 mm | **0.295 mm** | 1.105 mm | **0.955 mm** |
| Volume ratio | 1.0517 | **0.9860** | 0.9993 | 0.9958 |
| Key surfaces | 10 TOROIDAL | **4 TOROIDAL** | 15 CYL | **21 CYL** |
| File size | 21 kB | **12 kB** | -- | 55 kB |
