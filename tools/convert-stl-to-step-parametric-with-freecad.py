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

# ── Phase B: Torus (fillet) detection ────────────────────────────────────────
RANSAC_DIST_THRESHOLD_TORUS = 0.20  # mm – foot-point-to-spine-circle tolerance
TORUS_MIN_INLIERS           = 20    # minimum faces for a valid torus
TORUS_MAX_ROUNDS            = 10    # max RANSAC rounds for tori

# Fillet radius merge tolerance: tori whose minor_r differs by less than this
# fraction are assumed to be the same fillet and merged before applying
# makeFillet.  Prevents multiple makeFillet passes from consuming edges and
# forcing a CSG-fusion fallback that creates topological artifacts.
FILLET_MERGE_REL_TOL        = 0.25  # 25 % relative tolerance on minor_r

# ── Phase B.5: Sphere detection ──────────────────────────────────────────────
RANSAC_DIST_THRESHOLD_SPHERE = 0.20  # mm – point-to-sphere-surface tolerance
SPHERE_MIN_INLIERS           = 30    # minimum faces for a valid sphere
SPHERE_MAX_ROUNDS            = 15    # max RANSAC rounds for spheres

# ── Phase B.5: Blind hole depth inference ────────────────────────────────────
# Ratio of face-centre depth span to part height.  Below this → blind hole.
# Set conservatively low because intersecting slot cuts can remove portions of
# a through-hole's cylindrical wall, reducing the apparent face-centre span
# (e.g. baseplate center hole: 12mm part, faces span Y=4–8 due to crossing
# slots on both sides, giving ratio 0.33 even though it's through).
BLIND_HOLE_DEPTH_RATIO       = 0.25


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
    _cyl_axes = []        # track axes for early-exit on non-cylindrical geometry
    _claimed_indices = []  # track claimed face indices for rollback on early-exit

    for round_i in range(10):
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

        # Early exit: after 3 rounds, check if axes are consistent.  On non-
        # cylindrical geometry (e.g. spheres) RANSAC finds great-circle slices
        # with wildly varying axes — 10 rounds × 3000 iters wastes minutes.
        axis_n_pre = np.array(axis, dtype=float)
        axis_n_pre /= max(np.linalg.norm(axis_n_pre), 1e-9)
        _cyl_axes.append(axis_n_pre)
        if round_i == 2 and len(_cyl_axes) == 3:
            dots = [abs(float(np.dot(_cyl_axes[i], _cyl_axes[j])))
                    for i in range(3) for j in range(i+1, 3)]
            if max(dots) < COAXIAL_DOT_THRESHOLD:
                print(
                    "[parametric]   cyl early-exit: axes divergent after 3 rounds "
                    f"(max dot={max(dots):.3f}), likely non-cylindrical geometry",
                    flush=True,
                )
                # Rollback: un-claim all faces from previous rounds + discard results.
                for idx_arr in _claimed_indices:
                    used[idx_arr] = False
                return []

        avail_idx = np.where(avail)[0]
        claimed = avail_idx[inl]
        used[claimed] = True
        _claimed_indices.append(claimed)

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


# ── Phase B: Torus (fillet) detection ────────────────────────────────────────

def fit_circle_3d(points):
    """Fit a circle to 3D points via algebraic least-squares.

    Projects points onto their best-fit plane (SVD), fits a 2D algebraic circle,
    and lifts the result back to 3D.

    Returns (center_3d, plane_normal, radius) or None on failure.
    """
    if len(points) < 3:
        return None
    centroid = points.mean(axis=0)
    pts_c = points - centroid

    # Best-fit plane via SVD
    _, S, Vt = np.linalg.svd(pts_c, full_matrices=False)
    plane_normal = Vt[2]  # smallest singular value direction = plane normal

    # Build 2D coordinate system in the plane
    u = Vt[0]  # first principal direction
    v = Vt[1]  # second principal direction

    # Project onto 2D
    x = pts_c @ u
    y = pts_c @ v

    # Algebraic circle fit: x² + y² + Dx + Ey + F = 0
    A = np.column_stack([x, y, np.ones(len(x))])
    b = -(x**2 + y**2)
    try:
        params, _, _, _ = np.linalg.lstsq(A, b, rcond=None)
    except Exception:
        return None

    D, E, F = params
    cx_2d = -D / 2.0
    cy_2d = -E / 2.0
    r_sq = cx_2d**2 + cy_2d**2 - F
    if r_sq <= 0:
        return None

    radius = float(np.sqrt(r_sq))
    center_3d = centroid + cx_2d * u + cy_2d * v
    return center_3d, plane_normal, radius


def fit_circle_fixed_axis(points, axis, axis_point):
    """Fit a circle to 3D points with the plane normal constrained to `axis`.

    Projects points onto the plane through `axis_point` perpendicular to `axis`,
    fits a 2D algebraic circle, and returns (center_3d, radius) or None.
    """
    if len(points) < 3:
        return None

    # Project points onto the plane perpendicular to axis
    rel = points - axis_point
    t = rel @ axis  # signed distance along axis
    projected = points - np.outer(t, axis)  # project onto plane

    # Build orthonormal basis in the plane
    # Pick any vector not parallel to axis
    trial = np.array([1., 0., 0.])
    if abs(np.dot(trial, axis)) > 0.9:
        trial = np.array([0., 1., 0.])
    u = trial - np.dot(trial, axis) * axis
    u /= np.linalg.norm(u)
    v = np.cross(axis, u)

    centroid = projected.mean(axis=0)
    pts_c = projected - centroid
    x = pts_c @ u
    y = pts_c @ v

    A = np.column_stack([x, y, np.ones(len(x))])
    b_vec = -(x**2 + y**2)
    try:
        params, _, _, _ = np.linalg.lstsq(A, b_vec, rcond=None)
    except Exception:
        return None

    D, E, F = params
    cx_2d = -D / 2.0
    cy_2d = -E / 2.0
    r_sq = cx_2d**2 + cy_2d**2 - F
    if r_sq <= 0:
        return None

    radius = float(np.sqrt(r_sq))
    center_3d = centroid + cx_2d * u + cy_2d * v
    return center_3d, radius


