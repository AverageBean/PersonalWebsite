document.addEventListener("DOMContentLoaded", () => {
  const viewerCanvas = document.getElementById("viewerCanvas");
  const dropZone = document.getElementById("dropZone");
  const fileInput = document.getElementById("fileInput");
  const resetCameraButton = document.getElementById("resetCameraButton");
  const statusMessage = document.getElementById("statusMessage");
  const statusText = document.getElementById("statusText");
  const conversionSpinner = document.getElementById("conversionSpinner");
  const fileNameOutput = document.getElementById("fileName");
  const triangleCountOutput = document.getElementById("triangleCount");
  const dimXInput = document.getElementById("dimX");
  const dimYInput = document.getElementById("dimY");
  const dimZInput = document.getElementById("dimZ");
  const bboxToggleBtn = document.getElementById("bboxToggleBtn");
  const controlPresetSelect = document.getElementById("controlPreset");
  const viewStyleSelect = document.getElementById("viewStyle");
  const backgroundStyleSelect = document.getElementById("backgroundStyle");
  const gridToggleBtn = document.getElementById("gridToggleBtn");
  const refinementSlider = document.getElementById("refinementSlider");
  const refinementValueOutput = document.getElementById("refinementValue");
  const refinementMinHint = document.getElementById("refinementMinHint");
  const refinementMaxHint = document.getElementById("refinementMaxHint");
  const usageTip = document.getElementById("usageTip");
  const partColorInput = document.getElementById("partColor");
  const exportFormatSelect = document.getElementById("exportFormat");
  const downloadExportButton = document.getElementById("downloadExportButton");
  const exportHint = document.getElementById("exportHint");
  const conversionResult  = document.getElementById("conversionResult");
  const crPctCyl          = document.getElementById("crPctCyl");
  const crPctPlane        = document.getElementById("crPctPlane");
  const crPctFillet       = document.getElementById("crPctFillet");
  const crCylinders       = document.getElementById("crCylinders");
  const crPlanes          = document.getElementById("crPlanes");
  const crCoverage        = document.getElementById("crCoverage");
  const crMode            = document.getElementById("crMode");
  const scaleHalfBtn = document.getElementById("scaleHalfBtn");
  const scaleDoubleBtn = document.getElementById("scaleDoubleBtn");
  const scaleDisplay = document.getElementById("scaleDisplay");
  const minimizeFootprintBtn = document.getElementById("minimizeFootprintBtn");
  const uniformScaleCheckbox = document.getElementById("uniformScaleCheckbox");

  // ── Tab switching ──────────────────────────────────────────────────────
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      tabBtns.forEach(b => {
        b.classList.toggle('is-active', b === btn);
        b.setAttribute('aria-selected', String(b === btn));
      });
      tabPanes.forEach(p => p.classList.toggle('is-active', p.id === `tab-${target}`));
      if (target === 'stl-viewer') {
        window.dispatchEvent(new Event('resize'));
      }
    });
  });

  if (!window.THREE || !THREE.OrbitControls || !THREE.STLLoader) {
    statusText.textContent = "Three.js failed to load. Check your internet connection and refresh.";
    return;
  }

  const MAX_TRIANGLES = 2000000;
  const MIN_MULTIPLIER = 0.1;
  const MAX_MULTIPLIER = 16;
  const MULTIPLIER_STEP = 0.1;
  const SUPPORTED_INPUT_EXTENSIONS = new Set(["stl", "sldprt"]);
  const CONVERTER_API_BASE = window.CAD_CONVERTER_URL || "http://127.0.0.1:8090";
  const BACKGROUND_STYLES = {
    lab: {
      label: "Lab Light",
      sceneColor: 0xe2e9f3,
      gridCenterColor: 0xa9b9c8,
      gridColor: 0xcfd8e3
    },
    neutral: {
      label: "Neutral Gray",
      sceneColor: 0xe6e7ea,
      gridCenterColor: 0xb2b6bd,
      gridColor: 0xd0d3d9
    },
    dark: {
      label: "Dark Studio",
      sceneColor: 0x1b2029,
      gridCenterColor: 0x536074,
      gridColor: 0x394353
    },
    warm: {
      label: "Warm Paper",
      sceneColor: 0xf1e8d8,
      gridCenterColor: 0xc7ad86,
      gridColor: 0xe2d2b6
    }
  };
  const EXPORT_FORMATS = {
    stl: {
      extension: "stl",
      mime: "model/stl",
      requires: () => Boolean(THREE.STLExporter)
    },
    obj: {
      extension: "obj",
      mime: "text/plain",
      requires: () => Boolean(THREE.OBJExporter)
    },
    glb: {
      extension: "glb",
      mime: "model/gltf-binary",
      requires: () => Boolean(THREE.GLTFExporter)
    },
    step: {
      extension: "step",
      mime: "model/step",
      requires: () => true,
      hint: "Requires the local converter service (npm run convert:start). "
        + "Produces a solid body importable into Onshape and FreeCAD. "
        + "Faces follow the original triangles — not parametric."
    },
    "step-parametric": {
      extension: "step",
      mime: "model/step",
      requires: () => true,
      hint: "Requires the local converter service (npm run convert:start). "
        + "Detects cylinders and planes via RANSAC and reconstructs them as "
        + "analytical surfaces. Best on prismatic/machined parts. "
        + "Falls back to triangulated STEP for complex regions."
    }
  };

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe2e9f3);

  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 5000);
  // preserveDrawingBuffer keeps the framebuffer alive after composition so that
  // gl.readPixels works for pixel-level tests and potential future canvas exports.
  // The swap-chain optimisation it trades away is not meaningful for a single-mesh viewer.
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  viewerCanvas.appendChild(renderer.domElement);

  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = true;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a9bad, 0.85));

  const keyLight = new THREE.DirectionalLight(0xffffff, 0.95);
  keyLight.position.set(160, 140, 110);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
  fillLight.position.set(-140, 70, -90);
  scene.add(fillLight);

  const gridHelper = new THREE.GridHelper(260, 24, 0xa9b9c8, 0xcfd8e3);
  scene.add(gridHelper);

  const stlLoader = new THREE.STLLoader();
  let currentModelRoot = null;
  let currentFillMesh = null;
  let currentWireMesh = null;
  let currentEdgeLines = null;
  let currentBounds = null;
  let baseGeometry = null;
  let currentFileName = "";
  let currentFileStem = "";
  let sliderDebounceTimer = null;
  let scaleX = 1.0;
  let scaleY = 1.0;
  let scaleZ = 1.0;
  let isUniformScale = true;
  let savedLocalBounds = null;
  let box3Helper = null;
  let bboxOverlayActive = false;
  let gridVisible = true;
  let currentPartColor = 0x4c86a8;

  function resizeRenderer() {
    const width = viewerCanvas.clientWidth;
    const height = viewerCanvas.clientHeight;

    if (!width || !height) {
      return;
    }

    // Keep CSS size matched to the container; drawing buffer scaling is handled by pixel ratio.
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function setStatus(message) {
    statusText.textContent = message;
  }

  function getFileExtension(fileName) {
    if (!fileName || typeof fileName !== "string") {
      return "";
    }

    const dotIndex = fileName.lastIndexOf(".");
    if (dotIndex < 0 || dotIndex === fileName.length - 1) {
      return "";
    }

    return fileName.slice(dotIndex + 1).toLowerCase();
  }

  function stripFileExtension(fileName) {
    if (!fileName || typeof fileName !== "string") {
      return "model";
    }

    const dotIndex = fileName.lastIndexOf(".");
    if (dotIndex <= 0) {
      return fileName;
    }

    return fileName.slice(0, dotIndex);
  }

  function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = event => resolve(event.target.result);
      reader.onerror = () => reject(new Error("The file could not be read from disk."));
      reader.readAsArrayBuffer(file);
    });
  }

  function clamp(value, minValue, maxValue) {
    return Math.max(minValue, Math.min(maxValue, value));
  }

  function snapMultiplier(value) {
    const snapped = Math.round(value / MULTIPLIER_STEP) * MULTIPLIER_STEP;
    return Number(snapped.toFixed(2));
  }

  function formatDimension(value) {
    return Number.isFinite(value) ? value.toFixed(2) : "0.00";
  }

  function getTriangleCount(geometry) {
    if (!geometry) {
      return 0;
    }

    const position = geometry.getAttribute("position");
    if (!position) {
      return 0;
    }

    return geometry.index ? geometry.index.count / 3 : position.count / 3;
  }

  function getRefinementBounds() {
    if (!baseGeometry) {
      return {
        min: MIN_MULTIPLIER,
        max: MAX_MULTIPLIER
      };
    }

    const baseTriangles = Math.max(getTriangleCount(baseGeometry), 1);
    const budgetLimit = MAX_TRIANGLES / baseTriangles;

    return {
      min: Math.max(0.01, Math.min(MIN_MULTIPLIER, budgetLimit)),
      max: Math.max(Math.max(0.01, Math.min(MIN_MULTIPLIER, budgetLimit)), Math.min(MAX_MULTIPLIER, budgetLimit))
    };
  }

  function updateRefinementUi(multiplier, bounds) {
    refinementSlider.min = bounds.min.toFixed(2);
    refinementSlider.max = bounds.max.toFixed(2);
    refinementSlider.step = MULTIPLIER_STEP.toFixed(2);
    refinementSlider.value = multiplier.toFixed(2);

    refinementValueOutput.textContent = `${multiplier.toFixed(2)}x`;
    refinementMinHint.textContent = `${bounds.min.toFixed(2)}x min`;
    refinementMaxHint.textContent = `${bounds.max.toFixed(2)}x max`;
  }

  function normalizeRequestedMultiplier(rawValue, bounds) {
    const clamped = clamp(rawValue, bounds.min, bounds.max);
    return clamp(snapMultiplier(clamped), bounds.min, bounds.max);
  }

  function updateMetrics(fileName, geometry) {
    const triangles = getTriangleCount(geometry);
    const size = currentBounds.getSize(new THREE.Vector3());

    fileNameOutput.textContent = fileName;
    triangleCountOutput.textContent = Math.round(triangles).toLocaleString();
    // Only update each input if the user isn't actively editing it.
    if (dimXInput && document.activeElement !== dimXInput) dimXInput.value = formatDimension(size.x);
    if (dimYInput && document.activeElement !== dimYInput) dimYInput.value = formatDimension(size.y);
    if (dimZInput && document.activeElement !== dimZInput) dimZInput.value = formatDimension(size.z);
    updateBboxPreview();
  }

  function getSelectedExportConfig() {
    const key = exportFormatSelect ? exportFormatSelect.value : "stl";
    return EXPORT_FORMATS[key] || EXPORT_FORMATS.stl;
  }

  function updateExportUiState() {
    if (!downloadExportButton || !exportHint) {
      return;
    }

    const exportConfig = getSelectedExportConfig();
    const hasGeometry = Boolean(currentFillMesh && currentFillMesh.geometry);
    const hasExporter = exportConfig.requires();

    downloadExportButton.disabled = !(hasGeometry && hasExporter);

    if (!hasGeometry) {
      exportHint.textContent = "Load a model to enable export downloads.";
      return;
    }

    if (!hasExporter) {
      exportHint.textContent = `The exporter for .${exportConfig.extension} is unavailable in this browser session.`;
      return;
    }

    exportHint.textContent = exportConfig.hint || `Download the loaded model as .${exportConfig.extension}.`;
  }

  function resetCameraToBounds() {
    if (!currentBounds) {
      return;
    }

    resizeRenderer();

    const center = currentBounds.getCenter(new THREE.Vector3());
    const size = currentBounds.getSize(new THREE.Vector3());
    // Use the actual bounding-sphere radius with only a degenerate-geometry floor.
    // A fixed minimum (e.g. 0.5) would push the camera far back for micro-scale parts,
    // making them appear as a dot even after a zoom-to-fit.
    const radius = Math.max(size.length() * 0.5, 1e-4);
    const minAspect = 0.01;
    const safeAspect = Math.max(camera.aspect || 1, minAspect);
    const verticalFov = THREE.MathUtils.degToRad(camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * safeAspect);
    const limitingFov = Math.max(Math.min(verticalFov, horizontalFov), THREE.MathUtils.degToRad(8));

    // Keep the current orbit angle when possible so reset does not jump to a hardcoded view.
    const viewDirection = camera.position.clone().sub(controls.target);
    if (viewDirection.lengthSq() < 1e-6) {
      viewDirection.set(0.68, 0.46, 0.57);
    }
    viewDirection.normalize();

    // Bounding-sphere fit is conservative but stable: the model remains centered and fully visible.
    const fitDistance = (radius / Math.sin(limitingFov / 2)) * 1.08;

    camera.position.copy(center).addScaledVector(viewDirection, fitDistance);
    // Scale near/far relative to fitDistance so depth precision is preserved at any model scale.
    camera.near = Math.max(fitDistance - radius * 1.5, fitDistance * 0.01);
    camera.far = Math.max(fitDistance + radius * 6, camera.near + fitDistance * 2);
    camera.updateProjectionMatrix();

    controls.target.copy(center);
    // Remove fixed-unit floors from orbit limits so tiny parts remain navigable.
    controls.minDistance = Math.max(radius * 0.12, fitDistance * 0.01);
    controls.maxDistance = Math.max(radius * 45, 200);
    const wasDampingEnabled = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = wasDampingEnabled;
    controls.update();
  }

  function resetToDefaultView() {
    camera.position.set(170, 110, 170);
    camera.near = 0.1;
    camera.far = 5000;
    camera.updateProjectionMatrix();
    controls.target.set(0, 0, 0);
    controls.update();
  }

  function clearCurrentModel() {
    if (!currentModelRoot) {
      return;
    }

    scene.remove(currentModelRoot);

    if (currentFillMesh && currentFillMesh.material) {
      currentFillMesh.material.dispose();
    }

    if (currentWireMesh && currentWireMesh.material) {
      currentWireMesh.material.dispose();
    }

    if (currentEdgeLines && currentEdgeLines.material) {
      currentEdgeLines.material.dispose();
    }

    if (currentEdgeLines && currentEdgeLines.geometry) {
      currentEdgeLines.geometry.dispose();
    }

    if (currentFillMesh && currentFillMesh.geometry) {
      currentFillMesh.geometry.dispose();
    }

    if (currentWireMesh && currentWireMesh.geometry) {
      currentWireMesh.geometry.dispose();
    }

    currentModelRoot = null;
    currentFillMesh = null;
    currentWireMesh = null;
    currentEdgeLines = null;
    currentBounds = null;
    savedLocalBounds = null;
    conversionResult.hidden = true;
    updateExportUiState();
    updateTransformRowState();
  }

  function updateTransformRowState() {
    const hasModel = Boolean(currentFillMesh);
    if (scaleHalfBtn) scaleHalfBtn.disabled = !hasModel;
    if (scaleDoubleBtn) scaleDoubleBtn.disabled = !hasModel;
    if (minimizeFootprintBtn) minimizeFootprintBtn.disabled = !hasModel;
    if (uniformScaleCheckbox) uniformScaleCheckbox.disabled = !hasModel;
    if (dimXInput) dimXInput.disabled = !hasModel;
    if (dimYInput) dimYInput.disabled = !hasModel;
    if (dimZInput) dimZInput.disabled = !hasModel;
    if (!hasModel) {
      if (dimXInput) dimXInput.value = "";
      if (dimYInput) dimYInput.value = "";
      if (dimZInput) dimZInput.value = "";
      if (scaleDisplay) scaleDisplay.textContent = "1.00×";
    }
    updateBboxPreview();
  }

  // Keeps the Three.js Box3Helper in sync with currentBounds and bboxOverlayActive.
  function syncBox3Helper() {
    if (!bboxOverlayActive || !currentBounds || !currentFillMesh) {
      if (box3Helper) {
        box3Helper.visible = false;
      }
      return;
    }

    if (!box3Helper) {
      box3Helper = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color(0x0f6e8c));
      scene.add(box3Helper);
    }

    box3Helper.box.copy(currentBounds);
    box3Helper.visible = true;
  }

  // Syncs the bbox toggle button's active/disabled state and the 3D overlay.
  function updateBboxPreview() {
    const hasModel = Boolean(currentFillMesh);
    if (bboxToggleBtn) {
      bboxToggleBtn.disabled = !hasModel;
      bboxToggleBtn.classList.toggle("is-active", hasModel && bboxOverlayActive);
      bboxToggleBtn.setAttribute("aria-pressed", String(hasModel && bboxOverlayActive));
    }
    syncBox3Helper();
  }

  // Computes the uniform scale factor that makes the given axis equal to mmValue,
  // applies it, and refreshes all dependent UI.
  function applyDimensionInput(axis, mmValue) {
    if (!savedLocalBounds || !currentModelRoot || !currentFillMesh) {
      return;
    }

    if (!Number.isFinite(mmValue) || mmValue <= 0) {
      return;
    }

    const baseSize = savedLocalBounds.getSize(new THREE.Vector3());
    const baseDim = axis === "x" ? baseSize.x : axis === "y" ? baseSize.y : baseSize.z;

    if (baseDim < 1e-10) {
      return;
    }

    const newScale = clamp(mmValue / baseDim, 1 / 64, 64);
    let sx = scaleX, sy = scaleY, sz = scaleZ;

    if (isUniformScale) {
      sx = sy = sz = newScale;
    } else {
      if (axis === "x") sx = newScale;
      else if (axis === "y") sy = newScale;
      else sz = newScale;
    }

    applyModelTransform(sx, sy, sz);
    updateMetrics(currentFileName, currentFillMesh.geometry);
    resetCameraToBounds();
    setStatus(`${axis.toUpperCase()} = ${formatDimension(mmValue)} mm (${newScale.toFixed(3)}×).`);
  }

  // Attaches Enter/Escape/blur handlers to a dimension input.
  function bindDimInput(inputEl, axis) {
    if (!inputEl) {
      return;
    }

    let preFocusValue = "";

    inputEl.addEventListener("focus", () => {
      preFocusValue = inputEl.value;
      inputEl.select();
    });

    inputEl.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        e.preventDefault();
        inputEl.blur();
      }

      if (e.key === "Escape") {
        inputEl.value = preFocusValue;
        inputEl.blur();
      }
    });

    inputEl.addEventListener("blur", () => {
      const v = parseFloat(inputEl.value);
      if (Number.isFinite(v) && v > 0) {
        applyDimensionInput(axis, v);
      } else {
        // Restore last valid value
        if (currentBounds) {
          const size = currentBounds.getSize(new THREE.Vector3());
          const dim = axis === "x" ? size.x : axis === "y" ? size.y : size.z;
          inputEl.value = formatDimension(dim);
        } else {
          inputEl.value = "";
        }
      }
    });
  }

  // Sets uniform scale on the model root, recalculates the grid-rest lift, and
  // updates currentBounds in world space. Must be called after savedLocalBounds is set.
  // Applies per-axis scale, updates grid lift, world-space bounds, and scale display.
  function applyModelTransform(sx, sy, sz) {
    if (!currentModelRoot || !savedLocalBounds) {
      return;
    }

    scaleX = sx;
    scaleY = sy;
    scaleZ = sz;
    currentModelRoot.scale.set(sx, sy, sz);

    // Lift model so its base sits on Y=0 after Y-scaling.
    const liftY = -savedLocalBounds.min.y * sy;
    currentModelRoot.position.y = liftY;

    // Rebuild world-space bounds from local bounds, per-axis scale, and lift.
    currentBounds = new THREE.Box3(
      new THREE.Vector3(
        savedLocalBounds.min.x * sx,
        savedLocalBounds.min.y * sy + liftY,
        savedLocalBounds.min.z * sz
      ),
      new THREE.Vector3(
        savedLocalBounds.max.x * sx,
        savedLocalBounds.max.y * sy + liftY,
        savedLocalBounds.max.z * sz
      )
    );

    if (scaleDisplay) {
      if (sx === sy && sy === sz) {
        scaleDisplay.textContent = `${sx.toFixed(2)}×`;
      } else {
        scaleDisplay.textContent = "—";
      }
    }
  }

  // Tests all 6 axis-aligned face-down orientations, picks the one with the
  // smallest XZ bounding-box footprint, bakes it into baseGeometry, and rebuilds.
  function minimizeFootprint() {
    if (!baseGeometry) {
      return;
    }

    // Each Euler brings a different face to point downward (-Y = toward the grid).
    const orientations = [
      new THREE.Euler(0,             0, 0,            "XYZ"),  // +Y up (default)
      new THREE.Euler(Math.PI,       0, 0,            "XYZ"),  // -Y up
      new THREE.Euler(0,             0,  Math.PI / 2, "XYZ"),  // -X up
      new THREE.Euler(0,             0, -Math.PI / 2, "XYZ"),  // +X up
      new THREE.Euler(-Math.PI / 2,  0, 0,            "XYZ"),  // +Z up
      new THREE.Euler( Math.PI / 2,  0, 0,            "XYZ")   // -Z up
    ];

    let bestArea = Infinity;
    let bestMatrix = null;

    const rotMatrix = new THREE.Matrix4();
    // Reuse one BufferGeometry across all 6 probes to avoid repeated allocation.
    const probeGeom = new THREE.BufferGeometry();
    const srcPos = baseGeometry.getAttribute("position");

    orientations.forEach(euler => {
      rotMatrix.makeRotationFromEuler(euler);
      probeGeom.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(srcPos.array.slice(), 3)
      );
      probeGeom.applyMatrix4(rotMatrix);
      probeGeom.computeBoundingBox();

      const size = probeGeom.boundingBox.getSize(new THREE.Vector3());
      const area = size.x * size.z;

      if (area < bestArea) {
        bestArea = area;
        bestMatrix = rotMatrix.clone();
      }
    });

    probeGeom.dispose();

    if (!bestMatrix) {
      return;
    }

    // Bake the winning rotation permanently into baseGeometry, then rebuild.
    baseGeometry.applyMatrix4(bestMatrix);
    centerGeometryAtOrigin(baseGeometry);
    baseGeometry.computeBoundingBox();

    // Rotation changes the geometry axes, so per-axis scale no longer maps to
    // the original dimensions. Reset to 1× so the display is not misleading.
    scaleX = scaleY = scaleZ = 1.0;
    rebuildModelFromSettings();
    setStatus("Model reoriented to minimize XZ footprint.");
  }

  // Crease angle for smooth-shading: faces whose dihedral exceeds this will
  // NOT share vertex normals, eliminating the "black large triangle" artefact
  // that occurs when a big flat face is vertex-merged with adjacent fillet faces.
  const CREASE_COS = Math.cos(Math.PI * 40 / 180); // 40°

  function applyCreaseNormals(nonIndexedGeometry) {
    const position = nonIndexedGeometry.getAttribute("position");
    const faceCount = position.count / 3;
    const precision = 1e5;

    // Compute one face normal per triangle.
    const faceNormals = new Array(faceCount);
    const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    for (let fi = 0; fi < faceCount; fi++) {
      vA.fromBufferAttribute(position, fi * 3);
      vB.fromBufferAttribute(position, fi * 3 + 1);
      vC.fromBufferAttribute(position, fi * 3 + 2);
      e1.subVectors(vC, vB);
      e2.subVectors(vA, vB);
      e1.cross(e2).normalize();
      faceNormals[fi] = e1.clone();
    }

    // Map each 3-D position (rounded) to all face indices that touch it.
    const posFaces = new Map();
    for (let vi = 0; vi < position.count; vi++) {
      const key =
        Math.round(position.getX(vi) * precision) + "_" +
        Math.round(position.getY(vi) * precision) + "_" +
        Math.round(position.getZ(vi) * precision);
      if (!posFaces.has(key)) posFaces.set(key, []);
      posFaces.get(key).push(Math.floor(vi / 3));
    }

    // For each vertex slot, average only the face normals within the crease angle.
    const normals = new Float32Array(position.count * 3);
    const avg = new THREE.Vector3();
    for (let vi = 0; vi < position.count; vi++) {
      const fi = Math.floor(vi / 3);
      const myN = faceNormals[fi];
      const key =
        Math.round(position.getX(vi) * precision) + "_" +
        Math.round(position.getY(vi) * precision) + "_" +
        Math.round(position.getZ(vi) * precision);
      avg.set(0, 0, 0);
      for (const adjFi of posFaces.get(key)) {
        if (faceNormals[adjFi].dot(myN) >= CREASE_COS) {
          avg.add(faceNormals[adjFi]);
        }
      }
      avg.normalize();
      normals[vi * 3]     = avg.x;
      normals[vi * 3 + 1] = avg.y;
      normals[vi * 3 + 2] = avg.z;
    }

    nonIndexedGeometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    return nonIndexedGeometry;
  }

  function ensureIndexedGeometry(geometry) {
    if (geometry.index) {
      return geometry;
    }

    const position = geometry.getAttribute("position");
    if (!position) {
      return geometry;
    }

    const precision = 100000;
    const uniquePositions = [];
    const indexArray = [];
    const positionLookup = new Map();

    // Merge coincident vertices so normal calculation can smooth shared surfaces.
    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i);
      const y = position.getY(i);
      const z = position.getZ(i);
      const key = `${Math.round(x * precision)}_${Math.round(y * precision)}_${Math.round(z * precision)}`;

      if (!positionLookup.has(key)) {
        positionLookup.set(key, uniquePositions.length / 3);
        uniquePositions.push(x, y, z);
      }

      indexArray.push(positionLookup.get(key));
    }

    const mergedGeometry = new THREE.BufferGeometry();
    mergedGeometry.setAttribute("position", new THREE.Float32BufferAttribute(uniquePositions, 3));
    mergedGeometry.setIndex(indexArray);

    return mergedGeometry;
  }

  function centerGeometryAtOrigin(geometry) {
    geometry.computeBoundingBox();
    if (!geometry.boundingBox) {
      return;
    }

    const center = geometry.boundingBox.getCenter(new THREE.Vector3());
    geometry.translate(-center.x, -center.y, -center.z);
    geometry.computeBoundingBox();
  }

  function applyBackgroundStyle(style, announce = false) {
    const background = BACKGROUND_STYLES[style] || BACKGROUND_STYLES.lab;
    scene.background = new THREE.Color(background.sceneColor);
    renderer.setClearColor(background.sceneColor, 1);

    const gridMaterials = Array.isArray(gridHelper.material) ? gridHelper.material : [gridHelper.material];
    if (gridMaterials[0] && gridMaterials[0].color) {
      gridMaterials[0].color.setHex(background.gridCenterColor);
    }

    if (gridMaterials[1] && gridMaterials[1].color) {
      gridMaterials[1].color.setHex(background.gridColor);
    }

    if (announce) {
      setStatus(`Background changed to ${background.label}.`);
    }
  }

  function applyGridVisibility(isVisible, announce = false) {
    gridVisible = Boolean(isVisible);
    gridHelper.visible = gridVisible;

    if (gridToggleBtn) {
      gridToggleBtn.classList.toggle("is-active", gridVisible);
      gridToggleBtn.setAttribute("aria-pressed", String(gridVisible));
    }

    if (announce) {
      setStatus(gridVisible ? "Grid enabled." : "Grid hidden.");
    }
  }

  function subdivideIndexedGeometry(geometry) {
    const position = geometry.getAttribute("position");
    const index = geometry.index;

    if (!position || !index) {
      return geometry;
    }

    const positions = Array.from(position.array);
    const sourceIndices = Array.from(index.array);
    const nextIndices = [];
    const midpointCache = new Map();

    function midpointIndex(a, b) {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;

      if (midpointCache.has(key)) {
        return midpointCache.get(key);
      }

      const ax = positions[a * 3];
      const ay = positions[a * 3 + 1];
      const az = positions[a * 3 + 2];

      const bx = positions[b * 3];
      const by = positions[b * 3 + 1];
      const bz = positions[b * 3 + 2];

      const mid = positions.length / 3;
      positions.push((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
      midpointCache.set(key, mid);

      return mid;
    }

    for (let i = 0; i < sourceIndices.length; i += 3) {
      const a = sourceIndices[i];
      const b = sourceIndices[i + 1];
      const c = sourceIndices[i + 2];

      const ab = midpointIndex(a, b);
      const bc = midpointIndex(b, c);
      const ca = midpointIndex(c, a);

      nextIndices.push(a, ab, ca);
      nextIndices.push(ab, b, bc);
      nextIndices.push(ca, bc, c);
      nextIndices.push(ab, bc, ca);
    }

    const nextGeometry = new THREE.BufferGeometry();
    nextGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    nextGeometry.setIndex(nextIndices);

    return nextGeometry;
  }

  function buildTriangleSubsetGeometry(geometry, keepRatio) {
    const position = geometry.getAttribute("position");
    const index = geometry.index;

    if (!position || !index || keepRatio >= 0.999) {
      return geometry;
    }

    const sourceIndices = index.array;
    const sourceTriangles = sourceIndices.length / 3;
    const targetTriangles = Math.max(4, Math.floor(sourceTriangles * keepRatio));

    if (targetTriangles >= sourceTriangles) {
      return geometry;
    }

    const nextIndices = [];
    const stride = sourceTriangles / targetTriangles;
    let cursor = 0;

    // Deterministic sampling keeps behavior predictable for the same slider value.
    for (let i = 0; i < targetTriangles; i += 1) {
      const tri = Math.min(sourceTriangles - 1, Math.floor(cursor));
      nextIndices.push(sourceIndices[tri * 3], sourceIndices[tri * 3 + 1], sourceIndices[tri * 3 + 2]);
      cursor += stride;
    }

    const reducedGeometry = new THREE.BufferGeometry();
    reducedGeometry.setAttribute("position", position.clone());
    reducedGeometry.setIndex(nextIndices);

    return reducedGeometry;
  }

  function buildRenderableGeometry(multiplier) {
    if (!baseGeometry) {
      return null;
    }

    let geometry = baseGeometry.clone();

    if (multiplier > 1) {
      const subdivisionLevel = Math.ceil(Math.log(multiplier) / Math.log(4));

      for (let i = 0; i < subdivisionLevel; i += 1) {
        const previousGeometry = geometry;
        geometry = subdivideIndexedGeometry(previousGeometry);
        previousGeometry.dispose();
      }
    }

    // Triangle-subset sampling is omitted: strided triangle removal leaves
    // vertices with no connected faces, producing visible holes in the mesh.
    // The nearest subdivision level is used instead.
    geometry.computeVertexNormals();
    centerGeometryAtOrigin(geometry);

    return geometry;
  }

  function getViewStyleLabel(style) {
    if (style === "overlay") {
      return "Solid + Triangle Lines";
    }

    if (style === "wireframe") {
      return "Triangle Lines Only";
    }

    if (style === "flat") {
      return "Flat Shaded";
    }

    return "Solid Fill";
  }

  function applyViewStyle(style, announce = false) {
    if (!currentFillMesh || !currentWireMesh || !currentEdgeLines) {
      return;
    }

    currentFillMesh.visible = style === "solid" || style === "overlay" || style === "flat";
    currentWireMesh.visible = style === "overlay" || style === "wireframe";
    currentEdgeLines.visible = false;
    currentFillMesh.material.flatShading = style === "flat";
    currentFillMesh.material.needsUpdate = true;

    if (announce) {
      setStatus(`View style changed to ${getViewStyleLabel(style)}.`);
    }
  }

  function applyPartColor(hexString) {
    currentPartColor = parseInt(hexString.replace("#", ""), 16);
    if (currentFillMesh && currentFillMesh.material) {
      currentFillMesh.material.color.setHex(currentPartColor);
    }
  }

  function applyGeometryToScene(geometry, fileName) {
    clearCurrentModel();

    const fillMaterial = new THREE.MeshStandardMaterial({
      color: currentPartColor,
      roughness: 0.35,
      metalness: 0.12
    });

    const wireMaterial = new THREE.MeshBasicMaterial({
      color: 0x103245,
      wireframe: true
    });

    const edgeMaterial = new THREE.LineBasicMaterial({
      color: 0x0c3142
    });

    // Fill mesh uses non-indexed geometry with crease-angle normals so that
    // hard edges (flat face ↔ cylinder/fillet) stay sharp while smooth regions
    // interpolate correctly. Wire/edge meshes keep the indexed geometry.
    const fillGeometry = applyCreaseNormals(geometry.toNonIndexed());
    currentFillMesh = new THREE.Mesh(fillGeometry, fillMaterial);
    currentWireMesh = new THREE.Mesh(geometry, wireMaterial);
    currentEdgeLines = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 24), edgeMaterial);

    currentModelRoot = new THREE.Group();
    currentModelRoot.add(currentFillMesh);
    currentModelRoot.add(currentWireMesh);
    currentModelRoot.add(currentEdgeLines);

    // Save local (pre-lift, pre-scale) bounds so applyModelTransform can recalculate
    // world-space position and bounds at any scale without re-parsing geometry.
    if (!geometry.boundingBox) {
      geometry.computeBoundingBox();
    }
    savedLocalBounds = geometry.boundingBox.clone();

    // Apply the current scale (1.0 for new loads, preserved value for refinement rebuilds).
    // This sets currentModelRoot.scale, position.y (grid lift), and currentBounds.
    applyModelTransform(scaleX, scaleY, scaleZ);

    scene.add(currentModelRoot);
    currentFileStem = stripFileExtension(fileName || "model");

    applyViewStyle(viewStyleSelect.value || "flat");
    updateMetrics(fileName, geometry);
    updateExportUiState();
    updateTransformRowState();
    resetCameraToBounds();
  }

  function rebuildModelFromSettings() {
    if (!baseGeometry) {
      setStatus("Load a model first, then adjust refinement.");
      return;
    }

    const bounds = getRefinementBounds();
    const requested = Number(refinementSlider.value) || 1;
    const safeMultiplier = normalizeRequestedMultiplier(requested, bounds);
    const requestedRounded = Number(requested.toFixed(2));
    const wasLimited = Math.abs(safeMultiplier - requestedRounded) > 0.001;

    updateRefinementUi(safeMultiplier, bounds);

    const geometry = buildRenderableGeometry(safeMultiplier);
    if (!geometry) {
      return;
    }

    applyGeometryToScene(geometry, currentFileName);

    if (wasLimited) {
      setStatus(`Triangle multiplier limited to ${safeMultiplier.toFixed(2)}x for this model.`);
      return;
    }

    setStatus(`Loaded ${currentFileName} at ${safeMultiplier.toFixed(2)}x triangle multiplier.`);
  }

  function prepareBaseGeometry(rawGeometry) {
    const workingGeometry = rawGeometry;

    const indexedGeometry = ensureIndexedGeometry(workingGeometry);
    if (indexedGeometry !== workingGeometry) {
      workingGeometry.dispose();
    }

    indexedGeometry.computeVertexNormals();
    centerGeometryAtOrigin(indexedGeometry);

    return indexedGeometry;
  }

  function getPresetUsageText(preset) {
    if (preset === "onshape") {
      return "Onshape-like: right-drag rotate, left-drag pan, scroll zoom.";
    }

    if (preset === "solidworks") {
      return "SolidWorks-like: middle-drag rotate, left/right drag pan, scroll zoom.";
    }

    return "Web Orbit: left-drag rotate, right-drag pan, scroll zoom.";
  }

  function applyControlPreset(preset, announce = false) {
    if (preset === "onshape") {
      controls.mouseButtons = {
        LEFT: THREE.MOUSE.PAN,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.ROTATE
      };
    } else if (preset === "solidworks") {
      controls.mouseButtons = {
        LEFT: THREE.MOUSE.PAN,
        MIDDLE: THREE.MOUSE.ROTATE,
        RIGHT: THREE.MOUSE.PAN
      };
    } else {
      controls.mouseButtons = {
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN
      };
    }

    const tip = getPresetUsageText(preset);
    usageTip.textContent = tip;

    if (announce) {
      setStatus(`Control preset switched. ${tip}`);
    }
  }

  function parseStlArrayBuffer(arrayBuffer, fileName) {
    const parsedGeometry = stlLoader.parse(arrayBuffer);
    const preparedBase = prepareBaseGeometry(parsedGeometry);

    if (baseGeometry) {
      baseGeometry.dispose();
    }

    baseGeometry = preparedBase;
    currentFileName = fileName;
    scaleX = scaleY = scaleZ = 1.0;  // reset scale for every new file load
    bboxOverlayActive = false;

    const bounds = getRefinementBounds();
    const startingMultiplier = normalizeRequestedMultiplier(1, bounds);
    updateRefinementUi(startingMultiplier, bounds);

    rebuildModelFromSettings();
  }

  async function convertSldprtToStl(file) {
    const url = `${CONVERTER_API_BASE}/api/convert/sldprt-to-stl?filename=${encodeURIComponent(file.name)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream"
      },
      body: file
    });

    if (!response.ok) {
      let details = "The converter service rejected the file.";
      try {
        const payload = await response.json();
        if (payload && payload.error) {
          details = payload.error;
        }
      } catch (_) {
        const fallbackText = await response.text();
        if (fallbackText) {
          details = fallbackText;
        }
      }

      throw new Error(details);
    }

    return response.arrayBuffer();
  }

  async function convertStlBlobToStep(stlBlob, filename, endpoint = "/api/convert/stl-to-step") {
    const url = `${CONVERTER_API_BASE}${endpoint}?filename=${encodeURIComponent(filename)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: stlBlob
    });

    if (!response.ok) {
      let details = "The converter service rejected the file.";
      try {
        const payload = await response.json();
        if (payload && payload.error) {
          details = payload.error;
        }
      } catch (_) {
        const fallbackText = await response.text();
        if (fallbackText) {
          details = fallbackText;
        }
      }
      throw new Error(details);
    }

    const meta = {
      analytical:  response.headers.get("X-Analytical-Surfaces") === "true",
      coverage:    response.headers.get("X-Coverage")           || null,
      cylinders:   response.headers.get("X-Detected-Cylinders") || null,
      planes:      response.headers.get("X-Detected-Planes")    || null,
      pctCyl:      response.headers.get("X-Pct-Cyl")            || null,
      pctPlane:    response.headers.get("X-Pct-Plane")          || null,
      pctFillet:   response.headers.get("X-Pct-Fillet")         || null
    };

    return { buffer: await response.arrayBuffer(), meta };
  }

  function getFriendlySldprtErrorMessage(rawMessage) {
    const message = String(rawMessage || "").trim();
    const normalized = message.toLowerCase();

    if (normalized.includes("failed to fetch")) {
      return "Could not reach the local converter service at http://127.0.0.1:8090.";
    }

    if (
      normalized.includes("lacks sldprt support")
      || normalized.includes("no supported file format")
      || normalized.includes("could not import this sldprt")
    ) {
      if (normalized.includes("cloudconvert fallback is disabled")) {
        return "FreeCAD cannot import this SLDPRT and cloud fallback is not configured. Set CLOUDCONVERT_API_KEY on the converter server.";
      }
      return "FreeCAD on this machine cannot import this SLDPRT file. Use CloudConvert fallback (CLOUDCONVERT_API_KEY) or convert to STL/STEP with another CAD tool.";
    }

    if (normalized.includes("cloudconvert failed")) {
      return "Local FreeCAD import failed and CloudConvert fallback also failed. Check CLOUDCONVERT_API_KEY and internet access.";
    }

    return message || "Unknown converter error.";
  }

  async function loadModelFile(file) {
    if (!file) {
      return;
    }

    const extension = getFileExtension(file.name);
    if (!SUPPORTED_INPUT_EXTENSIONS.has(extension)) {
      setStatus("Please choose a valid .stl or .sldprt file.");
      return;
    }

    try {
      if (extension === "sldprt") {
        setStatus(`Converting ${file.name} to STL via local converter...`);
        const convertedArrayBuffer = await convertSldprtToStl(file);
        parseStlArrayBuffer(convertedArrayBuffer, `${stripFileExtension(file.name)}.stl`);
        setStatus(`Converted ${file.name} and loaded the generated STL.`);
        return;
      }

      setStatus(`Loading ${file.name}...`);
      const stlArrayBuffer = await readFileAsArrayBuffer(file);
      parseStlArrayBuffer(stlArrayBuffer, file.name);
    } catch (error) {
      console.error(error);
      if (extension === "sldprt") {
        const friendlyError = getFriendlySldprtErrorMessage(error.message);
        setStatus(`SLDPRT conversion failed: ${friendlyError}`);
        return;
      }

      setStatus("This STL could not be parsed. Try a different file.");
    }
  }

  function sanitizeFileStem(stem) {
    return (stem || "model").replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_");
  }

  // Returns a cloned geometry with the current scale baked into vertex positions,
  // or null when scale is 1.0 (caller should use currentFillMesh.geometry directly).
  // Caller is responsible for disposing the returned geometry.
  function buildScaledExportGeometry() {
    if (!currentFillMesh || !currentFillMesh.geometry) {
      return null;
    }

    if (Math.abs(scaleX - 1.0) < 1e-6 && Math.abs(scaleY - 1.0) < 1e-6 && Math.abs(scaleZ - 1.0) < 1e-6) {
      return null;
    }

    const scaledGeom = currentFillMesh.geometry.clone();
    scaledGeom.applyMatrix4(new THREE.Matrix4().makeScale(scaleX, scaleY, scaleZ));
    return scaledGeom;
  }

  async function createExportBlob(formatKey) {
    if (!currentFillMesh || !currentFillMesh.geometry) {
      throw new Error("Load a model before exporting.");
    }

    if (formatKey === "stl") {
      const scaledGeom = buildScaledExportGeometry();
      const exportMesh = scaledGeom
        ? new THREE.Mesh(scaledGeom, currentFillMesh.material)
        : currentFillMesh;
      const exporter = new THREE.STLExporter();
      const stlContent = exporter.parse(exportMesh, { binary: false });
      if (scaledGeom) {
        scaledGeom.dispose();
      }
      return new Blob([stlContent], { type: EXPORT_FORMATS.stl.mime });
    }

    if (formatKey === "obj") {
      const scaledGeom = buildScaledExportGeometry();
      const exportMesh = new THREE.Mesh(
        scaledGeom || currentFillMesh.geometry,
        currentFillMesh.material
      );
      exportMesh.name = sanitizeFileStem(currentFileStem);
      const exporter = new THREE.OBJExporter();
      const objContent = exporter.parse(exportMesh);
      if (scaledGeom) {
        scaledGeom.dispose();
      }
      return new Blob([objContent], { type: EXPORT_FORMATS.obj.mime });
    }

    if (formatKey === "glb") {
      const scaledGeom = buildScaledExportGeometry();
      const exportMesh = new THREE.Mesh(
        scaledGeom || currentFillMesh.geometry,
        currentFillMesh.material
      );
      exportMesh.name = sanitizeFileStem(currentFileStem);
      const exporter = new THREE.GLTFExporter();

      return new Promise((resolve, reject) => {
        exporter.parse(
          exportMesh,
          result => {
            if (scaledGeom) {
              scaledGeom.dispose();
            }
            if (result instanceof ArrayBuffer) {
              resolve(new Blob([result], { type: EXPORT_FORMATS.glb.mime }));
              return;
            }
            resolve(new Blob([JSON.stringify(result)], { type: "application/json" }));
          },
          error => {
            if (scaledGeom) {
              scaledGeom.dispose();
            }
            reject(error);
          },
          { binary: true, trs: false }
        );
      });
    }

    if (formatKey === "step" || formatKey === "step-parametric") {
      const scaledGeom = buildScaledExportGeometry();
      const exportMesh = scaledGeom
        ? new THREE.Mesh(scaledGeom, currentFillMesh.material)
        : currentFillMesh;
      const exporter = new THREE.STLExporter();
      const stlContent = exporter.parse(exportMesh, { binary: false });
      if (scaledGeom) {
        scaledGeom.dispose();
      }
      const stlBlob = new Blob([stlContent], { type: "model/stl" });
      const stem = sanitizeFileStem(currentFileStem);
      const endpoint = formatKey === "step-parametric"
        ? "/api/convert/stl-to-step-parametric"
        : "/api/convert/stl-to-step";
      const { buffer, meta } = await convertStlBlobToStep(stlBlob, `${stem}.stl`, endpoint);
      return { blob: new Blob([buffer], { type: EXPORT_FORMATS.step.mime }), meta };
    }

    throw new Error("Unsupported export format.");
  }

  async function downloadCurrentModelExport() {
    const formatKey = exportFormatSelect ? exportFormatSelect.value : "stl";
    const exportConfig = EXPORT_FORMATS[formatKey];

    if (!exportConfig) {
      setStatus("Unsupported export format.");
      return;
    }

    if (!exportConfig.requires()) {
      setStatus(`.${exportConfig.extension} export is unavailable in this browser session.`);
      return;
    }

    const isStepExport = formatKey === "step" || formatKey === "step-parametric";

    if (isStepExport) {
      setStatus(
        formatKey === "step-parametric"
          ? "Detecting surfaces and building parametric STEP…"
          : "Converting to STEP via converter service…"
      );
      conversionSpinner.hidden = false;
      conversionResult.hidden = true;
      downloadExportButton.disabled = true;
    }

    try {
      const result = await createExportBlob(formatKey);
      // STEP returns {blob, meta}; all other formats return a Blob directly.
      const blob = result instanceof Blob ? result : result.blob;
      const meta = result instanceof Blob ? null : (result.meta || null);

      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `${sanitizeFileStem(currentFileStem)}.${exportConfig.extension}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);

      setStatus(`Exported ${anchor.download}.`);

      if (meta && meta.coverage) {
        crPctCyl.textContent    = meta.pctCyl    ? meta.pctCyl    + "%" : "—";
        crPctPlane.textContent  = meta.pctPlane  ? meta.pctPlane  + "%" : "—";
        crPctFillet.textContent = meta.pctFillet ? meta.pctFillet + "%" : "—";
        crCylinders.textContent = meta.cylinders || "—";
        crPlanes.textContent    = meta.planes    || "—";
        crCoverage.textContent  = meta.coverage + "%";
        if (meta.analytical) {
          crMode.textContent  = "Analytical surfaces";
          crMode.className    = "conversion-result-mode is-analytical";
        } else {
          crMode.textContent  = "Triangulated fallback (coverage below threshold)";
          crMode.className    = "conversion-result-mode";
        }
        conversionResult.hidden = false;
        conversionResult.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    } catch (error) {
      console.error(error);
      const msg = String(error.message || "").toLowerCase();
      const friendlyError = (isStepExport && msg.includes("failed to fetch"))
        ? `Converter service not reachable at ${CONVERTER_API_BASE}. Restart the dev server with npm start.`
        : error.message;
      setStatus(`Export failed: ${friendlyError}`);
    } finally {
      if (isStepExport) {
        conversionSpinner.hidden = true;
        downloadExportButton.disabled = false;
      }
    }
  }

  function scheduleSliderRebuild() {
    const bounds = getRefinementBounds();
    const requested = Number(refinementSlider.value) || 1;
    const previewMultiplier = normalizeRequestedMultiplier(requested, bounds);

    updateRefinementUi(previewMultiplier, bounds);

    if (!baseGeometry) {
      return;
    }

    if (sliderDebounceTimer) {
      window.clearTimeout(sliderDebounceTimer);
    }

    sliderDebounceTimer = window.setTimeout(() => {
      rebuildModelFromSettings();
    }, 140);
  }

  function activateDropZone() {
    dropZone.classList.add("is-active");
  }

  function deactivateDropZone() {
    dropZone.classList.remove("is-active");
  }

  function preventDefaults(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  ["dragenter", "dragover", "dragleave", "drop"].forEach(eventName => {
    dropZone.addEventListener(eventName, preventDefaults);
  });

  ["dragenter", "dragover"].forEach(eventName => {
    dropZone.addEventListener(eventName, activateDropZone);
  });

  ["dragleave", "drop"].forEach(eventName => {
    dropZone.addEventListener(eventName, deactivateDropZone);
  });

  dropZone.addEventListener("drop", event => {
    const file = event.dataTransfer.files && event.dataTransfer.files[0];
    loadModelFile(file);
  });

  dropZone.addEventListener("click", () => {
    fileInput.click();
  });

  dropZone.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      fileInput.click();
    }
  });

  fileInput.addEventListener("change", event => {
    const file = event.target.files && event.target.files[0];
    loadModelFile(file);
  });

  controlPresetSelect.addEventListener("change", event => {
    applyControlPreset(event.target.value, true);
  });

  viewStyleSelect.addEventListener("change", event => {
    applyViewStyle(event.target.value, true);
  });

  if (backgroundStyleSelect) {
    backgroundStyleSelect.addEventListener("change", event => {
      applyBackgroundStyle(event.target.value, true);
    });
  }

  if (gridToggleBtn) {
    gridToggleBtn.addEventListener("click", () => {
      applyGridVisibility(!gridVisible, true);
    });
  }

  if (exportFormatSelect) {
    exportFormatSelect.addEventListener("change", () => {
      updateExportUiState();
    });
  }

  if (downloadExportButton) {
    downloadExportButton.addEventListener("click", () => {
      downloadCurrentModelExport();
    });
  }

  bindDimInput(dimXInput, "x");
  bindDimInput(dimYInput, "y");
  bindDimInput(dimZInput, "z");

  if (bboxToggleBtn) {
    bboxToggleBtn.addEventListener("click", () => {
      if (!currentFillMesh) {
        return;
      }
      bboxOverlayActive = !bboxOverlayActive;
      updateBboxPreview();
    });
  }

  if (scaleHalfBtn) {
    scaleHalfBtn.addEventListener("click", () => {
      if (!currentModelRoot) {
        return;
      }
      applyModelTransform(
        clamp(scaleX * 0.5, 1 / 64, 64),
        clamp(scaleY * 0.5, 1 / 64, 64),
        clamp(scaleZ * 0.5, 1 / 64, 64)
      );
      updateMetrics(currentFileName, currentFillMesh.geometry);
      resetCameraToBounds();
      setStatus(`Model scaled ÷2.`);
    });
  }

  if (scaleDoubleBtn) {
    scaleDoubleBtn.addEventListener("click", () => {
      if (!currentModelRoot) {
        return;
      }
      applyModelTransform(
        clamp(scaleX * 2.0, 1 / 64, 64),
        clamp(scaleY * 2.0, 1 / 64, 64),
        clamp(scaleZ * 2.0, 1 / 64, 64)
      );
      updateMetrics(currentFileName, currentFillMesh.geometry);
      resetCameraToBounds();
      setStatus(`Model scaled ×2.`);
    });
  }

  if (minimizeFootprintBtn) {
    minimizeFootprintBtn.addEventListener("click", () => {
      if (!baseGeometry) {
        return;
      }
      minimizeFootprint();
    });
  }

  if (uniformScaleCheckbox) {
    uniformScaleCheckbox.addEventListener("change", () => {
      isUniformScale = uniformScaleCheckbox.checked;
    });
  }

  if (partColorInput) {
    partColorInput.addEventListener("input", () => {
      applyPartColor(partColorInput.value);
    });
  }

  refinementSlider.addEventListener("input", () => {
    scheduleSliderRebuild();
  });

  refinementSlider.addEventListener("change", () => {
    if (!baseGeometry) {
      return;
    }

    if (sliderDebounceTimer) {
      window.clearTimeout(sliderDebounceTimer);
    }

    rebuildModelFromSettings();
  });

  resetCameraButton.addEventListener("click", () => {
    if (currentBounds) {
      resetCameraToBounds();
      setStatus("Camera reset to frame the current model.");
      return;
    }

    resetToDefaultView();
    setStatus("Camera reset to the default empty-scene view.");
  });

  if (window.ResizeObserver) {
    const resizeObserver = new ResizeObserver(() => {
      resizeRenderer();
    });
    resizeObserver.observe(viewerCanvas);
  } else {
    window.addEventListener("resize", resizeRenderer);
  }

  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }

  updateRefinementUi(1, getRefinementBounds());
  applyControlPreset(controlPresetSelect.value || "web");
  applyBackgroundStyle(backgroundStyleSelect ? backgroundStyleSelect.value : "lab");
  applyGridVisibility(true);
  updateExportUiState();
  resetToDefaultView();
  resizeRenderer();
  animate();
});
