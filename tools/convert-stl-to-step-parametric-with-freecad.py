"""
STL → parametric STEP conversion using normal-guided RANSAC surface detection.

Runs under FreeCAD's Python interpreter (FreeCADCmd), which bundles OpenCASCADE.
Depends: trimesh, pyransac3d, numpy  (pip-installed into FreeCAD's Python)

Pipeline
--------
1. Load STL via trimesh; extract face centres and face normals.
2. Pre-filter by normal direction before running RANSAC — this prevents flat-ish
   faces near fillet edges from polluting cylinder detection:
     horiz  (|nz| < HORIZ_THRESHOLD)  → cylinder candidates
     vert   (|nz| > VERT_THRESHOLD)   → plane candidates
     other                            → fillet / transition faces (left as-is)
3. Iterative RANSAC on the horiz subset  → planes are axis-aligned → cylinders.
4. Iterative RANSAC on the vert subset  → find flat cap planes.
5. Classify each cylinder as OUTER (convex, body) or INNER (concave, hole) by
   testing whether face normals point away from or toward the cylinder axis.
6. Require all cylinders to be approximately coaxial; if they are not, fall back.
7. Build a Part solid via CSG:
     main_body = largest outer cylinder (trimmed to cap-plane height bounds)
     subtract each inner cylinder       (extended ±0.5 mm for clean cut-through)
8. If CSG fails or coverage is too low, fall back to a triangulated-face STEP
   (same quality as convert-stl-to-step-with-freecad.py).
9. Export STEP AP214.

Outputs to stdout: the output path on success.
Outputs to stderr + exits 1: descriptive error message on failure.
"""

import os
import sys
import math
import numpy as np


# ── CLI ──────────────────────────────────────────────────────────────────────

def fail(msg):
    print(msg, file=sys.stderr)
    sys.exit(1)


if len(sys.argv) != 3:
    fail(
        "Usage: FreeCADCmd convert-stl-to-step-parametric-with-freecad.py "
        "<input.stl> <output.step>"
    )

input_path  = os.path.abspath(sys.argv[1])
output_path = os.path.abspath(sys.argv[2])

if not os.path.exists(input_path):
    fail(f"Input file does not exist: {input_path}")


# ── Optional dependencies ─────────────────────────────────────────────────────

try:
    import trimesh
    import pyransac3d as pyrsc
except ImportError as exc:
    fail(
        f"Required packages not found: {exc}. "
        "Install into FreeCAD's Python: "
        "\"C:/Program Files/FreeCAD 1.0/bin/python.exe\" -m pip install trimesh pyransac3d"
    )

try:
    import FreeCAD
    import Mesh as FcMesh
    import Part
except ImportError as exc:
    fail(f"FreeCAD modules unavailable: {exc}")


# ── Tunable parameters ────────────────────────────────────────────────────────

# Normal-direction pre-filtering
HORIZ_THRESHOLD = 0.30   # |nz| < this → cylinder candidate face
VERT_THRESHOLD  = 0.85   # |nz| > this → plane candidate face

# RANSAC
RANSAC_DIST_THRESHOLD_CYL   = 0.15  # mm – point-to-cylinder-surface tolerance
RANSAC_DIST_THRESHOLD_PLANE = 0.15  # mm – point-to-plane tolerance
RANSAC_ITERATIONS           = 3000
MIN_INLIER_ABS              = 30    # ignore primitives with fewer inliers

# Coverage threshold to attempt CSG reconstruction
MIN_COVERAGE_FOR_PARAMETRIC = 0.50

# Fallback sewing tolerance
FALLBACK_STITCH_TOL = 0.1   # mm

# Coaxiality tolerance (dot product between cylinder axis directions)
COAXIAL_DOT_THRESHOLD = 0.98  # axes within ~11.5° are considered coaxial

# Height margin when cutting a hole cylinder (ensures full cut-through)
HOLE_CUT_MARGIN = 0.5  # mm


# ── Load mesh ─────────────────────────────────────────────────────────────────

try:
    mesh = trimesh.load_mesh(input_path)
except Exception as exc:
    fail(f"trimesh could not load the STL: {exc}")

if not hasattr(mesh, "faces") or len(mesh.faces) == 0:
    fail("The STL file contains no triangles.")

total_faces  = len(mesh.faces)
face_centers = np.array(mesh.triangles_center, dtype=float)   # (N, 3)
face_normals = np.array(mesh.face_normals,     dtype=float)   # (N, 3)

print(f"[parametric] loaded {total_faces} triangles", flush=True)


# ── Normal-guided pre-filtering ───────────────────────────────────────────────

abs_nz     = np.abs(face_normals[:, 2])
horiz_mask = abs_nz < HORIZ_THRESHOLD   # cylinder candidates
vert_mask  = abs_nz > VERT_THRESHOLD    # plane candidates

print(
    f"[parametric] pre-filter: "
    f"{horiz_mask.sum()} horiz (cyl), "
    f"{vert_mask.sum()} vert (plane), "
    f"{(~horiz_mask & ~vert_mask).sum()} fillet/other",
    flush=True
)


