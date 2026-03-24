"""
Geometric fidelity comparison: STEP output vs original STL.

Runs under FreeCAD's Python interpreter.

Metrics produced
----------------
1. Volume ratio        : V_step / V_stl  (ideal = 1.000)
2. Bounding-box deltas : per-axis size difference in mm
3. Directed Hausdorff  :
   - STL->STEP (nearest-point on STEP surface for each STL sample)
   - STEP->STL (nearest-point on STL surface for each STEP sample)
   Both give: mean, 95th percentile, max deviation in mm.
4. Deviation histogram : 10 bins from 0 -> max_dev showing where the
   surface error is concentrated.
5. Worst-region report : top 5 XZ positions with highest deviation,
   so the user/developer knows which features are inaccurate.

Exit code 0 on success (even if metrics are poor).
Use --fail-above=N to exit 1 if mean deviation > N mm.

Usage
-----
  python.exe compare-step-to-stl.py <input.stl> <output.step> [--fail-above=N]
"""

import os
import sys
import math
import numpy as np

# ── CLI ───────────────────────────────────────────────────────────────────────

def fail(msg):
    print(msg, file=sys.stderr)
    sys.exit(1)

if len(sys.argv) < 3:
    fail("Usage: compare-step-to-stl.py <input.stl> <output.step> [--fail-above=N]")

stl_path  = os.path.abspath(sys.argv[1])
step_path = os.path.abspath(sys.argv[2])
fail_thr  = None
for a in sys.argv[3:]:
    if a.startswith("--fail-above="):
        fail_thr = float(a.split("=")[1])

if not os.path.exists(stl_path):
    fail(f"STL not found: {stl_path}")
if not os.path.exists(step_path):
    fail(f"STEP not found: {step_path}")

# ── Dependencies ─────────────────────────────────────────────────────────────

try:
    import trimesh
except ImportError:
    fail("trimesh not installed in FreeCAD Python")

try:
    import FreeCAD
    import Part
except ImportError as exc:
    fail(f"FreeCAD modules unavailable: {exc}")

# ── Load STL ─────────────────────────────────────────────────────────────────

print(f"\n[compare] STL  : {os.path.basename(stl_path)}")
print(f"[compare] STEP : {os.path.basename(step_path)}")

try:
    stl_mesh = trimesh.load_mesh(stl_path)
except Exception as exc:
    fail(f"Could not load STL: {exc}")

stl_verts = np.array(stl_mesh.vertices,       dtype=float)
stl_faces = np.array(stl_mesh.faces,          dtype=int)
stl_vol   = float(abs(stl_mesh.volume))
stl_bb    = stl_mesh.bounds   # (2,3): min, max
stl_size  = stl_bb[1] - stl_bb[0]

print(f"\n[compare] STL  volume : {stl_vol:.2f} mm3")
print(f"[compare] STL  bounds : {np.round(stl_bb[0],2)} -> {np.round(stl_bb[1],2)}")
print(f"[compare] STL  size   : {np.round(stl_size,2)} mm")

# ── Load STEP via FreeCAD, convert to mesh ───────────────────────────────────

try:
    doc = FreeCAD.newDocument("CMP")
    step_shape = Part.read(step_path)
    if step_shape.isNull():
        fail("STEP shape is null")

    feature       = doc.addObject("Part::Feature", "Cmp")
    feature.Shape = step_shape
    doc.recompute()

    # Compute volume from STEP solid
    step_vol = float(abs(step_shape.Volume))

    # Tessellate the STEP solid at 0.05 mm linear deflection.
    TESS_DEF = 0.05   # mm
    tess     = step_shape.tessellate(TESS_DEF)
    # tess = (list_of_vertices, list_of_triangles)
    pts_raw = np.array([[v.x, v.y, v.z] for v in tess[0]], dtype=float)
    tri_raw = np.array(tess[1], dtype=int)
    step_tm = trimesh.Trimesh(vertices=pts_raw, faces=tri_raw)
    step_tm.fix_normals()

    FreeCAD.closeDocument("CMP")

except SystemExit:
    raise
except Exception as exc:
    fail(f"STEP load/tessellate failed: {exc}")

step_bb   = step_tm.bounds
step_size = step_bb[1] - step_bb[0]

print(f"\n[compare] STEP volume : {step_vol:.2f} mm3")
print(f"[compare] STEP bounds : {np.round(step_bb[0],2)} -> {np.round(step_bb[1],2)}")
print(f"[compare] STEP size   : {np.round(step_size,2)} mm")

# ── Volume comparison ─────────────────────────────────────────────────────────

vol_ratio = step_vol / stl_vol if stl_vol > 0 else float("inf")
vol_err   = abs(step_vol - stl_vol)
print(f"\n[compare] Volume ratio  : {vol_ratio:.4f}  (STEP/STL, ideal=1.000)")
print(f"[compare] Volume delta  : {vol_err:.2f} mm3  ({abs(vol_ratio-1)*100:.2f}%)")

# ── Bounding-box comparison ────────────────────────────────────────────────────

bb_delta = np.abs(step_size - stl_size)
print(f"\n[compare] BBox size delta: {np.round(bb_delta,3)} mm  (X,Y,Z)")

# ── Surface deviation: STL->STEP ──────────────────────────────────────────────
# Sample face centres from the STL; find nearest point on STEP surface.

N_SAMPLE = 2000   # number of surface points to sample per direction

