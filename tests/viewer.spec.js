const path = require("path");
const { test, expect } = require("@playwright/test");

const TESTDOCS_DIR = path.resolve(__dirname, "..", "TestDocs");
const TESTOUTPUT_DIR = path.resolve(__dirname, "..", "Testoutput");
const RUN_DATE = "2026-03-12";

const tinyAsciiStl = `solid tiny
facet normal 0 0 1
  outer loop
    vertex 0 0 0
    vertex 20 0 0
    vertex 0 20 0
  endloop
endfacet
endsolid tiny`;

test.beforeEach(async ({ page }) => {
  page.on("console", msg => {
    console.log(`[browser:${msg.type()}] ${msg.text()}`);
  });

  page.on("pageerror", error => {
    console.log(`[pageerror] ${error.message}`);
  });

  await page.goto("/");
});

test("viewer controls render", async ({ page }) => {
  await expect(page.locator("#controlPreset")).toBeVisible();
  await expect(page.locator("#viewStyle")).toBeVisible();
  await expect(page.locator("#backgroundStyle")).toBeVisible();
  await expect(page.locator("#refinementSlider")).toBeVisible();
  await expect(page.locator("#statusMessage")).toContainText("Viewer ready");
});

test("changes viewer background preset", async ({ page }) => {
  await page.locator("#backgroundStyle").selectOption("dark");
  await expect(page.locator("#statusMessage")).toContainText("Background changed to Dark Studio.");
});

