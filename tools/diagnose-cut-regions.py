"""
Diagnose the cut features (holes, oblongs) in a flat plate STL.

Clusters curved/lateral faces by XZ proximity, then runs cylinder RANSAC
on each cluster to find radius and axis.  Separates corner fillet clusters
from internal cut clusters.

Run with FreeCAD Python:
    "C:/Program Files/FreeCAD 1.0/bin/python.exe" tools/diagnose-cut-regions.py <input.stl>
"""

import os
import sys
import numpy as np

if len(sys.argv) < 2:
    print("Usage: python diagnose-cut-regions.py <input.stl>")
    sys.exit(1)

try:
    import trimesh
    import pyransac3d as pyrsc
except ImportError as e:
    print(f"Missing dependency: {e}")
    sys.exit(1)

path = os.path.abspath(sys.argv[1])
mesh = trimesh.load_mesh(path)
fc = np.array(mesh.triangles_center, dtype=float)   # (N,3) face centres
fn = np.array(mesh.face_normals,     dtype=float)   # (N,3) face normals
total = len(mesh.faces)

bounds = mesh.bounds
fc_min = bounds[0]
fc_max = bounds[1]
cap_axis_idx = int(np.argmin(fc_max - fc_min))   # shortest dimension = height
print(f"Part bounds: {np.round(fc_min,2)} -> {np.round(fc_max,2)}")
print(f"Cap axis index: {cap_axis_idx} ({'XYZ'[cap_axis_idx]}), "
      f"height = {fc_max[cap_axis_idx]-fc_min[cap_axis_idx]:.2f} mm")

cap_axis = np.zeros(3); cap_axis[cap_axis_idx] = 1.0
la, lb = [i for i in range(3) if i != cap_axis_idx]

# Lateral faces: normals mostly perpendicular to cap axis.
cos_cap = np.abs(fn @ cap_axis)
lat_mask = cos_cap < 0.30

print(f"\nTotal faces: {total}")
print(f"Lateral faces (|n_cap|<0.30): {lat_mask.sum()} ({lat_mask.sum()/total:.1%})")

lat_fc = fc[lat_mask]
lat_fn = fn[lat_mask]

# --- Cluster lateral faces by XZ position using simple distance-based grouping ---
# Use a coarse grid to find face centre clusters.

GRID_MM = 3.0   # cluster radius in mm

print("\n--- Lateral face XZ clusters ---")
remaining = np.ones(lat_mask.sum(), dtype=bool)
clusters = []
while remaining.sum() > 5:
    # Pick the face furthest from known cluster centres (or just the first remaining).
    idx0 = np.where(remaining)[0][0]
    seed = lat_fc[idx0, [la, lb]]
    d2 = (lat_fc[:, la] - seed[0])**2 + (lat_fc[:, lb] - seed[1])**2
    nearby = remaining & (d2 < GRID_MM**2)
    # Expand cluster to include adjacent faces iteratively.
    prev_count = 0
    while nearby.sum() != prev_count:
        prev_count = nearby.sum()
        cluster_centre_a = float(lat_fc[nearby, la].mean())
        cluster_centre_b = float(lat_fc[nearby, lb].mean())
        d2 = (lat_fc[:, la] - cluster_centre_a)**2 + (lat_fc[:, lb] - cluster_centre_b)**2
        nearby = remaining & (d2 < GRID_MM**2)
    clusters.append(np.where(nearby)[0])
    remaining[nearby] = False

# Sort clusters by XZ distance from origin.
clusters.sort(key=lambda c: float(np.linalg.norm(
    np.array([lat_fc[c, la].mean(), lat_fc[c, lb].mean()])
)))

