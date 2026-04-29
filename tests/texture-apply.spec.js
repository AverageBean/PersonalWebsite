/**
 * Surface texture application tests.
 *
 * Verifies that:
 *  - texture panel toggle enables when a model is loaded
 *  - face selection via flood-fill and Select All work
 *  - Apply Bumps increases triangle count (geometry was modified)
 *  - Apply Weave increases triangle count (geometry was modified)
 *  - Reset restores original triangle count
 *  - Panel closes after successful apply
 */

const fs   = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");

const TESTDOCS_DIR   = path.resolve(__dirname, "..", "TestDocs");
const TESTOUTPUT_DIR = path.resolve(__dirname, "..", "Testoutput");
const DATE = new Date().toISOString().slice(0, 10);

const BASEPLATE_STL = path.join(TESTDOCS_DIR, "Station_3_Baseplate - Part 1.stl");
const RING_STL      = path.join(TESTDOCS_DIR, "MeshRing1.stl");

// ── Helpers ──────────────────────────────────────────────────────────────────

async function loadStl(page, stlPath) {
  await page.setInputFiles("#fileInput", stlPath);
  await expect(page.locator("#fileName")).not.toBeEmpty({ timeout: 15000 });
  // Wait until triangle count is non-zero
  await page.waitForFunction(() => {
    const el = document.getElementById("triangleCount");
    return el && parseInt(el.textContent.replace(/,/g, "")) > 0;
  }, { timeout: 15000 });
  // Extra settle time for geometry pipeline
  await page.waitForTimeout(500);
}

async function getTriangleCount(page) {
  return page.evaluate(() => {
    const el = document.getElementById("triangleCount");
    return el ? parseInt(el.textContent.replace(/,/g, "")) : 0;
  });
}

async function openTexturePanel(page) {
  const btn = page.locator("#textureToggleBtn");
  // Only click if panel not already open
  const panel = page.locator("#texturePanel");
  if (!(await panel.isVisible())) {
    await btn.click();
  }
  await expect(panel).toBeVisible({ timeout: 3000 });
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  page.on("console", msg => console.log(`[browser:${msg.type()}] ${msg.text()}`));
  page.on("pageerror", err => console.log(`[pageerror] ${err.message}`));
  await page.goto("/");
});

test("texture panel toggle is disabled before model load", async ({ page }) => {
  await expect(page.locator("#textureToggleBtn")).toBeDisabled();
});

test("texture panel toggle enables after STL load", async ({ page }) => {
  await loadStl(page, BASEPLATE_STL);
  await expect(page.locator("#textureToggleBtn")).toBeEnabled();
});

test("texture panel opens and shows face selection UI", async ({ page }) => {
  await loadStl(page, BASEPLATE_STL);
  await openTexturePanel(page);
  await expect(page.locator("#textureFaceCount")).toBeVisible();
  await expect(page.locator("#textureClearSelBtn")).toBeVisible();
  await expect(page.locator("#textureSelectAllBtn")).toBeVisible();
  await expect(page.locator("#textureApplyBtn")).toBeVisible();
  await expect(page.locator("#textureResetBtn")).toBeVisible();
});

test("Select All populates face count", async ({ page }) => {
  await loadStl(page, BASEPLATE_STL);
  await openTexturePanel(page);
  await page.locator("#textureSelectAllBtn").click();
  await page.waitForFunction(() => {
    const el = document.getElementById("textureFaceCount");
    return el && parseInt(el.textContent) > 0;
  }, { timeout: 5000 });
  const text = await page.locator("#textureFaceCount").textContent();
  expect(parseInt(text)).toBeGreaterThan(0);
});

test("Clear resets face count to zero", async ({ page }) => {
  await loadStl(page, BASEPLATE_STL);
  await openTexturePanel(page);
  await page.locator("#textureSelectAllBtn").click();
  await page.waitForFunction(() => parseInt(document.getElementById("textureFaceCount").textContent) > 0, { timeout: 5000 });
  await page.locator("#textureClearSelBtn").click();
  await expect(page.locator("#textureFaceCount")).toContainText("0 faces");
});

