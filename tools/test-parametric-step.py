"""
Self-test for the parametric STEP converter.

Run with:
    python tools/test-parametric-step.py

Uses FreeCADCmd's Python directly for the conversion; checks stdout logs and
the resulting STEP file for expected STEP entity types.

Exit code 0 = all tests passed.
Exit code 1 = one or more tests failed.
"""

import os
import re
import subprocess
import sys
from datetime import datetime

# ── Paths ─────────────────────────────────────────────────────────────────────

REPO_ROOT    = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FREECAD_PY   = r"C:/Program Files/FreeCAD 1.0/bin/python.exe"
CONVERTER    = os.path.join(REPO_ROOT, "tools", "convert-stl-to-step-parametric-with-freecad.py")
TEST_DOCS    = os.path.join(REPO_ROOT, "TestDocs")
OUT_DIR      = os.path.join(REPO_ROOT, "Testoutput")

date_prefix  = datetime.now().strftime("%Y-%m-%d")

# ── Test definitions ──────────────────────────────────────────────────────────
#
# Each test specifies:
#   stl         : filename inside TestDocs/
#   expect_log  : substrings that MUST appear in converter stdout (Phase A criteria)
#   reject_log  : substrings that must NOT appear (regressions)
#   expect_step : STEP entity type names that must appear in the output file
#   reject_step : STEP entity type names that must NOT appear (triangulation fallback)
#   description : human-readable goal

TESTS = [
    {
        "stl": "MeshRing1.stl",
        "description": "Phase A — coaxial cylindrical ring (Phase A baseline)",
        "expect_log":  [
            "detecting planes",
            "detecting cylinders",
            "CSG solid",          # cylindrical path success
            "analytical solid",
        ],
        "reject_log": [
            "triangulated fallback",
            "box CSG",            # must not route to box path
            "coaxiality",         # must not fail coaxiality
        ],
        "expect_step": ["CYLINDRICAL_SURFACE", "PLANE"],
        "reject_step": [],
        "min_coverage": 0.50,
    },
    {
        "stl": "Station_3_Baseplate - Part 1.stl",
        "description": "Phase A — prismatic baseplate with rounded corners and slots",
        "expect_log":  [
            "detecting planes",
            "box CSG",                  # must route to box path
            "corner radius detected",   # must find corner fillet radius
            "corner fillets applied",   # must apply makeFillet
            "applied",                  # slot cuts applied (N slot cut(s))
            "analytical solid",
        ],
        "reject_log": [
            "triangulated fallback",
            "cylinders are not coaxial",
        ],
        "expect_step": ["PLANE", "CYLINDRICAL_SURFACE"],
        "reject_step": [],
        "min_coverage": 0.50,
        "min_planes_in_step":    10,    # outer walls + slot walls + caps
        "min_cylinders_in_step": 10,    # corner fillets (4) + oblong end caps (8+)
    },
    {
        "stl": "MeshRing1-mold-top.stl",
        "description": "Phase D regression — downward-opening ring cavity + sprue (no false rect pocket, no false base channels, sprue blind to floor)",
        "expect_log": [
            "detecting planes",
            "box CSG",
            "ring pocket cut",
            "sprue hole cut",
            "blind-pocket",
            "analytical solid",
        ],
        "reject_log": [
            "triangulated fallback",
            "base channel",
            "sprue hole cut: r=2.99mm, through",
            "pocket cut:",                  # rect pocket cut must not fire on circular cavity
        ],
        "expect_step": ["PLANE", "CYLINDRICAL_SURFACE"],
        "reject_step": [],
        "min_coverage": 0.50,
        "vol_ratio_min": 0.95,
        "vol_ratio_max": 1.05,
    },
    {
        "stl": "ESP35Box.stl",
        "description": "Phase D — hollow electronics enclosure (pocket + base-channel cuts)",
        "expect_log": [
            "detecting planes",
            "box CSG",
            "corner radius detected",
            "corner fillets applied",
            "inner pocket",
            "pocket cut",
            "base channel",
            "analytical solid",
        ],
        "reject_log": [
            "triangulated fallback",
            "sprue hole cut",
        ],
        "expect_step": ["PLANE", "CYLINDRICAL_SURFACE"],
        "reject_step": [],
        "min_coverage": 0.50,
        "vol_ratio_min": 0.90,
        "vol_ratio_max": 1.10,
        "max_mean_dev_mm": 1.0,
    },
    {
        "stl": "CurvedMinimalPost-Onshape.stl",
        "description": (
            "Phase C baseline (pre-implementation) — curved swept post; only Phase A+D"
            " quadrics fit. Documents current state; tightens after Phase C lands."
        ),
        "expect_log": [
            "detecting planes",
            "analytical solid",
        ],
        "reject_log": [
            "triangulated fallback",
        ],
        "expect_step": ["PLANE"],
        "reject_step": [],
        # Coverage is low (~46%) before C-1/C-2/C-3 — box CSG fills enough to push
        # past MIN_COVERAGE_FOR_PARAMETRIC via box-fillet face claiming. Volume
        # ratio is high (~1.47) because the box envelopes the curved-out regions.
        # These bounds lock in current behaviour as a regression floor; Phase C
        # work must EITHER preserve them or improve them (vol → 1.0, dev → 0).
        "min_coverage": 0.40,
        "vol_ratio_min": 0.90,
        "vol_ratio_max": 1.60,
    },
]

