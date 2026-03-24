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

# Normal-direction pre-filtering (stats only — not used for detection routing)
HORIZ_THRESHOLD = 0.30   # |nz| < this → cylinder candidate face
VERT_THRESHOLD  = 0.85   # |nz| > this → plane candidate face

# Plane detection: minimum cosine between a face normal and the principal axis
# direction for that face to be considered a plane candidate.
# cos(20°) ≈ 0.94.
PLANE_NORMAL_COS_THRESH = 0.94

# Plane flatness validation: after grouping candidate faces by normal direction,
# the face centres must lie in a thin slab.  Curved surfaces (cylinders) whose
# face normals happen to point near a principal axis still fail this check
# because their centres are spread along the arc.
# A cluster spanning more than this value along its own normal is rejected.
# 3 × RANSAC plane tolerance gives comfortable margin for real flat faces.
PLANE_FLATNESS_MAX_SPREAD = 0.45  # mm  (= 3 × RANSAC_DIST_THRESHOLD_PLANE)

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

def detect_cylinders(pts, nrm, base_mask, used, min_abs, thresh, max_iter, total):
    """Iterative RANSAC over candidate faces; updates shared `used` mask in-place."""
    results = []

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


def detect_planes(pts, nrm, base_mask, used, min_abs, thresh, max_iter, total, max_rounds=12):
    """Deterministic axis-aligned plane detection via normal-direction binning.

    For each of the 6 principal directions (±X, ±Y, ±Z):
      1. Bin faces whose normals point within ~20° of that direction.
      2. Project those face centres onto the axis and cluster by offset to
         find distinct parallel planes at different positions.

    This is guaranteed to find small walls that random RANSAC sampling would
    take many trials to hit by chance.  Updates `used` in-place.
    `max_iter` is unused (kept for call-site compatibility).
    """
    results = []
    AXES = [np.array([1., 0., 0.]),
            np.array([0., 1., 0.]),
            np.array([0., 0., 1.])]

    for axis in AXES:
        for sign in (1, -1):
            direction = axis * sign

            # Bin: faces whose normals align with `direction` within ~20°.
            cos_align = nrm @ direction
            bin_mask  = (cos_align > PLANE_NORMAL_COS_THRESH) & base_mask & ~used
            if bin_mask.sum() < min_abs:
                continue

            bin_idx = np.where(bin_mask)[0]
            # Project face centres onto the unsigned axis for 1-D offset clustering.
            offsets = pts[bin_idx] @ axis

            # Sort and split on gaps > 3× the positional threshold.
            order      = np.argsort(offsets)
            sorted_off = offsets[order]
            sorted_idx = bin_idx[order]
            gaps       = np.diff(sorted_off)
            splits     = np.where(gaps > thresh * 3)[0] + 1
            clusters   = np.split(sorted_idx, splits)

            for cluster in clusters:
                # Drop faces already claimed by an earlier plane.
                cluster = cluster[~used[cluster]]
                if len(cluster) < min_abs:
                    continue

                plane_nrm = nrm[cluster].mean(axis=0)
                plane_nrm /= np.linalg.norm(plane_nrm)
                centroid  = pts[cluster].mean(axis=0)

                # Flatness check: face centres on a true plane lie in a thin slab.
                # Cylinder faces whose normals happen to point near a principal axis
                # will have centres spread along an arc, failing this check.
                residuals = np.abs((pts[cluster] - centroid) @ plane_nrm)
                if residuals.max() > PLANE_FLATNESS_MAX_SPREAD:
                    print(
                        f"[parametric]   plane REJECTED (curved): "
                        f"n={np.round(direction,3)}, "
                        f"spread={residuals.max():.3f} mm > {PLANE_FLATNESS_MAX_SPREAD} mm, "
                        f"candidates={len(cluster)}",
                        flush=True,
                    )
                    continue

                d = -float(plane_nrm @ centroid)

                used[cluster] = True
                results.append({
                    "normal":  plane_nrm,
                    "d":       d,
                    "inliers": len(cluster),
                    "indices": cluster.copy(),   # face indices for extent queries
                })
                print(
                    f"[parametric]   plane: n={np.round(plane_nrm, 3)}, "
                    f"d={d:.3f}, inliers={len(cluster)} ({len(cluster)/total:.1%})",
                    flush=True
                )

    return results


# ── Run detection ─────────────────────────────────────────────────────────────
# Planes are detected first across ALL faces using a normal-alignment filter.
# This correctly separates flat surfaces (consistent normals) from curved faces
# that lie on the same geometric plane (normals spread around a circle).
# Cylinder RANSAC then runs only on unclaimed faces.
# The vert/horiz masks are kept for pre-filter stats only.

used = np.zeros(total_faces, dtype=bool)
all_mask = np.ones(total_faces, dtype=bool)

print("[parametric] detecting planes …", flush=True)
planes = detect_planes(
    face_centers, face_normals, all_mask, used,
    MIN_INLIER_ABS, RANSAC_DIST_THRESHOLD_PLANE, RANSAC_ITERATIONS, total_faces
)

