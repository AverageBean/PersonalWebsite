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
  // Bbox SVG must be hidden (no model)
  await expect(page.locator("#bboxPreviewSvg")).toBeHidden();
});

test("overlay buttons: with model — both buttons visible and aligned (visual)", async ({ page }) => {
  const stlPath = path.join(TESTDOCS_DIR, "CurvedMinimalPost-Onshape.stl");
  await page.setInputFiles("#fileInput", stlPath);
  await expect(page.locator("#fileName")).toContainText("CurvedMinimalPost", { timeout: 15000 });
  await page.waitForTimeout(600);

  await page.locator(".viewer-canvas-wrapper").screenshot({
    path: path.join(TESTOUTPUT_DIR, `${RUN_DATE}_overlay-with-model.png`)
  });

  // Both must be visible
  await expect(page.locator("#gridToggleBtn")).toBeVisible();
  await expect(page.locator("#bboxPreviewSvg")).toBeVisible();

  // Measure their bounding boxes — top edges should be within 4px of each other
  const gridBox = await page.locator("#gridToggleBtn").boundingBox();
  const svgBox  = await page.locator("#bboxPreviewSvg").boundingBox();

  console.log("gridToggleBtn box:", JSON.stringify(gridBox));
  console.log("bboxPreviewSvg box:", JSON.stringify(svgBox));

  // Tops should be within 2px (flex-start alignment)
  expect(Math.abs(gridBox.y - svgBox.y)).toBeLessThan(2);

  // Both should be in the right half of the viewport
  const vpWidth = page.viewportSize().width;
  expect(gridBox.x + gridBox.width).toBeGreaterThan(vpWidth * 0.5);
  expect(svgBox.x + svgBox.width).toBeGreaterThan(vpWidth * 0.5);
});