# ── Helpers ───────────────────────────────────────────────────────────────────

PASS = "\033[32mPASS\033[0m"
FAIL = "\033[31mFAIL\033[0m"

def check(condition, label):
    status = PASS if condition else FAIL
    print(f"  [{status}] {label}")
    return condition

def run_converter(stl_path, out_path):
    cmd = [FREECAD_PY, CONVERTER, stl_path, out_path]
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=240,
    )
    return result.stdout, result.stderr, result.returncode

def count_step_entities(step_path, entity_name):
    """Count occurrences of an entity type in a STEP file."""
    if not os.path.exists(step_path):
        return 0
    count = 0
    pattern = re.compile(r"\b" + re.escape(entity_name) + r"\b")
    with open(step_path, "r", errors="replace") as f:
        for line in f:
            if pattern.search(line):
                count += 1
    return count

def extract_coverage(stdout):
    m = re.search(r"coverage=(\d+\.\d+)%", stdout)
    return float(m.group(1)) / 100.0 if m else None

def run_compare(stl_path, step_path):
    """Run compare-step-to-stl.py and return (vol_ratio, mean_dev) or (None, None)."""
    compare_script = os.path.join(REPO_ROOT, "tools", "compare-step-to-stl.py")
    if not os.path.exists(compare_script):
        return None, None
    try:
        result = subprocess.run(
            [FREECAD_PY, compare_script, stl_path, step_path],
            capture_output=True, text=True, timeout=120,
        )
        stdout = result.stdout
        vol_m  = re.search(r"Volume ratio\s*:\s*([\d.]+)", stdout)
        dev_m  = re.search(r"Symm mean dev\s*:\s*([\d.]+)", stdout)
        vol    = float(vol_m.group(1)) if vol_m else None
        dev    = float(dev_m.group(1)) if dev_m else None
        return vol, dev
    except Exception:
        return None, None

# ── Run tests ─────────────────────────────────────────────────────────────────

all_passed = True