# Snapshot used mask after plane detection — needed for corner radius detection later.
used_after_planes = used.copy()

print("[parametric] detecting cylinders …", flush=True)
cylinders = detect_cylinders(
    face_centers, face_normals, ~used, used,
    MIN_INLIER_ABS, RANSAC_DIST_THRESHOLD_CYL, RANSAC_ITERATIONS, total_faces
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


def detect_corner_radius_from_faces(
    face_centers, face_normals, used_after_planes, fc_min, fc_max, cap_axis_idx
):
    """
    Detect corner fillet radius by fitting 2D algebraic circles to unclaimed
    lateral face centres near each box corner.

    Unclaimed lateral faces (not taken by plane detection, normal mostly ⊥ cap axis)
    are the fillet and wall faces left over after plane detection.  At each of the
    four corners of the bounding box the face centres are projected onto the lateral
    plane and an algebraic least-squares circle is fitted.  The median radius across
    all four corners is returned.

    Returns detected radius (float) or None if fitting fails.
    """
    la, lb = [i for i in range(3) if i != cap_axis_idx]

    cap_axis = np.zeros(3)
    cap_axis[cap_axis_idx] = 1.0

    # Lateral faces: not claimed as planes, and normals mostly perpendicular to cap axis.
    cos_cap      = np.abs(face_normals @ cap_axis)
    lateral_mask = ~used_after_planes & (cos_cap < 0.5)

    if lateral_mask.sum() < 30:
        print(
            f"[parametric] corner detect: too few lateral faces ({lateral_mask.sum()})",
            flush=True,
        )
        return None

    pts2d = face_centers[lateral_mask][:, [la, lb]]  # (M, 2) projected to lateral plane

    mid_a = (fc_min[la] + fc_max[la]) / 2.0
    mid_b = (fc_min[lb] + fc_max[lb]) / 2.0
    max_dim = min(fc_max[la] - fc_min[la], fc_max[lb] - fc_min[lb])

    print(
        f"[parametric] corner detect: {lateral_mask.sum()} lateral unclaimed faces, "
        f"box 2D: a=[{fc_min[la]:.1f},{fc_max[la]:.1f}] b=[{fc_min[lb]:.1f},{fc_max[lb]:.1f}], "
        f"mid=({mid_a:.1f},{mid_b:.1f}), max_dim={max_dim:.1f}mm, r_limit={max_dim*0.40:.1f}mm",
        flush=True,
    )

    # For each of the 4 corners, select faces using BOTH:
    #   1. Spatial proximity: face centre within max_dim×0.40 of the corner point.
    #   2. Diagonal normal: 2D lateral normal within 40° of the corner's outward diagonal.
    #
    # The spatial filter eliminates wall faces from the opposite side of the part.
    # The normal filter eliminates straight-wall faces adjacent to the corner (which
    # have normals pointing purely in ±a or ±b, not diagonally).
    lat_nrm = face_normals[lateral_mask][:, [la, lb]]  # (M, 2)
    lat_nrm_len = np.linalg.norm(lat_nrm, axis=1, keepdims=True)
    lat_nrm_len = np.where(lat_nrm_len < 1e-9, 1.0, lat_nrm_len)
    lat_nrm_unit = lat_nrm / lat_nrm_len

    # 4 corner positions in 2D (a, b).
    corners_2d = [
        (fc_min[la], fc_min[lb]),  # (-a, -b)
        (fc_max[la], fc_min[lb]),  # (+a, -b)
        (fc_min[la], fc_max[lb]),  # (-a, +b)
        (fc_max[la], fc_max[lb]),  # (+a, +b)
    ]
    corner_signs = [(-1, -1), (+1, -1), (-1, +1), (+1, +1)]
    search_r = max_dim * 0.40  # generous proximity bound (same as r_limit)
    diag_cos_thresh = np.cos(np.radians(40))  # tight enough to exclude pure-axis wall faces

    radii = []
    for (ca, cb), (sa, sb) in zip(corners_2d, corner_signs):
        dist2 = (pts2d[:, 0] - ca) ** 2 + (pts2d[:, 1] - cb) ** 2
        near_mask = dist2 < search_r ** 2

        diag = np.array([sa, sb], dtype=float) / np.sqrt(2.0)
        cos_diag = lat_nrm_unit @ diag
        diag_mask = cos_diag > diag_cos_thresh

        qmask = near_mask & diag_mask
        pts_c = pts2d[qmask]
        n_pts = int(qmask.sum())
        print(
            f"[parametric]   corner ({sa:+d},{sb:+d}): {n_pts} faces "
            f"(near={near_mask.sum()}, diag={diag_mask.sum()})",
            flush=True,
        )
        if n_pts < 10:
            continue

        # Algebraic circle fit: x²+y² + D·x + E·y + F = 0
        # → linear system A @ [D, E, F]ᵀ = b  where b = -(x²+y²)
        x = pts_c[:, 0]
        y = pts_c[:, 1]
        A = np.column_stack([x, y, np.ones(len(x))])
        b = -(x ** 2 + y ** 2)
        try:
            params, _, _, _ = np.linalg.lstsq(A, b, rcond=None)
        except Exception as exc:
            print(f"[parametric]   corner ({sa:+d},{sb:+d}): lstsq failed: {exc}", flush=True)
            continue

        D, E, F = params
        cx  = -D / 2.0
        cy  = -E / 2.0
        r_sq = cx ** 2 + cy ** 2 - F
        if r_sq <= 0:
            print(f"[parametric]   corner ({sa:+d},{sb:+d}): degenerate fit (r²={r_sq:.3f})", flush=True)
            continue
        r = float(np.sqrt(r_sq))

        print(
            f"[parametric]   corner ({sa:+d},{sb:+d}): r={r:.2f} mm, "
            f"center=({cx:.1f}, {cy:.1f}), limit=[1,{max_dim*0.40:.1f}]mm",
            flush=True,
        )

        # Sanity: radius must be positive, smaller than 40 % of the shorter dimension,
        # and at least 1 mm.
        if r < 1.0 or r > max_dim * 0.40:
            continue

        radii.append(r)

    if not radii:
        print("[parametric] corner detect: no valid circle fits", flush=True)
        return None

    median_r = float(np.median(radii))
    print(
        f"[parametric] corner radius detected: {median_r:.2f} mm ({len(radii)}/4 corners)",
        flush=True,
    )
    return median_r


def detect_box_holes(
    face_centers, face_normals, used_after_planes, cap_axis, cap_axis_idx,
    fc_min, fc_max, corner_r
):
    """
    Detect cylindrical through-holes in a box part using RANSAC with low
    minimum inlier count, restricted to faces that are very perpendicular to
    the cap axis and away from the corner fillet regions.

    Returns a list of dicts with keys: axis, center, radius, inliers.
    """
    la, lb = [i for i in range(3) if i != cap_axis_idx]

    # Only faces that are tightly lateral (hole walls are almost perfectly
    # perpendicular to the cap axis).
    cos_cap = np.abs(face_normals @ cap_axis)
    tight_lateral = ~used_after_planes & (cos_cap < 0.20)

    # Exclude faces near corner fillet regions.
    if corner_r is not None:
        corner_exclude_r = max(corner_r * 3.0, 15.0)
    else:
        corner_exclude_r = 20.0
    corners_2d = [
        (fc_min[la], fc_min[lb]), (fc_max[la], fc_min[lb]),
        (fc_min[la], fc_max[lb]), (fc_max[la], fc_max[lb]),
    ]
    near_corner = np.zeros(len(face_centers), dtype=bool)
    for ca, cb in corners_2d:
        d2 = (face_centers[:, la] - ca) ** 2 + (face_centers[:, lb] - cb) ** 2
        near_corner |= (d2 < corner_exclude_r ** 2)

    hole_mask = tight_lateral & ~near_corner
    n_cands = int(hole_mask.sum())
    print(
        f"[parametric] hole detect: {n_cands} candidate faces "
        f"(lateral & away from corners)",
        flush=True,
    )
    if n_cands < 8:
        return []

    lat_dim = float(min(fc_max[la] - fc_min[la], fc_max[lb] - fc_min[lb]))
    max_hole_r = lat_dim * 0.35

    MIN_HOLE_INLIERS = 8
    MAX_HOLE_ROUNDS  = 20

    used_local = np.zeros(len(face_centers), dtype=bool)
    holes = []

    for _ in range(MAX_HOLE_ROUNDS):
        avail = hole_mask & ~used_local
        if avail.sum() < MIN_HOLE_INLIERS:
            break

        cyl = pyrsc.Cylinder()
        try:
            center, axis, radius, inl = cyl.fit(
                face_centers[avail], RANSAC_DIST_THRESHOLD_CYL,
                maxIteration=RANSAC_ITERATIONS
            )
        except Exception:
            break

        if inl is None or len(inl) < MIN_HOLE_INLIERS:
            break

        avail_idx = np.where(avail)[0]
        used_local[avail_idx[inl]] = True

        axis_n  = np.array(axis, dtype=float)
        axis_n /= np.linalg.norm(axis_n)
        center_n = np.array(center, dtype=float)
        radius_f = float(radius)

        # Only accept: small radius, aligned with cap axis, concave face normals.
        if radius_f < 1.0 or radius_f > max_hole_r:
            print(
                f"[parametric]   hole REJECTED: r={radius_f:.2f} mm "
                f"(limit [1, {max_hole_r:.1f}])",
                flush=True,
            )
            continue
        if abs(float(np.dot(axis_n, cap_axis))) < 0.85:
            print(
                f"[parametric]   hole REJECTED: axis misaligned "
                f"(dot={abs(float(np.dot(axis_n, cap_axis))):.3f})",
                flush=True,
            )
            continue

        inl_pts = face_centers[avail_idx[inl]]
        inl_nrm = face_normals[avail_idx[inl]]
        t       = np.einsum("ij,j->i", inl_pts - center_n, axis_n)
        foot    = center_n + np.outer(t, axis_n)
        radial  = inl_pts - foot
        r_len   = np.linalg.norm(radial, axis=1, keepdims=True)
        r_len   = np.where(r_len < 1e-9, 1.0, r_len)
        rad_unit = radial / r_len
        dot_avg  = float(np.einsum("ij,ij->i", inl_nrm, rad_unit).mean())
        if dot_avg >= 0:  # convex → not a hole
            print(
                f"[parametric]   hole REJECTED: convex (dot_avg={dot_avg:.3f})",
                flush=True,
            )
            continue

        holes.append({
            "axis":    axis_n,
            "center":  center_n,
            "radius":  radius_f,
            "inliers": len(inl),
        })
        print(
            f"[parametric]   hole: r={radius_f:.2f} mm, "
            f"axis={np.round(axis_n, 3)}, inliers={len(inl)}",
            flush=True,
        )

    return holes


SLOT_MIN_WIDTH = 1.0   # mm — minimum plausible slot width
SLOT_MAX_WIDTH = 25.0  # mm — maximum plausible slot width
# Minimum angular coverage (radians) to classify a cylinder cluster as a full hole
# vs. a semicircular oblong end.  270° threshold: full holes span ~360°,
# oblong ends span ~180°.
CIRCLE_MIN_ARC_RAD = np.radians(270)
CIRCLE_CLUSTER_RADIUS = 8.0  # mm — XZ proximity radius for face clustering


def detect_circle_holes(
    face_centers, face_normals, used_after_planes, cap_axis, cap_axis_idx,
    la, lb, fc_min, fc_max
):
    """
    Detect full cylindrical through-holes by clustering unclaimed lateral faces
    in the XZ plane and running RANSAC per cluster.

    Distinguishes full circles (angular coverage > 270°) from semicircular oblong
    ends (coverage ~ 180°) using the spread of face normals around the cylinder axis.

    Returns a list of dicts {center_la, center_lb, radius} plus a list of
    circle_footprints [(center_la, center_lb, radius)] for suppressing
    redundant slot-pair cuts at the same locations.
    """
    # Unclaimed tight-lateral faces (very perpendicular to cap axis, not already a plane).
    cos_cap = np.abs(face_normals @ cap_axis)
    lat_mask = ~used_after_planes & (cos_cap < 0.25)
    n_lat = int(lat_mask.sum())
    print(f"[parametric] circle detect: {n_lat} unclaimed tight-lateral faces", flush=True)
    if n_lat < 20:
        return [], []

    lat_idx = np.where(lat_mask)[0]
    lat_fc  = face_centers[lat_idx]   # (M, 3)
    lat_fn  = face_normals[lat_idx]   # (M, 3)

    # BFS clustering in the XZ lateral plane.
    remaining = np.ones(len(lat_idx), dtype=bool)
    clusters  = []
    while remaining.sum() >= 20:
        seed_i = np.where(remaining)[0][0]
        seed   = np.array([lat_fc[seed_i, la], lat_fc[seed_i, lb]])
        in_cl  = np.zeros(len(lat_idx), dtype=bool)
        in_cl[seed_i] = True
        prev = 0
        while in_cl.sum() != prev:
            prev = in_cl.sum()
            ctr_a = float(lat_fc[in_cl, la].mean())
            ctr_b = float(lat_fc[in_cl, lb].mean())
            d2 = (lat_fc[:, la] - ctr_a)**2 + (lat_fc[:, lb] - ctr_b)**2
            in_cl = remaining & (d2 < CIRCLE_CLUSTER_RADIUS**2)
        cl_mask = in_cl & remaining
        remaining[cl_mask] = False
        if cl_mask.sum() >= 20:
            clusters.append(np.where(cl_mask)[0])

    print(f"[parametric] circle detect: {len(clusters)} face clusters", flush=True)

    holes        = []
    skip_circles = []  # (center_la, center_lb, r) for slot suppression

    for ci, cl in enumerate(clusters):
        cl_pts = lat_fc[cl]   # face centres for this cluster
        cl_nrm = lat_fn[cl]   # face normals for this cluster
        n_cl   = len(cl)

        ctr_a = float(cl_pts[:, la].mean())
        ctr_b = float(cl_pts[:, lb].mean())

        # Angular coverage of face normals in the lateral plane.
        # Project normals onto the two lateral axes.
        nla = cl_nrm[:, la]
        nlb = cl_nrm[:, lb]
        angles = np.arctan2(nlb, nla)
        sorted_a = np.sort(angles)
        gaps = np.diff(sorted_a)
        wrap_gap = float(sorted_a[0] + 2 * np.pi - sorted_a[-1])
        max_gap = float(np.max(np.append(gaps, wrap_gap)))
        arc_coverage = 2 * np.pi - max_gap

        if arc_coverage < CIRCLE_MIN_ARC_RAD:
            print(
                f"[parametric]   cluster {ci+1}: {n_cl} faces, "
                f"({ctr_a:+.1f},{ctr_b:+.1f}), "
                f"arc={np.degrees(arc_coverage):.0f}° < 270° — partial arc (oblong end), skip",
                flush=True,
            )
            continue

        # Run RANSAC on this cluster alone to find cylinder r and axis.
        cyl = pyrsc.Cylinder()
        try:
            center, axis, radius, inl = cyl.fit(
                cl_pts, RANSAC_DIST_THRESHOLD_CYL, maxIteration=RANSAC_ITERATIONS
            )
        except Exception as exc:
            print(f"[parametric]   cluster {ci+1}: RANSAC failed: {exc}", flush=True)
            continue

        if inl is None or len(inl) < 12:
            continue

        axis_n   = np.array(axis,   dtype=float)
        axis_n  /= np.linalg.norm(axis_n)
        center_n = np.array(center, dtype=float)
        r        = float(radius)

        # Must be cap-axis aligned and small enough to be a through-hole.
        max_dim = float(min(fc_max[la] - fc_min[la], fc_max[lb] - fc_min[lb]))
        if abs(float(np.dot(axis_n, cap_axis))) < 0.85:
            print(
                f"[parametric]   cluster {ci+1}: axis misaligned "
                f"(dot={abs(float(np.dot(axis_n, cap_axis))):.2f})",
                flush=True,
            )
            continue
        if r < 0.5 or r > max_dim * 0.40:
            print(
                f"[parametric]   cluster {ci+1}: r={r:.2f} outside [0.5, {max_dim*0.40:.1f}]",
                flush=True,
            )
            continue

        # Concavity check.
        inl_pts = cl_pts[inl]
        inl_nrm = cl_nrm[inl]
        t        = np.einsum("ij,j->i", inl_pts - center_n, axis_n)
        foot     = center_n + np.outer(t, axis_n)
        radial   = inl_pts - foot
        r_len    = np.linalg.norm(radial, axis=1, keepdims=True)
        r_len    = np.where(r_len < 1e-9, 1.0, r_len)
        rad_unit = radial / r_len
        dot_avg  = float(np.einsum("ij,ij->i", inl_nrm, rad_unit).mean())
        if dot_avg >= 0:
            print(
                f"[parametric]   cluster {ci+1}: convex (dot={dot_avg:.2f}), skip",
                flush=True,
            )
            continue

        cx_la = float(center_n[la])
        cx_lb = float(center_n[lb])
        print(
            f"[parametric]   cluster {ci+1}: CIRCLE r={r:.2f} mm, "
            f"center=({cx_la:+.1f},{cx_lb:+.1f}), "
            f"arc={np.degrees(arc_coverage):.0f}°, inliers={len(inl)}",
            flush=True,
        )
        holes.append({"center_la": cx_la, "center_lb": cx_lb, "radius": r})
        skip_circles.append((cx_la, cx_lb, r))

    return holes, skip_circles


def apply_internal_slot_cuts(
    solid, planes, cap_axis_idx, fc_min, fc_max, face_centers, skip_circles=None
):
    """
    Detect and subtract oblong (stadium) slot cuts from internal plane pairs.

    Each matched plane pair (one +axis, one −axis, at positions interior to the
    outer walls) defines an oblong through-cut:
      - Width  = distance between the two wall planes
      - Length = straight-section extent from wall face-centre bounds + two
                 semicircular end caps of radius = width/2
      - Depth  = full part thickness (all cuts are through-features)

    The oblong is cut as a box (straight section) + two cylinders (end caps),
    all through the full height.

    skip_circles: list of (center_la, center_lb, r) for detected circular holes.
    Any plane pair whose slot centre coincides with a known circle is suppressed
    to avoid double-cutting.

    Returns the modified solid.
    """
    if skip_circles is None:
        skip_circles = []

    la, lb = [i for i in range(3) if i != cap_axis_idx]
    cap_hi = float(fc_max[cap_axis_idx])
    cap_lo = float(fc_min[cap_axis_idx])
    cut_h  = cap_hi - cap_lo + 1.0   # full height with 0.5 mm margin each side
    cut_y0 = cap_lo - 0.5            # base of all through-cuts

    cap_axis_vec = np.zeros(3); cap_axis_vec[cap_axis_idx] = 1.0

    def fv(v):
        return FreeCAD.Vector(float(v[0]), float(v[1]), float(v[2]))

    def fv_cap_axis():
        return FreeCAD.Vector(
            float(cap_axis_vec[0]),
            float(cap_axis_vec[1]),
            float(cap_axis_vec[2]),
        )

    n_cuts = 0

    for axis_idx in [la, lb]:
        outer_min = float(fc_min[axis_idx])
        outer_max = float(fc_max[axis_idx])
        wall_tol  = max(2.0, (outer_max - outer_min) * 0.03)
        perp_idx  = lb if axis_idx == la else la

        pos_planes = []
        neg_planes = []

        for p in planes:
            if np.abs(p["normal"][cap_axis_idx]) > 0.85:
                continue
            n_comp = p["normal"][axis_idx]
            if np.abs(n_comp) < 0.85:
                continue
            if p.get("indices") is not None and len(p["indices"]) > 0:
                pos_val = float(face_centers[p["indices"], axis_idx].mean())
            else:
                pt      = -p["d"] * p["normal"]
                pos_val = float(pt[axis_idx])
            if (abs(pos_val - outer_min) < wall_tol or
                    abs(pos_val - outer_max) < wall_tol):
                continue
            entry = {"plane": p, "pos": pos_val}
            if n_comp > 0.85:
                pos_planes.append(entry)
            else:
                neg_planes.append(entry)

        print(
            f"[parametric] slot detect axis={axis_idx}: "
            f"{len(pos_planes)} left-wall planes, {len(neg_planes)} right-wall planes",
            flush=True,
        )

        candidates = []
        for i, pp in enumerate(pos_planes):
            for j, np_ in enumerate(neg_planes):
                width = np_["pos"] - pp["pos"]
                if SLOT_MIN_WIDTH <= width <= SLOT_MAX_WIDTH:
                    candidates.append((width, i, j, pp, np_))
        candidates.sort(key=lambda c: c[0])

        used_pos = set()
        used_neg = set()
        for width, i, j, pp, np_ in candidates:
            if i in used_pos or j in used_neg:
                continue
            used_pos.add(i)
            used_neg.add(j)

            slot_left   = pp["pos"]
            slot_right  = np_["pos"]
            slot_center = (slot_left + slot_right) / 2.0
            r_semi      = width / 2.0

            # Skip if this slot centre corresponds to a detected circle hole.
            skip = False
            for cx_la, cx_lb, cr in skip_circles:
                # Circle is in the lateral plane (la, lb); this slot is in axis_idx.
                # Check: the slot centre in axis_idx is near cx at axis_idx position,
                # AND the slot is small enough to be the circle tessellation.
                circle_ctr_in_axis = cx_la if axis_idx == la else cx_lb
                if (abs(slot_center - circle_ctr_in_axis) < cr * 1.5 and
                        width < cr * 3.0):
                    print(
                        f"[parametric]   slot axis={axis_idx} "
                        f"pos=[{slot_left:.1f},{slot_right:.1f}] suppressed "
                        f"(matches circle at {cx_la:+.1f},{cx_lb:+.1f} r={cr:.2f})",
                        flush=True,
                    )
                    skip = True
                    break
            if skip:
                continue

            # Straight-section extent in the perp direction from face-centre data.
            # Face centres may be non-contiguous (e.g. two T-heads on opposite ends
            # of the same wall pair).  Cluster them by gaps so each separate feature
            # gets its own box + end caps rather than one over-long merged cut.
            all_indices = []
            if pp["plane"].get("indices") is not None:
                all_indices.extend(pp["plane"]["indices"].tolist())
            if np_["plane"].get("indices") is not None:
                all_indices.extend(np_["plane"]["indices"].tolist())

            if all_indices:
                perp_vals   = face_centers[all_indices, perp_idx]
                perp_sorted = np.sort(perp_vals)
                # A gap larger than 2× the slot width signals a new distinct feature.
                gap_thresh  = max(5.0, width * 2.0)
                splits      = np.where(np.diff(perp_sorted) > gap_thresh)[0] + 1
                segments    = np.split(perp_sorted, splits)
                slot_segs   = [(float(s.min()), float(s.max())) for s in segments if len(s) > 0]
            else:
                slot_segs = [(float(fc_min[perp_idx]), float(fc_max[perp_idx]))]

            # Part edge positions — used to decide whether an end cap would
            # incorrectly scallop the part boundary.
            part_lo    = float(fc_min[perp_idx])
            part_hi    = float(fc_max[perp_idx])
            EDGE_MARGIN = 2.0  # mm — skip end cap when within (r_semi + EDGE_MARGIN) of edge

            for seg_min, seg_max in slot_segs:
                # --- Straight rectangular section ---
                box_origin = np.zeros(3)
                box_size   = np.zeros(3)
                box_origin[axis_idx]     = slot_left
                box_size[axis_idx]       = width
                box_origin[perp_idx]     = seg_min
                box_size[perp_idx]       = seg_max - seg_min
                box_origin[cap_axis_idx] = cut_y0
                box_size[cap_axis_idx]   = cut_h

                ok = True
                if np.any(box_size <= 0):
                    ok = False
                else:
                    try:
                        cut_box = Part.makeBox(
                            float(box_size[0]), float(box_size[1]), float(box_size[2]),
                            fv(box_origin),
                        )
                        solid = solid.cut(cut_box)
                    except Exception as exc:
                        print(f"[parametric]   slot box cut failed: {exc}", flush=True)
                        ok = False

                if not ok:
                    continue

                # --- Semicircular end caps (two cylinders, full height) ---
                # Skip if this end of the slot is at the part boundary — the slot
                # opens through the edge and needs no rounded cap there.
                cyl_ok = 0
                for perp_end in (seg_min, seg_max):
                    at_edge = (
                        perp_end < part_lo + r_semi + EDGE_MARGIN or
                        perp_end > part_hi - r_semi - EDGE_MARGIN
                    )
                    if at_edge:
                        print(
                            f"[parametric]   end-cap skipped (at part edge "
                            f"perp={perp_end:.1f}, edge=[{part_lo:.1f},{part_hi:.1f}])",
                            flush=True,
                        )
                        continue
                    cyl_base = np.zeros(3)
                    cyl_base[axis_idx]     = slot_center
                    cyl_base[perp_idx]     = perp_end
                    cyl_base[cap_axis_idx] = cut_y0
                    try:
                        end_cyl = Part.makeCylinder(
                            r_semi, cut_h, fv(cyl_base), fv_cap_axis()
                        )
                        solid = solid.cut(end_cyl)
                        cyl_ok += 1
                    except Exception as exc:
                        print(f"[parametric]   end-cap cut failed: {exc}", flush=True)

                n_cuts += 1
                print(
                    f"[parametric]   oblong cut axis={axis_idx}: "
                    f"walls=[{slot_left:.1f},{slot_right:.1f}] w={width:.1f} mm, "
                    f"straight=[{seg_min:.1f},{seg_max:.1f}], "
                    f"r_semi={r_semi:.2f} mm, end_caps={cyl_ok}",
                    flush=True,
                )

    print(f"[parametric] applied {n_cuts} oblong cut(s)", flush=True)
    return solid


def build_box_solid(ext_cyls, int_cyls, planes, face_centers, face_normals, used_after_planes):
    """
    CSG path for prismatic box parts (rectangular plates, brackets, beams).

    Uses detected planes for precise dimensions; applies corner fillets detected
    by 2D circle fitting of unclaimed lateral face centres; subtracts inner
    cylinders as holes.

    Returns a Part.Shape or None on failure.
    """
    # Determine height axis: the world axis with the most face area in cap planes.
    # Weight by inlier count — a part with many small internal planes would otherwise
    # outvote the two large cap faces if we simply counted planes.
    cap_axis_votes = {0: 0.0, 1: 0.0, 2: 0.0}
    cap_axis_plane_count = {0: 0, 1: 0, 2: 0}
    for p in planes:
        idx = int(np.argmax(np.abs(p["normal"])))
        if np.abs(p["normal"][idx]) > 0.85:
            cap_axis_votes[idx] += p["inliers"]
            cap_axis_plane_count[idx] += 1

    cap_axis_idx = max(cap_axis_votes, key=cap_axis_votes.get)
    if cap_axis_plane_count[cap_axis_idx] < 2:
        print("[parametric] no clear cap axis — box build skipped", flush=True)
        return None

    cap_axis = np.zeros(3)
    cap_axis[cap_axis_idx] = 1.0

    # Precise height from cap plane equations; lateral footprint from face centres.
    cap_positions = []
    for p in planes:
        if np.abs(p["normal"][cap_axis_idx]) > 0.85:
            pt_on_plane = -p["d"] * p["normal"]
            cap_positions.append(float(np.dot(pt_on_plane, cap_axis)))

    if len(cap_positions) < 2:
        print("[parametric] insufficient cap planes for box height", flush=True)
        return None

    fc_min = face_centers.min(axis=0).copy()
    fc_max = face_centers.max(axis=0).copy()
    fc_min[cap_axis_idx] = min(cap_positions)
    fc_max[cap_axis_idx] = max(cap_positions)

    size = fc_max - fc_min
    if np.any(size < 1e-4):
        print("[parametric] degenerate box size — box build skipped", flush=True)
        return None

    def fv(v):
        return FreeCAD.Vector(float(v[0]), float(v[1]), float(v[2]))

    try:
        solid = Part.makeBox(float(size[0]), float(size[1]), float(size[2]), fv(fc_min))
    except Exception as exc:
        print(f"[parametric] box build failed: {exc}", flush=True)
        return None

    print(
        f"[parametric] box: {size[0]:.1f}×{size[1]:.1f}×{size[2]:.1f} mm",
        flush=True,
    )

    # Detect corner fillet radius via 2D circle fitting of unclaimed lateral faces.
    corner_r = detect_corner_radius_from_faces(
        face_centers, face_normals, used_after_planes, fc_min, fc_max, cap_axis_idx
    )

    if corner_r is not None:
        print(f"[parametric] applying corner fillets r={corner_r:.2f} mm …", flush=True)

        fillet_edges = []
        for edge in solid.Edges:
            if len(edge.Vertexes) < 2:
                continue
            v0 = edge.Vertexes[0].Point
            v1 = edge.Vertexes[1].Point
            d = np.array([v1.x - v0.x, v1.y - v0.y, v1.z - v0.z])
            length = float(np.linalg.norm(d))
            if length < 1e-6:
                continue
            if abs(float(np.dot(d / length, cap_axis))) > 0.95:
                fillet_edges.append(edge)

        if fillet_edges:
            try:
                solid = solid.makeFillet(corner_r, fillet_edges)
                print(
                    f"[parametric] corner fillets applied ({len(fillet_edges)} edges)",
                    flush=True,
                )
            except Exception as exc:
                print(
                    f"[parametric] corner fillet failed (continuing without): {exc}",
                    flush=True,
                )

    # Detect full cylindrical through-holes via cluster-then-RANSAC.
    # Must run before slot cuts so circle positions can suppress redundant slot pairs.
    cap_axis_v = np.zeros(3); cap_axis_v[cap_axis_idx] = 1.0
    la, lb = [i for i in range(3) if i != cap_axis_idx]
    circle_holes, skip_circles = detect_circle_holes(
        face_centers, face_normals, used_after_planes,
        cap_axis_v, cap_axis_idx, la, lb, fc_min, fc_max,
    )

    part_h  = float(fc_max[cap_axis_idx] - fc_min[cap_axis_idx])
    cut_y0  = float(fc_min[cap_axis_idx]) - 0.5
    cut_h   = part_h + 1.0

    for ch in circle_holes:
        cyl_base = np.zeros(3)
        cyl_base[la]           = ch["center_la"]
        cyl_base[lb]           = ch["center_lb"]
        cyl_base[cap_axis_idx] = cut_y0
        try:
            cyl_solid = Part.makeCylinder(
                ch["radius"], cut_h, fv(cyl_base), fv(cap_axis_v)
            )
            solid = solid.cut(cyl_solid)
            print(
                f"[parametric] circle hole cut: r={ch['radius']:.2f} mm, "
                f"center=({ch['center_la']:+.1f},{ch['center_lb']:+.1f})",
                flush=True,
            )
        except Exception as exc:
            print(f"[parametric] circle hole cut failed: {exc}", flush=True)

    # Subtract oblong slot cuts from internal plane pairs.
    solid = apply_internal_slot_cuts(
        solid, planes, cap_axis_idx, fc_min, fc_max, face_centers,
        skip_circles=skip_circles,
    )

    if solid is None or solid.isNull():
        return None

    corner_r_str = f"{corner_r:.2f} mm" if corner_r is not None else "none"
    print(
        f"[parametric] box CSG solid: corner_r={corner_r_str}, "
        f"{len(circle_holes)} circle hole(s)",
        flush=True,
    )
    return solid


# Radius above which an outer cylinder is treated as the main body of a
# cylindrical part rather than a corner fillet.
BODY_CYL_MIN_RADIUS = 50  # mm


def build_parametric_solid(cylinders, planes, face_centers, face_normals, used_after_planes):
    """
    Attempt CSG reconstruction.  Returns a Part.Shape or None on failure.

    Routes to build_box_solid for prismatic parts (4+ planes detected) or the
    cylindrical CSG path for coaxial ring/boss parts.
    """
    ext_cyls = [c for c in cylinders if not c["concave"]]
    int_cyls = [c for c in cylinders if c["concave"]]

    # Box path: triggered when 4+ planes detected (cap + vertical walls).
    # Cylindrical parts (rings, bosses) have only 2 cap planes → won't reach this.
    # Corner radius is detected from unclaimed face geometry rather than RANSAC cylinders.
    if len(planes) >= 4:
        solid = build_box_solid(
            ext_cyls, int_cyls, planes, face_centers, face_normals, used_after_planes
        )
        if solid:
            return solid
        print("[parametric] box build failed — trying cylindrical path", flush=True)

    # Cylindrical path: one large outer cylinder = body; inner = holes.
    if not cylinders:
        return None

    if not axes_are_coaxial(cylinders):
        print(
            "[parametric] cylinders are not coaxial — skipping parametric build",
            flush=True
        )
        return None

    if not ext_cyls:
        ext_cyls = [max(cylinders, key=lambda c: c["radius"])]
        int_cyls = [c for c in cylinders if c is not ext_cyls[0]]

    body    = max(ext_cyls, key=lambda c: c["radius"])
    axis    = body["axis"]
    center  = body["center"]

    cap_planes = [pl for pl in planes if abs(float(np.dot(pl["normal"], axis))) > 0.85]

    if len(cap_planes) >= 2:
        projs  = [plane_projection_along_axis(pl, axis, center) for pl in cap_planes]
        h_min  = min(projs)
        h_max  = max(projs)
    else:
        t      = np.dot(face_centers - center, axis)
        h_min  = float(t.min())
        h_max  = float(t.max())

    height = h_max - h_min
    if height < 1e-4:
        print("[parametric] degenerate height — aborting CSG", flush=True)
        return None

    base_pt = center + axis * h_min

    def fv(v):
        return FreeCAD.Vector(float(v[0]), float(v[1]), float(v[2]))

    try:
        solid = Part.makeCylinder(body["radius"], height, fv(base_pt), fv(axis))
    except Exception as exc:
        print(f"[parametric] outer cylinder build failed: {exc}", flush=True)
        return None

    # Subtract holes anchored to the body axis (see original comment for why).
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
        shape = build_parametric_solid(
            cylinders, planes, face_centers, face_normals, used_after_planes
        )
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
