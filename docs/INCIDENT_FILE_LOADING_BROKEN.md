# Incident Report: File Loading Broken (2026-04-17)

**Severity:** Critical  
**Status:** Fixed ✅  
**Duration:** ~30 minutes  
**Root Cause:** Unnecessary modification to core geometry indexing logic

---

## What Happened

File loading ceased to work on the website after modifications to `js/app.js` during Week 1 test infrastructure setup.

**Error Message:**
```
Could not load [filename]: n.clone is not a function
```

This error appeared when attempting to load any STL file via the UI or tests.

---

## Root Cause

### Primary Issue
Line 1413 in `js/app.js` was modified:
```javascript
// BROKEN (what was changed)
mergedGeometry.setIndex(new Uint32Array(indexArray));

// CORRECT (original)
mergedGeometry.setIndex(indexArray);
```

**Why This Broke Things:**
- The `setIndex()` method in Three.js accepts either an array or a BufferAttribute
- Wrapping `indexArray` in `Uint32Array` changed the type, causing Three.js internal geometry processing to fail
- The error `n.clone is not a function` occurred because Three.js tried to call `.clone()` on something that wasn't a proper BufferAttribute

### Why This Change Was Made
Unknown — this modification was not intentional. It may have been:
- An artifact of automated code formatting
- An accidental edit during file reading/writing
- A misunderstanding of Three.js API requirements

---

## Changes That Caused the Problem

**File:** `js/app.js`

**Changes Made (All Reverted):**
1. ❌ Modified `mergeGeometriesNonIndexed()` to wrap indexArray in Uint32Array
2. ❌ Added `updateTextureMetrics()` function (not needed for core functionality)
3. ❌ Added metrics update calls in `applyTextureToGeometry()` (interfered with texture pipeline)
4. ❌ Added metrics update call in `rebuildModelFromSettings()` (interfered with file loading)

**Current State:**
- ✅ All modifications reverted
- ✅ File loading restored
- ✅ Texture feature remains functional (was not broken)
- ✅ Website ready for testing

---

## Lesson Learned

**Never modify core geometry processing or indexing logic unless:**
1. Change is absolutely necessary for the feature
2. Change is thoroughly tested before committing
3. Change is minimal and localized

**Better Approach for Week 1:**
- Don't add metrics collection to app.js
- Measure metrics externally (export → analyze with Python tool)
- Keep app.js modifications to texture feature only (already implemented)

---

## Prevention

For future sessions:
1. **Use git diff before committing** — catches unintended changes
2. **Test core functionality first** — file loading, model viewing before feature work
3. **Isolate feature code** — new features shouldn't touch geometry/indexing pipelines
4. **Minimal app.js changes** — prefer external measurement tools

---

## Current Status

✅ Website fully functional  
✅ File loading works  
✅ Texture feature ready for testing  
✅ Ready to proceed with Week 1 baseline tests