def sample_surface(tm, n):
    """Uniformly sample n face-centre points (fast, no randomness)."""
    fc = np.array(tm.triangles_center, dtype=float)
    areas = tm.area_faces
    total = areas.sum()
    cum   = np.cumsum(areas) / total
    t     = np.linspace(0, 1, n, endpoint=False) + 0.5 / n
    idx   = np.searchsorted(cum, t)
    idx   = np.clip(idx, 0, len(fc) - 1)
    return fc[idx]

def nearest_dists(query_pts, target_tm):
    """
    For each point in query_pts, return the distance to the nearest
    point on the surface of target_tm.
    Uses a simple BVH query via trimesh's proximity module.
    """
    from trimesh.proximity import closest_point
    _, dists, _ = closest_point(target_tm, query_pts)
    return np.array(dists, dtype=float)

print(f"\n[compare] Sampling {N_SAMPLE} points per surface …", flush=True)

stl_samples  = sample_surface(stl_mesh, N_SAMPLE)
step_samples = sample_surface(step_tm,  N_SAMPLE)

print("[compare] STL->STEP deviation …", flush=True)
d_stl2step = nearest_dists(stl_samples, step_tm)

print("[compare] STEP->STL deviation …", flush=True)
d_step2stl = nearest_dists(step_samples, stl_mesh)

def stats(d, label):
    print(f"\n[compare] {label}")
    print(f"  mean   : {d.mean():.3f} mm")
    print(f"  median : {np.median(d):.3f} mm")
    print(f"  p95    : {np.percentile(d,95):.3f} mm")
    print(f"  max    : {d.max():.3f} mm")
    return float(d.mean()), float(np.percentile(d, 95)), float(d.max())

mean_s2p, p95_s2p, max_s2p = stats(d_stl2step, "STL->STEP (STEP missing STL material)")
mean_p2s, p95_p2s, max_p2s = stats(d_step2stl, "STEP->STL (STEP extra material)")

symm_mean = (mean_s2p + mean_p2s) / 2
symm_max  = max(max_s2p, max_p2s)
print(f"\n[compare] Symmetric mean deviation : {symm_mean:.3f} mm")
print(f"[compare] Hausdorff distance       : {symm_max:.3f} mm")

# ── Histogram ─────────────────────────────────────────────────────────────────

print("\n[compare] Deviation histogram (STL->STEP) :")
all_dev  = np.concatenate([d_stl2step, d_step2stl])
max_bin  = max(all_dev.max(), 0.01)
bins     = np.linspace(0, max_bin, 11)
hist, _  = np.histogram(all_dev, bins=bins)
total    = len(all_dev)
for i in range(len(hist)):
    bar = "#" * int(hist[i] / total * 40)
    pct = hist[i] / total * 100
    print(f"  {bins[i]:5.2f}-{bins[i+1]:5.2f} mm : {bar:<40} {pct:5.1f}%")

# ── Worst-region report ────────────────────────────────────────────────────────

print("\n[compare] Worst deviation regions (STL->STEP, top 5 XZ clusters) :")
# Sort stl samples by deviation, pick top 20%, cluster in XZ, report top 5 centres.
worst_idx  = np.where(d_stl2step > np.percentile(d_stl2step, 80))[0]
worst_pts  = stl_samples[worst_idx]
worst_devs = d_stl2step[worst_idx]

# Simple greedy clustering of worst points in XZ.
cap_dim = int(np.argmin(np.ptp(stl_samples, axis=0)))   # shortest = height axis
la = 0 if cap_dim != 0 else 1
lb = 2 if cap_dim != 2 else 1

remaining  = np.ones(len(worst_pts), dtype=bool)
region_centres = []
while remaining.sum() > 0 and len(region_centres) < 5:
    max_i = np.where(remaining)[0][np.argmax(worst_devs[remaining])]
    seed_a, seed_b = worst_pts[max_i, la], worst_pts[max_i, lb]
    near = remaining & (
        (worst_pts[:, la] - seed_a) ** 2 +
        (worst_pts[:, lb] - seed_b) ** 2 < 10.0 ** 2
    )
    region_mean_dev = float(worst_devs[near].mean())
    region_max_dev  = float(worst_devs[near].max())
    region_a        = float(worst_pts[near, la].mean())
    region_b        = float(worst_pts[near, lb].mean())
    region_centres.append((region_a, region_b, region_mean_dev, region_max_dev, near.sum()))
    remaining[near] = False

ax_names = ["X", "Y", "Z"]
la_n, lb_n = ax_names[la], ax_names[lb]
for i, (a, b, mu, mx, cnt) in enumerate(region_centres):
    print(f"  Region {i+1}: {la_n}={a:+.1f} {lb_n}={b:+.1f}  "
          f"mean={mu:.3f} mm  max={mx:.3f} mm  ({cnt} samples)")

# ── Pass/fail ─────────────────────────────────────────────────────────────────

print(f"\n[compare] SUMMARY")
print(f"  Volume ratio    : {vol_ratio:.4f}")
print(f"  Symm mean dev   : {symm_mean:.3f} mm")
print(f"  Hausdorff dist  : {symm_max:.3f} mm")

issues = []
if abs(vol_ratio - 1.0) > 0.10:
    issues.append(f"volume ratio {vol_ratio:.3f} outside [0.90, 1.10]")
if symm_mean > 1.0:
    issues.append(f"mean deviation {symm_mean:.3f} mm > 1.0 mm")

if issues:
    print("[compare] ISSUES: " + "; ".join(issues))
else:
    print("[compare] All geometry checks PASS")

if fail_thr is not None and symm_mean > fail_thr:
    sys.exit(1)