for i, cl in enumerate(clusters):
    cx = float(lat_fc[cl, la].mean())
    cz = float(lat_fc[cl, lb].mean())
    cy_min = float(lat_fc[cl, cap_axis_idx].min())
    cy_max = float(lat_fc[cl, cap_axis_idx].max())
    n_faces = len(cl)
    # Estimate shape: aspect ratio of face centre bounding box in lateral plane.
    a_ext = float(lat_fc[cl, la].max() - lat_fc[cl, la].min())
    b_ext = float(lat_fc[cl, lb].max() - lat_fc[cl, lb].min())
    print(f"  Cluster {i+1:2d}: {n_faces:4d} faces, "
          f"XZ_centre=({cx:+6.1f},{cz:+6.1f}), "
          f"height=[{cy_min:.1f},{cy_max:.1f}], "
          f"bbox=[{a_ext:.1f}x{b_ext:.1f}]")

# --- RANSAC cylinder detection on lateral faces, ignoring corner regions ---
# Corner positions of the bounding box in the lateral plane.
CORNER_R = 15.0   # mm - exclusion radius around part corners
corners_2d = [
    (fc_min[la], fc_min[lb]), (fc_max[la], fc_min[lb]),
    (fc_min[la], fc_max[lb]), (fc_max[la], fc_max[lb]),
]
near_corner = np.zeros(len(fc), dtype=bool)
for ca, cb in corners_2d:
    d2 = (fc[:, la] - ca)**2 + (fc[:, lb] - cb)**2
    near_corner |= (d2 < CORNER_R**2)

cyl_mask = lat_mask & ~near_corner
print(f"\n--- RANSAC cylinders on internal lateral faces "
      f"({cyl_mask.sum()} faces, corners excluded) ---")

pts = fc[cyl_mask]
used_local = np.zeros(len(fc), dtype=bool)

for round_i in range(20):
    avail = cyl_mask & ~used_local
    if avail.sum() < 8:
        break
    cyl = pyrsc.Cylinder()
    try:
        center, axis, radius, inl = cyl.fit(
            fc[avail], 0.15, maxIteration=3000
        )
    except Exception:
        break
    if inl is None or len(inl) < 8:
        break
    avail_idx = np.where(avail)[0]
    used_local[avail_idx[inl]] = True

    axis_n = np.array(axis, dtype=float)
    axis_n /= np.linalg.norm(axis_n)
    center_n = np.array(center, dtype=float)
    r = float(radius)

    # Classify concavity.
    inl_pts = fc[avail_idx[inl]]
    inl_nrm = fn[avail_idx[inl]]
    t = np.einsum('ij,j->i', inl_pts - center_n, axis_n)
    foot = center_n + np.outer(t, axis_n)
    radial = inl_pts - foot
    r_len = np.linalg.norm(radial, axis=1, keepdims=True)
    r_len = np.where(r_len < 1e-9, 1.0, r_len)
    rad_unit = radial / r_len
    dot_avg = float(np.einsum('ij,ij->i', inl_nrm, rad_unit).mean())
    concave = dot_avg < 0

    # Height of inlier faces along axis.
    t_vals = np.einsum('ij,j->i', inl_pts - center_n, axis_n)
    h_min = float(t_vals.min()); h_max = float(t_vals.max())

    ax_aligned = abs(float(np.dot(axis_n, cap_axis)))
    print(f"  Round {round_i+1:2d}: r={r:7.2f} mm, "
          f"center=({center_n[0]:+6.1f},{center_n[1]:+5.1f},{center_n[2]:+6.1f}), "
          f"inliers={len(inl):4d}, "
          f"{'INNER' if concave else 'OUTER'}, "
          f"axis_dot_cap={ax_aligned:.3f}, "
          f"h=[{h_min:.1f},{h_max:.1f}]")

# --- Check for ALL-height lateral face groups (through-features) ---
part_height = fc_max[cap_axis_idx] - fc_min[cap_axis_idx]
print(f"\n--- Height coverage of lateral clusters (part height={part_height:.1f} mm) ---")
for i, cl in enumerate(clusters):
    cy_min = float(lat_fc[cl, cap_axis_idx].min())
    cy_max = float(lat_fc[cl, cap_axis_idx].max())
    coverage = (cy_max - cy_min) / part_height
    print(f"  Cluster {i+1:2d}: [{cy_min:.2f},{cy_max:.2f}] -> {coverage:.0%} of height")
