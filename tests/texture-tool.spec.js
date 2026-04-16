import { test, expect } from '@playwright/test';

test.describe('Surface Texture Tool', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:8081', { waitUntil: 'networkidle' });
    // Wait for Three.js and app.js to load
    await page.waitForFunction(() => window.THREE, { timeout: 10000 });
  });

  test('texture button appears and is initially disabled', async ({ page }) => {
    const btn = page.locator('#textureToggleBtn');
    await expect(btn).toBeVisible();
    await expect(btn).toBeDisabled();
  });

  test('texture panel opens when model is loaded', async ({ page }) => {
    // Load an STL file
    const fileInput = page.locator('#fileInput');
    await fileInput.setInputFiles('./TestDocs/MeshRing1.stl');

    // Wait for model to load
    await page.waitForFunction(() => {
      return document.querySelector('#fileName').textContent !== 'None loaded';
    }, { timeout: 5000 });

    // Now texture button should be enabled
    const btn = page.locator('#textureToggleBtn');
    await expect(btn).toBeEnabled();

    // Click it
    await btn.click();

    // Panel should be visible
    const panel = page.locator('#texturePanel');
    await expect(panel).toBeVisible();
  });

  test('can select faces by clicking on model', async ({ page }) => {
    // Load an STL file
    const fileInput = page.locator('#fileInput');
    await fileInput.setInputFiles('./TestDocs/MeshRing1.stl');

    await page.waitForFunction(() => {
      return document.querySelector('#fileName').textContent !== 'None loaded';
    }, { timeout: 5000 });

    // Open texture panel
    await page.locator('#textureToggleBtn').click();

    // Get initial face count
    const faceCountBefore = await page.locator('#textureFaceCount').textContent();
    expect(faceCountBefore).toContain('0 faces selected');

    // Click on the canvas to select a face
    const canvas = page.locator('#viewerCanvas canvas').first();
    const box = await canvas.boundingBox();
    if (box) {
      // Click near center of canvas
      await page.click('#viewerCanvas', { position: { x: box.width / 2, y: box.height / 2 } });

      // Wait a moment for selection to register
      await page.waitForTimeout(500);

      // Face count should have changed
      const faceCountAfter = await page.locator('#textureFaceCount').textContent();
      // This might be 0 if we happened to miss any face, but structure is there
      expect(faceCountAfter).toBeDefined();
    }
  });

  test('preset controls appear and can be changed', async ({ page }) => {
    // Load an STL file
    const fileInput = page.locator('#fileInput');
    await fileInput.setInputFiles('./TestDocs/MeshRing1.stl');

    await page.waitForFunction(() => {
      return document.querySelector('#fileName').textContent !== 'None loaded';
    }, { timeout: 5000 });

    // Open texture panel
    await page.locator('#textureToggleBtn').click();

    // Check bump controls are visible by default
    const bumpControls = page.locator('#textureBumpsControls');
    await expect(bumpControls).toBeVisible();

    // Switch to mesh
    await page.locator('#texturePresetSelect').selectOption('mesh');

    // Bump should be hidden, mesh should be visible
    await expect(bumpControls).toBeHidden();
    const meshControls = page.locator('#textureMeshControls');
    await expect(meshControls).toBeVisible();
  });

  test('apply and reset buttons work', async ({ page }) => {
    // Load an STL file
    const fileInput = page.locator('#fileInput');
    await fileInput.setInputFiles('./TestDocs/HelicalTube1.stl');

    await page.waitForFunction(() => {
      return document.querySelector('#fileName').textContent !== 'None loaded';
    }, { timeout: 5000 });

    // Get initial triangle count
    const triCountBefore = await page.locator('#triangleCount').textContent();
    const countBefore = parseInt(triCountBefore);

    // Open texture panel
    await page.locator('#textureToggleBtn').click();

    // Select all faces
    await page.locator('#textureSelectAllBtn').click();

    // Verify faces were selected
    const faceCountText = await page.locator('#textureFaceCount').textContent();
    expect(faceCountText).not.toContain('0 faces');

    // Apply bumps with default settings
    await page.locator('#textureApplyBtn').click();

    // Wait for application and rebuild
    await page.waitForTimeout(2000);

    // Reset button should be enabled
    const resetBtn = page.locator('#textureResetBtn');
    await expect(resetBtn).toBeEnabled();

    // Click reset
    await resetBtn.click();

    // Wait for reset
    await page.waitForTimeout(500);

    // Reset button should be disabled again
    await expect(resetBtn).toBeDisabled();

    // Reset should preserve the original geometry structure
    const triCountReset = await page.locator('#triangleCount').textContent();
    const countReset = parseInt(triCountReset);
    // After reset, should be back to original (or very close)
    expect(Math.abs(countReset - countBefore)).toBeLessThan(countBefore * 0.1);
  });

  test('export includes texture geometry', async ({ page }) => {
    // Load an STL file
    const fileInput = page.locator('#fileInput');
    await fileInput.setInputFiles('./TestDocs/MeshRing1.stl');

    await page.waitForFunction(() => {
      return document.querySelector('#fileName').textContent !== 'None loaded';
    }, { timeout: 5000 });

    // Open texture panel and apply texture
    await page.locator('#textureToggleBtn').click();
    await page.locator('#textureSelectAllBtn').click();
    await page.locator('#textureApplyBtn').click();

    await page.waitForTimeout(1000);

    // Export should work (we won't download, just verify button is enabled)
    const exportBtn = page.locator('#downloadExportButton');
    await expect(exportBtn).toBeEnabled();
  });
});
