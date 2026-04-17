# Surface Texture Feature — Complete Implementation

**Date:** 2026-04-17  
**Commit:** 28d590b  
**Scope:** Hemispherical bumps, mesh weave, apply spinner, upgrade plan

---

## What Was Built

The surface texture feature lets you select a region of a loaded 3D model by clicking on it,
then apply a repeating texture (bumps or weave stripes) to that region. The textured geometry
replaces the original and can be exported as STL for 3D printing.

---

## How the Feature Works

### Selecting Faces

When you open the texture panel and click the model, the code does a **raycaster hit test** —
it casts a ray from the camera through the screen pixel you clicked and finds which triangle
was hit. It then does a **flood-fill** (breadth-first search) starting from that triangle,
spreading to adjacent triangles as long as their surface normals are within 30° of the first
triangle's normal. This is how "clicking the top face" selects all connected faces pointing
roughly the same direction, without selecting the sides or bottom.

The selected faces are stored in `selectedFaceIndices` (a `Set`) and highlighted with a green
transparent overlay mesh.

### Hemispherical Bumps

The bump algorithm works in 2D projected space:

1. It computes the **average surface normal** of all selected faces and builds two axes
   perpendicular to it (`uAxis`, `vAxis`) — this defines a flat coordinate frame.
2. All selected face vertices are projected onto this flat frame, finding the bounding box.
3. A regular grid of points is placed across the bounding box with the user's chosen spacing.
4. For each grid point, the algorithm finds the **nearest selected face** (by centroid distance),
   projects the grid point onto that face's plane, and tests whether the projected point lands
   **inside the triangle** using barycentric coordinates. If yes, a bump goes there.
5. Each bump is a `THREE.SphereGeometry` hemisphere, rotated to align with the face's normal
   and translated to the projected position.
6. All hemispheres are concatenated (as raw `Float32Array` data) with the original mesh to
   produce the new geometry.

The **barycentric test** is the key to coverage precision — a bump is only placed if the grid
point actually falls inside a selected triangle, not just nearby. This prevents bumps from
appearing on unselected faces.

### Mesh Weave

The weave works differently — it displaces existing geometry rather than adding new shapes:

1. Each selected face is **recursively subdivided** until the edge length is smaller than
   `cellSize / 4`. This ensures the mesh is dense enough for the displacement to look smooth.
2. Each subdivided vertex is displaced along the face's normal by `height × meshValue()`,
   where `meshValue` returns 1 for vertices on a "strand" of the weave pattern and 0 elsewhere.
3. The pattern is two families of diagonal stripes crossing at 90°, sampled from world
   X/Z coordinates. Vertices on unselected faces are left completely unchanged.

### Apply/Reset Lifecycle

Before applying, the function saves a clone of the original geometry as `preTextureBaseGeometry`.
After applying, the new textured geometry replaces the base geometry and the model rebuilds
from it. The Reset button restores the saved clone. This gives a single-level undo.

**A subtle bug we fixed:** `clearCurrentModel()` (called inside `rebuildModelFromSettings()`)
was nulling out `preTextureBaseGeometry`. The fix: save `preTextureBaseGeometry` to a local
variable before calling `rebuildModelFromSettings()`, then restore it afterward.

---

## The Apply Spinner

JavaScript is **single-threaded** — while the bump computation runs, the browser cannot update
the screen. If you click Apply and the operation takes 3 seconds, the button appears frozen the
entire time.

The fix uses `setTimeout` with a 30ms delay:

```javascript
textureApplyBtn.disabled = true;
label.textContent = "Applying…";
spinner.hidden = false;

setTimeout(() => {
  // heavy computation runs here
  applyTextureToGeometry();
  // reset button label after
}, 30);
```

The 30ms delay gives the browser one repaint cycle before the blocking work starts, so the
user sees the spinner appear. This is a standard pattern for showing loading state before
synchronous heavy work in browser JavaScript.

The spinner itself is a pure CSS animation — a circle with a transparent top border rotating
continuously with `@keyframes`. No images, no library needed.

---

## Why Curved Surfaces Don't Work Well

The bump algorithm uses a **single flat coordinate frame** (one average normal → one uAxis/vAxis
plane). This is perfect for flat surfaces where all normals point the same way. On a curved
surface (like the outer wall of a ring), faces point in many different directions. The average
normal points "somewhere in between" and the flat 2D grid misses the faces that curve away from
the average.

The mesh weave uses **world X/Z coordinates** for the stripe pattern. On tilted or vertical
surfaces, these world coordinates compress (the stripes get denser or sparser) in a way that
isn't uniform across the surface.

The upgrade plan at `docs/TEXTURE_UPGRADE_PLAN.md` documents four phases of improvement:
- **Phase 1:** Cluster faces by normal direction, apply separate frames per cluster (handles
  multi-flat bodies like the baseplate immediately).
- **Phase 2:** Walk the mesh surface using graph distances (geodesic) to space bumps — the only
  approach that handles true continuous curves.
- **Phase 3:** Switch weave to local face UV coordinates instead of world XZ.
- **Phase 4:** Geometry validation for 3D printing.

---

## Testing: Finding the Right Click Position

One interesting debugging challenge: the Playwright test for flood-fill clicked on the ring
model at 75% across the canvas and 30% down, but the raycaster returned zero hits. Adding
debug logging revealed `meshCenterNDC=(0.000,0.000)` — the ring center projected to the exact
center of the screen. This meant the orbit controls' camera target was the ring center, so
clicking at "75% across" was actually clicking far outside the ring's footprint.

**NDC (Normalized Device Coordinates)** range from -1 to +1 across both axes. The ring's outer
edge was at NDC radius ≈ 0.35 (calculated from the ring's 50mm diameter and the ~94mm camera
distance with a 75° field of view: `tan(arctan(25/94)) / tan(37.5°) ≈ 0.35`). The correct
test click at canvas fraction (0.67, 0.45) maps to NDC ≈ (0.34, 0.10), which lands on the
ring body.

---

## Key Concepts Introduced

- **Raycasting in Three.js**: `Raycaster.setFromCamera(mouse, camera)` + `intersectObject(mesh)` 
  for converting screen clicks to 3D hit tests
- **Barycentric coordinates**: Testing whether a point is inside a triangle by checking the
  signs of cross products at each edge
- **BFS queue optimization**: `Array.shift()` is O(n) — for a 21K-face mesh this made every
  flood-fill O(n²) and caused freezes. Using a head pointer (`queue[head++]`) restores O(n).
- **setTimeout for UI updates before synchronous work**: Yielding the thread so the browser can
  repaint before blocking computation begins
- **CSS spinner**: `border-top-color: transparent` + `animation: spin infinite` creates a
  rotating arc with a single `<span>` element
