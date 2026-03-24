"""
Diagnostic script: analyse a mesh's face geometry to understand what
primitives it contains.

Run with FreeCAD's Python:
    "C:/Program Files/FreeCAD 1.0/bin/python.exe" tools/diagnose-stl-geometry.py <input.stl>
"""

import os
import sys
import numpy as np

if len(sys.argv) < 2:
    print("Usage: python diagnose-stl-geometry.py <input.stl>")
    sys.exit(1)

try:
    import trimesh
except ImportError:
    print("trimesh not available — install into FreeCAD Python first")
    sys.exit(1)

path = os.path.abspath(sys.argv[1])
mesh = trimesh.load_mesh(path)
total = len(mesh.faces)
pts  = np.array(mesh.triangles_center, dtype=float)
nrm  = np.array(mesh.face_normals, dtype=float)

print(f"\nFile  : {os.path.basename(path)}")
print(f"Faces : {total}")
bounds = mesh.bounds
size = bounds[1] - bounds[0]
print(f"Bounds: X [{bounds[0,0]:.2f}, {bounds[1,0]:.2f}]  "
      f"Y [{bounds[0,1]:.2f}, {bounds[1,1]:.2f}]  "
      f"Z [{bounds[0,2]:.2f}, {bounds[1,2]:.2f}]")
print(f"Size  : {size[0]:.2f} x {size[1]:.2f} x {size[2]:.2f} mm")

# -- Normal distribution by principal axis ------------------------------------

print("\n-- Normal alignment by principal axis -------------------------")
THRESH = 0.94  # cos(20°)
axes = {"X": [1,0,0], "Y": [0,1,0], "Z": [0,0,1]}
for name, ax in axes.items():
    av = np.array(ax, dtype=float)
    pos = (nrm @ av > THRESH).sum()
    neg = (nrm @ (-av) > THRESH).sum()
    print(f"  +{name}: {pos:5d} ({pos/total:.1%})   -{name}: {neg:5d} ({neg/total:.1%})")

remainder = total - sum(
    (nrm @ np.array(ax) > THRESH).sum() + (nrm @ -np.array(ax) > THRESH).sum()
    for ax in axes.values()
)
print(f"  Other (diagonal/curved): {remainder} ({remainder/total:.1%})")

# -- Mesh edge analysis for holes ---------------------------------------------

print("\n-- Boundary edges (possible hole openings) ---------------------")
try:
    boundary_edges = trimesh.grouping.group_rows(mesh.edges_sorted, require_count=1)
    boundary_verts = mesh.edges[boundary_edges].reshape(-1)
    boundary_pts   = mesh.vertices[boundary_verts]
    print(f"  Boundary edge count: {len(boundary_edges)}")

    # Cluster boundary edges into loops
    from collections import defaultdict
    adjacency = defaultdict(set)
    for e in mesh.edges[boundary_edges]:
        adjacency[e[0]].add(e[1])
        adjacency[e[1]].add(e[0])

    visited = set()
    loops = []
    for start in adjacency:
        if start in visited:
            continue
        loop = []
        stack = [start]
        while stack:
            v = stack.pop()
            if v in visited:
                continue
            visited.add(v)
            loop.append(v)
            for nb in adjacency[v]:
                if nb not in visited:
                    stack.append(nb)
        if loop:
            loops.append(loop)

    print(f"  Boundary loops found: {len(loops)}")
    for i, loop in enumerate(loops):
        verts = mesh.vertices[loop]
        cx, cy, cz = verts.mean(axis=0)
        span = np.linalg.norm(verts.max(axis=0) - verts.min(axis=0))
        # Estimate circle radius from 2D spread in dominant plane
        # Find the plane of this loop by PCA
        centred = verts - verts.mean(axis=0)
        _, _, vt = np.linalg.svd(centred, full_matrices=False)
        normal = vt[2]   # smallest singular value = normal direction
        in_plane = centred - np.outer(centred @ normal, normal)
        radii = np.linalg.norm(in_plane, axis=1)
        r_mean = radii.mean()
        r_std  = radii.std()
        print(f"  Loop {i+1:2d}: {len(loop):4d} verts, "
              f"center=({cx:.1f},{cy:.1f},{cz:.1f}), "
              f"r_est={r_mean:.2f}±{r_std:.2f} mm, "
              f"normal≈({normal[0]:.2f},{normal[1]:.2f},{normal[2]:.2f})")