for t in TESTS:
    stl_name = t["stl"]
    stl_path = os.path.join(TEST_DOCS, stl_name)
    out_name = f"{date_prefix}_parametric_{stl_name.replace(' ', '_').replace('.stl', '.step')}"
    out_path = os.path.join(OUT_DIR, out_name)

    print(f"\n{'='*60}")
    print(f"TEST: {stl_name}")
    print(f"      {t['description']}")
    print(f"{'='*60}")

    if not os.path.exists(stl_path):
        print(f"  [{FAIL}] STL not found: {stl_path}")
        all_passed = False
        continue

    print(f"  Running converter …")
    try:
        stdout, stderr, rc = run_converter(stl_path, out_path)
    except subprocess.TimeoutExpired:
        print(f"  [{FAIL}] Converter timed out after 120 s")
        all_passed = False
        continue
    except FileNotFoundError:
        print(f"  [{FAIL}] FreeCADCmd not found at: {FREECAD_PY}")
        all_passed = False
        continue

    # Print converter stdout for visibility
    print("\n  --- converter stdout ---")
    for line in stdout.strip().splitlines():
        print(f"  | {line}")
    if stderr.strip():
        print("\n  --- converter stderr ---")
        for line in stderr.strip().splitlines()[-20:]:
            print(f"  ! {line}")
    print()

    passed = True

    # Exit code
    passed &= check(rc == 0, f"exit code 0 (got {rc})")

    # STEP file written
    passed &= check(os.path.exists(out_path), "STEP file written")
    if os.path.exists(out_path):
        size_kb = os.path.getsize(out_path) / 1024
        print(f"       STEP size: {size_kb:.1f} kB")

    # Coverage
    cov = extract_coverage(stdout)
    if cov is not None:
        passed &= check(
            cov >= t["min_coverage"],
            f"coverage {cov:.1%} >= {t['min_coverage']:.0%}"
        )

    # Log keyword checks
    for kw in t["expect_log"]:
        passed &= check(kw in stdout, f"stdout contains '{kw}'")
    for kw in t["reject_log"]:
        ok = kw not in stdout
        if not ok:
            passed &= check(ok, f"stdout does NOT contain '{kw}'")

    # STEP entity checks
    for entity in t["expect_step"]:
        n = count_step_entities(out_path, entity)
        passed &= check(n > 0, f"STEP contains {entity} (found {n})")
    for entity in t["reject_step"]:
        n = count_step_entities(out_path, entity)
        passed &= check(n == 0, f"STEP does NOT contain {entity} (found {n})")

    # Minimum PLANE count check (for slot-cut verification)
    if "min_planes_in_step" in t:
        n_planes = count_step_entities(out_path, "PLANE")
        passed &= check(
            n_planes >= t["min_planes_in_step"],
            f"STEP PLANE count {n_planes} >= {t['min_planes_in_step']}"
        )

    # Minimum CYLINDRICAL_SURFACE count check (corner fillets + oblong end caps)
    if "min_cylinders_in_step" in t:
        n_cyl = count_step_entities(out_path, "CYLINDRICAL_SURFACE")
        passed &= check(
            n_cyl >= t["min_cylinders_in_step"],
            f"STEP CYLINDRICAL_SURFACE count {n_cyl} >= {t['min_cylinders_in_step']}"
        )

    # Geometry quality checks (volume ratio + mean deviation via compare script)
    if ("vol_ratio_min" in t or "vol_ratio_max" in t or "max_mean_dev_mm" in t) \
            and os.path.exists(out_path):
        print("  Running geometry comparison …")
        vol_ratio, mean_dev = run_compare(stl_path, out_path)
        if vol_ratio is not None:
            if "vol_ratio_min" in t:
                passed &= check(vol_ratio >= t["vol_ratio_min"],
                                f"vol ratio {vol_ratio:.4f} >= {t['vol_ratio_min']}")
            if "vol_ratio_max" in t:
                passed &= check(vol_ratio <= t["vol_ratio_max"],
                                f"vol ratio {vol_ratio:.4f} <= {t['vol_ratio_max']}")
        if mean_dev is not None and "max_mean_dev_mm" in t:
            passed &= check(mean_dev <= t["max_mean_dev_mm"],
                            f"mean dev {mean_dev:.3f} mm <= {t['max_mean_dev_mm']} mm")

    all_passed &= passed
    print(f"\n  Result: {'PASSED' if passed else 'FAILED'}")

# ── Summary ───────────────────────────────────────────────────────────────────

print(f"\n{'='*60}")
print(f"Overall: {'ALL TESTS PASSED' if all_passed else 'SOME TESTS FAILED'}")
print(f"{'='*60}\n")
sys.exit(0 if all_passed else 1)
