---
note_for_ai: Don't edit this file without user request/approval. When you do, use the quality-prompting skill.
---

This document describes project goals/requirements for my PersonalWebsite.

## Language
Write concisely to maximize information density and minimize context cost.

Avoid absolute-claim words: "perfect", "flawless", "exactly", "completely", "fully resolved", "works correctly". Replace with measurable outcomes: pass counts, metric values, specific criteria met or unmet.

## Test Output Summary Format

Each closed or ongoing test run must have a corresponding entry in `Testoutput/TEST_SUMMARY.md`. Use this structure:

```
## <Issue Title>
**Date:** YYYY-MM-DD
**Status:** Resolved | Ongoing | Regression check
**Active:** <active artifact filenames, if any>
**Archive:** <archived artifact filenames>

### Problem
What failed or was being verified, and why.

### Tests Used
Test suite name, browser, pass/fail counts; list individual tests if fewer than ~8.

### Interpretation
What the results indicate. Cite specific metrics. State whether the issue is closed or what remains.
```

Archived artifacts go to `Testoutput/archive/`. Temp or unlabeled files also belong in archive with a note in the Temp section.

## Skills

Generate and define new skills when necessary

### Agents

Define subagents for context preservation when necessary.

---

## Parametric STEP Export

Convert a loaded STL mesh to an analytical STEP solid by detecting mathematical surface primitives via RANSAC and exporting as a B-rep solid.

- Endpoint: POST `/api/convert/stl-to-step-parametric`
- Script: `tools/convert-stl-to-step-parametric-with-freecad.py`
- Dependencies: pyransac3d + trimesh in FreeCAD's Python env

### Phase A — complete

Classify faces by normal direction: cylinders (|nz| < 0.30), planes (|nz| > 0.85). Fit primitives via pyransac3d. Reject cylinders misaligned >11° from body axis (coaxiality constraint). Output `CYLINDRICAL_SURFACE` + `PLANE` via FreeCAD CSG.

Success criterion: `TestDocs/MeshRing1.stl` exports with ≥57.9% analytical coverage.

### Phase B — tori (fillets)

Fit tori to remaining intermediate-normal faces using foot-circle RANSAC: `foot = face_center - r * face_normal`; fit a circle to foot points to recover center C, axis A, and major radius R. Fix axis to Phase A body axis; solve only for R and r.

Use CSG fallback (`Part.makeTorus()`) before attempting full B-rep trim curve assembly. Output adds `TOROIDAL_SURFACE` entities.

Success criteria: MeshRing1 ≥95% coverage; `TestDocs/Station_3_Baseplate - Part 1.stl` ≥99% coverage.

### Phase C — swept and freeform surfaces

Three sub-phases targeting geometry not representable by planes, cylinders, or tori.

#### C-1 — Elliptic cylinders

Fit ellipse to unclaimed face centres projected onto best-fit plane (`cv2.fitEllipse` or `scipy.optimize`). Output: `SURFACE_OF_LINEAR_EXTRUSION(ELLIPSE)`.

#### C-2 — Surfaces of revolution

Project unclaimed faces onto candidate revolution axis; compute radial profile r(z); fit B-spline curve. Output: `SURFACE_OF_REVOLUTION` with B-spline profile.

#### C-3 — Free swept surfaces

Pipeline: medial axis skeleton → B-spline spine fit → Frenet frame slicing → 2D cross-section extraction → profile classification. Use named STEP entity when profile matches a known type (ellipse, compound arc/line); otherwise fit `B_SPLINE_SURFACE_WITH_KNOTS` via `geomdl`. Compute trim curves via `BRepAlgoAPI_Section`.

Success criterion: `TestDocs/CurvedMinimalPost-Onshape.stl` — ≥80% B-spline coverage, imports as smooth solid in Onshape, visual match within 0.05mm.
