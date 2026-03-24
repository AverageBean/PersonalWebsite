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

    all_passed &= passed
    print(f"\n  Result: {'PASSED' if passed else 'FAILED'}")

# ── Summary ───────────────────────────────────────────────────────────────────

print(f"\n{'='*60}")
print(f"Overall: {'ALL TESTS PASSED' if all_passed else 'SOME TESTS FAILED'}")
print(f"{'='*60}\n")
sys.exit(0 if all_passed else 1)
