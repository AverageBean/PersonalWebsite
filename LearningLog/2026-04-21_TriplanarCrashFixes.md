# 2026-04-21 — Triplanar Texture: Crash Root-Cause Fixes

## What Changed

Two categories of crash were occurring during triplanar texture tests. Four fixes were applied across the JS application code, the Python analysis tool, and the Playwright test files.

---

## Crash 1: 135 MB Export / Browser OOM

### Root Cause
The budget check in `applyMeshWeaveDisplacement` (js/app.js) sampled only the first 50 faces to estimate the worst-case triangle multiplication factor. On Aloy Focus (6,560 faces), the largest triangles — which have edges over 16mm — were almost never in that first 50. The budget estimator saw small faces, assumed low subdivision depth, and allowed the operation to proceed. The actual subdivision then hit level 5 (1024×) on the large faces, producing ~6.7 million triangles instead of the budgeted 1.68 million. The exported STL was 135 MB and crashed both the browser and the Python analysis tool.

### Fix
Removed the 50-face sampling cap entirely. The budget scan now iterates over every selected face to find the true maximum edge length before deciding whether to proceed.

```javascript
// Before (wrong — stopped at 50 faces)
for (const fIdx of selectedFaceIndices) {
  if (sampleN++ >= 50) break;
  ...
}

// After (correct — scans all faces)
for (const fIdx of selectedFaceIndices) {
  maxEdgeLen = Math.max(maxEdgeLen, ...edge lengths...);
}
```

**Why this matters for learning:** Sampling is a common optimization, but it only works when the sample is representative. A geometric mesh has no ordering guarantees — the "worst" face could be anywhere in the set. For a budget check that gates an irreversible operation, correctness matters more than speed.

---

## Crash 2: V8 Memory Spike During Weave Output Assembly

### Root Cause
The weave displacement function built its output using a plain JavaScript `Array` with repeated `.push()` calls. V8 (the JavaScript engine in Chrome) starts a plain `Array` with a small internal capacity and doubles it every time the array outgrows its buffer. At 24+ million elements (for a large-face all-faces weave), this caused 20+ reallocations and peak memory 2–3× the final array size.

### Fix
Pre-allocate a `Float32Array` of the exact required capacity before the loop, then write by index:

```javascript
const maxSelectedFloats = selectedFaceIndices.size * estimatedMultiplier * 9;
const selectedPositions = new Float32Array(maxSelectedFloats);
let selWriteIdx = 0;
// Inside the recursion leaf:
selectedPositions[selWriteIdx++] = d0.x;
selectedPositions[selWriteIdx++] = d0.y;
// ...
```

**Why this matters for learning:** `Float32Array` is a typed array — it allocates exactly the memory you request, stores values as 4-byte floats (not 8-byte JS doubles), and never reallocates. For bulk geometry data this is both faster and far more memory-efficient than a plain Array.

---

## Crash 3: Python `ETIMEDOUT` from sklearn Import

### Root Cause
`analyze-texture-stl.py` had top-level imports of `scipy` and `sklearn`. On Windows, these packages take 20–60 seconds to import cold. The Playwright test called the script via Node.js `execSync` with a 30-second timeout. Even for a tiny STL that needed only basic geometry validation (no bump spacing analysis), the full sklearn import consumed the timeout before any real work happened.

### Fixes
1. **Lazy imports**: moved `from sklearn.cluster import DBSCAN` inside `detect_bump_clusters()` — only triggered when spatial clustering is actually needed (i.e. when a baseline STL is provided for comparison).
2. **Skip DBSCAN without baseline**: `compute_metrics()` now only calls spacing/height analysis when `baseline_stl_path` is not None. Geometry validation (zero-area triangles, degenerate vertices) runs on numpy alone and completes in under 1 second.

**Why this matters for learning:** Startup cost matters for subprocess tools. A Python script that does nothing but import heavy ML libraries still pays the full import tax. Lazy imports trade a tiny per-call overhead for a much faster common-case startup.

---

## Crash 4: Python OOM on Multi-Million-Triangle STL

### Root Cause
The existing `STLAnalyzer` class reads an STL by building Python `dict` objects mapping every vertex coordinate tuple to an index. At 2+ million triangles this creates 6+ million dict entries and exhausts available RAM.

### Fix
Added `fast_binary_stl_validate()`: reads the raw STL bytes directly into a numpy array, reshapes into per-triangle records, and checks geometry quality with vectorized operations — no dicts, no vertex deduplication:

```python
records = raw.reshape(n_triangles, 50)
v0 = np.frombuffer(records[:, 12:24].tobytes(), dtype=np.float32).reshape(n_triangles, 3)
cross = np.cross(v1 - v0, v2 - v0)
areas = np.linalg.norm(cross, axis=1) / 2
zero_area_count = int(np.sum(areas < 1e-6))
```

Files over 10 MB are automatically routed to this fast path. Non-manifold edge detection is skipped (requires an O(n) edge dict that would OOM at scale), but degenerate triangle detection remains accurate.

**Why this matters for learning:** Numpy vectorized operations on contiguous byte arrays are orders of magnitude faster and more memory-efficient than equivalent Python loops over dicts. The trick of reading the raw struct bytes directly — knowing each STL record is exactly 50 bytes — avoids the struct.unpack loop entirely.

---

## Playwright Test Fixes

### Hidden Input Fill Timeout
`#meshCellInput` lives inside a `display:none` div that only becomes visible when the mesh preset is selected. Playwright's `fill()` blocks until the element is visible — causing a ~90s timeout when called on a hidden input. Fix: always `selectOption('mesh')` before `fill()`.

### Cell Size Constraint (cellSize = 12mm)
Aloy Focus has faces with edges up to ~45mm. At default cellSize=2mm (subdivTarget=0.5mm), faces over 8mm trigger level-5 subdivision (1024×) → budget rejection. At cellSize=12mm (subdivTarget=3mm), all faces in a 45mm model stay at level ≤4 (256×): 6,560 × 256 = 1.68M < 2M budget. Tests that use `selectAllFaces()` on Aloy Focus must specify `cellSizeMm=12`.

---

## Test Results After Fixes

| Suite | Tests | Result | Time |
|-------|-------|--------|------|
| texture-triplanar.spec.js | 5/5 | PASS | 50s |
| texture-phase1-clusters.spec.js | 8/8 | PASS | 1.1m |

Key numbers:
- Aloy Focus bumps: **367** (up from 68 with original cluster approach)
- Baseplate bumps: **367** (regression guard ≥254 maintained)
- MeshRing1 bumps: **293**
- Aloy Focus weave export: 12,998 triangles, 0 degenerate, geometry valid