def detect_tori(face_centers, face_normals, used, body_axis, body_center,
                total, cylinders, planes, thresh=RANSAC_DIST_THRESHOLD_TORUS):
    """Detect toroidal surfaces (fillets) on unclaimed intermediate-normal faces.

    Uses an algebraic linear method with the axis pre-constrained to `body_axis`.
    For a point P on a torus with spine circle center C, axis A, major R, minor r:
      (dist_to_axis - R)² + h² = r²
    Rearranges to: dist² + h² = 2*R*dist + (r² - R²)
    which is LINEAR in R and (r² - R²), solvable via least-squares.

    Clusters fillet faces using known cylinder radii and cap plane heights to
    separate distinct tori (e.g. inner-top, inner-bottom, outer-top, outer-bottom).

    Returns list of dicts: {center, axis, major_r, minor_r, inlier_mask, concave}
    """
    avail = ~used
    if avail.sum() < TORUS_MIN_INLIERS:
        return []

    cos_axis = np.abs(face_normals @ body_axis)
    # Fillet normals transition between axial (~1.0) and radial (~0.0);
    # widen range to capture full fillet sweep.
    fillet_mask = avail & (cos_axis > 0.10) & (cos_axis < 0.90)

    n_cands = int(fillet_mask.sum())
    print(f"[parametric] torus detect: {n_cands} candidate fillet faces", flush=True)
    if n_cands < TORUS_MIN_INLIERS:
        return []

    cand_idx = np.where(fillet_mask)[0]
    cand_pts = face_centers[cand_idx]
    cand_nrm = face_normals[cand_idx]

    # Compute cylindrical coordinates relative to body axis.
    rel = cand_pts - body_center
    h = rel @ body_axis                              # height along axis
    along = np.outer(h, body_axis)
    lateral = rel - along
    rho = np.linalg.norm(lateral, axis=1)             # radial distance from axis

    # Determine clustering boundaries from known geometry.
    # Radial split: midpoint between distinct cylinder radii.
    cyl_radii = sorted(set(round(c["radius"], 1) for c in cylinders))
    if len(cyl_radii) >= 2:
        rho_split = (cyl_radii[-1] + cyl_radii[-2]) / 2.0
    else:
        rho_split = float(np.median(rho))

    # Height split: midpoint between cap planes (or median).
    cap_heights = []
    for pl in planes:
        if abs(float(np.dot(pl["normal"], body_axis))) > 0.85:
            pt = -pl["d"] * pl["normal"]
            cap_heights.append(float(np.dot(pt - body_center, body_axis)))
    if len(cap_heights) >= 2:
        h_split = (min(cap_heights) + max(cap_heights)) / 2.0
    else:
        h_split = float(np.median(h))

    cluster_keys = []
    for rr, hh in zip(rho, h):
        r_label = "outer" if rr >= rho_split else "inner"
        h_label = "top" if hh >= h_split else "bottom"
        cluster_keys.append(f"{r_label}_{h_label}")

    unique_clusters = sorted(set(cluster_keys))
    print(
        f"[parametric] torus clusters: {unique_clusters} "
        f"(rho_split={rho_split:.2f}, h_split={h_split:.2f})",
        flush=True,
    )

    results = []

    for cl_name in unique_clusters:
        cl_mask = np.array([k == cl_name for k in cluster_keys])
        n_cl = int(cl_mask.sum())
        if n_cl < TORUS_MIN_INLIERS:
            continue

        cl_rho = rho[cl_mask]
        cl_h_raw = h[cl_mask]
        cl_local_idx = np.where(cl_mask)[0]

        # For the algebraic fit, h should be measured from the nearest cap plane,
        # not from the body center.  A fillet connects a cylinder to a cap; its
        # torus center sits at the cap plane height.
        if cap_heights:
            if "top" in cl_name:
                h_cap = max(cap_heights)
            else:
                h_cap = min(cap_heights)
        else:
            h_cap = float(cl_h_raw.mean())
        cl_h = cl_h_raw - h_cap  # height relative to the nearest cap plane

        # Algebraic torus fit: s = 2*R*d + b, where s = d² + h², b = r² - R²
        s = cl_rho**2 + cl_h**2
        A_mat = np.column_stack([cl_rho, np.ones(n_cl)])
        try:
            params, _, _, _ = np.linalg.lstsq(A_mat, s, rcond=None)
        except Exception:
            continue

        a_coeff, b_coeff = params
        R_fit = a_coeff / 2.0
        r_sq = b_coeff + R_fit**2
        if r_sq <= 0 or R_fit <= 0:
            print(
                f"[parametric]   cluster {cl_name}: degenerate fit "
                f"(R={R_fit:.2f}, r²={r_sq:.3f})",
                flush=True,
            )
            continue
        r_fit = float(np.sqrt(r_sq))

        # Sanity: R should be comparable to known cylinder radii, r should be
        # a reasonable fillet radius (0.1 to ~half of part height).
        if r_fit < 0.1 or r_fit > 50.0 or R_fit < 1.0:
            print(
                f"[parametric]   cluster {cl_name}: implausible R={R_fit:.2f}, r={r_fit:.2f}",
                flush=True,
            )
            continue

        # Compute point-to-torus-surface distance for inlier check.
        dist_to_surface = np.abs(np.sqrt((cl_rho - R_fit)**2 + cl_h**2) - r_fit)
        inlier_local = dist_to_surface < thresh
        n_inliers = int(inlier_local.sum())

        if n_inliers < TORUS_MIN_INLIERS:
            print(
                f"[parametric]   cluster {cl_name}: too few inliers "
                f"({n_inliers}/{n_cl}), R={R_fit:.2f}, r={r_fit:.2f}",
                flush=True,
            )
            continue

        # Refine R and r using only inliers.
        inl_rho = cl_rho[inlier_local]
        inl_h = cl_h[inlier_local]
        s_inl = inl_rho**2 + inl_h**2
        A_inl = np.column_stack([inl_rho, np.ones(n_inliers)])
        try:
            params2, _, _, _ = np.linalg.lstsq(A_inl, s_inl, rcond=None)
            R_fit = params2[0] / 2.0
            r_sq2 = params2[1] + R_fit**2
            if r_sq2 > 0 and R_fit > 0:
                r_fit = float(np.sqrt(r_sq2))
        except Exception:
            pass

        # Spine center: on the body axis at the cap plane height.
        spine_center = body_center + body_axis * h_cap

        # Classify concave vs convex from normal orientation.
        inl_global_idx = cl_local_idx[inlier_local]
        inl_nrm = cand_nrm[inl_global_idx]
        inl_lateral = lateral[inl_global_idx]
        lat_d = np.linalg.norm(inl_lateral, axis=1, keepdims=True)
        lat_d_safe = np.where(lat_d < 1e-9, 1.0, lat_d)
        lat_u = inl_lateral / lat_d_safe
        nrm_radial = np.einsum("ij,ij->i", inl_nrm, lat_u)
        concave = float(nrm_radial.mean()) < 0

        # Build global inlier mask.
        inlier_global = np.zeros(len(face_centers), dtype=bool)
        inlier_global[cand_idx[inl_global_idx]] = True

        results.append({
            "center":     spine_center,
            "axis":       body_axis.copy(),
            "major_r":    float(R_fit),
            "minor_r":    float(r_fit),
            "inliers":    int(inlier_global.sum()),
            "inlier_mask": inlier_global,
            "concave":    concave,
        })

        print(
            f"[parametric]   torus ({cl_name}): R={R_fit:.2f} mm, r={r_fit:.2f} mm, "
            f"inliers={n_inliers} ({n_inliers/total:.1%}), "
            f"{'INNER(concave)' if concave else 'OUTER(convex)'}",
            flush=True,
        )

    return results


# ── Phase B.5: Sphere detection ──────────────────────────────────────────────

