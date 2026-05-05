"""
Debug harness for Phase C-2 (surfaces of revolution) detection.

Standalone tool — runs WITHOUT the C-2 detector existing in the main
converter. Lets us validate axis selection, profile extraction, and
inlier classification independently before wiring detection into
`convert-stl-to-step-parametric-with-freecad.py`.

Why this exists separately
--------------------------
Phase C-1 burned an hour on silent `None` returns from `fit_ellipse_2d`
(eigenvector indexing + canonical-form sign bugs). Both would have been
caught immediately with a debug print on intermediate state. C-2 has more
moving parts (axis search + profile fit + CSG), so each one gets a
dedicated diagnostic dump before the real detector is written.

When the detector lands, this script will additionally import its
`find_revolution_axis` and `extract_profile` and compare against the
heuristic baseline computed here.

Usage
-----
    "C:/Program Files/FreeCAD 1.0/bin/python.exe" \
        tools/debug-revolution-fit.py <STL_PATH> [--axis X|Y|Z|pca] [--out DIR]

Default axis hint: pca (principal component of face centres).
Default out dir:   Testoutput/

Outputs (date-prefixed, stem from input STL):
  <date>_c2debug_<stem>.json           candidate axis scores, inlier counts, profile points
  <date>_c2debug_<stem>_profile.png    (z, r) scatter + median r per z-bucket
  <date>_c2debug_<stem>_coverage.png   theta histogram per z-bucket strip

Exit code 0 always — this is a diagnostic tool, not a pass/fail gate.
"""

import argparse
import json
import os
import sys
from datetime import datetime

import numpy as np
import trimesh
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_OUT = os.path.join(REPO_ROOT, "Testoutput")


# ── Cylindrical projection helpers ────────────────────────────────────────────


def orthonormal_frame(axis):
    """Return (u, v, w) orthonormal frame with w = normalised axis."""
    w = np.asarray(axis, dtype=float)
    w = w / np.linalg.norm(w)
    # Pick a helper vector not parallel to w
    helper = np.array([1.0, 0.0, 0.0]) if abs(w[0]) < 0.9 else np.array([0.0, 1.0, 0.0])
    u = np.cross(w, helper)
    u = u / np.linalg.norm(u)
    v = np.cross(w, u)
    return u, v, w


def project_cylindrical(points, origin, axis):
    """Project points into (z, r, theta) about axis through origin."""
    u, v, w = orthonormal_frame(axis)
    rel = points - origin
    z = rel @ w
    x = rel @ u
    y = rel @ v
    r = np.sqrt(x * x + y * y)
    theta = np.arctan2(y, x)  # [-pi, pi]
    return z, r, theta


# ── Axis scoring (ground-truth detector substitute) ────────────────────────────