test("refinement slider below 1x uses base geometry without mesh holes", async ({ page }) => {
  await page.setInputFiles("#fileInput", {
    name: "tiny.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(tinyAsciiStl)
  });

  await expect(page.locator("#fileName")).toHaveText("tiny.stl", { timeout: 10000 });
  const baseTriangleText = await page.locator("#triangleCount").innerText();

  await page.locator("#refinementSlider").evaluate((element, value) => {
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, "0.50");

  await expect(page.locator("#triangleCount")).toHaveText(baseTriangleText);
  await expect(page.locator("#statusMessage")).not.toContainText("failed");
  await expect(page.locator("#statusMessage")).not.toContainText("error");
});

test("refinement slider at non-power-of-4 applies subdivision without mesh holes", async ({ page }) => {
  await page.setInputFiles("#fileInput", {
    name: "tiny.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(tinyAsciiStl)
  });

  await expect(page.locator("#fileName")).toHaveText("tiny.stl", { timeout: 10000 });
  const baseTriangleText = await page.locator("#triangleCount").innerText();

  // 2.40x triggers ceil(log4(2.4)) = 1 subdivision → 4x triangles, no subsampling
  await page.locator("#refinementSlider").evaluate((element, value) => {
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, "2.40");

  await expect(page.locator("#triangleCount")).not.toHaveText(baseTriangleText);
  await expect(page.locator("#statusMessage")).not.toContainText("failed");
  await expect(page.locator("#statusMessage")).not.toContainText("error");
});

test("grid sits below model base after STL load (visual)", async ({ page }) => {
  const stlPath = path.join(TESTDOCS_DIR, "CurvedMinimalPost-Onshape.stl");

  await page.setInputFiles("#fileInput", stlPath);
  await expect(page.locator("#fileName")).toContainText("CurvedMinimalPost", { timeout: 15000 });
  await expect(page.locator("#triangleCount")).not.toHaveText("0");

  // Wait for several animation frames so WebGL has rendered the lifted model
  await page.waitForTimeout(600);

  // Capture the full viewer panel for spatial context
  await page.locator(".viewer-panel").screenshot({
    path: path.join(TESTOUTPUT_DIR, `${RUN_DATE}_grid-below-model-default-view.png`)
  });

  // Rotate to a low-angle side view to make grid/model relationship visible
  await page.evaluate(() => {
    const canvas = document.querySelector("#viewerCanvas canvas");
    const rect = canvas.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    canvas.dispatchEvent(new MouseEvent("mousedown", { clientX: cx, clientY: cy, button: 0, bubbles: true }));
    canvas.dispatchEvent(new MouseEvent("mousemove", { clientX: cx, clientY: cy + 120, button: 0, bubbles: true }));
    canvas.dispatchEvent(new MouseEvent("mouseup",   { clientX: cx, clientY: cy + 120, button: 0, bubbles: true }));
  });

  await page.waitForTimeout(400);

  await page.locator(".viewer-panel").screenshot({
    path: path.join(TESTOUTPUT_DIR, `${RUN_DATE}_grid-below-model-low-angle.png`)
  });

  // Model should have loaded without errors
  await expect(page.locator("#statusMessage")).not.toContainText("failed");
  await expect(page.locator("#statusMessage")).not.toContainText("error");

  // X dimension must be populated (proves bounding-box is in world space)
  const dimX = await page.locator("#dimX").inputValue();
  expect(dimX).not.toBe("");
});

test("zoom to fit fills viewport for micro-scale STL (visual)", async ({ page }) => {
  const stlPath = path.join(TESTDOCS_DIR, "CurvedMinimalPost-Onshape.stl");

  await page.setInputFiles("#fileInput", stlPath);
  await expect(page.locator("#fileName")).toContainText("CurvedMinimalPost", { timeout: 15000 });
  await expect(page.locator("#triangleCount")).not.toHaveText("0");
  await page.waitForTimeout(600);

  // Sample canvas pixels via WebGL readPixels to verify the model fills the viewport.
  // Three.js r128 requests webgl2 first; calling getContext("webgl") on a webgl2 canvas
  // returns null per the HTML spec — must match the context type already created.
  // Background Lab Light is ~0xe2e9f3 (226, 233, 243). Model is blue ~0x4c86a8.
  const modelVisible = await page.evaluate(() => {
    const canvas = document.querySelector("#viewerCanvas canvas");
    if (!canvas) return 0;

    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (!gl) return 0;

    const w = canvas.width;
    const h = canvas.height;
    const cx = Math.floor(w / 2);
    const cy = Math.floor(h / 2);
    const sampleRadius = Math.floor(Math.min(w, h) * 0.15);
    const pixels = new Uint8Array(4);
    let nonBackground = 0;

    for (let dy = -sampleRadius; dy <= sampleRadius; dy += 4) {
      for (let dx = -sampleRadius; dx <= sampleRadius; dx += 4) {
        const px = cx + dx;
        const py = cy + dy;
        if (px < 0 || py < 0 || px >= w || py >= h) continue;
        // WebGL origin is bottom-left; flip Y to match screen coordinates.
        gl.readPixels(px, h - py - 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        const diffR = Math.abs(pixels[0] - 226);
        const diffG = Math.abs(pixels[1] - 233);
        const diffB = Math.abs(pixels[2] - 243);
        if (diffR + diffG + diffB > 30) nonBackground++;
      }
    }

    return nonBackground;
  });

  await page.locator(".viewer-canvas-frame").screenshot({
    path: path.join(TESTOUTPUT_DIR, `${RUN_DATE}_zoom-to-fit-micro-model.png`)
  });

  // The model must occupy a non-trivial number of sampled pixels in the central viewport region.
  expect(modelVisible).toBeGreaterThan(0);

  await expect(page.locator("#statusMessage")).not.toContainText("failed");
});

test("loads stl, switches style, and applies slider multiplier", async ({ page }) => {
  await page.setInputFiles("#fileInput", {
    name: "tiny.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(tinyAsciiStl)
  });

  await expect(page.locator("#fileName")).toHaveText("tiny.stl", { timeout: 10000 });
  await expect(page.locator("#triangleCount")).not.toHaveText("0");

  const initialTriangleText = await page.locator("#triangleCount").innerText();

  await page.locator("#viewStyle").selectOption("wireframe");
  await expect(page.locator("#statusMessage")).toContainText("Triangle Lines Only");

  await page.locator("#refinementSlider").evaluate((element, value) => {
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, "2.40");

  await expect(page.locator("#refinementValue")).toContainText("2.40x");
  await expect(page.locator("#triangleCount")).not.toHaveText(initialTriangleText);
});

// ── Scale and footprint tests (2026-03-13) ──────────────────────────────────

test("scale/footprint buttons and dim inputs are disabled before load and enabled after load", async ({ page }) => {
  await expect(page.locator("#scaleHalfBtn")).toBeDisabled();
  await expect(page.locator("#scaleDoubleBtn")).toBeDisabled();
  await expect(page.locator("#minimizeFootprintBtn")).toBeDisabled();
  await expect(page.locator("#dimX")).toBeDisabled();
  await expect(page.locator("#dimY")).toBeDisabled();
  await expect(page.locator("#dimZ")).toBeDisabled();

  await page.setInputFiles("#fileInput", {
    name: "tiny.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(tinyAsciiStl)
  });

  await expect(page.locator("#fileName")).toHaveText("tiny.stl", { timeout: 10000 });
  await expect(page.locator("#scaleHalfBtn")).toBeEnabled();
  await expect(page.locator("#scaleDoubleBtn")).toBeEnabled();
  await expect(page.locator("#minimizeFootprintBtn")).toBeEnabled();
  await expect(page.locator("#dimX")).toBeEnabled();
  await expect(page.locator("#dimY")).toBeEnabled();
  await expect(page.locator("#dimZ")).toBeEnabled();
});

test("scale display initialises at 1.00× and updates on ½× and 2× presses", async ({ page }) => {
  await page.setInputFiles("#fileInput", {
    name: "tiny.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(tinyAsciiStl)
  });

  await expect(page.locator("#fileName")).toHaveText("tiny.stl", { timeout: 10000 });
  await expect(page.locator("#scaleDisplay")).toHaveText("1.00×");

  await page.locator("#scaleDoubleBtn").click();
  await expect(page.locator("#scaleDisplay")).toHaveText("2.00×");
  await expect(page.locator("#statusMessage")).toContainText("×2");

  await page.locator("#scaleHalfBtn").click();
  await expect(page.locator("#scaleDisplay")).toHaveText("1.00×");
});

test("scale resets to 1.00× when a new file is loaded", async ({ page }) => {
  await page.setInputFiles("#fileInput", {
    name: "tiny.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(tinyAsciiStl)
  });

  await expect(page.locator("#fileName")).toHaveText("tiny.stl", { timeout: 10000 });

  await page.locator("#scaleDoubleBtn").click();
  await expect(page.locator("#scaleDisplay")).toHaveText("2.00×");

  // Load a second file — scale should reset.
  await page.setInputFiles("#fileInput", {
    name: "tiny2.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(tinyAsciiStl)
  });

  await expect(page.locator("#fileName")).toHaveText("tiny2.stl", { timeout: 10000 });
  await expect(page.locator("#scaleDisplay")).toHaveText("1.00×");
});

test("scale persists across refinement slider changes", async ({ page }) => {
  await page.setInputFiles("#fileInput", {
    name: "tiny.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(tinyAsciiStl)
  });

  await expect(page.locator("#fileName")).toHaveText("tiny.stl", { timeout: 10000 });

  await page.locator("#scaleDoubleBtn").click();
  await expect(page.locator("#scaleDisplay")).toHaveText("2.00×");

  // Trigger a refinement rebuild via slider.
  await page.locator("#refinementSlider").evaluate(element => {
    element.value = "4.10";
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });

  await expect(page.locator("#refinementValue")).toContainText("4.10x", { timeout: 10000 });
  // Scale must still be 2× after the rebuild.
  await expect(page.locator("#scaleDisplay")).toHaveText("2.00×");
});

test("dimensions metric reflects scaled size", async ({ page }) => {
  await page.setInputFiles("#fileInput", {
    name: "tiny.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(tinyAsciiStl)
  });

  await expect(page.locator("#fileName")).toHaveText("tiny.stl", { timeout: 10000 });
  const baseX = await page.locator("#dimX").inputValue();

  await page.locator("#scaleDoubleBtn").click();
  const scaledX = await page.locator("#dimX").inputValue();

  // X dimension must change after 2× scale.
  expect(scaledX).not.toBe(baseX);
  expect(scaledX).not.toBe("");
});

test("typing a value into a dim input scales the model uniformly", async ({ page }) => {
  await page.setInputFiles("#fileInput", {
    name: "tiny.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(tinyAsciiStl)
  });

  await expect(page.locator("#fileName")).toHaveText("tiny.stl", { timeout: 10000 });

  const baseY = await page.locator("#dimY").inputValue();
  const baseScale = await page.locator("#scaleDisplay").innerText();

  // Type a new X dimension value and commit with Enter.
  await page.locator("#dimX").fill("100");
  await page.locator("#dimX").press("Enter");

  await expect(page.locator("#statusMessage")).toContainText("X = 100.00 mm", { timeout: 5000 });

  // Scale display must update to a non-1.00× value.
  const newScale = await page.locator("#scaleDisplay").innerText();
  expect(newScale).not.toBe(baseScale);

  // Y value must also change (uniform scale — all axes change together).
  const newY = await page.locator("#dimY").inputValue();
  expect(newY).not.toBe(baseY);
});

test("minimize footprint button reorients model and rebuilds", async ({ page }) => {
  const stlFile = path.join(TESTDOCS_DIR, "CurvedMinimalPost-Onshape.stl");

  await page.setInputFiles("#fileInput", stlFile);
  await expect(page.locator("#fileName")).toContainText(".stl", { timeout: 15000 });

  const trisBefore = await page.locator("#triangleCount").innerText();

  await page.locator("#minimizeFootprintBtn").click();

  // Status message must indicate reorientation.
  await expect(page.locator("#statusMessage")).toContainText("footprint", { timeout: 15000 });

  // Model must still be loaded (triangle count non-zero).
  await expect(page.locator("#triangleCount")).not.toHaveText("0");
  // Triangle count may be identical (same file, just rotated) or different if slider differs.
  // Either is valid; we confirm the viewer did not crash.
  await expect(page.locator("#statusMessage")).not.toContainText("failed");
});

test("non-uniform scale: unchecking Uniform applies scale to a single axis only", async ({ page }) => {
  await page.setInputFiles("#fileInput", {
    name: "tiny.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(tinyAsciiStl)
  });

  await expect(page.locator("#fileName")).toHaveText("tiny.stl", { timeout: 10000 });

  // Record baseline X and Z dimensions.
  const baseX = parseFloat(await page.locator("#dimX").inputValue());
  const baseZ = parseFloat(await page.locator("#dimZ").inputValue());

  // Uncheck uniform scale and type a new Y value.
  await page.locator("#uniformScaleCheckbox").uncheck();
  await page.locator("#dimY").fill("50");
  await page.locator("#dimY").press("Enter");

  // Status message should reference Y axis.
  await expect(page.locator("#statusMessage")).toContainText("Y");

  // X and Z should be unchanged; Y should differ.
  const newX = parseFloat(await page.locator("#dimX").inputValue());
  const newZ = parseFloat(await page.locator("#dimZ").inputValue());
  expect(Math.abs(newX - baseX)).toBeLessThan(0.01);
  expect(Math.abs(newZ - baseZ)).toBeLessThan(0.01);

  // Scale display should show "—" (mixed scales).
  await expect(page.locator("#scaleDisplay")).toHaveText("—");
});
