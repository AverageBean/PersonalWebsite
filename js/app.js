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
  const rotateToggleBtn = document.getElementById("rotateToggleBtn");
  const rotationRow = document.getElementById("rotationRow");
  const rotX = document.getElementById("rotX");
  const rotY = document.getElementById("rotY");
  const rotZ = document.getElementById("rotZ");
  const applyRotationBtn = document.getElementById("applyRotationBtn");
  const resetRotationBtn = document.getElementById("resetRotationBtn");
  const moldToggleBtn = document.getElementById("moldToggleBtn");
  const moldPanel = document.getElementById("moldPanel");
  const moldWallInput = document.getElementById("moldWall");
  const moldClearanceInput = document.getElementById("moldClearance");
  const moldSplitSlider = document.getElementById("moldSplitSlider");
  const moldSplitValue = document.getElementById("moldSplitValue");
  const moldPinDiameterInput = document.getElementById("moldPinDiameter");
  const moldPinInsetInput = document.getElementById("moldPinInset");
  const moldPinToleranceInput = document.getElementById("moldPinTolerance");
  const moldSprueDiameterInput = document.getElementById("moldSprueDiameter");
  const moldSprueEnabledCheckbox = document.getElementById("moldSprueEnabled");
  const generateMoldBtn = document.getElementById("generateMoldBtn");
  const sliceToggleBtn = document.getElementById("sliceToggleBtn");
  const slicePanel = document.getElementById("slicePanel");
  const slicePositionSlider = document.getElementById("slicePositionSlider");
  const slicePositionValue = document.getElementById("slicePositionValue");
  const sliceAxisXRadio = document.getElementById("sliceAxisX");
  const sliceAxisYRadio = document.getElementById("sliceAxisY");
  const sliceAxisZRadio = document.getElementById("sliceAxisZ");
  const sliceFlipCheckbox = document.getElementById("sliceFlipCheckbox");
  const sliceCapCheckbox = document.getElementById("sliceCapCheckbox");
  const textureToggleBtn = document.getElementById("textureToggleBtn");
  const texturePanel = document.getElementById("texturePanel");
  const textureFaceCount = document.getElementById("textureFaceCount");
  const textureClearSelBtn = document.getElementById("textureClearSelBtn");
  const textureSelectAllBtn = document.getElementById("textureSelectAllBtn");
  const texturePresetSelect = document.getElementById("texturePresetSelect");
  const textureBumpsControls = document.getElementById("textureBumpsControls");
  const textureMeshControls = document.getElementById("textureMeshControls");
  const bumpHeightInput = document.getElementById("bumpHeightInput");
  const bumpScaleInput = document.getElementById("bumpScaleInput");
  const meshHeightInput = document.getElementById("meshHeightInput");
  const meshCellInput = document.getElementById("meshCellInput");
  const meshStrandInput = document.getElementById("meshStrandInput");
  const textureApplyBtn = document.getElementById("textureApplyBtn");
  const textureResetBtn = document.getElementById("textureResetBtn");

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
  const SUPPORTED_INPUT_EXTENSIONS = new Set([
    "stl", "sldprt",
    "obj", "ply", "gltf", "glb", "3mf",            // client-side loaders
    "step", "stp", "iges", "igs", "brep", "brp"     // server-side CAD conversion
  ]);
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
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, stencil: true });
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
  const objLoader = new THREE.OBJLoader();
  const plyLoader = new THREE.PLYLoader();
  const gltfLoader = new THREE.GLTFLoader();

  // Extensions that require server-side conversion to STL via FreeCAD
  const CAD_EXTENSIONS = new Set(["step", "stp", "iges", "igs", "brep", "brp"]);
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
  let moldSplitPlane = null;
  let moldPanelVisible = false;
  let moldSplitY = 0;
  let isDraggingSplitPlane = false;
  let slicePanelVisible = false;
  let sliceActive = false;
  let sliceAxis = "y";
  let slicePosition = 0;
  let sliceFlipped = false;
  let isDraggingSlicePlane = false;
  let sliceClipPlane = null;
  let slicePreviewPlane = null;
  let sliceInteriorMesh = null;
  let texturePanelVisible = false;
  let selectedFaceIndices = new Set();
  let faceAdjacency = null;
  let faceCentroids = null;
  let faceNormalsCache = null;
  let textureHighlightMesh = null;
  let preTextureBaseGeometry = null;
  let textureRaycaster = new THREE.Raycaster();
  let textureMouse = new THREE.Vector2();

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

    // Clean up slice clipping before tearing down model (stencil meshes are children of currentModelRoot)
    removeSliceClipping();
    slicePanelVisible = false;
    if (slicePanel) slicePanel.style.display = "none";
    if (sliceToggleBtn) {
      sliceToggleBtn.classList.remove("is-active");
      sliceToggleBtn.setAttribute("aria-pressed", "false");
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
    removeSplitPlanePreview();
    moldPanelVisible = false;
    if (moldPanel) moldPanel.style.display = "none";
    if (moldToggleBtn) {
      moldToggleBtn.classList.remove("is-active");
      moldToggleBtn.setAttribute("aria-pressed", "false");
    }
    clearTextureSelection();
    texturePanelVisible = false;
    if (texturePanel) texturePanel.style.display = "none";
    if (textureToggleBtn) {
      textureToggleBtn.classList.remove("is-active");
      textureToggleBtn.setAttribute("aria-pressed", "false");
    }
    if (preTextureBaseGeometry) {
      preTextureBaseGeometry.dispose();
      preTextureBaseGeometry = null;
    }
    updateExportUiState();
    updateTransformRowState();
  }

  function updateTransformRowState() {
    const hasModel = Boolean(currentFillMesh);
    if (scaleHalfBtn) scaleHalfBtn.disabled = !hasModel;
    if (scaleDoubleBtn) scaleDoubleBtn.disabled = !hasModel;
    if (minimizeFootprintBtn) minimizeFootprintBtn.disabled = !hasModel;
    if (rotateToggleBtn) rotateToggleBtn.disabled = !hasModel;
    if (uniformScaleCheckbox) uniformScaleCheckbox.disabled = !hasModel;
    if (dimXInput) dimXInput.disabled = !hasModel;
    if (dimYInput) dimYInput.disabled = !hasModel;
    if (dimZInput) dimZInput.disabled = !hasModel;
    if (moldToggleBtn) moldToggleBtn.disabled = !hasModel;
    if (sliceToggleBtn) sliceToggleBtn.disabled = !hasModel;
    if (textureToggleBtn) textureToggleBtn.disabled = !hasModel;
    if (!hasModel) {
      if (dimXInput) dimXInput.value = "";
      if (dimYInput) dimYInput.value = "";
      if (dimZInput) dimZInput.value = "";
      if (scaleDisplay) scaleDisplay.textContent = "1.00×";
      if (rotationRow) rotationRow.style.display = "none";
      if (rotateToggleBtn) {
        rotateToggleBtn.setAttribute("aria-pressed", "false");
        rotateToggleBtn.classList.remove("is-active");
      }
      resetRotationInputs();
      if (moldPanel) moldPanel.style.display = "none";
      if (moldToggleBtn) {
        moldToggleBtn.setAttribute("aria-pressed", "false");
        moldToggleBtn.classList.remove("is-active");
      }
      moldPanelVisible = false;
      removeSplitPlanePreview();
      if (slicePanel) slicePanel.style.display = "none";
      if (sliceToggleBtn) {
        sliceToggleBtn.setAttribute("aria-pressed", "false");
        sliceToggleBtn.classList.remove("is-active");
      }
      slicePanelVisible = false;
      removeSliceClipping();
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

    // Re-clamp slice position to new bounds after transform change
    if (sliceActive) {
      const range = getSliceAxisRange();
      slicePosition = Math.max(range.min + 0.1, Math.min(range.max - 0.1, slicePosition));
      updateSlicePreviewPosition(slicePosition);
    }
  }

  // Tests all 6 axis-aligned face-down orientations, picks the one with the
  // largest XZ bounding-box footprint (best 3D-print orientation), bakes it
  // into baseGeometry, and rebuilds.
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

    let bestArea = -Infinity;
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

      if (area > bestArea) {
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
    setStatus("Model reoriented to maximize XZ footprint.");
  }

  // ── Rotation controls ────────────────────────────────────────────────────

  function resetRotationInputs() {
    if (rotX) rotX.value = "0";
    if (rotY) rotY.value = "0";
    if (rotZ) rotZ.value = "0";
  }

  function applyRotation() {
    if (!baseGeometry) return;

    const rx = parseFloat(rotX.value) || 0;
    const ry = parseFloat(rotY.value) || 0;
    const rz = parseFloat(rotZ.value) || 0;

    if (rx === 0 && ry === 0 && rz === 0) return;

    const euler = new THREE.Euler(
      rx * Math.PI / 180,
      ry * Math.PI / 180,
      rz * Math.PI / 180,
      "XYZ"
    );
    const rotMatrix = new THREE.Matrix4().makeRotationFromEuler(euler);

    baseGeometry.applyMatrix4(rotMatrix);
    centerGeometryAtOrigin(baseGeometry);
    baseGeometry.computeBoundingBox();

    scaleX = scaleY = scaleZ = 1.0;
    rebuildModelFromSettings();
    resetRotationInputs();
    setStatus(`Rotated ${rx}° X, ${ry}° Y, ${rz}° Z.`);
  }

  // ── Mold generator ────────────────────────────────────────────────────

  function createSplitPlanePreview() {
    if (!currentBounds || !currentFillMesh) return;

    const size = new THREE.Vector3();
    currentBounds.getSize(size);
    const margin = 5;
    const planeWidth = size.x + margin * 2;
    const planeDepth = size.z + margin * 2;

    if (moldSplitPlane) {
      moldSplitPlane.geometry.dispose();
      moldSplitPlane.geometry = new THREE.PlaneGeometry(planeWidth, planeDepth);
    } else {
      const geo = new THREE.PlaneGeometry(planeWidth, planeDepth);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x0f6e8c,
        opacity: 0.25,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      moldSplitPlane = new THREE.Mesh(geo, mat);
      moldSplitPlane.rotation.x = -Math.PI / 2; // lay flat on XZ
      scene.add(moldSplitPlane);
    }

    const center = new THREE.Vector3();
    currentBounds.getCenter(center);
    moldSplitPlane.position.set(center.x, moldSplitY, center.z);
    moldSplitPlane.visible = true;
  }

  function updateSplitPlanePosition(yValue) {
    if (!currentBounds) return;
    yValue = Math.max(currentBounds.min.y + 0.1, Math.min(currentBounds.max.y - 0.1, yValue));
    moldSplitY = yValue;
    if (moldSplitPlane) {
      moldSplitPlane.position.y = yValue;
    }
    if (moldSplitSlider) {
      moldSplitSlider.value = String(yValue);
    }
    if (moldSplitValue) {
      moldSplitValue.textContent = yValue.toFixed(1) + " mm";
    }
  }

  function removeSplitPlanePreview() {
    if (moldSplitPlane) {
      scene.remove(moldSplitPlane);
      moldSplitPlane.geometry.dispose();
      moldSplitPlane.material.dispose();
      moldSplitPlane = null;
    }
  }

  function initMoldControls() {
    if (!currentBounds) return;
    const minY = currentBounds.min.y;
    const maxY = currentBounds.max.y;
    const midY = (minY + maxY) / 2;

    if (moldSplitSlider) {
      moldSplitSlider.min = minY.toFixed(1);
      moldSplitSlider.max = maxY.toFixed(1);
      moldSplitSlider.step = "0.1";
      moldSplitSlider.value = midY.toFixed(1);
    }

    moldSplitY = midY;
    if (moldSplitValue) {
      moldSplitValue.textContent = midY.toFixed(1) + " mm";
    }

    createSplitPlanePreview();
  }

  function setupSplitPlaneDrag() {
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let dragStartY = 0;
    let dragPlaneWorldY = 0;

    renderer.domElement.addEventListener("pointerdown", (event) => {
      if (!moldSplitPlane || !moldPanelVisible || !moldSplitPlane.visible) return;
      mouse.x = (event.offsetX / renderer.domElement.clientWidth) * 2 - 1;
      mouse.y = -(event.offsetY / renderer.domElement.clientHeight) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObject(moldSplitPlane);
      if (hits.length > 0) {
        isDraggingSplitPlane = true;
        dragStartY = event.clientY;
        dragPlaneWorldY = moldSplitY;
        controls.enabled = false;
        event.preventDefault();
      }
    });

    renderer.domElement.addEventListener("pointermove", (event) => {
      if (!isDraggingSplitPlane) return;
      // Compute world-space Y per pixel at current zoom
      const bounds = currentBounds;
      if (!bounds) return;
      const heightRange = bounds.max.y - bounds.min.y;
      const canvasHeight = renderer.domElement.clientHeight;
      const sensitivity = heightRange / (canvasHeight * 0.4);
      const deltaPixels = event.clientY - dragStartY;
      const newY = dragPlaneWorldY - deltaPixels * sensitivity;
      updateSplitPlanePosition(newY);
    });

    window.addEventListener("pointerup", () => {
      if (isDraggingSplitPlane) {
        isDraggingSplitPlane = false;
        controls.enabled = true;
      }
    });
  }

  async function generateMold() {
    if (!currentFillMesh || !currentBounds) {
      setStatus("Load a model before generating a mold.");
      return;
    }

    const wallThickness = parseFloat(moldWallInput.value) || 10;
    const clearance = parseFloat(moldClearanceInput.value) || 0;
    const splitHeight = moldSplitY;
    const pinDiameter = parseFloat(moldPinDiameterInput.value) || 5;
    const pinInset = parseFloat(moldPinInsetInput.value) || 8;
    const pinTolerance = parseFloat(moldPinToleranceInput.value);
    const sprueDiameter = parseFloat(moldSprueDiameterInput.value) || 6;
    const sprueEnabled = moldSprueEnabledCheckbox ? moldSprueEnabledCheckbox.checked : true;

    // Build scaled STL blob (same as STEP export)
    const scaledGeom = buildScaledExportGeometry();
    const exportMesh = scaledGeom
      ? new THREE.Mesh(scaledGeom, currentFillMesh.material)
      : currentFillMesh;
    const exporter = new THREE.STLExporter();
    const stlContent = exporter.parse(exportMesh, { binary: false });
    if (scaledGeom) scaledGeom.dispose();
    const stlBlob = new Blob([stlContent], { type: "model/stl" });

    const stem = sanitizeFileStem(currentFileStem);
    const params = new URLSearchParams({
      filename: `${stem}.stl`,
      wallThickness: String(wallThickness),
      clearance: String(clearance),
      splitHeight: String(splitHeight),
      pinDiameter: String(pinDiameter),
      pinInset: String(pinInset),
      pinTolerance: String(isNaN(pinTolerance) ? 0.4 : pinTolerance),
      sprueDiameter: String(sprueDiameter),
      sprueEnabled: String(sprueEnabled)
    });

    setStatus("Generating mold halves via FreeCAD…");
    conversionSpinner.hidden = false;
    generateMoldBtn.disabled = true;
    generateMoldBtn.textContent = "Generating…";

    try {
      const url = `${CONVERTER_API_BASE}/api/convert/stl-to-mold?${params}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: stlBlob
      });

      if (!response.ok) {
        let details = "Mold generation failed.";
        try {
          const payload = await response.json();
          if (payload && payload.error) details = payload.error;
        } catch (_) {}
        throw new Error(details);
      }

      const zipBuffer = await response.arrayBuffer();
      const blob = new Blob([zipBuffer], { type: "application/zip" });
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `${stem}-mold.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);

      setStatus(`Mold exported as ${stem}-mold.zip (top + bottom halves).`);
    } catch (error) {
      console.error(error);
      const msg = String(error.message || "").toLowerCase();
      const friendlyError = msg.includes("failed to fetch")
        ? `Converter service not reachable at ${CONVERTER_API_BASE}. Run npm run convert:start.`
        : error.message;
      setStatus(`Mold generation failed: ${friendlyError}`);
    } finally {
      conversionSpinner.hidden = true;
      generateMoldBtn.disabled = false;
      generateMoldBtn.textContent = "Generate Mold";
    }
  }

  // ── Slice / cross-section view ──────────────────────────────────────────

  function getSliceAxisNormal() {
    const sign = sliceFlipped ? -1 : 1;
    if (sliceAxis === "x") return new THREE.Vector3(sign, 0, 0);
    if (sliceAxis === "z") return new THREE.Vector3(0, 0, sign);
    return new THREE.Vector3(0, sign, 0);
  }

  function getSliceAxisRange() {
    if (!currentBounds) return { min: 0, max: 100 };
    if (sliceAxis === "x") return { min: currentBounds.min.x, max: currentBounds.max.x };
    if (sliceAxis === "z") return { min: currentBounds.min.z, max: currentBounds.max.z };
    return { min: currentBounds.min.y, max: currentBounds.max.y };
  }

  function getCapColor(partColorHex) {
    const c = new THREE.Color(partColorHex);
    const hsl = {};
    c.getHSL(hsl);
    hsl.s = Math.max(0, hsl.s - 0.3);
    hsl.l = Math.min(1, hsl.l + 0.15);
    c.setHSL(hsl.h, hsl.s, hsl.l);
    return c.getHex();
  }

  function initSliceClipPlane() {
    if (!currentFillMesh) return;
    renderer.localClippingEnabled = true;

    const normal = getSliceAxisNormal();
    sliceClipPlane = new THREE.Plane(normal, -slicePosition * (sliceFlipped ? -1 : 1));

    const planes = [sliceClipPlane];
    currentFillMesh.material.clippingPlanes = planes;
    currentWireMesh.material.clippingPlanes = planes;
    currentEdgeLines.material.clippingPlanes = planes;
    sliceActive = true;
  }

  function updateSliceClipPlane() {
    if (!sliceClipPlane) return;
    const normal = getSliceAxisNormal();
    sliceClipPlane.normal.copy(normal);
    // THREE.Plane: normal.dot(point) + constant = 0
    // For normal=(0,1,0) at position p: constant = -p
    // For normal=(0,-1,0) at position p: constant = p
    sliceClipPlane.constant = sliceFlipped ? slicePosition : -slicePosition;
  }

  function disposeSlicePreviewPlane() {
    if (!slicePreviewPlane) return;
    scene.remove(slicePreviewPlane);
    // Dispose children
    slicePreviewPlane.children.forEach(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
    slicePreviewPlane = null;
  }

  function createSlicePreviewPlane() {
    if (!currentBounds || !currentFillMesh) return;
    const size = new THREE.Vector3();
    currentBounds.getSize(size);
    const margin = 5;

    // Determine plane dimensions based on axis
    let planeW, planeH;
    if (sliceAxis === "x") { planeW = size.z + margin * 2; planeH = size.y + margin * 2; }
    else if (sliceAxis === "z") { planeW = size.x + margin * 2; planeH = size.y + margin * 2; }
    else { planeW = size.x + margin * 2; planeH = size.z + margin * 2; }

    disposeSlicePreviewPlane();

    slicePreviewPlane = new THREE.Group();

    // Invisible hit mesh for raycaster-based drag interaction
    const hitGeo = new THREE.PlaneGeometry(planeW, planeH);
    const hitMat = new THREE.MeshBasicMaterial({
      visible: false,
      side: THREE.DoubleSide
    });
    const hitMesh = new THREE.Mesh(hitGeo, hitMat);
    slicePreviewPlane.add(hitMesh);

    // Visible border-only outline (LineLoop of the rectangle edges)
    const hw = planeW / 2, hh = planeH / 2;
    const borderGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-hw, -hh, 0),
      new THREE.Vector3( hw, -hh, 0),
      new THREE.Vector3( hw,  hh, 0),
      new THREE.Vector3(-hw,  hh, 0)
    ]);
    const borderMat = new THREE.LineBasicMaterial({ color: 0x8c3a0f, linewidth: 1 });
    const borderLine = new THREE.LineLoop(borderGeo, borderMat);
    slicePreviewPlane.add(borderLine);

    // Orient perpendicular to the slice axis
    if (sliceAxis === "y") slicePreviewPlane.rotation.set(-Math.PI / 2, 0, 0);
    else if (sliceAxis === "x") slicePreviewPlane.rotation.set(0, Math.PI / 2, 0);
    // z-axis: default orientation is correct

    const center = new THREE.Vector3();
    currentBounds.getCenter(center);
    if (sliceAxis === "x") slicePreviewPlane.position.set(slicePosition, center.y, center.z);
    else if (sliceAxis === "z") slicePreviewPlane.position.set(center.x, center.y, slicePosition);
    else slicePreviewPlane.position.set(center.x, slicePosition, center.z);

    scene.add(slicePreviewPlane);
  }

  function updateSlicePreviewPosition(value) {
    if (!currentBounds) return;
    const range = getSliceAxisRange();
    value = Math.max(range.min + 0.1, Math.min(range.max - 0.1, value));
    slicePosition = value;

    if (slicePreviewPlane) {
      if (sliceAxis === "x") slicePreviewPlane.position.x = value;
      else if (sliceAxis === "z") slicePreviewPlane.position.z = value;
      else slicePreviewPlane.position.y = value;
    }

    if (slicePositionSlider) slicePositionSlider.value = String(value);
    if (slicePositionValue) slicePositionValue.textContent = value.toFixed(1) + " mm";

    updateSliceClipPlane();
  }

  function createSliceInteriorMesh() {
    if (!currentFillMesh || !sliceClipPlane) return;

    // Back-face mesh: shows interior surfaces where the clip plane cuts.
    // Depth testing against the front-face model ensures back faces only
    // appear at the exposed cross-section, not behind the exterior surface.
    const geom = currentFillMesh.geometry; // shared reference, no clone
    const backMat = new THREE.MeshStandardMaterial({
      color: getCapColor(currentPartColor),
      roughness: 0.5,
      metalness: 0.05,
      side: THREE.BackSide,
      clippingPlanes: [sliceClipPlane]
    });
    sliceInteriorMesh = new THREE.Mesh(geom, backMat);
    currentModelRoot.add(sliceInteriorMesh);
  }

  function removeSliceClipping() {
    // Remove clipping from model materials (guard against already-disposed)
    try {
      if (currentFillMesh && currentFillMesh.material) currentFillMesh.material.clippingPlanes = [];
      if (currentWireMesh && currentWireMesh.material) currentWireMesh.material.clippingPlanes = [];
      if (currentEdgeLines && currentEdgeLines.material) currentEdgeLines.material.clippingPlanes = [];
    } catch (_) {}

    // Dispose back-face mesh
    if (sliceInteriorMesh) {
      if (currentModelRoot) currentModelRoot.remove(sliceInteriorMesh);
      sliceInteriorMesh.material.dispose();
      sliceInteriorMesh = null;
    }

    // Dispose preview plane
    disposeSlicePreviewPlane();

    sliceClipPlane = null;
    sliceActive = false;
    renderer.localClippingEnabled = false;
  }

  function rebuildSliceForAxisChange(newAxis) {
    sliceAxis = newAxis;
    const range = getSliceAxisRange();
    const mid = (range.min + range.max) / 2;

    if (slicePositionSlider) {
      slicePositionSlider.min = String(range.min);
      slicePositionSlider.max = String(range.max);
      slicePositionSlider.value = String(mid);
    }

    slicePosition = mid;

    // Rebuild preview plane for new orientation
    disposeSlicePreviewPlane();
    createSlicePreviewPlane();

    // Rebuild back-face mesh for new orientation
    if (sliceInteriorMesh) {
      currentModelRoot.remove(sliceInteriorMesh);
      sliceInteriorMesh.material.dispose();
      sliceInteriorMesh = null;
    }

    updateSliceClipPlane();
    createSliceInteriorMesh();

    if (slicePositionValue) slicePositionValue.textContent = mid.toFixed(1) + " mm";
  }

  function initSliceControls() {
    if (!currentBounds || !currentFillMesh) return;

    const range = getSliceAxisRange();
    const mid = (range.min + range.max) / 2;
    slicePosition = mid;

    if (slicePositionSlider) {
      slicePositionSlider.min = String(range.min);
      slicePositionSlider.max = String(range.max);
      slicePositionSlider.step = String(Math.max(0.1, (range.max - range.min) / 500));
      slicePositionSlider.value = String(mid);
    }
    if (slicePositionValue) slicePositionValue.textContent = mid.toFixed(1) + " mm";

    initSliceClipPlane();
    createSlicePreviewPlane();
    createSliceInteriorMesh();
  }

  function setupSlicePlaneDrag() {
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let dragStartX = 0;
    let dragStartY = 0;
    let dragStartValue = 0;

    renderer.domElement.addEventListener("pointerdown", (event) => {
      if (!slicePreviewPlane || !slicePanelVisible || !sliceActive) return;
      mouse.x = (event.offsetX / renderer.domElement.clientWidth) * 2 - 1;
      mouse.y = -(event.offsetY / renderer.domElement.clientHeight) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObject(slicePreviewPlane, true);
      if (hits.length > 0) {
        isDraggingSlicePlane = true;
        dragStartX = event.clientX;
        dragStartY = event.clientY;
        dragStartValue = slicePosition;
        controls.enabled = false;
        event.preventDefault();
      }
    });

    renderer.domElement.addEventListener("pointermove", (event) => {
      if (!isDraggingSlicePlane || !currentBounds) return;

      // Project the slice axis to screen space to determine drag sensitivity
      const center = new THREE.Vector3();
      currentBounds.getCenter(center);
      const range = getSliceAxisRange();
      const axisLen = range.max - range.min;
      const axisDir = new THREE.Vector3(
        sliceAxis === "x" ? 1 : 0,
        sliceAxis === "y" ? 1 : 0,
        sliceAxis === "z" ? 1 : 0
      );

      const p1 = center.clone().project(camera);
      const p2 = center.clone().addScaledVector(axisDir, axisLen).project(camera);

      const canvasW = renderer.domElement.clientWidth;
      const canvasH = renderer.domElement.clientHeight;
      const sx1 = (p1.x + 1) * canvasW / 2;
      const sy1 = (1 - p1.y) * canvasH / 2;
      const sx2 = (p2.x + 1) * canvasW / 2;
      const sy2 = (1 - p2.y) * canvasH / 2;

      const screenDx = sx2 - sx1;
      const screenDy = sy2 - sy1;
      const screenLen = Math.sqrt(screenDx * screenDx + screenDy * screenDy);
      if (screenLen < 1) return; // axis perpendicular to screen

      const mouseDx = event.clientX - dragStartX;
      const mouseDy = event.clientY - dragStartY;
      const projected = (mouseDx * screenDx + mouseDy * screenDy) / screenLen;
      const worldDelta = (projected / screenLen) * axisLen;
      updateSlicePreviewPosition(dragStartValue + worldDelta);
    });

    window.addEventListener("pointerup", () => {
      if (isDraggingSlicePlane) {
        isDraggingSlicePlane = false;
        controls.enabled = true;
      }
    });
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

    // Back-face interior mesh only meaningful when solid fill is visible
    if (sliceActive && sliceInteriorMesh) {
      const showCap = style !== "wireframe" && sliceCapCheckbox && sliceCapCheckbox.checked;
      sliceInteriorMesh.visible = showCap;
    }

    if (announce) {
      setStatus(`View style changed to ${getViewStyleLabel(style)}.`);
    }
  }

  function applyPartColor(hexString) {
    currentPartColor = parseInt(hexString.replace("#", ""), 16);
    if (currentFillMesh && currentFillMesh.material) {
      currentFillMesh.material.color.setHex(currentPartColor);
    }
    if (sliceInteriorMesh && sliceInteriorMesh.material) {
      sliceInteriorMesh.material.color.setHex(getCapColor(currentPartColor));
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

    // Save slice state so it survives the clearCurrentModel() inside applyGeometryToScene()
    const wasSliceActive = slicePanelVisible;
    const savedSliceAxis = sliceAxis;
    const savedSliceFlipped = sliceFlipped;
    const savedSlicePos = slicePosition;

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

    // Restore slice view if it was active before rebuild
    if (wasSliceActive) {
      slicePanelVisible = true;
      sliceAxis = savedSliceAxis;
      sliceFlipped = savedSliceFlipped;
      if (slicePanel) slicePanel.style.display = "";
      if (sliceToggleBtn) {
        sliceToggleBtn.classList.add("is-active");
        sliceToggleBtn.setAttribute("aria-pressed", "true");
      }
      if (sliceFlipCheckbox) sliceFlipCheckbox.checked = savedSliceFlipped;
      if (sliceAxisXRadio && savedSliceAxis === "x") sliceAxisXRadio.checked = true;
      if (sliceAxisYRadio && savedSliceAxis === "y") sliceAxisYRadio.checked = true;
      if (sliceAxisZRadio && savedSliceAxis === "z") sliceAxisZRadio.checked = true;
      initSliceControls();
      // Try to restore previous position (clamped to new bounds)
      updateSlicePreviewPosition(savedSlicePos);
    }

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

    // New file load — ensure slice state is not preserved across file loads
    slicePanelVisible = false;
    sliceActive = false;

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

  /**
   * Streaming parametric STEP conversion with real-time progress.
   * Sends the STL blob and reads NDJSON progress lines, calling onProgress
   * for each line.  Returns {blob, meta} on completion.
   */
  async function convertStlBlobToStepStreaming(stlBlob, filename, onProgress) {
    const url = `${CONVERTER_API_BASE}/api/convert/stl-to-step-parametric?filename=${encodeURIComponent(filename)}&stream=true`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: stlBlob
    });

    if (!response.ok) {
      let details = "The converter service rejected the file.";
      try {
        const payload = await response.json();
        if (payload && payload.error) details = payload.error;
      } catch (_) {
        const fallbackText = await response.text();
        if (fallbackText) details = fallbackText;
      }
      throw new Error(details);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let completionEvent = null;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop(); // keep incomplete last line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const event = JSON.parse(trimmed);
          if (event.type === "progress" && onProgress) {
            onProgress(event.message);
          } else if (event.type === "complete") {
            completionEvent = event;
          } else if (event.type === "error") {
            throw new Error(event.message);
          }
        } catch (parseErr) {
          if (parseErr.message && !parseErr.message.includes("JSON"))
            throw parseErr;
          // Skip malformed JSON lines
        }
      }
    }

    // Process any remaining data in buffer
    if (buffer.trim()) {
      try {
        const event = JSON.parse(buffer.trim());
        if (event.type === "complete") completionEvent = event;
        else if (event.type === "error") throw new Error(event.message);
      } catch (_) { /* ignore */ }
    }

    if (!completionEvent) {
      throw new Error("Conversion stream ended without a completion event.");
    }

    // Decode base64 STEP data
    const binaryStr = atob(completionEvent.data);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    const meta = {
      analytical: completionEvent.meta.analytical,
      coverage:   completionEvent.meta.coverage   || null,
      cylinders:  completionEvent.meta.cylinders   || null,
      planes:     completionEvent.meta.planes      || null,
      pctCyl:     completionEvent.meta.pctCyl      || null,
      pctPlane:   completionEvent.meta.pctPlane    || null,
      pctFillet:  completionEvent.meta.pctFillet   || null
    };

    return {
      blob: new Blob([bytes], { type: "model/step" }),
      meta
    };
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

  function extractGeometryFromObject3D(object) {
    const geometries = [];
    object.traverse(function (child) {
      if (child.isMesh && child.geometry) {
        const cloned = child.geometry.clone();
        if (child.matrixWorld) {
          cloned.applyMatrix4(child.matrixWorld);
        }
        geometries.push(cloned);
      }
    });
    if (geometries.length === 0) {
      return null;
    }
    if (geometries.length === 1) {
      return geometries[0];
    }
    // Merge all geometries into one
    const merged = geometries[0];
    for (let i = 1; i < geometries.length; i++) {
      const other = geometries[i];
      const positions = [];
      const normals = [];
      for (const geom of [merged, other]) {
        const nonIndexed = geom.index ? geom.toNonIndexed() : geom;
        positions.push(nonIndexed.getAttribute("position").array);
        if (nonIndexed.getAttribute("normal")) {
          normals.push(nonIndexed.getAttribute("normal").array);
        }
      }
      const totalLen = positions.reduce(function (s, a) { return s + a.length; }, 0);
      const mergedPos = new Float32Array(totalLen);
      let offset = 0;
      for (const arr of positions) {
        mergedPos.set(arr, offset);
        offset += arr.length;
      }
      const combinedGeom = new THREE.BufferGeometry();
      combinedGeom.setAttribute("position", new THREE.BufferAttribute(mergedPos, 3));
      if (normals.length === positions.length) {
        const totalNLen = normals.reduce(function (s, a) { return s + a.length; }, 0);
        const mergedNrm = new Float32Array(totalNLen);
        let nOffset = 0;
        for (const arr of normals) {
          mergedNrm.set(arr, nOffset);
          nOffset += arr.length;
        }
        combinedGeom.setAttribute("normal", new THREE.BufferAttribute(mergedNrm, 3));
      }
      merged.dispose();
      other.dispose();
      return combinedGeom;
    }
    return merged;
  }

  async function convertCadToStl(file, extension) {
    const url = `${CONVERTER_API_BASE}/api/convert/cad-to-stl?filename=${encodeURIComponent(file.name)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
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

  async function loadModelFile(file) {
    if (!file) {
      return;
    }

    const extension = getFileExtension(file.name);
    if (!SUPPORTED_INPUT_EXTENSIONS.has(extension)) {
      setStatus("Unsupported file format. Try STL, OBJ, PLY, GLTF, STEP, or SLDPRT.");
      return;
    }

    try {
      // Server-side CAD conversions (STEP, IGES, BREP, SLDPRT → STL)
      if (extension === "sldprt") {
        setStatus(`Converting ${file.name} to STL via local converter...`);
        const convertedArrayBuffer = await convertSldprtToStl(file);
        parseStlArrayBuffer(convertedArrayBuffer, `${stripFileExtension(file.name)}.stl`);
        setStatus(`Converted ${file.name} and loaded the generated STL.`);
        return;
      }

      if (CAD_EXTENSIONS.has(extension)) {
        setStatus(`Converting ${file.name} to STL via FreeCAD...`);
        const convertedArrayBuffer = await convertCadToStl(file, extension);
        parseStlArrayBuffer(convertedArrayBuffer, `${stripFileExtension(file.name)}.stl`);
        setStatus(`Converted and loaded ${file.name}.`);
        return;
      }

      // Client-side format loaders
      setStatus(`Loading ${file.name}...`);
      const arrayBuffer = await readFileAsArrayBuffer(file);

      if (extension === "stl") {
        parseStlArrayBuffer(arrayBuffer, file.name);
        return;
      }

      if (extension === "obj") {
        const text = new TextDecoder().decode(arrayBuffer);
        const group = objLoader.parse(text);
        const geometry = extractGeometryFromObject3D(group);
        if (!geometry) {
          throw new Error("OBJ file contains no mesh geometry.");
        }
        loadGeometryIntoViewer(geometry, file.name);
        return;
      }

      if (extension === "ply") {
        const geometry = plyLoader.parse(arrayBuffer);
        if (!geometry) {
          throw new Error("PLY file could not be parsed.");
        }
        loadGeometryIntoViewer(geometry, file.name);
        return;
      }

      if (extension === "gltf" || extension === "glb") {
        await new Promise(function (resolve, reject) {
          gltfLoader.parse(arrayBuffer, "", function (gltf) {
            const geometry = extractGeometryFromObject3D(gltf.scene);
            if (!geometry) {
              reject(new Error("GLTF file contains no mesh geometry."));
              return;
            }
            loadGeometryIntoViewer(geometry, file.name);
            resolve();
          }, function (error) {
            reject(error);
          });
        });
        return;
      }

      if (extension === "3mf") {
        if (!THREE.ThreeMFLoader) {
          throw new Error("3MF loader not available.");
        }
        const loader3mf = new THREE.ThreeMFLoader();
        const group = loader3mf.parse(arrayBuffer);
        const geometry = extractGeometryFromObject3D(group);
        if (!geometry) {
          throw new Error("3MF file contains no mesh geometry.");
        }
        loadGeometryIntoViewer(geometry, file.name);
        return;
      }

      // Fallback: treat as STL
      parseStlArrayBuffer(arrayBuffer, file.name);
    } catch (error) {
      console.error(error);
      if (extension === "sldprt") {
        const friendlyError = getFriendlySldprtErrorMessage(error.message);
        setStatus(`SLDPRT conversion failed: ${friendlyError}`);
        return;
      }
      if (CAD_EXTENSIONS.has(extension)) {
        setStatus(`CAD conversion failed: ${error.message}`);
        return;
      }
      setStatus(`Could not load ${file.name}: ${error.message}`);
    }
  }

  function loadGeometryIntoViewer(geometry, fileName) {
    const preparedBase = prepareBaseGeometry(geometry);

    if (baseGeometry) {
      baseGeometry.dispose();
    }

    baseGeometry = preparedBase;
    currentFileName = fileName;
    scaleX = scaleY = scaleZ = 1.0;
    bboxOverlayActive = false;
    slicePanelVisible = false;
    sliceActive = false;

    const bounds = getRefinementBounds();
    const startingMultiplier = normalizeRequestedMultiplier(1, bounds);
    updateRefinementUi(startingMultiplier, bounds);

    rebuildModelFromSettings();
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

      if (formatKey === "step-parametric") {
        // Use streaming endpoint for real-time progress feedback.
        const { blob, meta } = await convertStlBlobToStepStreaming(
          stlBlob, `${stem}.stl`,
          (msg) => {
            // Show user-friendly phase summaries in the status bar.
            let display = msg;
            if (/^loaded (\d+) triangles/.test(msg)) {
              display = msg.replace("loaded", "Loaded");
            } else if (/^pre-filter:/.test(msg)) {
              display = "Classifying face normals\u2026";
            } else if (/^detecting planes/.test(msg)) {
              display = "Detecting flat surfaces\u2026";
            } else if (/^detecting cylinders/.test(msg)) {
              display = "Detecting cylindrical surfaces\u2026";
            } else if (/^detecting tori/.test(msg)) {
              display = "Detecting fillets & tori\u2026";
            } else if (/^detecting spheres/.test(msg)) {
              display = "Detecting spherical surfaces\u2026";
            } else if (/^coverage=/.test(msg)) {
              display = "Coverage: " + msg.replace("coverage=", "");
            } else if (/^(CSG solid|box CSG|sphere CSG|trying)/.test(msg)) {
              display = "Building solid\u2026";
            } else if (/^using analytical/.test(msg)) {
              display = "Analytical surfaces built successfully";
            } else if (/^using triangulated/.test(msg)) {
              display = "Using triangulated fallback";
            } else if (/^torus (detect|clusters|cleanup)/.test(msg)) {
              // Intermediate fillet details — skip, phase header already shown
              return;
            } else if (/^torus fillet (groups|applied)/.test(msg)) {
              display = msg.replace(/^torus fillet /, "Fillet ");
            } else if (/^(cyl|plane|torus|sphere)\b/.test(msg)) {
              // Individual detection result — show as-is
              display = msg;
            }
            setStatus(`Parametric STEP \u2014 ${display}`);
          }
        );
        return { blob, meta };
      }

      const endpoint = "/api/convert/stl-to-step";
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

  if (rotateToggleBtn && rotationRow) {
    rotateToggleBtn.addEventListener("click", () => {
      const show = rotationRow.style.display === "none";
      rotationRow.style.display = show ? "" : "none";
      rotateToggleBtn.setAttribute("aria-pressed", String(show));
      rotateToggleBtn.classList.toggle("is-active", show);
    });
  }

  if (applyRotationBtn) {
    applyRotationBtn.addEventListener("click", applyRotation);
  }

  if (resetRotationBtn) {
    resetRotationBtn.addEventListener("click", () => {
      resetRotationInputs();
    });
  }

  [rotX, rotY, rotZ].forEach(input => {
    if (!input) return;
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        e.preventDefault();
        applyRotation();
      }
    });
  });

  // ── Surface texture ────────────────────────────────────────────────────

  function buildFaceAdjacency(geometry) {
    const position = geometry.getAttribute("position");
    if (!position) return new Map();

    const faceCount = Math.floor(position.count / 3);
    const adjacency = new Map();
    const edgeMap = new Map();
    const precision = 10000;

    // Map vertex position to face index
    function positionKey(i) {
      const x = Math.round(position.getX(i) * precision);
      const y = Math.round(position.getY(i) * precision);
      const z = Math.round(position.getZ(i) * precision);
      return `${x}_${y}_${z}`;
    }

    // Build edge map for adjacency
    for (let f = 0; f < faceCount; f++) {
      const i0 = f * 3, i1 = f * 3 + 1, i2 = f * 3 + 2;
      const p0 = positionKey(i0), p1 = positionKey(i1), p2 = positionKey(i2);

      // Three edges: (p0,p1), (p1,p2), (p2,p0)
      const edges = [
        [p0, p1].sort().join('_'),
        [p1, p2].sort().join('_'),
        [p2, p0].sort().join('_')
      ];

      edges.forEach(edge => {
        if (!edgeMap.has(edge)) edgeMap.set(edge, []);
        edgeMap.get(edge).push(f);
      });
    }

    // Build adjacency from shared edges
    for (let f = 0; f < faceCount; f++) {
      adjacency.set(f, new Set());
    }
    edgeMap.forEach(faces => {
      for (let i = 0; i < faces.length; i++) {
        for (let j = i + 1; j < faces.length; j++) {
          const f1 = faces[i], f2 = faces[j];
          adjacency.get(f1).add(f2);
          adjacency.get(f2).add(f1);
        }
      }
    });

    return adjacency;
  }

  function getFaceNormal(geometry, faceIndex) {
    const position = geometry.getAttribute("position");
    const i0 = faceIndex * 3, i1 = faceIndex * 3 + 1, i2 = faceIndex * 3 + 2;
    const v0 = new THREE.Vector3(position.getX(i0), position.getY(i0), position.getZ(i0));
    const v1 = new THREE.Vector3(position.getX(i1), position.getY(i1), position.getZ(i1));
    const v2 = new THREE.Vector3(position.getX(i2), position.getY(i2), position.getZ(i2));
    const e1 = v2.clone().sub(v0);
    const e2 = v1.clone().sub(v0);
    return e1.cross(e2).normalize();
  }

  function getFaceCentroid(geometry, faceIndex) {
    const position = geometry.getAttribute("position");
    const i0 = faceIndex * 3, i1 = faceIndex * 3 + 1, i2 = faceIndex * 3 + 2;
    const centroid = new THREE.Vector3();
    centroid.add(new THREE.Vector3(position.getX(i0), position.getY(i0), position.getZ(i0)));
    centroid.add(new THREE.Vector3(position.getX(i1), position.getY(i1), position.getZ(i1)));
    centroid.add(new THREE.Vector3(position.getX(i2), position.getY(i2), position.getZ(i2)));
    centroid.divideScalar(3);
    return centroid;
  }

  function selectFaceRegion(startFaceIdx, addToSelection) {
    if (!faceAdjacency) return;
    const startNormal = getFaceNormal(currentFillMesh.geometry, startFaceIdx);
    const queue = [startFaceIdx];
    const visited = new Set();
    const NORMAL_THRESHOLD = 0.87; // ~30 degrees

    if (!addToSelection) {
      selectedFaceIndices.clear();
    }

    while (queue.length > 0) {
      const faceIdx = queue.shift();
      if (visited.has(faceIdx)) continue;
      visited.add(faceIdx);

      const faceNormal = getFaceNormal(currentFillMesh.geometry, faceIdx);
      const dot = startNormal.dot(faceNormal);
      if (dot > NORMAL_THRESHOLD) {
        selectedFaceIndices.add(faceIdx);
        const adjacent = faceAdjacency.get(faceIdx);
        if (adjacent) {
          adjacent.forEach(adjFace => {
            if (!visited.has(adjFace)) queue.push(adjFace);
          });
        }
      }
    }

    updateFaceHighlight();
    updateTextureFaceCount();
  }

  function updateFaceHighlight() {
    if (textureHighlightMesh) {
      textureHighlightMesh.geometry.dispose();
      textureHighlightMesh.material.dispose();
      currentModelRoot.remove(textureHighlightMesh);
      textureHighlightMesh = null;
    }

    if (selectedFaceIndices.size === 0) return;

    const position = currentFillMesh.geometry.getAttribute("position");
    const highlightPositions = [];
    const highlightIndices = [];

    selectedFaceIndices.forEach(faceIdx => {
      const i0 = faceIdx * 3, i1 = faceIdx * 3 + 1, i2 = faceIdx * 3 + 2;
      const baseIndex = highlightPositions.length / 3;

      // Get vertices and face normal
      const v0 = new THREE.Vector3(position.getX(i0), position.getY(i0), position.getZ(i0));
      const v1 = new THREE.Vector3(position.getX(i1), position.getY(i1), position.getZ(i1));
      const v2 = new THREE.Vector3(position.getX(i2), position.getY(i2), position.getZ(i2));
      const faceNormal = getFaceNormal(currentFillMesh.geometry, faceIdx);

      // Offset vertices along normal by 0.005mm to prevent z-fighting
      const offset = 0.005;
      highlightPositions.push(
        v0.x + faceNormal.x * offset, v0.y + faceNormal.y * offset, v0.z + faceNormal.z * offset,
        v1.x + faceNormal.x * offset, v1.y + faceNormal.y * offset, v1.z + faceNormal.z * offset,
        v2.x + faceNormal.x * offset, v2.y + faceNormal.y * offset, v2.z + faceNormal.z * offset
      );
      highlightIndices.push(baseIndex, baseIndex + 1, baseIndex + 2);
    });

    const highlightGeom = new THREE.BufferGeometry();
    highlightGeom.setAttribute("position", new THREE.Float32BufferAttribute(highlightPositions, 3));
    highlightGeom.setIndex(highlightIndices);

    const highlightMat = new THREE.MeshBasicMaterial({
      color: 0x4499ff,
      opacity: 0.45,
      transparent: true,
      depthTest: false,
      side: THREE.DoubleSide
    });

    textureHighlightMesh = new THREE.Mesh(highlightGeom, highlightMat);
    currentModelRoot.add(textureHighlightMesh);
  }

  function updateTextureFaceCount() {
    textureFaceCount.textContent = `${selectedFaceIndices.size} face${selectedFaceIndices.size === 1 ? '' : 's'} selected`;
  }

  function bumpValue(x, z, scale) {
    const u = ((x % scale) + scale) % scale / scale;
    const v = ((z % scale) + scale) % scale / scale;
    return Math.pow(Math.sin(Math.PI * u), 2) * Math.pow(Math.sin(Math.PI * v), 2);
  }

  function meshValue(x, z, cellSize, strandWidth) {
    const u = (x + z) / cellSize;
    const v = (x - z) / cellSize;
    const bandU = Math.abs(((u % 1) + 1) % 1 - 0.5) * 2;
    const bandV = Math.abs(((v % 1) + 1) % 1 - 0.5) * 2;
    const fraction = strandWidth / cellSize;
    const inU = bandU < fraction ? 1 : 0;
    const inV = bandV < fraction ? 1 : 0;
    return Math.max(inU, inV);
  }

  function applyTextureToGeometry() {
    if (selectedFaceIndices.size === 0) {
      setStatus("No faces selected for texture.");
      return;
    }

    const isWeave = texturePresetSelect.value === "mesh";
    const height = parseFloat(isWeave ? meshHeightInput.value : bumpHeightInput.value);
    const scale = parseFloat(isWeave ? meshCellInput.value : bumpScaleInput.value);
    const strandWidth = isWeave ? parseFloat(meshStrandInput.value) : 0;

    // Backup baseGeometry for reset
    preTextureBaseGeometry = baseGeometry.clone();

    // Determine subdivision level needed
    baseGeometry.computeBoundingBox();
    const bounds = baseGeometry.boundingBox;
    const avgDim = (bounds.max.x - bounds.min.x + bounds.max.z - bounds.min.z) / 2;
    const baseTriCount = baseGeometry.index.count / 3;
    const targetEdgeLen = scale / 4;
    let subdivLevels = 0;
    let currentEdgeLen = avgDim / Math.sqrt(baseTriCount);

    while (currentEdgeLen > targetEdgeLen && subdivLevels < 4) {
      if (baseTriCount * Math.pow(4, subdivLevels + 1) > MAX_TRIANGLES) break;
      currentEdgeLen /= 2;
      subdivLevels++;
    }

    // Subdivide baseGeometry
    let subdivGeom = baseGeometry.clone();
    for (let i = 0; i < subdivLevels; i++) {
      const newGeom = subdivideIndexedGeometry(subdivGeom);
      subdivGeom.dispose();
      subdivGeom = newGeom;
    }

    // Convert to non-indexed for per-face processing
    const nonIdxGeom = subdivGeom.toNonIndexed();
    const position = nonIdxGeom.getAttribute("position");
    const vertexCount = position.count;
    const newPositionArray = position.array.slice();

    // Collect selected face centroids (faster than per-vertex comparison)
    const selectedCentroids = Array.from(selectedFaceIndices).map(fIdx => {
      const origPos = currentFillMesh.geometry.getAttribute("position");
      const i0 = fIdx * 3, i1 = fIdx * 3 + 1, i2 = fIdx * 3 + 2;
      return new THREE.Vector3(
        (origPos.getX(i0) + origPos.getX(i1) + origPos.getX(i2)) / 3,
        (origPos.getY(i0) + origPos.getY(i1) + origPos.getY(i2)) / 3,
        (origPos.getZ(i0) + origPos.getZ(i1) + origPos.getZ(i2)) / 3
      );
    });

    // Compute proximity threshold
    const originalFaceArea = (bounds.max.x - bounds.min.x) * (bounds.max.z - bounds.min.z) / baseTriCount;
    const proximityThreshold = Math.sqrt(originalFaceArea) * 2;

    // Build grid-based spatial lookup for fast proximity queries
    const gridSize = Math.max(1, proximityThreshold);
    const grid = new Map();
    selectedCentroids.forEach(centroid => {
      const gx = Math.floor(centroid.x / gridSize);
      const gy = Math.floor(centroid.y / gridSize);
      const gz = Math.floor(centroid.z / gridSize);
      const key = `${gx}_${gy}_${gz}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(centroid);
    });

    // Apply displacement to vertices in selected regions
    let displacedCount = 0;

    for (let v = 0; v < vertexCount; v++) {
      const vx = newPositionArray[v * 3];
      const vy = newPositionArray[v * 3 + 1];
      const vz = newPositionArray[v * 3 + 2];
      const gx = Math.floor(vx / gridSize);
      const gy = Math.floor(vy / gridSize);
      const gz = Math.floor(vz / gridSize);

      let isSelected = false;
      // Check current cell and neighboring cells
      for (let dgx = -1; dgx <= 1; dgx++) {
        for (let dgy = -1; dgy <= 1; dgy++) {
          for (let dgz = -1; dgz <= 1; dgz++) {
            const key = `${gx + dgx}_${gy + dgy}_${gz + dgz}`;
            const cellCentroids = grid.get(key);
            if (cellCentroids) {
              const currentPos = new THREE.Vector3(vx, vy, vz);
              for (const centroid of cellCentroids) {
                if (currentPos.distanceTo(centroid) < proximityThreshold) {
                  isSelected = true;
                  break;
                }
              }
              if (isSelected) break;
            }
          }
          if (isSelected) break;
        }
        if (isSelected) break;
      }

      if (isSelected) {
        const faceIdx = Math.floor(v / 3);
        const normal = getFaceNormal(nonIdxGeom, faceIdx);
        const dispValue = isWeave
          ? meshValue(vx, vz, scale, strandWidth)
          : bumpValue(vx, vz, scale);

        const displacement = height * dispValue;
        newPositionArray[v * 3] += normal.x * displacement;
        newPositionArray[v * 3 + 1] += normal.y * displacement;
        newPositionArray[v * 3 + 2] += normal.z * displacement;
        displacedCount++;
      }
    }

    // Apply the modified positions back
    nonIdxGeom.setAttribute("position", new THREE.Float32BufferAttribute(newPositionArray, 3));
    nonIdxGeom.computeVertexNormals();

    // Re-index for baseGeometry and update the main geometry object
    const preparedGeom = prepareBaseGeometry(nonIdxGeom);
    if (preparedGeom !== nonIdxGeom) {
      nonIdxGeom.dispose();
    }
    baseGeometry = preparedGeom;
    subdivGeom.dispose();

    selectedFaceIndices.clear();
    faceAdjacency = null;
    faceCentroids = null;
    clearTextureSelection();

    rebuildModelFromSettings();
    textureResetBtn.disabled = false;
    setStatus(`Texture applied to ${displacedCount} vertices.`);
  }

  function initTexturePanel() {
    if (!currentFillMesh) return;
    faceAdjacency = buildFaceAdjacency(currentFillMesh.geometry);
    selectedFaceIndices.clear();
    updateFaceHighlight();
    updateTextureFaceCount();

    // Add click handler for face selection
    const onCanvasClick = (e) => {
      if (!texturePanelVisible || !currentFillMesh) return;

      const rect = renderer.domElement.getBoundingClientRect();
      textureMouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      textureMouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      textureRaycaster.setFromCamera(textureMouse, camera);
      const intersects = textureRaycaster.intersectObject(currentFillMesh);

      if (intersects.length > 0) {
        const intersection = intersects[0];
        const hitPoint = intersection.point;

        // Find the closest face to the intersection point
        const pos = currentFillMesh.geometry.getAttribute("position");
        const faceCount = Math.floor(pos.count / 3);
        let closestFace = 0;
        let minDist = Infinity;

        for (let f = 0; f < faceCount; f++) {
          const i0 = f * 3, i1 = f * 3 + 1, i2 = f * 3 + 2;
          const v0 = new THREE.Vector3(pos.getX(i0), pos.getY(i0), pos.getZ(i0));
          const v1 = new THREE.Vector3(pos.getX(i1), pos.getY(i1), pos.getZ(i1));
          const v2 = new THREE.Vector3(pos.getX(i2), pos.getY(i2), pos.getZ(i2));

          // Compute face center and distance to hit point
          const faceCenter = new THREE.Vector3().addVectors(v0, v1).add(v2).divideScalar(3);
          const dist = hitPoint.distanceTo(faceCenter);

          if (dist < minDist) {
            minDist = dist;
            closestFace = f;
          }
        }

        selectFaceRegion(closestFace, e.shiftKey);
      } else if (!e.shiftKey) {
        selectedFaceIndices.clear();
        updateFaceHighlight();
        updateTextureFaceCount();
      }
    };

    renderer.domElement.addEventListener("click", onCanvasClick);
    renderer.domElement._textureClickHandler = onCanvasClick;
  }

  function clearTextureSelection() {
    if (renderer.domElement._textureClickHandler) {
      renderer.domElement.removeEventListener("click", renderer.domElement._textureClickHandler);
      delete renderer.domElement._textureClickHandler;
    }
    selectedFaceIndices.clear();
    faceAdjacency = null;
    if (textureHighlightMesh) {
      textureHighlightMesh.geometry.dispose();
      textureHighlightMesh.material.dispose();
      if (currentModelRoot) currentModelRoot.remove(textureHighlightMesh);
      textureHighlightMesh = null;
    }
    updateTextureFaceCount();
  }

  // ── Mold generator event listeners ──────────────────────────────────

  if (moldToggleBtn && moldPanel) {
    moldToggleBtn.addEventListener("click", () => {
      if (!currentFillMesh) return;
      moldPanelVisible = !moldPanelVisible;
      moldPanel.style.display = moldPanelVisible ? "" : "none";
      moldToggleBtn.setAttribute("aria-pressed", String(moldPanelVisible));
      moldToggleBtn.classList.toggle("is-active", moldPanelVisible);
      if (moldPanelVisible) {
        initMoldControls();
      } else {
        removeSplitPlanePreview();
      }
    });
  }

  if (moldSplitSlider) {
    moldSplitSlider.addEventListener("input", () => {
      updateSplitPlanePosition(parseFloat(moldSplitSlider.value));
    });
  }

  if (moldSprueEnabledCheckbox) {
    moldSprueEnabledCheckbox.addEventListener("change", () => {
      if (moldSprueDiameterInput) {
        moldSprueDiameterInput.disabled = !moldSprueEnabledCheckbox.checked;
      }
    });
  }

  if (generateMoldBtn) {
    generateMoldBtn.addEventListener("click", generateMold);
  }

  setupSplitPlaneDrag();

  // ── Slice view event listeners ──────────────────────────────────────

  if (sliceToggleBtn && slicePanel) {
    sliceToggleBtn.addEventListener("click", () => {
      if (!currentFillMesh) return;
      slicePanelVisible = !slicePanelVisible;
      slicePanel.style.display = slicePanelVisible ? "" : "none";
      sliceToggleBtn.setAttribute("aria-pressed", String(slicePanelVisible));
      sliceToggleBtn.classList.toggle("is-active", slicePanelVisible);
      if (slicePanelVisible) {
        initSliceControls();
        setStatus("Cross-section enabled — drag the cut plane or use the slider to reposition.");
      } else {
        removeSliceClipping();
        setStatus("Cross-section disabled.");
      }
    });
  }

  if (slicePositionSlider) {
    slicePositionSlider.addEventListener("input", () => {
      updateSlicePreviewPosition(parseFloat(slicePositionSlider.value));
    });
  }

  document.querySelectorAll('input[name="sliceAxis"]').forEach(radio => {
    radio.addEventListener("change", (e) => {
      if (sliceActive) {
        rebuildSliceForAxisChange(e.target.value);
        setStatus(`Cross-section axis changed to ${e.target.value.toUpperCase()}.`);
      }
    });
  });

  if (sliceFlipCheckbox) {
    sliceFlipCheckbox.addEventListener("change", () => {
      sliceFlipped = sliceFlipCheckbox.checked;
      updateSliceClipPlane();
      setStatus(sliceFlipped ? "Showing opposite side of cut." : "Showing default side of cut.");
    });
  }

  if (sliceCapCheckbox) {
    sliceCapCheckbox.addEventListener("change", () => {
      const show = sliceCapCheckbox.checked;
      if (sliceInteriorMesh) sliceInteriorMesh.visible = show;
    });
  }

  setupSlicePlaneDrag();

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

  // ── Texture panel event listeners ──────────────────────────────────

  if (textureToggleBtn && texturePanel) {
    textureToggleBtn.addEventListener("click", () => {
      if (!currentFillMesh) return;
      texturePanelVisible = !texturePanelVisible;
      texturePanel.style.display = texturePanelVisible ? "" : "none";
      textureToggleBtn.setAttribute("aria-pressed", String(texturePanelVisible));
      textureToggleBtn.classList.toggle("is-active", texturePanelVisible);
      if (texturePanelVisible) {
        initTexturePanel();
      } else {
        clearTextureSelection();
      }
    });
  }

  if (texturePresetSelect) {
    texturePresetSelect.addEventListener("change", () => {
      const isMesh = texturePresetSelect.value === "mesh";
      textureBumpsControls.style.display = isMesh ? "none" : "";
      textureMeshControls.style.display = isMesh ? "" : "none";
    });
  }

  if (textureClearSelBtn) {
    textureClearSelBtn.addEventListener("click", () => {
      selectedFaceIndices.clear();
      updateFaceHighlight();
      updateTextureFaceCount();
    });
  }

  if (textureSelectAllBtn) {
    textureSelectAllBtn.addEventListener("click", () => {
      if (!currentFillMesh) return;
      const faceCount = Math.floor(currentFillMesh.geometry.getAttribute("position").count / 3);
      for (let i = 0; i < faceCount; i++) {
        selectedFaceIndices.add(i);
      }
      updateFaceHighlight();
      updateTextureFaceCount();
    });
  }

  if (textureApplyBtn) {
    textureApplyBtn.addEventListener("click", () => {
      applyTextureToGeometry();
    });
  }

  if (textureResetBtn) {
    textureResetBtn.addEventListener("click", () => {
      if (preTextureBaseGeometry) {
        baseGeometry.dispose();
        baseGeometry = preTextureBaseGeometry.clone();
        preTextureBaseGeometry = null;
        textureResetBtn.disabled = true;
        rebuildModelFromSettings();
        setStatus("Texture reset to original geometry.");
      }
    });
  }

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

  // ============================================================================
  // TRAIN DETECTION PANEL — Home Assistant Integration
  // ============================================================================

  const TRAIN_DETECTION_CONFIG = {
    ha_base_url: localStorage.getItem('haBaseUrl') || 'http://homeassistant.local:8123',
    ha_token: localStorage.getItem('haToken') || '',
    update_interval: 10000, // 10 seconds
    entities: {
      train_detected: 'binary_sensor.train_detected',
      sound_level: 'sensor.train_detector_sound_level',
    }
  };

  let trainDetectionState = {
    last_detection: null,
    was_detecting: false,
    detection_events: [],
  };

  // Initialize train detection UI elements
  const detectionStatus = document.getElementById('detectionStatus');
  const soundLevelMeter = document.getElementById('soundLevelMeter');
  const soundLevelValue = document.getElementById('soundLevelValue');
  const meterNote = document.getElementById('meterNote');
  const eventLogTable = document.getElementById('eventLogTable');
  const eventLogBody = document.getElementById('eventLogBody');
  const logStatus = document.getElementById('logStatus');
  const trainDetectionReload = document.getElementById('trainDetectionReload');

  /**
   * Fetch Home Assistant entity state
   */
  async function fetchHaEntityState(entityId) {
    if (!TRAIN_DETECTION_CONFIG.ha_token) {
      meterNote.textContent = 'HA token not set. Open console to configure.';
      return null;
    }

    try {
      const response = await fetch(
        `${TRAIN_DETECTION_CONFIG.ha_base_url}/api/states/${entityId}`,
        {
          headers: {
            'Authorization': `Bearer ${TRAIN_DETECTION_CONFIG.ha_token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        if (response.status === 401) {
          meterNote.textContent = 'HA authentication failed. Check token.';
        } else {
          meterNote.textContent = `HA error: ${response.status}`;
        }
        return null;
      }

      return await response.json();
    } catch (error) {
      console.error(`Error fetching ${entityId}:`, error);
      meterNote.textContent = 'Failed to connect to Home Assistant';
      return null;
    }
  }

  /**
   * Update train detection display
   */
  async function updateTrainDetectionStatus() {
    const trainDetected = await fetchHaEntityState(TRAIN_DETECTION_CONFIG.entities.train_detected);
    const soundLevel = await fetchHaEntityState(TRAIN_DETECTION_CONFIG.entities.sound_level);

    if (!trainDetected || !soundLevel) {
      // HA not connected or entity not found
      if (meterNote.textContent === 'Connecting to Home Assistant...' ||
          !meterNote.textContent.includes('failed')) {
        meterNote.textContent = 'No HA connection. Configure via console: setHaConfig(url, token)';
      }
      return;
    }

    // Update sound level
    const level = parseFloat(soundLevel.state) || 0;
    soundLevelMeter.value = Math.min(100, level * 100);
    soundLevelValue.textContent = `${Math.round(level * 100)}%`;
    meterNote.textContent = `Last update: ${new Date().toLocaleTimeString()}`;

    // Update detection status
    const isDetecting = trainDetected.state === 'on';
    const statusElement = detectionStatus.querySelector('.status-indicator');

    if (isDetecting) {
      statusElement.className = 'status-indicator status-detecting';
      detectionStatus.querySelector('.status-text').textContent = 'Train Passing';
      detectionStatus.querySelector('.status-detail').textContent =
        `Sound level: ${(level * 100).toFixed(1)}% — Fan at 80%`;

      // Log detection event start
      if (!trainDetectionState.was_detecting) {
        const now = new Date();
        trainDetectionState.last_detection = {
          start_time: now,
          peak_level: level,
        };
        trainDetectionState.was_detecting = true;
      } else if (trainDetectionState.last_detection) {
        // Update peak level
        trainDetectionState.last_detection.peak_level = Math.max(
          trainDetectionState.last_detection.peak_level,
          level
        );
      }
    } else {
      statusElement.className = 'status-indicator status-clear';
      detectionStatus.querySelector('.status-text').textContent = 'Clear';
      detectionStatus.querySelector('.status-detail').textContent =
        'No train detected — Normal airflow';

      // Log detection event end
      if (trainDetectionState.was_detecting && trainDetectionState.last_detection) {
        const event = {
          start_time: trainDetectionState.last_detection.start_time,
          end_time: new Date(),
          peak_level: trainDetectionState.last_detection.peak_level,
        };
        trainDetectionState.detection_events.unshift(event);
        trainDetectionState.was_detecting = false;

        // Keep only last 100 events
        if (trainDetectionState.detection_events.length > 100) {
          trainDetectionState.detection_events.pop();
        }

        updateEventLog();
      }
    }
  }

  /**
   * Update event log table
   */
  function updateEventLog() {
    logStatus.textContent = `${trainDetectionState.detection_events.length} event(s) recorded`;

    if (trainDetectionState.detection_events.length === 0) {
      eventLogBody.innerHTML = '<tr class="no-events"><td colspan="4">No events recorded yet</td></tr>';
      return;
    }

    eventLogBody.innerHTML = trainDetectionState.detection_events
      .map(event => {
        const startTime = new Date(event.start_time);
        const endTime = new Date(event.end_time);
        const duration = Math.round((endTime - startTime) / 1000); // seconds
        const peakLevel = (event.peak_level * 100).toFixed(1);

        return `<tr>
          <td>${startTime.toLocaleTimeString()}</td>
          <td>${duration}s</td>
          <td>${peakLevel}%</td>
          <td>80% fan speed</td>
        </tr>`;
      })
      .join('');
  }

  /**
   * Global function to set HA configuration
   * Usage in console: setHaConfig('http://homeassistant.local:8123', 'eyJ0...')
   */
  window.setHaConfig = function(baseUrl, token) {
    TRAIN_DETECTION_CONFIG.ha_base_url = baseUrl;
    TRAIN_DETECTION_CONFIG.ha_token = token;
    localStorage.setItem('haBaseUrl', baseUrl);
    localStorage.setItem('haToken', token);
    meterNote.textContent = 'Configuration updated. Reloading...';
    setTimeout(updateTrainDetectionStatus, 500);
  };

  // Reload button
  if (trainDetectionReload) {
    trainDetectionReload.addEventListener('click', updateTrainDetectionStatus);
  }

  // Start periodic updates
  updateTrainDetectionStatus();
  setInterval(updateTrainDetectionStatus, TRAIN_DETECTION_CONFIG.update_interval);
});
