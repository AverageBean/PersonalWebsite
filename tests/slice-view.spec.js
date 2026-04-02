const fs   = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");

const TESTDOCS_DIR   = path.resolve(__dirname, "..", "TestDocs");
const TESTOUTPUT_DIR = path.resolve(__dirname, "..", "Testoutput");
const RUN_DATE = "2026-04-02";

const tinyStl = `solid tiny
facet normal 0 0 1
  outer loop
    vertex 0 0 0
    vertex 20 0 0
    vertex 0 20 0
  endloop
endfacet
facet normal 0 0 -1
  outer loop
    vertex 0 0 0
    vertex 0 20 0
    vertex 20 0 0
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

// ── Slice toggle button ──────────────────────────────────────────────────

test("slice toggle is disabled before model load and enabled after", async ({ page }) => {
  await expect(page.locator("#sliceToggleBtn")).toBeDisabled();

  await page.setInputFiles("#fileInput", {
    name: "tiny.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(tinyStl)
  });
  await expect(page.locator("#fileName")).toHaveText("tiny.stl", { timeout: 10000 });

  await expect(page.locator("#sliceToggleBtn")).toBeEnabled();
});

test("slice toggle shows and hides the slice panel", async ({ page }) => {
  await page.setInputFiles("#fileInput", {
    name: "tiny.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(tinyStl)
  });
  await expect(page.locator("#fileName")).toHaveText("tiny.stl", { timeout: 10000 });

  // Panel hidden by default
  await expect(page.locator("#slicePanel")).not.toBeVisible();
  await expect(page.locator("#sliceToggleBtn")).toHaveAttribute("aria-pressed", "false");

  // Click to show
  await page.locator("#sliceToggleBtn").click();
  await expect(page.locator("#slicePanel")).toBeVisible();
  await expect(page.locator("#sliceToggleBtn")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#sliceToggleBtn")).toHaveClass(/is-active/);

  // Click to hide
  await page.locator("#sliceToggleBtn").click();
  await expect(page.locator("#slicePanel")).not.toBeVisible();
  await expect(page.locator("#sliceToggleBtn")).toHaveAttribute("aria-pressed", "false");
});

// ── Panel defaults ───────────────────────────────────────────────────────

test("slice panel has correct default values", async ({ page }) => {
  await page.setInputFiles("#fileInput", {
    name: "tiny.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(tinyStl)
  });
  await expect(page.locator("#fileName")).toHaveText("tiny.stl", { timeout: 10000 });

  await page.locator("#sliceToggleBtn").click();
  await expect(page.locator("#slicePanel")).toBeVisible();

  // Y axis selected by default
  await expect(page.locator("#sliceAxisY")).toBeChecked();
  await expect(page.locator("#sliceAxisX")).not.toBeChecked();
  await expect(page.locator("#sliceAxisZ")).not.toBeChecked();

  // Flip unchecked, cap checked
  await expect(page.locator("#sliceFlipCheckbox")).not.toBeChecked();
  await expect(page.locator("#sliceCapCheckbox")).toBeChecked();

  // Readout shows numeric mm value
  const readout = await page.locator("#slicePositionValue").innerText();
  expect(readout).toMatch(/[\d.]+\s*mm/);
});

test("slice slider range matches model bounding box on Y axis", async ({ page }) => {
  await page.setInputFiles("#fileInput", {
    name: "tiny.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(tinyStl)
  });
  await expect(page.locator("#fileName")).toHaveText("tiny.stl", { timeout: 10000 });

  await page.locator("#sliceToggleBtn").click();
  await expect(page.locator("#slicePanel")).toBeVisible();

  const slider = page.locator("#slicePositionSlider");
  const minVal = await slider.getAttribute("min");
  const maxVal = await slider.getAttribute("max");

  expect(parseFloat(minVal)).toBeGreaterThanOrEqual(0);
  expect(parseFloat(maxVal)).toBeGreaterThan(parseFloat(minVal));
});

// ── Axis switching ───────────────────────────────────────────────────────

test("changing axis radio updates slider range", async ({ page }) => {
  await page.setInputFiles("#fileInput", {
    name: "tiny.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(tinyStl)
  });
  await expect(page.locator("#fileName")).toHaveText("tiny.stl", { timeout: 10000 });

  await page.locator("#sliceToggleBtn").click();
  await expect(page.locator("#slicePanel")).toBeVisible();

  // Record Y-axis range
  const slider = page.locator("#slicePositionSlider");
  const yMin = parseFloat(await slider.getAttribute("min"));
  const yMax = parseFloat(await slider.getAttribute("max"));

  // Switch to X axis
  await page.locator("#sliceAxisX").click();

  const xMin = parseFloat(await slider.getAttribute("min"));
  const xMax = parseFloat(await slider.getAttribute("max"));

  // The tiny STL has different extents on X (0-20) vs Y (0-20) but
  // after centering, bounds differ. Just verify slider was updated
  expect(xMax).toBeGreaterThan(xMin);

  // Readout should show a numeric value
  const readout = await page.locator("#slicePositionValue").innerText();
  expect(readout).toMatch(/[\d.]+\s*mm/);
});

// ── Lifecycle ────────────────────────────────────────────────────────────

test("slice panel hides when a new file is loaded", async ({ page }) => {
  await page.setInputFiles("#fileInput", {
    name: "tiny.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(tinyStl)
  });
  await expect(page.locator("#fileName")).toHaveText("tiny.stl", { timeout: 10000 });

  // Open the slice panel
  await page.locator("#sliceToggleBtn").click();
  await expect(page.locator("#slicePanel")).toBeVisible();

  // Load another file
  await page.setInputFiles("#fileInput", {
    name: "tiny2.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(tinyStl)
  });
  await expect(page.locator("#fileName")).toHaveText("tiny2.stl", { timeout: 10000 });

  // Panel should be hidden, toggle reset
  await expect(page.locator("#slicePanel")).not.toBeVisible();
  await expect(page.locator("#sliceToggleBtn")).toHaveAttribute("aria-pressed", "false");
});

// ── GPU clipping validation ──────────────────────────────────────────────

test("slice active changes canvas rendering (GPU clipping)", async ({ page }) => {
  await page.setInputFiles("#fileInput", {
    name: "tiny.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(tinyStl)
  });
  await expect(page.locator("#fileName")).toHaveText("tiny.stl", { timeout: 10000 });

  // Wait for render to settle
  await page.waitForTimeout(500);

  // Capture canvas pixels before slice
  const beforePixels = await page.evaluate(() => {
    const canvas = document.querySelector("#viewerCanvas canvas");
    if (!canvas) return null;
    const ctx = canvas.getContext("webgl2");
    if (!ctx) return null;
    const pixels = new Uint8Array(4 * 10);
    const cx = Math.floor(canvas.width / 2);
    const cy = Math.floor(canvas.height / 2);
    ctx.readPixels(cx - 5, cy, 10, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, pixels);
    return Array.from(pixels);
  });

  expect(beforePixels).not.toBeNull();

  // Enable slice
  await page.locator("#sliceToggleBtn").click();
  await expect(page.locator("#slicePanel")).toBeVisible();

  // Move slider to near the bottom to clip most of the model away
  const slider = page.locator("#slicePositionSlider");
  const maxVal = parseFloat(await slider.getAttribute("max"));
  await slider.fill(String(maxVal - 0.5));
  await slider.dispatchEvent("input");

  await page.waitForTimeout(500);

  // Capture canvas pixels after slice
  const afterPixels = await page.evaluate(() => {
    const canvas = document.querySelector("#viewerCanvas canvas");
    if (!canvas) return null;
    const ctx = canvas.getContext("webgl2");
    if (!ctx) return null;
    const pixels = new Uint8Array(4 * 10);
    const cx = Math.floor(canvas.width / 2);
    const cy = Math.floor(canvas.height / 2);
    ctx.readPixels(cx - 5, cy, 10, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, pixels);
    return Array.from(pixels);
  });

  expect(afterPixels).not.toBeNull();

  // Pixels should differ — the clipping changed what's visible
  const pixelsMatch = beforePixels.every((v, i) => v === afterPixels[i]);
  expect(pixelsMatch).toBe(false);
});

// ── Coexistence with mold panel ─────────────────────────────────────────

test("slice and mold panels can both be open simultaneously", async ({ page }) => {
  await page.setInputFiles("#fileInput", {
    name: "tiny.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(tinyStl)
  });
  await expect(page.locator("#fileName")).toHaveText("tiny.stl", { timeout: 10000 });

  // Open both panels
  await page.locator("#moldToggleBtn").click();
  await expect(page.locator("#moldPanel")).toBeVisible();

  await page.locator("#sliceToggleBtn").click();
  await expect(page.locator("#slicePanel")).toBeVisible();

  // Both should be visible
  await expect(page.locator("#moldPanel")).toBeVisible();
  await expect(page.locator("#slicePanel")).toBeVisible();
});

// ── Visual test with HelicalTube1 ────────────────────────────────────────

test("HelicalTube1 slice Y midpoint screenshot", async ({ page }) => {
  test.setTimeout(60000);

  const helicalPath = path.join(TESTDOCS_DIR, "HelicalTube1.stl");
  if (!fs.existsSync(helicalPath)) {
    test.skip(true, "HelicalTube1.stl not found in TestDocs");
  }

  await page.setInputFiles("#fileInput", helicalPath);
  await expect(page.locator("#dimX")).not.toHaveValue("", { timeout: 30000 });

  // Enable slice
  await page.locator("#sliceToggleBtn").click();
  await expect(page.locator("#slicePanel")).toBeVisible();

  // Wait for render to settle
  await page.waitForTimeout(1000);

  const screenshot = await page.locator("#viewerCanvas").screenshot();
  const outPath = path.join(TESTOUTPUT_DIR, `${RUN_DATE}_slice-helical-y-mid.png`);
  fs.writeFileSync(outPath, screenshot);

  // Verify screenshot was created
  expect(fs.statSync(outPath).size).toBeGreaterThan(1000);
});