except Exception as exc:
    print(f"  Boundary analysis failed: {exc}")

# -- Cylindrical face clusters -------------------------------------------------

print("\n-- Cylindrical face clusters (non-axis-aligned normals) --------")
# Find groups of faces where normals spread in a circle (cylinder signature)
# Project normals onto XZ plane (for Y-up parts) and look at angles
nrm_xz_len = np.sqrt(nrm[:,0]**2 + nrm[:,2]**2)
angles_xz = np.arctan2(nrm[:,2], nrm[:,0]) * 180 / np.pi   # angle in XZ plane

# Sort face centres by Y to find different levels
y_sorted = np.argsort(pts[:,1])
y_vals = pts[y_sorted, 1]
y_gaps = np.diff(y_vals)
y_splits = np.where(y_gaps > 0.3)[0] + 1
y_clusters = np.split(y_sorted, y_splits)
print(f"  Y levels (height slices): {len(y_clusters)}")

# Find candidates for round holes: face groups where normals form a circle
# at consistent X,Z positions
print("\n-- Face centre XZ clusters (potential hole centres) ------------")
# Look at faces whose normals are mostly perpendicular to Y (lateral faces)
lat_mask = np.abs(nrm[:,1]) < 0.3
lat_pts = pts[lat_mask]
lat_nrm = nrm[lat_mask]
print(f"  Lateral faces (|ny|<0.3): {lat_mask.sum()} ({lat_mask.sum()/total:.1%})")

if lat_mask.sum() > 10:
    # For each lateral face, the cylinder axis centre is roughly at:
    # foot = face_centre - r * face_normal (using r=0 as approximation → just face centre)
    # Better: estimate centre of curvature
    # For each face, the "foot" of the normal from the face centre toward the axis is:
    # foot ≈ face_centre for large cylinders, or well-defined for small cylinders

    # Group by angle of normal in XZ plane
    lat_angles = np.arctan2(lat_nrm[:,2], lat_nrm[:,0]) * 180 / np.pi
    lat_pts_xz = lat_pts[:, [0, 2]]

    # Try to find cylinder axes by looking at where face normals point toward
    # For a cylinder, if we shoot a ray from face_centre in the -normal direction,
    # all such rays converge at the cylinder axis.
    # For SMALL radii (r << distance from face), this is easy to detect.

    # Simple approach: histogram of face centre positions in 2D
    # (hole cylinder faces cluster around a ring in XZ)
    print(f"\n  XZ face-centre range: X [{lat_pts[:,0].min():.1f}, {lat_pts[:,0].max():.1f}], "
          f"Z [{lat_pts[:,2].min():.1f}, {lat_pts[:,2].max():.1f}]")

    # Show face count by XZ quadrant
    mx = lat_pts[:,0].mean()
    mz = lat_pts[:,2].mean()
    q = [
        ((lat_pts[:,0]<mx) & (lat_pts[:,2]<mz)).sum(),
        ((lat_pts[:,0]>mx) & (lat_pts[:,2]<mz)).sum(),
        ((lat_pts[:,0]<mx) & (lat_pts[:,2]>mz)).sum(),
        ((lat_pts[:,0]>mx) & (lat_pts[:,2]>mz)).sum(),
    ]
    print(f"  Quadrant counts (XZ): --:{q[0]}, +-:{q[1]}, -+:{q[2]}, ++:{q[3]}")

print()
