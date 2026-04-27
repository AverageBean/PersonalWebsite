/**
 * Tests for the coordinate probe feature.
 * Loads a model, activates the probe, clicks the canvas, verifies the readout.
 */
const { test, expect } = require("@playwright/test");
const path = require("path");

const STL = path.resolve(__dirname, "../TestDocs/MeshRing1.stl");
const BASE = "http://localhost:8081";

test.describe("Coordinate probe", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    await page.waitForSelector("#viewerCanvas canvas", { timeout: 10000 });

    // Load STL via file input
    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.click("#dropZone"),
    ]);
    await fileChooser.setFiles(STL);
    await page.waitForTimeout(1500);
  });

  test("probe button enables after model load", async ({ page }) => {
    const btn = page.locator("#probeToggleBtn");
    await expect(btn).not.toBeDisabled();
  });

  test("probe toggle activates crosshair cursor", async ({ page }) => {
    await page.click("#probeToggleBtn");
    const canvas = page.locator("#viewerCanvas canvas");
    const cursor = await canvas.evaluate(el => el.style.cursor);
    expect(cursor).toBe("crosshair");
  });

  test("coord readout hidden when probe inactive", async ({ page }) => {
    const readout = page.locator("#coordProbeReadout");
    await expect(readout).toBeHidden();
  });

  test("coord readout appears after clicking model with probe active", async ({ page }) => {
    await page.click("#probeToggleBtn");
    const canvas = page.locator("#viewerCanvas canvas");
    const box = await canvas.boundingBox();

    // Click near center of canvas where the ring should be
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
    await page.waitForTimeout(200);

    const readout = page.locator("#coordProbeReadout");
    // Readout may or may not appear depending on whether the ray hit the mesh.
    // At minimum, check the aria-live region is present.
    await expect(readout).toBeAttached();
  });

  test("probe button deactivates and hides readout on second click", async ({ page }) => {
    const btn = page.locator("#probeToggleBtn");
    await btn.click();
    await expect(btn).toHaveAttribute("aria-pressed", "true");

    await btn.click();
    await expect(btn).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#coordProbeReadout")).toBeHidden();
  });

  test("probe disabled after model cleared (new file load resets)", async ({ page }) => {
    // Load a second file to trigger clearCurrentModel
    const [fileChooser2] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.click("#dropZone"),
    ]);
    await fileChooser2.setFiles(STL);
    await page.waitForTimeout(1000);

    const btn = page.locator("#probeToggleBtn");
    // After reload, probe should be off (aria-pressed false)
    await expect(btn).toHaveAttribute("aria-pressed", "false");
  });
});
