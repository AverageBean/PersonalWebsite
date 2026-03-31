const path = require("path");
const { test, expect } = require("@playwright/test");

const TESTDOCS_DIR = path.resolve(__dirname, "..", "TestDocs");
const TESTOUTPUT_DIR = path.resolve(__dirname, "..", "Testoutput");
const RUN_DATE = "2026-03-13";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForTimeout(400);
});

test("overlay buttons: no model — grid button visible in corner (visual)", async ({ page }) => {
  await page.locator(".viewer-canvas-wrapper").screenshot({
    path: path.join(TESTOUTPUT_DIR, `${RUN_DATE}_overlay-no-model.png`)
  });
  // Grid button must be present and visible
  await expect(page.locator("#gridToggleBtn")).toBeVisible();
  // Bbox toggle must be visible but disabled (no model loaded)
  await expect(page.locator("#bboxToggleBtn")).toBeVisible();
  await expect(page.locator("#bboxToggleBtn")).toBeDisabled();
});

test("overlay buttons: with model — both buttons visible and aligned (visual)", async ({ page }) => {
  const stlPath = path.join(TESTDOCS_DIR, "CurvedMinimalPost-Onshape.stl");
  await page.setInputFiles("#fileInput", stlPath);
  await expect(page.locator("#fileName")).toContainText("CurvedMinimalPost", { timeout: 15000 });
  await expect(page.locator("#dimX")).not.toHaveValue("", { timeout: 10000 });
  await page.waitForTimeout(300);

  await page.locator(".viewer-canvas-wrapper").screenshot({
    path: path.join(TESTOUTPUT_DIR, `${RUN_DATE}_overlay-with-model.png`)
  });

  // Both must be visible and enabled after load
  await expect(page.locator("#gridToggleBtn")).toBeVisible();
  await expect(page.locator("#bboxToggleBtn")).toBeVisible();
  await expect(page.locator("#bboxToggleBtn")).toBeEnabled({ timeout: 10000 });

  // Measure their bounding boxes
  const gridBox = await page.locator("#gridToggleBtn").boundingBox();
  const bboxBox = await page.locator("#bboxToggleBtn").boundingBox();

  console.log("gridToggleBtn box:", JSON.stringify(gridBox));
  console.log("bboxToggleBtn box:", JSON.stringify(bboxBox));

  // Tops should be within 2px (flex-start alignment)
  expect(Math.abs(gridBox.y - bboxBox.y)).toBeLessThan(2);

  // Both should be in the right half of the viewport
  const vpWidth = page.viewportSize().width;
  expect(gridBox.x + gridBox.width).toBeGreaterThan(vpWidth * 0.5);
  expect(bboxBox.x + bboxBox.width).toBeGreaterThan(vpWidth * 0.5);
});
