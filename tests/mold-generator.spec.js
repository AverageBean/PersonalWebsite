const fs   = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");

const TESTDOCS_DIR   = path.resolve(__dirname, "..", "TestDocs");
const TESTOUTPUT_DIR = path.resolve(__dirname, "..", "Testoutput");
const RUN_DATE = "2026-04-01";

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

// ── Mold toggle button ────────────────────────────────────────────────────

test("mold toggle is disabled before model load and enabled after", async ({ page }) => {
  await expect(page.locator("#moldToggleBtn")).toBeDisabled();

  await page.setInputFiles("#fileInput", {
    name: "tiny.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(tinyStl)
  });
  await expect(page.locator("#fileName")).toHaveText("tiny.stl", { timeout: 10000 });

  await expect(page.locator("#moldToggleBtn")).toBeEnabled();
});

test("mold toggle shows and hides the mold panel", async ({ page }) => {
  await page.setInputFiles("#fileInput", {
    name: "tiny.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(tinyStl)
  });
  await expect(page.locator("#fileName")).toHaveText("tiny.stl", { timeout: 10000 });

  // Panel hidden by default
  await expect(page.locator("#moldPanel")).not.toBeVisible();
  await expect(page.locator("#moldToggleBtn")).toHaveAttribute("aria-pressed", "false");

  // Click to show
  await page.locator("#moldToggleBtn").click();
  await expect(page.locator("#moldPanel")).toBeVisible();
  await expect(page.locator("#moldToggleBtn")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#moldToggleBtn")).toHaveClass(/is-active/);

  // Click to hide
  await page.locator("#moldToggleBtn").click();
  await expect(page.locator("#moldPanel")).not.toBeVisible();
  await expect(page.locator("#moldToggleBtn")).toHaveAttribute("aria-pressed", "false");
});

// ── Mold parameter defaults ───────────────────────────────────────────────

test("mold panel has correct default parameter values", async ({ page }) => {
  await page.setInputFiles("#fileInput", {
    name: "tiny.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(tinyStl)
  });
  await expect(page.locator("#fileName")).toHaveText("tiny.stl", { timeout: 10000 });

  await page.locator("#moldToggleBtn").click();
  await expect(page.locator("#moldPanel")).toBeVisible();

  await expect(page.locator("#moldWall")).toHaveValue("10");
  await expect(page.locator("#moldClearance")).toHaveValue("0");
  await expect(page.locator("#moldPinDiameter")).toHaveValue("5");
  await expect(page.locator("#moldPinInset")).toHaveValue("8");
  await expect(page.locator("#moldPinTolerance")).toHaveValue("0.4");
  await expect(page.locator("#moldSprueDiameter")).toHaveValue("6");
});

// ── Split slider ──────────────────────────────────────────────────────────

test("split slider range matches model bounding box", async ({ page }) => {
  await page.setInputFiles("#fileInput", {
    name: "tiny.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(tinyStl)
  });
  await expect(page.locator("#fileName")).toHaveText("tiny.stl", { timeout: 10000 });

  await page.locator("#moldToggleBtn").click();
  await expect(page.locator("#moldPanel")).toBeVisible();

  const slider = page.locator("#moldSplitSlider");
  const minVal = await slider.getAttribute("min");
  const maxVal = await slider.getAttribute("max");

  // The tiny STL has Y range 0-20; with the model sitting on the grid,
  // the slider min/max should reflect the world-space model bounds
  expect(parseFloat(minVal)).toBeGreaterThanOrEqual(0);
  expect(parseFloat(maxVal)).toBeGreaterThan(parseFloat(minVal));

  // Readout should show a numeric mm value
  const readout = await page.locator("#moldSplitValue").innerText();
  expect(readout).toMatch(/[\d.]+\s*mm/);
});

// ── Panel lifecycle ───────────────────────────────────────────────────────

test("mold panel hides when a new file is loaded", async ({ page }) => {
  await page.setInputFiles("#fileInput", {
    name: "tiny.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(tinyStl)
  });
  await expect(page.locator("#fileName")).toHaveText("tiny.stl", { timeout: 10000 });

  // Open the mold panel
  await page.locator("#moldToggleBtn").click();
  await expect(page.locator("#moldPanel")).toBeVisible();

  // Load another file
  await page.setInputFiles("#fileInput", {
    name: "tiny2.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(tinyStl)
  });
  await expect(page.locator("#fileName")).toHaveText("tiny2.stl", { timeout: 10000 });

  // Panel should be hidden, toggle reset
  await expect(page.locator("#moldPanel")).not.toBeVisible();
  await expect(page.locator("#moldToggleBtn")).toHaveAttribute("aria-pressed", "false");
});

// ── Mold generation (requires converter service) ──────────────────────────

test("generate mold produces a zip download", async ({ page }) => {
  // Skip if converter service is not running
  let converterAvailable = false;
  try {
    const response = await page.request.get("http://127.0.0.1:8090/api/health");
    const body = await response.json();
    converterAvailable = body.ok && body.freecadConfigured;
  } catch (_) {}

  test.skip(!converterAvailable, "Converter service not running — skipping mold generation test");
  test.setTimeout(240000);

  // Load a real STL model
  const meshRingPath = path.join(TESTDOCS_DIR, "MeshRing1.stl");
  await page.setInputFiles("#fileInput", meshRingPath);
  await expect(page.locator("#dimX")).not.toHaveValue("", { timeout: 10000 });

  // Open mold panel
  await page.locator("#moldToggleBtn").click();
  await expect(page.locator("#moldPanel")).toBeVisible();

  // Set up download promise before clicking
  const downloadPromise = page.waitForEvent("download", { timeout: 180000 });

  await page.locator("#generateMoldBtn").click();

  // Wait for either download or error status
  const result = await Promise.race([
    downloadPromise.then(d => ({ type: "download", download: d })),
    expect(page.locator("#statusMessage")).toContainText("failed", { timeout: 180000 })
      .then(() => ({ type: "error" }))
      .catch(() => null) // ignore if this branch doesn't match
  ]);

  if (result && result.type === "error") {
    const statusText = await page.locator("#statusText").innerText();
    throw new Error(`Mold generation failed with status: ${statusText}`);
  }

  // If we got here via download
  const download = result && result.type === "download" ? result.download : await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/-mold\.zip$/);

  const downloadPath = path.join(TESTOUTPUT_DIR, `${RUN_DATE}_mold-generation.zip`);
  await download.saveAs(downloadPath);
  const fileSize = fs.statSync(downloadPath).size;
  expect(fileSize).toBeGreaterThan(1000);

  await expect(page.locator("#statusMessage")).toContainText("Mold exported", { timeout: 10000 });
});