# ── RANSAC helpers ────────────────────────────────────────────────────────────

def detect_cylinders(pts, nrm, base_mask, min_abs, thresh, max_iter, total):
    """Iterative RANSAC over horiz faces; returns list of cylinder dicts."""
    results = []
    used    = np.zeros(len(pts), dtype=bool)

    for _ in range(10):
        avail = base_mask & ~used
        if avail.sum() < min_abs:
            break

        cyl = pyrsc.Cylinder()
        try:
            center, axis, radius, inl = cyl.fit(pts[avail], thresh, maxIteration=max_iter)
        except Exception:
            break

        if inl is None or len(inl) < min_abs:
            break

        avail_idx = np.where(avail)[0]
        used[avail_idx[inl]] = True

        axis_n  = np.array(axis,   dtype=float)
        axis_n /= np.linalg.norm(axis_n)
        center_n = np.array(center, dtype=float)

        # Classify inner vs outer from normal orientation relative to radial direction.
        inl_pts = pts[avail_idx[inl]]
        inl_nrm = nrm[avail_idx[inl]]
        t       = np.einsum("ij,j->i", inl_pts - center_n, axis_n)
        foot    = center_n + np.outer(t, axis_n)
        radial  = inl_pts - foot
        r_len   = np.linalg.norm(radial, axis=1, keepdims=True)
        r_len   = np.where(r_len < 1e-9, 1.0, r_len)
        rad_unit = radial / r_len
        dot_avg  = float(np.einsum("ij,ij->i", inl_nrm, rad_unit).mean())
        concave  = dot_avg < 0  # True → hole / interior

        results.append({
            "axis":    axis_n,
            "center":  center_n,
            "radius":  float(radius),
            "inliers": len(inl),
            "concave": concave,
        })
        print(
            f"[parametric]   cyl: r={radius:.2f} mm, "
            f"axis={np.round(axis_n,3)}, "
            f"inliers={len(inl)} ({len(inl)/total:.1%}), "
            f"{'INNER(hole)' if concave else 'OUTER(body)'}",
            flush=True
        )

    return results


def detect_planes(pts, nrm, base_mask, min_abs, thresh, max_iter, total):
    """Iterative RANSAC over vert faces; returns list of plane dicts."""
    results = []
    used    = np.zeros(len(pts), dtype=bool)

    for _ in range(6):
        avail = base_mask & ~used
        if avail.sum() < min_abs:
            break

        plane = pyrsc.Plane()
        eq, inl = plane.fit(pts[avail], thresh, maxIteration=max_iter)

        if inl is None or len(inl) < min_abs:
            break

        avail_idx = np.where(avail)[0]
        used[avail_idx[inl]] = True

        n = np.array(eq[:3], dtype=float)
        n /= np.linalg.norm(n)
        d = float(eq[3])

        results.append({"normal": n, "d": d, "inliers": len(inl)})
        print(
            f"[parametric]   plane: n={np.round(n,3)}, d={d:.3f}, "
            f"inliers={len(inl)} ({len(inl)/total:.1%})",
            flush=True
        )

    return results


# ── Run detection ─────────────────────────────────────────────────────────────

print("[parametric] detecting cylinders …", flush=True)
cylinders = detect_cylinders(
    face_centers, face_normals, horiz_mask,
    MIN_INLIER_ABS, RANSAC_DIST_THRESHOLD_CYL, RANSAC_ITERATIONS, total_faces
)

print("[parametric] detecting planes …", flush=True)
planes = detect_planes(
    face_centers, face_normals, vert_mask,
    MIN_INLIER_ABS, RANSAC_DIST_THRESHOLD_PLANE, RANSAC_ITERATIONS, total_faces
)

cyl_inliers   = sum(c["inliers"] for c in cylinders)
plane_inliers = sum(p["inliers"] for p in planes)
coverage      = (cyl_inliers + plane_inliers) / total_faces
print(
    f"[parametric] coverage={coverage:.1%}  "
    f"({len(cylinders)} cyl, {len(planes)} plane)",
    flush=True
)


# ── CSG solid builder ─────────────────────────────────────────────────────────

def axes_are_coaxial(cyls):
    """Return True if all cylinder axes are within COAXIAL_DOT_THRESHOLD of each other."""
    if len(cyls) <= 1:
        return True
    ref = cyls[0]["axis"]
    for c in cyls[1:]:
        if abs(float(np.dot(ref, c["axis"]))) < COAXIAL_DOT_THRESHOLD:
            return False
    return True


def plane_projection_along_axis(pl, axis, ref_pt):
    """Return signed distance from ref_pt along axis to the plane."""
    # Point on plane: p = -d * n  (valid when n is normalised)
    n   = pl["normal"]
    d   = pl["d"]
    p   = -d * n
    return float(np.dot(p - ref_pt, axis))