def detect_spheres(pts, nrm, used, total):
    """
    Iterative RANSAC sphere detection on unclaimed faces.

    Uses pyransac3d.Sphere to fit spherical surfaces.  Classifies each sphere
    as convex (outward normals → solid body) or concave (inward normals →
    cavity) based on the mean dot product of face normals with the radial
    direction from the sphere centre.

    Returns list of dicts: {center, radius, concave, inliers, inlier_mask}.
    """
    avail = ~used
    n_avail = int(avail.sum())
    if n_avail < SPHERE_MIN_INLIERS:
        return []

    avail_idx = np.where(avail)[0]
    avail_pts = pts[avail_idx]
    avail_nrm = nrm[avail_idx]

    remaining = np.ones(len(avail_idx), dtype=bool)
    results = []

    for round_i in range(SPHERE_MAX_ROUNDS):
        n_rem = int(remaining.sum())
        if n_rem < SPHERE_MIN_INLIERS:
            break

        sph = pyrsc.Sphere()
        try:
            center, radius, inl = sph.fit(
                avail_pts[remaining], RANSAC_DIST_THRESHOLD_SPHERE,
                maxIteration=RANSAC_ITERATIONS,
            )
        except Exception as exc:
            print(f"[parametric] sphere RANSAC round {round_i+1} failed: {exc}", flush=True)
            break

        if inl is None or len(inl) < SPHERE_MIN_INLIERS:
            break

        radius = float(radius)
        center = np.array(center, dtype=float)

        # Map inliers back to avail_idx space.
        rem_idx = np.where(remaining)[0]
        inl_local = rem_idx[inl]

        inl_pts = avail_pts[inl_local]
        inl_nrm = avail_nrm[inl_local]

        # Concavity: normals pointing inward (toward centre) → concave (cavity).
        radial = inl_pts - center
        r_len = np.linalg.norm(radial, axis=1, keepdims=True)
        r_len = np.where(r_len < 1e-9, 1.0, r_len)
        rad_unit = radial / r_len
        dot_avg = float(np.einsum("ij,ij->i", inl_nrm, rad_unit).mean())
        concave = dot_avg < 0

        # Radius sanity: reject degenerate fits.
        if radius < 0.5 or radius > 500.0:
            print(
                f"[parametric]   sphere round {round_i+1}: "
                f"r={radius:.2f} outside [0.5, 500], skip",
                flush=True,
            )
            remaining[inl_local] = False
            continue

        # Build global inlier mask.
        global_mask = np.zeros(total, dtype=bool)
        global_mask[avail_idx[inl_local]] = True

        results.append({
            "center":      center,
            "radius":      radius,
            "concave":     concave,
            "inliers":     len(inl_local),
            "inlier_mask": global_mask,
        })

        remaining[inl_local] = False
        print(
            f"[parametric]   sphere {len(results)}: r={radius:.2f} mm, "
            f"center=({center[0]:+.1f},{center[1]:+.1f},{center[2]:+.1f}), "
            f"{'concave' if concave else 'convex'}, inliers={len(inl_local)}",
            flush=True,
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
# Restrict to horizontal-normal faces only — prevents fillet faces (intermediate
# normals) from being consumed as cylinder inliers, preserving them for Phase B
# torus detection.
cyl_candidate_mask = horiz_mask & ~used
cylinders = detect_cylinders(
    face_centers, face_normals, cyl_candidate_mask, used,
    MIN_INLIER_ABS, RANSAC_DIST_THRESHOLD_CYL, RANSAC_ITERATIONS, total_faces
)

cyl_inliers   = sum(c["inliers"] for c in cylinders)
plane_inliers = sum(p["inliers"] for p in planes)

# Phase B: Detect tori (fillets) on unclaimed faces if we have a coaxial body axis.
tori = []
if cylinders:
    # Use the largest outer cylinder's axis as the body axis for torus detection.
    ext_cyls_pre = [c for c in cylinders if not c["concave"]]
    if not ext_cyls_pre:
        ext_cyls_pre = [max(cylinders, key=lambda c: c["radius"])]
    body_cyl = max(ext_cyls_pre, key=lambda c: c["radius"])
    body_axis_pre = body_cyl["axis"]
    body_center_pre = body_cyl["center"]

    print("[parametric] detecting tori (fillets) …", flush=True)
    tori = detect_tori(
        face_centers, face_normals, used, body_axis_pre, body_center_pre, total_faces,
        cylinders, planes
    )
    for t in tori:
        used[t["inlier_mask"]] = True

    # Cleanup pass: claim remaining unclaimed faces geometrically close to
    # any detected torus surface.  Catches edge faces with near-axial or
    # near-radial normals that fell outside the fillet candidate range.
    if tori:
        unclaimed = ~used
        n_unclaimed = int(unclaimed.sum())
        if n_unclaimed > 0:
            uc_idx = np.where(unclaimed)[0]
            uc_pts = face_centers[uc_idx]
            rel_uc = uc_pts - body_center_pre
            h_uc = rel_uc @ body_axis_pre
            along_uc = np.outer(h_uc, body_axis_pre)
            rho_uc = np.linalg.norm(rel_uc - along_uc, axis=1)

            cleanup_claimed = np.zeros(len(face_centers), dtype=bool)
            for t in tori:
                R = t["major_r"]
                r = t["minor_r"]
                # Spine center height along axis
                h_spine = float(np.dot(t["center"] - body_center_pre, body_axis_pre))
                h_rel = h_uc - h_spine
                # Point-to-torus-surface distance
                d_torus = np.abs(np.sqrt((rho_uc - R)**2 + h_rel**2) - r)
                close = d_torus < RANSAC_DIST_THRESHOLD_TORUS * 3.0  # generous threshold
                cleanup_claimed[uc_idx[close]] = True

            n_cleanup = int(cleanup_claimed.sum())
            if n_cleanup > 0:
                used[cleanup_claimed] = True
                # Add to existing torus inlier counts
                for t in tori:
                    t["inliers"] += n_cleanup // len(tori)
                print(
                    f"[parametric] torus cleanup: {n_cleanup} additional faces claimed",
                    flush=True,
                )

torus_inliers = sum(t["inliers"] for t in tori)

# Phase B.5: Detect spheres on all unclaimed faces.
print("[parametric] detecting spheres …", flush=True)
spheres = detect_spheres(face_centers, face_normals, used, total_faces)
for s in spheres:
    used[s["inlier_mask"]] = True
sphere_inliers = sum(s["inliers"] for s in spheres)

# Preliminary coverage (box fillet claiming deferred until after function definitions).
coverage = (cyl_inliers + plane_inliers + torus_inliers + sphere_inliers) / total_faces
print(
    f"[parametric] coverage={coverage:.1%}  "
    f"({len(cylinders)} cyl, {len(planes)} plane, {len(tori)} torus, "
    f"{len(spheres)} sphere)",
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
# Minimum radius (mm) for a circle hole to be eligible for cavity-floor plane
# reclassification.  Small pin holes use face-centre depth; large cavities need
# plane-derived depth because prior detection passes leave unreliable remnant faces.
CAVITY_FLOOR_MIN_RADIUS = 8.0


def detect_circle_holes(
    face_centers, face_normals, used_after_planes, cap_axis, cap_axis_idx,
    la, lb, fc_min, fc_max
):
    """
    Detect full cylindrical through-holes by clustering unclaimed lateral faces
    in the XZ plane and running RANSAC per cluster.

    Distinguishes full circles (angular coverage > 270°) from semicircular oblong
    ends (coverage ~ 180°) using the spread of face normals around the cylinder axis.

    Returns (holes, skip_circles, posts, partial_arcs):
      - holes: list of concave (hole) dicts {center_la, center_lb, radius, ...}
      - skip_circles: [(center_la, center_lb, radius)] for slot suppression
      - posts: list of convex (post/boss) dicts, same shape as holes
      - partial_arcs: list of dicts {center_la, center_lb, n_faces} for rejected
        partial-arc clusters (arc < 270°); used for inner-ring boundary estimation
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
    raw_clusters = []
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
            raw_clusters.append(np.where(cl_mask)[0])

    clusters = raw_clusters

    print(f"[parametric] circle detect: {len(clusters)} face clusters", flush=True)

    holes        = []
    posts        = []  # convex cylinders (inner ring post / boss)
    partial_arcs = []  # rejected partial-arc clusters (arc < 270°)
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
                f"arc={np.degrees(arc_coverage):.0f}° < 270° — partial arc, skip",
                flush=True,
            )
            partial_arcs.append({
                "center_la": ctr_a, "center_lb": ctr_b, "n_faces": n_cl,
            })
            continue

        # Always run deterministic 2D algebraic circle fit first.
        # RANSAC radius varies across runs; 2D fit is stable and preferred
        # for geometric decisions (depth classification, ring pairing).
        pts_2d = cl_pts[:, [la, lb]]  # (N, 2)
        A_2d = np.column_stack([pts_2d, np.ones(len(pts_2d))])
        b_2d = (pts_2d ** 2).sum(axis=1)
        fit2d_ok = False
        try:
            sol_2d, _, _, _ = np.linalg.lstsq(A_2d, b_2d, rcond=None)
            cx_2d = sol_2d[0] / 2.0
            cy_2d = sol_2d[1] / 2.0
            r_2d = float(np.sqrt(sol_2d[2] + cx_2d**2 + cy_2d**2))
            dists_2d = np.sqrt((pts_2d[:, 0] - cx_2d)**2 + (pts_2d[:, 1] - cy_2d)**2)
            residual_2d = float(np.abs(dists_2d - r_2d).mean())
            fit2d_ok = residual_2d <= 0.5
        except Exception:
            pass

        # Run RANSAC for concavity classification (needs 3D normals).
        ransac_ok = False
        cyl = pyrsc.Cylinder()
        try:
            center, axis, radius, inl = cyl.fit(
                cl_pts, RANSAC_DIST_THRESHOLD_CYL, maxIteration=RANSAC_ITERATIONS
            )
            if inl is not None and len(inl) >= 12:
                axis_n   = np.array(axis,   dtype=float)
                axis_n  /= np.linalg.norm(axis_n)
                center_n = np.array(center, dtype=float)
                r        = float(radius)
                ransac_ok = abs(float(np.dot(axis_n, cap_axis))) >= 0.85
        except Exception as exc:
            print(f"[parametric]   cluster {ci+1}: RANSAC failed: {exc}", flush=True)

        # Use 2D fit radius (deterministic) when available.  Fall back to
        # RANSAC radius or pure 2D fit when RANSAC axis is misaligned.
        if fit2d_ok:
            r = r_2d
            if not ransac_ok:
                # RANSAC axis bad — build centre/axis from 2D fit.
                center_n = np.zeros(3)
                center_n[la] = cx_2d
                center_n[lb] = cy_2d
                center_n[cap_axis_idx] = float(cl_pts[:, cap_axis_idx].mean())
                axis_n = cap_axis.copy()
                inl = np.arange(len(cl_pts))
                print(
                    f"[parametric]   cluster {ci+1}: RANSAC axis misaligned, "
                    f"using 2D circle fit (r={r:.2f}mm, residual={residual_2d:.3f}mm)",
                    flush=True,
                )
        elif not ransac_ok:
            print(
                f"[parametric]   cluster {ci+1}: both fits failed, skip",
                flush=True,
            )
            continue

        # Must be small enough to be a through-hole.
        max_dim = float(min(fc_max[la] - fc_min[la], fc_max[lb] - fc_min[lb]))
        if r < 0.5 or r > max_dim * 0.40:
            print(
                f"[parametric]   cluster {ci+1}: r={r:.2f} outside [0.5, {max_dim*0.40:.1f}]",
                flush=True,
            )
            continue

        # Concavity check: classify as hole (concave) or post (convex).
        inl_pts = cl_pts[inl]
        inl_nrm = cl_nrm[inl]
        t        = np.einsum("ij,j->i", inl_pts - center_n, axis_n)
        foot     = center_n + np.outer(t, axis_n)
        radial   = inl_pts - foot
        r_len    = np.linalg.norm(radial, axis=1, keepdims=True)
        r_len    = np.where(r_len < 1e-9, 1.0, r_len)
        rad_unit = radial / r_len
        dot_avg  = float(np.einsum("ij,ij->i", inl_nrm, rad_unit).mean())
        is_convex = dot_avg >= 0

        cx_la = float(center_n[la])
        cx_lb = float(center_n[lb])

        # Depth extent along cap axis for blind-hole detection (Phase B.5-1).
        cap_coords = cl_pts[:, cap_axis_idx]
        depth_min = float(cap_coords.min())
        depth_max = float(cap_coords.max())

        entry = {
            "center_la": cx_la, "center_lb": cx_lb, "radius": r,
            "depth_min": depth_min, "depth_max": depth_max,
        }

        if is_convex:
            print(
                f"[parametric]   cluster {ci+1}: POST r={r:.2f} mm, "
                f"center=({cx_la:+.1f},{cx_lb:+.1f}), "
                f"arc={np.degrees(arc_coverage):.0f}°, "
                f"dot={dot_avg:.2f}, inliers={len(inl)}",
                flush=True,
            )
            posts.append(entry)
        else:
            print(
                f"[parametric]   cluster {ci+1}: CIRCLE r={r:.2f} mm, "
                f"center=({cx_la:+.1f},{cx_lb:+.1f}), "
                f"arc={np.degrees(arc_coverage):.0f}°, "
                f"depth=[{depth_min:.2f},{depth_max:.2f}], inliers={len(inl)}",
                flush=True,
            )
            holes.append(entry)
            skip_circles.append((cx_la, cx_lb, r))

    # Merge co-located holes — circles at the same XZ centre with similar radius
    # but detected at different Y heights (e.g. sprue tessellation producing
    # multiple thin face rings).  Combine their depth ranges so depth
    # classification sees the full extent.
    MERGE_XZ_TOL = 2.0   # mm — max XZ distance between centres to merge
    MERGE_R_TOL  = 1.0   # mm — max radius difference to merge
    merged_holes = []
    merged_flags = [False] * len(holes)
    for i, hi in enumerate(holes):
        if merged_flags[i]:
            continue
        group = [hi]
        for j in range(i + 1, len(holes)):
            if merged_flags[j]:
                continue
            hj = holes[j]
            xz_dist = np.sqrt((hi["center_la"] - hj["center_la"])**2 +
                              (hi["center_lb"] - hj["center_lb"])**2)
            if xz_dist < MERGE_XZ_TOL and abs(hi["radius"] - hj["radius"]) < MERGE_R_TOL:
                group.append(hj)
                merged_flags[j] = True
        if len(group) == 1:
            merged_holes.append(hi)
        else:
            combined = dict(hi)
            combined["depth_min"] = min(h["depth_min"] for h in group)
            combined["depth_max"] = max(h["depth_max"] for h in group)
            combined["radius"] = float(np.mean([h["radius"] for h in group]))
            print(
                f"[parametric] merged {len(group)} co-located circles at "
                f"({combined['center_la']:+.1f},{combined['center_lb']:+.1f}) "
                f"r={combined['radius']:.2f} -> depth=[{combined['depth_min']:.2f},"
                f"{combined['depth_max']:.2f}]",
                flush=True,
            )
            merged_holes.append(combined)
    holes = merged_holes

    return holes, skip_circles, posts, partial_arcs


def apply_internal_slot_cuts(
    solid, planes, cap_axis_idx, fc_min, fc_max, face_centers, mesh_triangles,
    skip_circles=None
):
    """
    Detect and subtract oblong (stadium) slot cuts from internal plane pairs.

    Uses a two-pass approach:
      Pass 1: Collect all slot pairs across both lateral axes.
      Pass 2: Cut each slot, suppressing end caps at T-junctions where a
              perpendicular slot pair straddles the segment end position.

    Each matched plane pair (one +axis, one -axis, at positions interior to the
    outer walls) defines an oblong through-cut:
      - Width  = distance between the two wall planes (from vertex positions
                 for accuracy, not face-centre means)
      - Length = straight-section extent from wall face-centre bounds + two
                 semicircular end caps of radius = width/2
      - Depth  = full part thickness (all cuts are through-features)

    The oblong is cut as a box (straight section) + two cylinders (end caps),
    all through the full height.

    skip_circles: list of (center_la, center_lb, r) for detected circular holes.
    Any plane pair whose slot centre coincides with a known circle is suppressed
    to avoid double-cutting.

    mesh_triangles: (N, 3, 3) array of triangle vertex positions, used to compute
    accurate wall surface positions from vertex data instead of face-centre means.

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

    # ── Pass 1: collect all slot pairs across both axes ──────────────────────
    all_slot_pairs = []   # list of dicts with axis_idx, slot_left, slot_right, ...

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
            all_indices = []
            if pp["plane"].get("indices") is not None:
                all_indices.extend(pp["plane"]["indices"].tolist())
            if np_["plane"].get("indices") is not None:
                all_indices.extend(np_["plane"]["indices"].tolist())

            if all_indices:
                perp_vals   = face_centers[all_indices, perp_idx]
                perp_sorted = np.sort(perp_vals)
                gap_thresh  = max(5.0, width * 2.0)
                splits      = np.where(np.diff(perp_sorted) > gap_thresh)[0] + 1
                segments    = np.split(perp_sorted, splits)
                slot_segs   = [(float(s.min()), float(s.max())) for s in segments if len(s) > 0]
            else:
                slot_segs = [(float(fc_min[perp_idx]), float(fc_max[perp_idx]))]

            all_slot_pairs.append({
                "axis_idx":    axis_idx,
                "perp_idx":    perp_idx,
                "slot_left":   slot_left,
                "slot_right":  slot_right,
                "slot_center": slot_center,
                "width":       width,
                "r_semi":      r_semi,
                "segments":    slot_segs,
            })

    # ── Pass 2: cut slots with T-junction awareness ──────────────────────────

    def find_t_junction(slot, perp_end):
        """
        Check if a segment end is at a T-junction with a perpendicular slot.

        Returns the perpendicular slot's wall center position along
        slot["perp_idx"] if a T-junction exists (so the box can be extended
        exactly to that point), or None if no T-junction.
        """
        for other in all_slot_pairs:
            if other["axis_idx"] == slot["axis_idx"]:
                continue  # same axis -- not perpendicular
            # The perp slot has walls at [other.slot_left, other.slot_right]
            # along other.axis_idx == slot.perp_idx.
            # Check 1: perp_end is within the perp slot's wall range (with margin)
            margin = other["r_semi"] * 0.5
            if not (other["slot_left"] - margin <= perp_end <= other["slot_right"] + margin):
                continue
            # Check 2: our slot_center falls within one of the perp slot's
            # segments (which are along other.perp_idx == slot.axis_idx)
            our_pos_in_perp_width = slot["slot_center"]
            for seg_min, seg_max in other["segments"]:
                seg_margin = other["r_semi"] + other["width"]
                if seg_min - seg_margin <= our_pos_in_perp_width <= seg_max + seg_margin:
                    # T-junction found. Return the perp slot's center position
                    # along our perp axis — this is where we should extend to.
                    return other["slot_center"]
        return None

    n_cuts = 0
    part_lo_map = {la: float(fc_min[la]), lb: float(fc_min[lb])}
    part_hi_map = {la: float(fc_max[la]), lb: float(fc_max[lb])}
    EDGE_MARGIN = 2.0  # mm

    for slot in all_slot_pairs:
        axis_idx    = slot["axis_idx"]
        perp_idx    = slot["perp_idx"]
        slot_left   = slot["slot_left"]
        slot_right  = slot["slot_right"]
        slot_center = slot["slot_center"]
        width       = slot["width"]
        r_semi      = slot["r_semi"]
        part_lo     = part_lo_map[perp_idx]
        part_hi     = part_hi_map[perp_idx]

        for seg_min, seg_max in slot["segments"]:
            # --- Classify each segment end BEFORE cutting ---
            # Determine end-cap treatment: rounded cylinder, box extension
            # (T-junction), or nothing (part edge).
            effective_min = seg_min
            effective_max = seg_max
            end_treatment = {}  # perp_end -> "cap" | "extend" | "skip"

            for perp_end in (seg_min, seg_max):
                at_edge = (
                    perp_end < part_lo + r_semi + EDGE_MARGIN or
                    perp_end > part_hi - r_semi - EDGE_MARGIN
                )
                if at_edge:
                    end_treatment[perp_end] = "skip"
                    print(
                        f"[parametric]   end-cap skipped (at part edge "
                        f"perp={perp_end:.1f}, edge=[{part_lo:.1f},{part_hi:.1f}])",
                        flush=True,
                    )
                    continue

                t_pos = find_t_junction(slot, perp_end)
                if t_pos is not None:
                    end_treatment[perp_end] = "extend"
                    # Extend the box to the perpendicular slot's center position.
                    # This fills the gap between the face-centre bound and the
                    # actual slot intersection without overshooting.
                    if perp_end == seg_min:
                        effective_min = min(effective_min, t_pos)
                    else:
                        effective_max = max(effective_max, t_pos)
                    print(
                        f"[parametric]   end-cap -> box extension (T-junction "
                        f"perp={perp_end:.1f} -> {t_pos:.1f})",
                        flush=True,
                    )
                else:
                    end_treatment[perp_end] = "cap"

            # --- Straight rectangular section (with T-junction extensions) ---
            box_origin = np.zeros(3)
            box_size   = np.zeros(3)
            box_origin[axis_idx]     = slot_left
            box_size[axis_idx]       = width
            box_origin[perp_idx]     = effective_min
            box_size[perp_idx]       = effective_max - effective_min
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

            # --- Semicircular end caps ---
            # Place caps for free ends ("cap") and also for T-junction ends
            # ("extend") when the segment is long relative to the slot width.
            # Long segments represent real slot terminations at the intersection;
            # short segments (< width) are just fragments inside a perpendicular
            # slot gap and don't have physical rounded ends.
            seg_length = seg_max - seg_min
            cyl_ok = 0
            for perp_end in (seg_min, seg_max):
                treatment = end_treatment.get(perp_end)
                if treatment == "cap":
                    pass  # always place cap for free ends
                elif treatment == "extend" and seg_length > width:
                    # T-junction with a long segment — the slot genuinely
                    # terminates near the perpendicular slot; place a rounded
                    # end cap at the original face-centre bound.
                    pass
                else:
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


def build_box_solid(ext_cyls, int_cyls, planes, face_centers, face_normals, used_after_planes,
                    mesh_triangles=None):
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
    circle_holes, skip_circles, circle_posts, partial_arcs = detect_circle_holes(
        face_centers, face_normals, used_after_planes,
        cap_axis_v, cap_axis_idx, la, lb, fc_min, fc_max,
    )

    part_h     = float(fc_max[cap_axis_idx] - fc_min[cap_axis_idx])
    part_lo    = float(fc_min[cap_axis_idx])
    part_hi    = float(fc_max[cap_axis_idx])

    # ── Phase C-0: cavity-floor plane detection for large holes ─────────
    # Prior detection passes (cylinder/torus/sphere RANSAC) consume most faces
    # from large cavities, leaving scattered remnants with unreliable depth
    # spans.  For large holes, cross-reference with interior cap-aligned planes
    # to determine the true cavity depth.
    interior_planes = []
    for p in planes:
        if abs(p["normal"][cap_axis_idx]) < 0.85:
            continue
        pt_on_plane = -p["d"] * p["normal"]
        pos = float(np.dot(pt_on_plane, cap_axis_v))
        # Interior plane: between part boundaries (with 0.5mm margin)
        if pos > part_lo + 0.5 and pos < part_hi - 0.5:
            # Compute XZ bounding box of the plane's inlier faces.
            if "indices" in p and len(p["indices"]) > 0:
                pfc = face_centers[p["indices"]]
                interior_planes.append({
                    "pos": pos,
                    "inliers": p["inliers"],
                    "la_min": float(pfc[:, la].min()),
                    "la_max": float(pfc[:, la].max()),
                    "lb_min": float(pfc[:, lb].min()),
                    "lb_max": float(pfc[:, lb].max()),
                })
    if interior_planes:
        print(
            f"[parametric] cavity-floor candidates: "
            + ", ".join(f"pos={ip['pos']:.2f}mm ({ip['inliers']} faces)" for ip in interior_planes),
            flush=True,
        )

    # ── Phase C-0: ring pocket pairing (concentric hole + post) ─────────
    # Match convex posts to concave holes at the same XZ center.  A matching
    # pair indicates an annular (ring-shaped) pocket, not a simple hole.
    RING_PAIR_CENTER_TOL = 5.0  # mm — max XZ center distance to pair
    ring_pockets = []
    paired_hole_indices = set()
    for post in circle_posts:
        for hi, hole in enumerate(circle_holes):
            if hi in paired_hole_indices:
                continue
            dist_la = abs(hole["center_la"] - post["center_la"])
            dist_lb = abs(hole["center_lb"] - post["center_lb"])
            if dist_la < RING_PAIR_CENTER_TOL and dist_lb < RING_PAIR_CENTER_TOL:
                if post["radius"] < hole["radius"]:
                    ring_pockets.append({
                        "outer_r": hole["radius"],
                        "inner_r": post["radius"],
                        "radius": hole["radius"],  # for _classify_hole_depth
                        "center_la": hole["center_la"],
                        "center_lb": hole["center_lb"],
                        "depth_min": hole["depth_min"],
                        "depth_max": hole["depth_max"],
                    })
                    paired_hole_indices.add(hi)
                    print(
                        f"[parametric] ring pocket paired: outer_r={hole['radius']:.2f}, "
                        f"inner_r={post['radius']:.2f}, "
                        f"center=({hole['center_la']:+.1f},{hole['center_lb']:+.1f})",
                        flush=True,
                    )
                    break

    # ── Phase C-0: inner-ring estimation from partial-arc clusters ─────
    # When a large hole has no paired post but multiple partial-arc clusters
    # surround it at a consistent radius, they trace the inner wall of a ring-
    # shaped cavity.  Fit a circle to these cluster centroids to estimate the
    # inner cylinder radius, then promote to a ring pocket.
    for hi, hole in enumerate(circle_holes):
        if hi in paired_hole_indices:
            continue
        if hole["radius"] < CAVITY_FLOOR_MIN_RADIUS:
            continue
        # Collect partial arcs whose centre lies within the hole's footprint.
        hla, hlb = hole["center_la"], hole["center_lb"]
        nearby_arcs = []
        for pa in partial_arcs:
            dist = np.sqrt((pa["center_la"] - hla)**2 + (pa["center_lb"] - hlb)**2)
            if dist < hole["radius"] * 1.1:
                nearby_arcs.append(pa)
        if len(nearby_arcs) < 3:
            continue
        # Fit a circle to the partial-arc centroids in the lateral plane.
        pa_pts = np.array([[a["center_la"], a["center_lb"]] for a in nearby_arcs])
        A_fit = np.column_stack([pa_pts, np.ones(len(pa_pts))])
        b_fit = (pa_pts**2).sum(axis=1)
        try:
            sol, _, _, _ = np.linalg.lstsq(A_fit, b_fit, rcond=None)
            cx = sol[0] / 2.0
            cz = sol[1] / 2.0
            inner_r = float(np.sqrt(sol[2] + cx**2 + cz**2))
        except Exception:
            continue
        if inner_r < 1.0 or inner_r >= hole["radius"]:
            continue
        ring_pockets.append({
            "outer_r": hole["radius"],
            "inner_r": inner_r,
            "radius": hole["radius"],  # for _classify_hole_depth
            "center_la": hole["center_la"],
            "center_lb": hole["center_lb"],
            "depth_min": hole["depth_min"],
            "depth_max": hole["depth_max"],
        })
        paired_hole_indices.add(hi)
        print(
            f"[parametric] ring pocket (partial-arc): outer_r={hole['radius']:.2f}, "
            f"inner_r={inner_r:.2f} (from {len(nearby_arcs)} arcs), "
            f"center=({hole['center_la']:+.1f},{hole['center_lb']:+.1f})",
            flush=True,
        )

    # Unpaired holes are processed normally.
    unpaired_holes = [h for i, h in enumerate(circle_holes) if i not in paired_hole_indices]

    def _classify_hole_depth(ch):
        """Classify a circle hole as through or blind, using interior planes
        for large holes where face-centre depth is unreliable."""
        d_min = ch.get("depth_min", part_lo)
        d_max = ch.get("depth_max", part_hi)
        depth_span = d_max - d_min

        # For large holes, try to find a cavity-floor plane that overlaps
        # the hole's XZ position.  This is more reliable than face-centre
        # depth when prior detection passes consumed most faces.
        if ch["radius"] >= CAVITY_FLOOR_MIN_RADIUS and interior_planes:
            best_floor = None
            for ip in interior_planes:
                # Check that the plane covers the hole center in XZ.
                if (ip["la_min"] <= ch["center_la"] <= ip["la_max"] and
                        ip["lb_min"] <= ch["center_lb"] <= ip["lb_max"]):
                    # Pick the floor plane with the most inliers.
                    if best_floor is None or ip["inliers"] > best_floor["inliers"]:
                        best_floor = ip
            if best_floor is not None:
                floor_pos = best_floor["pos"]
                # The cavity opens from whichever box face is further from the floor.
                dist_to_lo = floor_pos - part_lo
                dist_to_hi = part_hi - floor_pos
                if dist_to_lo <= dist_to_hi:
                    # Floor is near the bottom → cavity opens from the bottom.
                    cut_y0 = part_lo - HOLE_CUT_MARGIN
                    cut_h  = (floor_pos - part_lo) + HOLE_CUT_MARGIN
                else:
                    # Floor is near the top → cavity opens from the top.
                    cut_y0 = floor_pos
                    cut_h  = (part_hi - floor_pos) + HOLE_CUT_MARGIN
                kind = f"blind-floor(depth={min(dist_to_lo, dist_to_hi):.1f}mm, plane@{floor_pos:.2f})"
                return cut_y0, cut_h, kind

        # Default: face-centre depth classification (Phase B.5-1).
        if depth_span > BLIND_HOLE_DEPTH_RATIO * part_h:
            cut_y0 = part_lo - HOLE_CUT_MARGIN
            cut_h  = part_h + 2.0 * HOLE_CUT_MARGIN
            return cut_y0, cut_h, "through"
        else:
            dist_to_lo = d_min - part_lo
            dist_to_hi = part_hi - d_max
            if dist_to_lo <= dist_to_hi:
                cut_y0 = part_lo - HOLE_CUT_MARGIN
                cut_h  = (d_max - part_lo) + HOLE_CUT_MARGIN
            else:
                cut_y0 = d_min
                cut_h  = (part_hi - d_min) + HOLE_CUT_MARGIN
            return cut_y0, cut_h, f"blind(depth={depth_span:.1f}mm)"

    # ── Cut ring pockets using a torus CSG shape ──────────────────────
    # The partial-arc centroid radius (inner_r) approximates the torus
    # major radius.  The tube radius is estimated from the cavity depth
    # (half the blind-cut height), giving a better fit than concentric
    # cylinders against the curved ring surface.
    for rp in ring_pockets:
        cut_y0, cut_h, hole_kind = _classify_hole_depth(rp)

        # Estimate torus geometry.  R_major comes from the deterministic
        # partial-arc centroid radius (torus centre line).  The tube radius
        # is constrained by the cavity depth (half the blind-cut height).
        R_major = rp["inner_r"]   # partial-arc centroid ≈ torus centre
        r_tube  = cut_h / 2.0

        # Position the torus at the mid-depth of the cavity.
        torus_center = np.zeros(3)
        torus_center[la]           = rp["center_la"]
        torus_center[lb]           = rp["center_lb"]
        torus_center[cap_axis_idx] = cut_y0 + cut_h / 2.0

        try:
            torus_solid = Part.makeTorus(
                R_major, r_tube, fv(torus_center), fv(cap_axis_v)
            )
            solid = solid.cut(torus_solid)
            print(
                f"[parametric] ring pocket cut (torus): R={R_major:.2f}, r={r_tube:.2f}, "
                f"center=({rp['center_la']:+.1f},{rp['center_lb']:+.1f}), "
                f"{hole_kind}",
                flush=True,
            )
        except Exception as exc:
            # Fallback: annular cylinder cut if torus fails.
            print(f"[parametric] torus cut failed ({exc}), falling back to annular cut", flush=True)
            cyl_base = np.zeros(3)
            cyl_base[la]           = rp["center_la"]
            cyl_base[lb]           = rp["center_lb"]
            cyl_base[cap_axis_idx] = cut_y0
            try:
                outer_cyl = Part.makeCylinder(rp["outer_r"], cut_h, fv(cyl_base), fv(cap_axis_v))
                inner_cyl = Part.makeCylinder(rp["inner_r"], cut_h, fv(cyl_base), fv(cap_axis_v))
                ring_tool = outer_cyl.cut(inner_cyl)
                solid = solid.cut(ring_tool)
                print(
                    f"[parametric] ring pocket cut (annular fallback): "
                    f"outer_r={rp['outer_r']:.2f}, inner_r={rp['inner_r']:.2f}, "
                    f"{hole_kind}",
                    flush=True,
                )
            except Exception as exc2:
                print(f"[parametric] annular fallback also failed: {exc2}", flush=True)

    # ── Cut unpaired circle holes ───────────────────────────────────────
    for ch in unpaired_holes:
        cut_y0, cut_h, hole_kind = _classify_hole_depth(ch)
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
                f"center=({ch['center_la']:+.1f},{ch['center_lb']:+.1f}), "
                f"{hole_kind}",
                flush=True,
            )
        except Exception as exc:
            print(f"[parametric] circle hole cut failed: {exc}", flush=True)

    # ── Second-pass: small cylindrical holes above cavity floor (sprue) ──
    # Main circle detection uses BFS radius 8mm which merges small features
    # (sprue channels, r~3mm) with nearby large features (ring walls) when
    # they overlap in XZ.  This pass uses a tighter cluster radius and only
    # examines lateral faces above the cavity floor.
    SPRUE_CLUSTER_RADIUS = 5.0   # mm — tighter than main 8mm
    SPRUE_MAX_RADIUS     = 5.0   # mm — only small cylindrical holes
    SPRUE_MIN_ARC_DEG    = 180.0 # degrees — relaxed for partial visibility
    SPRUE_MIN_FACES      = 10

    sprue_min_cap = part_lo + part_h * 0.5
    if interior_planes:
        sprue_min_cap = max(ip["pos"] for ip in interior_planes)

    cos_cap_arr = np.abs(face_normals @ cap_axis_v)
    sprue_lat_mask = (~used_after_planes &
                      (cos_cap_arr < 0.25) &
                      (face_centers[:, cap_axis_idx] > sprue_min_cap))
    n_sprue_lat = int(sprue_lat_mask.sum())

    if n_sprue_lat >= SPRUE_MIN_FACES:
        print(f"[parametric] sprue pass: {n_sprue_lat} lateral faces above "
              f"cap={sprue_min_cap:.1f}", flush=True)

        sp_idx = np.where(sprue_lat_mask)[0]
        sp_fc  = face_centers[sp_idx]
        sp_fn  = face_normals[sp_idx]

        sp_remaining = np.ones(len(sp_idx), dtype=bool)
        sp_clusters  = []
        while sp_remaining.sum() >= SPRUE_MIN_FACES:
            seed_i = np.where(sp_remaining)[0][0]
            in_cl  = np.zeros(len(sp_idx), dtype=bool)
            in_cl[seed_i] = True
            prev = 0
            while in_cl.sum() != prev:
                prev  = in_cl.sum()
                ctr_a = float(sp_fc[in_cl, la].mean())
                ctr_b = float(sp_fc[in_cl, lb].mean())
                d2    = (sp_fc[:, la] - ctr_a)**2 + (sp_fc[:, lb] - ctr_b)**2
                in_cl = sp_remaining & (d2 < SPRUE_CLUSTER_RADIUS**2)
            cl_mask = in_cl & sp_remaining
            sp_remaining[cl_mask] = False
            if cl_mask.sum() >= SPRUE_MIN_FACES:
                sp_clusters.append(np.where(cl_mask)[0])

        for sci, scl in enumerate(sp_clusters):
            scl_pts = sp_fc[scl]
            scl_nrm = sp_fn[scl]

            pts_2d = scl_pts[:, [la, lb]]
            A_2d   = np.column_stack([pts_2d, np.ones(len(pts_2d))])
            b_2d   = (pts_2d ** 2).sum(axis=1)
            try:
                sol_2d, _, _, _ = np.linalg.lstsq(A_2d, b_2d, rcond=None)
                cx = sol_2d[0] / 2.0
                cz = sol_2d[1] / 2.0
                r  = float(np.sqrt(sol_2d[2] + cx**2 + cz**2))
            except Exception:
                continue

            if r < 0.5 or r > SPRUE_MAX_RADIUS:
                print(f"[parametric]   sprue cluster {sci+1}: r={r:.2f} "
                      f"outside [0.5, {SPRUE_MAX_RADIUS}] -- skip", flush=True)
                continue

            nla_s    = scl_nrm[:, la]
            nlb_s    = scl_nrm[:, lb]
            angles   = np.arctan2(nlb_s, nla_s)
            sorted_a = np.sort(angles)
            gaps     = np.diff(sorted_a)
            wrap_gap = float(sorted_a[0] + 2 * np.pi - sorted_a[-1])
            max_gap  = float(np.max(np.append(gaps, wrap_gap)))
            arc_deg  = float(np.degrees(2 * np.pi - max_gap))

            if arc_deg < SPRUE_MIN_ARC_DEG:
                print(f"[parametric]   sprue cluster {sci+1}: arc={arc_deg:.0f} deg "
                      f"< {SPRUE_MIN_ARC_DEG} -- skip", flush=True)
                continue

            already_detected = False
            for dc in list(unpaired_holes) + list(ring_pockets):
                xz_dist = np.sqrt((cx - dc["center_la"])**2 +
                                  (cz - dc["center_lb"])**2)
                if xz_dist < 2.0 and abs(r - dc["radius"]) < 1.0:
                    already_detected = True
                    break
            if already_detected:
                continue

            cap_coords = scl_pts[:, cap_axis_idx]
            d_min = float(cap_coords.min())
            d_max = float(cap_coords.max())

            print(f"[parametric] sprue detected: r={r:.2f}mm, "
                  f"center=({cx:+.1f},{cz:+.1f}), arc={arc_deg:.0f} deg, "
                  f"depth=[{d_min:.2f},{d_max:.2f}]", flush=True)

            ch = {"center_la": cx, "center_lb": cz, "radius": r,
                  "depth_min": d_min, "depth_max": d_max}
            cut_y0, cut_h, hole_kind = _classify_hole_depth(ch)
            cyl_base = np.zeros(3)
            cyl_base[la]           = cx
            cyl_base[lb]           = cz
            cyl_base[cap_axis_idx] = cut_y0
            try:
                cyl_solid = Part.makeCylinder(
                    r, cut_h, fv(cyl_base), fv(cap_axis_v)
                )
                solid = solid.cut(cyl_solid)
                print(f"[parametric] sprue hole cut: r={r:.2f}mm, "
                      f"{hole_kind}", flush=True)
            except Exception as exc:
                print(f"[parametric] sprue cut failed: {exc}", flush=True)

    # Subtract oblong slot cuts from internal plane pairs.
    solid = apply_internal_slot_cuts(
        solid, planes, cap_axis_idx, fc_min, fc_max, face_centers,
        mesh_triangles=mesh_triangles,
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


def build_sphere_solid(spheres):
    """
    CSG path for sphere-dominated geometry (Phase B.5-2).

    Builds a solid from detected spheres by fusing convex spheres and cutting
    concave ones.  Sorts by radius (largest first) for stable boolean ops.

    Returns a Part.Shape or None on failure.
    """
    if not spheres:
        return None

    def fv(v):
        return FreeCAD.Vector(float(v[0]), float(v[1]), float(v[2]))

    # Sort by radius (largest first) for stable boolean operations.
    sorted_spheres = sorted(spheres, key=lambda s: s["radius"], reverse=True)

    s0 = sorted_spheres[0]
    try:
        solid = Part.makeSphere(s0["radius"], fv(s0["center"]))
    except Exception as exc:
        print(f"[parametric] first sphere build failed: {exc}", flush=True)
        return None

    print(
        f"[parametric] sphere base: r={s0['radius']:.2f} mm, "
        f"center=({s0['center'][0]:+.1f},{s0['center'][1]:+.1f},{s0['center'][2]:+.1f})",
        flush=True,
    )

    for si, s in enumerate(sorted_spheres[1:], 2):
        try:
            sph = Part.makeSphere(s["radius"], fv(s["center"]))
            if s["concave"]:
                solid = solid.cut(sph)
                op = "cut"
            else:
                solid = solid.fuse(sph)
                op = "fused"
            print(
                f"[parametric] sphere {si} {op}: r={s['radius']:.2f} mm, "
                f"center=({s['center'][0]:+.1f},{s['center'][1]:+.1f},{s['center'][2]:+.1f})",
                flush=True,
            )
        except Exception as exc:
            print(f"[parametric] sphere {si} boolean failed: {exc}", flush=True)

    if solid is None or solid.isNull():
        return None

    print(
        f"[parametric] sphere CSG solid: {len(sorted_spheres)} sphere(s)",
        flush=True,
    )
    return solid


def build_parametric_solid(cylinders, planes, face_centers, face_normals, used_after_planes,
                           tori=None, spheres=None):
    """
    Attempt CSG reconstruction.  Returns a Part.Shape or None on failure.

    Routes to build_box_solid for prismatic parts (4+ planes detected),
    the cylindrical CSG path for coaxial ring/boss parts, or the sphere
    path for sphere-dominated geometry.  Phase B: fuses detected tori
    (fillets) into the coaxial cylinder solid.
    """
    if tori is None:
        tori = []
    if spheres is None:
        spheres = []
    ext_cyls = [c for c in cylinders if not c["concave"]]
    int_cyls = [c for c in cylinders if c["concave"]]

    # Box path: triggered when 4+ planes detected (cap + vertical walls).
    # Cylindrical parts (rings, bosses) have only 2 cap planes → won't reach this.
    # Corner radius is detected from unclaimed face geometry rather than RANSAC cylinders.
    if len(planes) >= 4:
        solid = build_box_solid(
            ext_cyls, int_cyls, planes, face_centers, face_normals, used_after_planes,
            mesh_triangles=np.array(mesh.triangles, dtype=float),
        )
        if solid:
            return solid
        print("[parametric] box build failed — trying cylindrical path", flush=True)

    # Cylindrical path: one large outer cylinder = body; inner = holes.
    if not cylinders:
        # No cylinders — try sphere path before giving up.
        if spheres:
            print(f"[parametric] no cylinders — trying sphere path ({len(spheres)} spheres)", flush=True)
            return build_sphere_solid(spheres)
        return None

    if not axes_are_coaxial(cylinders):
        print(
            "[parametric] cylinders are not coaxial — skipping cylindrical path",
            flush=True
        )
        if spheres:
            print(f"[parametric] trying sphere path ({len(spheres)} spheres)", flush=True)
            return build_sphere_solid(spheres)
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

    # Phase B: Apply fillet tori via makeFillet on cylinder edges.
    # For a coaxial part, fillets connect cylinders to cap planes.
    # We use the detected torus minor_r as the fillet radius and apply it
    # to the cylinder-cap edges of the CSG solid.
    #
    # Robust approach: merge tori with similar minor radii into a single
    # fillet operation.  The algebraic fit often produces slightly different
    # r values for top vs bottom fillets of the same feature (e.g. 0.79 vs
    # 0.85).  Applying them as separate makeFillet calls fails because the
    # first call consumes all circular edges, leaving none for the second.
    # The old CSG-fusion fallback (makeTorus + common + fuse) created
    # fragmented toroidal surfaces visible as "tube-like" edge artifacts.
    if tori:
        # ── Merge tori with similar minor_r ──────────────────────────────
        # Greedy merge: sort by minor_r, merge adjacent entries within
        # FILLET_MERGE_REL_TOL of each other.
        sorted_tori = sorted(tori, key=lambda t: t["minor_r"])
        merged_groups = []  # list of lists
        current_group = [sorted_tori[0]]
        for t in sorted_tori[1:]:
            ref_r = current_group[0]["minor_r"]
            if abs(t["minor_r"] - ref_r) / max(ref_r, 1e-6) <= FILLET_MERGE_REL_TOL:
                current_group.append(t)
            else:
                merged_groups.append(current_group)
                current_group = [t]
        merged_groups.append(current_group)

        print(
            f"[parametric] torus fillet groups: {len(merged_groups)} "
            f"(from {len(tori)} detected tori)",
            flush=True,
        )

        for group in merged_groups:
            # Weighted average of minor_r by inlier count for best estimate.
            total_inliers = sum(t["inliers"] for t in group)
            fillet_r = sum(
                t["minor_r"] * t["inliers"] for t in group
            ) / max(total_inliers, 1)
            radii_str = ", ".join(f"{t['minor_r']:.3f}" for t in group)

            # Find circular edges on the current solid.
            fillet_edges = []
            for edge in solid.Edges:
                if hasattr(edge, "Curve") and hasattr(edge.Curve, "Radius"):
                    fillet_edges.append(edge)

            if not fillet_edges:
                print(
                    f"[parametric] torus fillet skipped (no circular edges): "
                    f"r={fillet_r:.2f} mm, source radii=[{radii_str}]",
                    flush=True,
                )
                continue

            try:
                solid = solid.makeFillet(fillet_r, fillet_edges)
                print(
                    f"[parametric] torus fillet applied: r={fillet_r:.2f} mm, "
                    f"{len(fillet_edges)} edge(s), "
                    f"merged from [{radii_str}]",
                    flush=True,
                )
            except Exception as exc:
                print(
                    f"[parametric] torus fillet failed (r={fillet_r:.2f}, "
                    f"edges={len(fillet_edges)}): {exc}",
                    flush=True,
                )
                # Do NOT fall back to CSG torus fusion — the topological
                # fragmentation creates worse artifacts than a missing fillet.
                # The solid remains valid; it just has sharp edges here.

    if solid is None or solid.isNull():
        return None

    print(
        f"[parametric] CSG solid: r_outer={body['radius']:.2f} mm, "
        f"height={height:.2f} mm, "
        f"{len(int_cyls)} hole(s), {len(tori)} torus fillet(s)",
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


# ── Box fillet coverage (deferred until after function definitions) ───────────

box_fillet_inliers = 0
if len(planes) >= 4 and not tori:
    cap_votes = {0: 0.0, 1: 0.0, 2: 0.0}
    for p in planes:
        idx = int(np.argmax(np.abs(p["normal"])))
        if np.abs(p["normal"][idx]) > 0.85:
            cap_votes[idx] += p["inliers"]
    cap_ax_idx = max(cap_votes, key=cap_votes.get)
    cap_ax = np.zeros(3)
    cap_ax[cap_ax_idx] = 1.0
    la_i, lb_i = [i for i in range(3) if i != cap_ax_idx]

    fc_min_box = face_centers.min(axis=0)
    fc_max_box = face_centers.max(axis=0)
    corner_r_pre = detect_corner_radius_from_faces(
        face_centers, face_normals, used_after_planes,
        fc_min_box, fc_max_box, cap_ax_idx
    )
    if corner_r_pre is not None:
        # Box corner fillets are lateral faces near corner edges.  Their normals
        # are perpendicular to the cap axis (diagonal in the lateral plane),
        # so we select unclaimed faces that are NOT cap faces.
        cos_cap_all = np.abs(face_normals @ cap_ax)
        fillet_cand = ~used & (cos_cap_all < 0.85)
        if fillet_cand.sum() > 0:
            fc_la = face_centers[fillet_cand, la_i]
            fc_lb = face_centers[fillet_cand, lb_i]
            min_la, max_la = float(fc_min_box[la_i]), float(fc_max_box[la_i])
            min_lb, max_lb = float(fc_min_box[lb_i]), float(fc_max_box[lb_i])
            d_la = np.minimum(np.abs(fc_la - min_la), np.abs(fc_la - max_la))
            d_lb = np.minimum(np.abs(fc_lb - min_lb), np.abs(fc_lb - max_lb))
            # Near corner: close to both edges simultaneously (corner fillet)
            near_corner = (d_la < corner_r_pre * 2.5) & (d_lb < corner_r_pre * 2.5)
            fillet_claim = np.zeros(len(face_centers), dtype=bool)
            fillet_cand_idx = np.where(fillet_cand)[0]
            fillet_claim[fillet_cand_idx[near_corner]] = True
            box_fillet_inliers = int(fillet_claim.sum())
            used[fillet_claim] = True
            print(
                f"[parametric] box corner fillet faces claimed: {box_fillet_inliers} "
                f"(corner_r={corner_r_pre:.2f} mm)",
                flush=True,
            )

    # Also claim remaining unclaimed lateral faces — these are slot end-cap arcs,
    # wall-edge transitions, and other features geometrically covered by the box
    # CSG solid (slots, fillets, holes).
    cos_cap_all2 = np.abs(face_normals @ cap_ax)
    slot_arc_cand = ~used & (cos_cap_all2 < 0.50)  # lateral faces
    n_slot = int(slot_arc_cand.sum())
    if n_slot > 0:
        used[slot_arc_cand] = True
        box_fillet_inliers += n_slot
        print(
            f"[parametric] box slot/arc faces claimed: {n_slot}",
            flush=True,
        )

if box_fillet_inliers > 0:
    coverage = (cyl_inliers + plane_inliers + torus_inliers + sphere_inliers + box_fillet_inliers) / total_faces
    print(
        f"[parametric] coverage (with box fillets)={coverage:.1%}",
        flush=True,
    )


# ── Assemble and export ───────────────────────────────────────────────────────

doc_name = "STL_PARAMETRIC"

try:
    doc = FreeCAD.newDocument(doc_name)

    shape = None
    if coverage >= MIN_COVERAGE_FOR_PARAMETRIC:
        shape = build_parametric_solid(
            cylinders, planes, face_centers, face_normals, used_after_planes,
            tori, spheres,
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