def score_axis(face_centers, axis, n_z_buckets=24, n_theta_buckets=12):
    """Score a candidate revolution axis.

    Higher is better. Combines:
      - r consistency: low std-dev of r within each z-bucket
      - theta coverage: each z-bucket should sample many theta-buckets
      - inlier fraction: faces whose r is within 2 sigma of bucket median

    Returns dict with axis, score, inliers (bool array), profile (zr pts).
    """
    origin = face_centers.mean(axis=0)
    z, r, theta = project_cylindrical(face_centers, origin, axis)

    z_min, z_max = z.min(), z.max()
    if z_max - z_min < 1e-6:
        return {
            "axis":         axis.tolist(),
            "origin":       origin.tolist(),
            "score":        0.0,
            "reject":       "degenerate z-extent",
            "inliers":      np.zeros(len(face_centers), dtype=bool),
            "profile":      [],
            "n_z_buckets":  n_z_buckets,
        }

    bucket_edges = np.linspace(z_min, z_max, n_z_buckets + 1)
    bucket_idx = np.clip(np.digitize(z, bucket_edges) - 1, 0, n_z_buckets - 1)

    profile = []
    inliers = np.zeros(len(face_centers), dtype=bool)
    r_residuals = []
    theta_coverage = []

    for b in range(n_z_buckets):
        mask = bucket_idx == b
        if mask.sum() < 3:
            continue
        r_b = r[mask]
        theta_b = theta[mask]
        r_med = np.median(r_b)
        r_mad = np.median(np.abs(r_b - r_med)) + 1e-9
        bucket_inliers = np.abs(r_b - r_med) < 3.0 * r_mad
        inliers[np.where(mask)[0][bucket_inliers]] = True
        z_centre = 0.5 * (bucket_edges[b] + bucket_edges[b + 1])
        profile.append((float(z_centre), float(r_med), int(mask.sum()), int(bucket_inliers.sum())))
        r_residuals.append(float(r_mad))
        # theta-coverage: how many theta-buckets did this z-bucket touch?
        theta_bins = np.clip(
            np.digitize(theta_b, np.linspace(-np.pi, np.pi, n_theta_buckets + 1)) - 1,
            0, n_theta_buckets - 1
        )
        theta_coverage.append(float(len(set(theta_bins.tolist())) / n_theta_buckets))

    if not profile:
        return {
            "axis":         axis.tolist(),
            "origin":       origin.tolist(),
            "score":        0.0,
            "reject":       "no populated z-buckets",
            "inliers":      inliers,
            "profile":      [],
            "n_z_buckets":  n_z_buckets,
        }

    inlier_frac = float(inliers.sum()) / len(face_centers)
    mean_r_residual = float(np.mean(r_residuals))
    mean_theta_cov = float(np.mean(theta_coverage))
    # Score: reward inlier frac + theta coverage, penalise r residual
    # Scale residual by max(r) so the term is unitless
    r_scale = float(r.max() + 1e-6)
    score = inlier_frac * mean_theta_cov / (1.0 + mean_r_residual / r_scale)

    return {
        "axis":              axis.tolist(),
        "origin":            origin.tolist(),
        "score":             float(score),
        "inlier_frac":       inlier_frac,
        "mean_r_residual":   mean_r_residual,
        "mean_theta_cov":    mean_theta_cov,
        "n_inliers":         int(inliers.sum()),
        "n_total":           int(len(face_centers)),
        "z_extent":          [float(z_min), float(z_max)],
        "r_extent":          [float(r.min()), float(r.max())],
        "inliers":           inliers,
        "profile":           profile,
        "n_z_buckets":       n_z_buckets,
    }


def pca_principal_axis(face_centers):
    """Largest-variance direction of face centres (revolution axis candidate)."""
    centred = face_centers - face_centers.mean(axis=0)
    cov = centred.T @ centred
    eigvals, eigvecs = np.linalg.eigh(cov)
    # eigh returns ascending eigenvalues — largest is last
    return eigvecs[:, -1]


# ── Plot outputs ──────────────────────────────────────────────────────────────


def plot_profile(result, out_path, title):
    if not result["profile"]:
        return
    profile = np.array(result["profile"])
    z_b, r_b, n_total, n_inl = profile.T

    fig, ax_r = plt.subplots(figsize=(9, 5))
    ax_r.plot(z_b, r_b, "o-", color="C0", linewidth=2, markersize=6,
              label="median r per z-bucket", zorder=3)
    ax_r.set_xlabel("z (mm) along candidate axis (origin at centroid)")
    ax_r.set_ylabel("r (mm)", color="C0")
    ax_r.tick_params(axis="y", labelcolor="C0")
    ax_r.grid(True, alpha=0.3)
    ax_r.set_ylim(0, max(r_b) * 1.15)

    ax_n = ax_r.twinx()
    bar_w = (z_b[-1] - z_b[0]) / max(len(z_b), 1) * 0.6 if len(z_b) > 1 else 1.0
    ax_n.bar(z_b, n_inl, width=bar_w, alpha=0.25, color="C2",
             label="inlier face count", zorder=1)
    ax_n.set_ylabel("inlier face count", color="C2")
    ax_n.tick_params(axis="y", labelcolor="C2")

    ax_r.set_title(
        f"{title}\nscore={result['score']:.3f}  "
        f"inliers={result['n_inliers']}/{result['n_total']}  "
        f"axis=({result['axis'][0]:+.2f},{result['axis'][1]:+.2f},{result['axis'][2]:+.2f})"
    )
    plt.tight_layout()
    plt.savefig(out_path, dpi=110)
    plt.close()