test("Apply Bumps increases triangle count and keeps panel open", async ({ page }) => {
  await loadStl(page, BASEPLATE_STL);
  const before = await getTriangleCount(page);
  expect(before).toBeGreaterThan(0);

  await openTexturePanel(page);
  // Coarse spacing so test runs fast (few bumps)
  await page.locator("#bumpSpacingInput").fill("20");
  await page.locator("#bumpRadiusInput").fill("2");

  await page.locator("#textureSelectAllBtn").click();
  await page.waitForFunction(() => parseInt(document.getElementById("textureFaceCount").textContent) > 0, { timeout: 5000 });

  await page.locator("#textureApplyBtn").click();

  // Wait for apply to finish (multi-region keeps the panel open after Apply)
  await page.waitForFunction(
    () => document.querySelector("#textureApplySpinner").hidden === true,
    { timeout: 15000 }
  );
  await expect(page.locator("#texturePanel")).toBeVisible();

  // Triangle count must have grown
  await page.waitForFunction((b) => {
    const el = document.getElementById("triangleCount");
    return el && parseInt(el.textContent.replace(/,/g, "")) > b;
  }, before, { timeout: 20000 });

  const after = await getTriangleCount(page);
  expect(after).toBeGreaterThan(before);

  // Reset button is now enabled
  await expect(page.locator("#textureResetBtn")).toBeEnabled();

  await page.screenshot({ path: path.join(TESTOUTPUT_DIR, `${DATE}_texture-bumps-applied.png`) });
});

test("Reset restores original triangle count after bumps", async ({ page }) => {
  await loadStl(page, BASEPLATE_STL);
  const original = await getTriangleCount(page);

  await openTexturePanel(page);
  await page.locator("#bumpSpacingInput").fill("20");
  await page.locator("#bumpRadiusInput").fill("2");
  await page.locator("#textureSelectAllBtn").click();
  await page.waitForFunction(() => parseInt(document.getElementById("textureFaceCount").textContent) > 0, { timeout: 5000 });
  await page.locator("#textureApplyBtn").click();
  await page.waitForFunction(
    () => document.querySelector("#textureApplySpinner").hidden === true,
    { timeout: 15000 }
  );

  // Panel stays open under multi-region; reset is reachable directly
  await page.locator("#textureResetBtn").click();

  await page.waitForFunction((orig) => {
    const el = document.getElementById("triangleCount");
    return el && parseInt(el.textContent.replace(/,/g, "")) === orig;
  }, original, { timeout: 15000 });

  expect(await getTriangleCount(page)).toBe(original);
});

test("Apply Mesh Weave increases triangle count", async ({ page }) => {
  test.setTimeout(90000);
  await loadStl(page, BASEPLATE_STL);
  const before = await getTriangleCount(page);

  await openTexturePanel(page);
  await page.locator("#texturePresetSelect").selectOption("mesh");
  await page.locator("#meshCellInput").fill("10");
  await page.locator("#meshHeightInput").fill("0.5");

  await page.locator("#textureSelectAllBtn").click();
  await page.waitForFunction(() => parseInt(document.getElementById("textureFaceCount").textContent) > 0, { timeout: 5000 });

  await page.locator("#textureApplyBtn").click();
  await page.waitForFunction(
    () => document.querySelector("#textureApplySpinner").hidden === true,
    { timeout: 30000 }
  );

  await page.waitForFunction((b) => {
    const el = document.getElementById("triangleCount");
    return el && parseInt(el.textContent.replace(/,/g, "")) > b;
  }, before, { timeout: 30000 });

  expect(await getTriangleCount(page)).toBeGreaterThan(before);

  await page.screenshot({ path: path.join(TESTOUTPUT_DIR, `${DATE}_texture-weave-applied.png`) });
});

test("face click selects a region (flood-fill) on ring model", async ({ page }) => {
  await loadStl(page, RING_STL);
  await openTexturePanel(page);

  // The ring center projects to NDC (0,0); outer edge is at NDC radius ~0.35
  // (ring ~50mm wide, camera ~94mm away, fov=75°). Fraction (0.67, 0.45)
  // maps to NDC ≈ (0.34, 0.10) which reliably lands on the ring body.
  const box = await page.locator("#viewerCanvas").boundingBox();
  await page.mouse.click(box.x + box.width * 0.67, box.y + box.height * 0.45);

  await page.waitForFunction(() => {
    const el = document.getElementById("textureFaceCount");
    return el && parseInt(el.textContent) > 0;
  }, { timeout: 5000 });

  const count = parseInt(await page.locator("#textureFaceCount").textContent());
  expect(count).toBeGreaterThan(0);
  expect(count).toBeLessThan(100000);
});