def build_parametric_solid(cylinders, planes, face_centers):
    """
    Attempt CSG reconstruction.  Returns a Part.Shape or None on failure.

    Strategy
    --------
    - All cylinders must be coaxial.
    - Largest outer cylinder = main body.
    - Inner cylinders (concave) = holes to subtract.
    - Cap planes aligned to the body axis define the height extent.
    - Fallback height: projection range of ALL face centres on the axis.
    """
    if not cylinders:
        return None

    if not axes_are_coaxial(cylinders):
        print(
            "[parametric] cylinders are not coaxial — skipping parametric build",
            flush=True
        )
        return None

    ext_cyls = [c for c in cylinders if not c["concave"]]
    int_cyls = [c for c in cylinders if c["concave"]]

    if not ext_cyls:
        # All detected as concave — treat the largest as the outer body.
        ext_cyls = [max(cylinders, key=lambda c: c["radius"])]
        int_cyls = [c for c in cylinders if c is not ext_cyls[0]]

    body    = max(ext_cyls, key=lambda c: c["radius"])
    axis    = body["axis"]
    center  = body["center"]

    # Height extent from detected cap planes (preferred) or mesh projection.
    cap_planes = []
    for pl in planes:
        align = abs(float(np.dot(pl["normal"], axis)))
        if align > 0.85:
            cap_planes.append(pl)

    if len(cap_planes) >= 2:
        projs  = [plane_projection_along_axis(pl, axis, center) for pl in cap_planes]
        h_min  = min(projs)
        h_max  = max(projs)
    else:
        # Fall back: project all face centres onto body axis
        t      = np.dot(face_centers - center, axis)
        h_min  = float(t.min())
        h_max  = float(t.max())

    height = h_max - h_min
    if height < 1e-4:
        print("[parametric] degenerate height — aborting CSG", flush=True)
        return None

    base_pt = center + axis * h_min

    # FreeCAD vectors
    def fv(v):
        return FreeCAD.Vector(float(v[0]), float(v[1]), float(v[2]))

    try:
        solid = Part.makeCylinder(body["radius"], height, fv(base_pt), fv(axis))
    except Exception as exc:
        print(f"[parametric] outer cylinder build failed: {exc}", flush=True)
        return None

    # Subtract holes.
    # IMPORTANT: use the body cylinder's axis line (center + axis) for all hole
    # positions.  The RANSAC centre for each hole is just one point on its
    # detected axis; if its X-Y offset differs from the body axis even slightly,
    # the boolean cut only partially overlaps the body and leaves a D-shaped
    # residual planar face (the chord where the two cylinders diverge).
    # Solution: anchor every hole to the body axis by ignoring the hole's raw
    # centre and using the body's already-computed h_min / h_max bounds (±margin).
    for hole in int_cyls:
        hole_h    = height + 2.0 * HOLE_CUT_MARGIN
        hole_base = center + axis * (h_min - HOLE_CUT_MARGIN)

        try:
            hole_solid = Part.makeCylinder(
                hole["radius"], hole_h, fv(hole_base), fv(axis)
            )
            solid = solid.cut(hole_solid)
        except Exception as exc:
            print(f"[parametric] hole subtraction failed: {exc}", flush=True)

    if solid is None or solid.isNull():
        return None

    print(
        f"[parametric] CSG solid: r_outer={body['radius']:.2f} mm, "
        f"height={height:.2f} mm, "
        f"{len(int_cyls)} hole(s)",
        flush=True
    )
    return solid


# ── Fallback: triangulated STEP ───────────────────────────────────────────────

def build_fallback_solid():
    """
    Convert the mesh to a triangulated B-rep STEP.  Same quality as
    convert-stl-to-step-with-freecad.py but without analytical surfaces.
    """
    fc_mesh = FcMesh.Mesh(input_path)
    shape   = Part.Shape()
    shape.makeShapeFromMesh(fc_mesh.Topology, FALLBACK_STITCH_TOL)
    try:
        solid = Part.makeSolid(shape)
        return solid if (solid and not solid.isNull()) else shape
    except Exception:
        return shape


# ── Assemble and export ───────────────────────────────────────────────────────

doc_name = "STL_PARAMETRIC"

try:
    doc = FreeCAD.newDocument(doc_name)

    shape = None
    if coverage >= MIN_COVERAGE_FOR_PARAMETRIC:
        shape = build_parametric_solid(cylinders, planes, face_centers)
        if shape:
            print("[parametric] using analytical solid", flush=True)
        else:
            print("[parametric] CSG build failed — falling back to triangulated", flush=True)
    else:
        print(
            f"[parametric] coverage {coverage:.1%} < {MIN_COVERAGE_FOR_PARAMETRIC:.0%} "
            "— falling back to triangulated",
            flush=True
        )

    if shape is None:
        shape = build_fallback_solid()
        print("[parametric] using triangulated fallback solid", flush=True)

    feature        = doc.addObject("Part::Feature", "Result")
    feature.Shape  = shape
    doc.recompute()

    Part.export([feature], output_path)

    if not os.path.exists(output_path):
        fail("FreeCAD did not write the STEP output.")

    print(output_path, flush=True)

except SystemExit:
    raise
except Exception as exc:
    fail(f"Conversion failed: {exc}")
finally:
    try:
        FreeCAD.closeDocument(doc_name)
    except Exception:
        pass
