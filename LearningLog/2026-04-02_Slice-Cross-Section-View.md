# Slice / Cross-Section View

**Date:** 2026-04-02
**Feature:** GPU-accelerated clipping plane with back-face interior rendering

---

## What Was Built

A cross-section viewer that lets you slice a 3D model along any axis (X/Y/Z) and see the interior. This reveals internal geometry like the helical spirals inside `HelicalTube1.stl` without modifying the mesh.

### Key Components

1. **Toggle button** in the overlay toolbar with a box-and-dashed-line SVG icon
2. **Slice panel** with axis radio buttons (X/Y/Z), position slider, flip toggle, and cap toggle
3. **GPU clipping plane** via Three.js `renderer.localClippingEnabled` + `material.clippingPlanes`
4. **Back-face interior mesh** that renders interior surfaces at the cut
5. **Border-only preview plane** showing cut position without obstructing the view
6. **Interactive drag** on the preview plane to reposition the cut in 3D

---

## How GPU Clipping Works

Three.js r128 supports hardware clipping planes — the GPU discards all fragments on one side of a mathematical plane before they reach the screen. This is extremely fast because no geometry is modified.

```javascript
renderer.localClippingEnabled = true;
material.clippingPlanes = [new THREE.Plane(normal, constant)];
```

A `THREE.Plane` is defined by a normal vector and a constant: `normal · point + constant = 0`. For a Y-axis cut at position `p`, the normal is `(0, 1, 0)` and the constant is `-p`. Everything below the plane is clipped away.

The "flip" toggle negates the normal, showing the opposite half.

---

## Interior Face Rendering — Approaches Tried

### Attempt 1: Stencil Buffer Cap (Abandoned)

The stencil buffer approach uses 3 meshes:
1. **Back stencil** — renders back faces (invisible), increments stencil buffer
2. **Front stencil** — renders front faces (invisible), decrements stencil buffer
3. **Cap plane** — a flat quad that only renders where stencil ≠ 0 (the interior)

This produces a flat solid fill at the cross-section. However, it failed in practice:
- With `depthTest: true` (default): the cap was invisible because it lost the depth test against the model geometry sitting at the same position
- With `depthTest: false`: the cap rendered everywhere the stencil was non-zero, including behind the model surface, creating a gray overlay that bled through

**Lesson:** Stencil techniques that work in textbooks assume specific render pass ordering. Three.js r128's single-pass renderer with `renderOrder` doesn't give enough control for reliable stencil compositing when the cap plane intersects the model.

### Attempt 2: Back-Face Rendering (Adopted)

Much simpler — a single mesh with `side: THREE.BackSide` sharing the same geometry:

```javascript
const backMat = new THREE.MeshStandardMaterial({
  color: getCapColor(currentPartColor),
  side: THREE.BackSide,
  clippingPlanes: [sliceClipPlane]
});
sliceBackMesh = new THREE.Mesh(currentFillMesh.geometry, backMat);
```

**Why it works:** Normally back faces (the inside of the mesh) are invisible because the front faces are in front of them. But when the clipping plane removes the front faces, the back faces behind them become the closest surface to the camera. Standard depth testing handles everything automatically.

**Benefits:**
- 1 mesh instead of 3
- Zero extra geometry memory (shares `geometry` reference)
- Shows actual interior topology (helical spirals, not just a flat fill)
- Works with standard depth testing — no stencil complexity

**Lesson:** The simplest approach that leverages existing GPU behaviour (depth testing) was far more robust than the "correct" textbook technique (stencil buffer). Always try the simple thing first.

---

## Interactive Drag with Camera Projection

The drag system lets you reposition the slice plane by dragging the preview border in 3D. It works for all three axes by projecting the axis direction into screen space:

```javascript
// Project two points along the slice axis to screen space
const worldA = new THREE.Vector3();
const worldB = new THREE.Vector3();
worldA.setComponent(axisIndex, range.min);
worldB.setComponent(axisIndex, range.max);
worldA.project(camera);
worldB.project(camera);

// Compute screen-space direction and scale
const screenDir = new THREE.Vector2(worldB.x - worldA.x, worldB.y - worldA.y);
const screenLen = screenDir.length();
screenDir.normalize();

// Map mouse delta to world displacement
const mouseDelta = new THREE.Vector2(dx, dy);
const projected = mouseDelta.dot(screenDir);
const worldDelta = (projected / screenLen) * (range.max - range.min);
```

This correctly handles arbitrary camera angles — dragging up/down/left/right on screen always moves the plane along the correct world axis.

---

## Preview Plane: Filled vs Border-Only

The initial implementation used a translucent filled `PlaneGeometry`. User feedback: it obstructs the view of the interior. Solution: `THREE.Group` containing:
- An invisible hit mesh (for raycaster intersection during drag)
- A `THREE.LineLoop` border (visible orange outline)

This preserves drag functionality while maximizing visibility of the cross-section.

---

## Lifecycle Integration Points

The slice feature needed careful integration with existing viewer lifecycle:

| Event | Slice Response |
|-------|----------------|
| New file loaded | Reset: hide panel, remove clipping, dispose meshes |
| Refinement rebuild | Save state → rebuild → restore (axis, position, flip, cap) |
| View style change | Hide back-face mesh in wireframe mode (no solid to cap) |
| Part color change | Update back-face mesh color (derived via HSL) |
| Scale/transform | Re-clamp position to new bounds |

**Key bug found:** `clearCurrentModel()` was disposing `currentModelRoot` before `removeSliceClipping()` tried to access it. Fix: move slice cleanup to before model teardown.

---

## Testing Strategy

9 Playwright tests covering:
- **State:** toggle disabled/enabled based on model load
- **UI:** panel show/hide with ARIA state
- **Defaults:** Y axis, flip unchecked, cap checked
- **Range:** slider matches model bounding box
- **Axis switching:** slider range updates
- **Lifecycle:** panel resets on new file load
- **GPU validation:** pixel comparison before/after clipping (WebGL2 readPixels)
- **Coexistence:** mold and slice panels open simultaneously
- **Visual:** HelicalTube1 screenshot for regression baseline

The GPU pixel test reads canvas pixels via `getContext("webgl2").readPixels()` — important to use `webgl2` not `webgl` because Three.js r128 creates a WebGL2 context by default.