def plot_coverage(face_centers, result, out_path, title):
    """Theta histogram per z-bucket — visualises rotational symmetry."""
    if not result["profile"]:
        return
    origin = np.array(result["origin"])
    axis = np.array(result["axis"])
    z, r, theta = project_cylindrical(face_centers, origin, axis)

    n_z = result["n_z_buckets"]
    z_min = result["z_extent"][0]
    z_max = result["z_extent"][1]
    bucket_edges = np.linspace(z_min, z_max, n_z + 1)
    bucket_idx = np.clip(np.digitize(z, bucket_edges) - 1, 0, n_z - 1)

    fig, ax = plt.subplots(figsize=(9, 5))
    ax.scatter(theta * 180 / np.pi, z, c=r, cmap="viridis", s=8, alpha=0.7)
    ax.set_xlabel("theta (deg)")
    ax.set_ylabel("z (mm)")
    ax.set_title(f"{title}\ntheta coverage per z-bucket — uniform = revolution-like")
    ax.set_xticks(np.arange(-180, 181, 60))
    cb = plt.colorbar(ax.collections[0], ax=ax)
    cb.set_label("r (mm)")
    plt.tight_layout()
    plt.savefig(out_path, dpi=110)
    plt.close()


# ── Main ──────────────────────────────────────────────────────────────────────


def main(argv):
    ap = argparse.ArgumentParser(description="C-2 revolution-fit debug harness")
    ap.add_argument("stl", help="Path to STL file")
    ap.add_argument("--axis", default="pca",
                    help="Axis hint: X | Y | Z | pca (default pca)")
    ap.add_argument("--out", default=DEFAULT_OUT,
                    help=f"Output directory (default {DEFAULT_OUT})")
    args = ap.parse_args(argv)

    if not os.path.isfile(args.stl):
        print(f"ERROR: STL not found: {args.stl}", file=sys.stderr)
        return 2

    os.makedirs(args.out, exist_ok=True)

    print(f"Loading {args.stl}", flush=True)
    mesh = trimesh.load(args.stl, force="mesh")
    print(f"  triangles: {len(mesh.faces)}", flush=True)
    print(f"  bounds:    {mesh.bounds.tolist()}", flush=True)

    face_centers = np.asarray(mesh.triangles_center)
    face_normals = np.asarray(mesh.face_normals)

    candidates = {
        "X":   np.array([1.0, 0.0, 0.0]),
        "Y":   np.array([0.0, 1.0, 0.0]),
        "Z":   np.array([0.0, 0.0, 1.0]),
        "pca": pca_principal_axis(face_centers),
    }

    results = {}
    for label, axis in candidates.items():
        results[label] = score_axis(face_centers, axis)
        r = results[label]
        if "reject" in r:
            print(f"  axis {label}: rejected ({r['reject']})", flush=True)
        else:
            print(f"  axis {label}: score={r['score']:.3f}  "
                  f"inliers={r['n_inliers']}/{r['n_total']}  "
                  f"r-mad={r['mean_r_residual']:.3f}mm  "
                  f"theta-cov={r['mean_theta_cov']:.2f}",
                  flush=True)

    # Pick best by score (or by user hint if explicit)
    if args.axis in candidates and args.axis != "pca":
        chosen_label = args.axis
    else:
        chosen_label = max(results.keys(), key=lambda k: results[k].get("score", 0))
    chosen = results[chosen_label]
    print(f"  CHOSEN: axis {chosen_label} (score {chosen.get('score', 0):.3f})",
          flush=True)

    date = datetime.now().strftime("%Y-%m-%d")
    stem = os.path.splitext(os.path.basename(args.stl))[0]
    base = os.path.join(args.out, f"{date}_c2debug_{stem}")

    # Strip non-JSON-friendly fields
    serial = {}
    for label, r in results.items():
        rcopy = {k: v for k, v in r.items() if k != "inliers"}
        serial[label] = rcopy

    payload = {
        "stl":            args.stl,
        "n_triangles":    len(mesh.faces),
        "bounds":         mesh.bounds.tolist(),
        "candidates":     serial,
        "chosen":         chosen_label,
    }
    json_path = base + ".json"
    with open(json_path, "w") as f:
        json.dump(payload, f, indent=2)
    print(f"  wrote {json_path}", flush=True)

    plot_profile(chosen, base + "_profile.png", f"{stem} — axis {chosen_label}")
    print(f"  wrote {base}_profile.png", flush=True)

    plot_coverage(face_centers, chosen, base + "_coverage.png",
                  f"{stem} — axis {chosen_label}")
    print(f"  wrote {base}_coverage.png", flush=True)

    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
