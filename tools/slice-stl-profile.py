"""
Slice an STL at multiple heights and report the 2D cross-section profile.
This reveals the true cut depth and geometry at each level.

Run with:
  python.exe slice-stl-profile.py <input.stl>
"""
import sys, os
import numpy as np

try:
    import trimesh
except ImportError:
    print("trimesh required"); sys.exit(1)

path = os.path.abspath(sys.argv[1])
mesh = trimesh.load_mesh(path)

bounds = mesh.bounds
height = bounds[1][1] - bounds[0][1]   # Y is height axis for baseplate

print(f"Part: {os.path.basename(path)}")
print(f"Bounds: X[{bounds[0][0]:.1f},{bounds[1][0]:.1f}] "
      f"Y[{bounds[0][1]:.1f},{bounds[1][1]:.1f}] "
      f"Z[{bounds[0][2]:.1f},{bounds[1][2]:.1f}]")
print(f"Height (Y): {height:.2f} mm")
print()

# Slice at several Y levels
y_levels = [0.5, 2.0, 4.0, 5.0, 6.0, 8.0, 9.0, 10.0, 11.5]

print(f"{'Y':>6}  {'Cross-section description':}")
print("-" * 70)

for y in y_levels:
    try:
        section = mesh.section(plane_origin=[0, y, 0],
                               plane_normal=[0, 1, 0])
        if section is None:
            print(f"{y:6.1f}  (no section)")
            continue

        # Collect all paths in the section
        path2d, _ = section.to_planar()
        entities = path2d.entities
        verts2d  = path2d.vertices   # (N, 2) — X and Z

        if len(verts2d) == 0:
            print(f"{y:6.1f}  (empty)")
            continue

        # Report bounding box and any distinct loops
        x_min, z_min = verts2d.min(axis=0)
        x_max, z_max = verts2d.max(axis=0)
        n_loops = len(entities)

        # Identify loops by their centroid and size
        loop_desc = []
        for ent in entities:
            lv = verts2d[ent.points]
            lx_min, lz_min = lv.min(axis=0)
            lx_max, lz_max = lv.max(axis=0)
            cx, cz = lv.mean(axis=0)
            w, d = lx_max - lx_min, lz_max - lz_min
            loop_desc.append(f"({cx:+.1f},{cz:+.1f}) {w:.1f}x{d:.1f}")

        print(f"{y:6.1f}  {n_loops} loops  X[{x_min:.1f},{x_max:.1f}] Z[{z_min:.1f},{z_max:.1f}]")
        for ld in loop_desc:
            print(f"         loop {ld}")

    except Exception as e:
        print(f"{y:6.1f}  ERROR: {e}")

print()
print("--- Volume analysis ---")
vol = float(abs(mesh.volume))
box_vol = float(np.prod(bounds[1] - bounds[0]))
print(f"Mesh volume : {vol:.1f} mm3")
print(f"Bbox volume : {box_vol:.1f} mm3")
print(f"Fill ratio  : {vol/box_vol:.3f}")
print(f"Removed vol : {box_vol - vol:.1f} mm3")
