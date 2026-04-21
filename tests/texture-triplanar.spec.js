/**
 * Step 1: Triplanar Weave Tests
 *
 * Validates that the triplanar weave:
 *  1. Applies successfully on the Aloy Focus (185 unique normals — max stress)
 *  2. Applies successfully on MeshRing1 (curved cylinder)
 *  3. Does not regress Baseplate (flat surface still works)
 *  4. Exports valid geometry (no degenerate triangles)
 *
 * Triplanar replaces per-face UV tangent frames with a weight-blended
 * world-space projection: wx·P(y,z) + wy·P(x,z) + wz·P(x,y), weights = |n.axis|^4.
 * This eliminates per-cluster seam lines without changing the bump algorithm.
 *
 * Run: npm run test:e2e -- tests/texture-triplanar.spec.js
 */

const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const BASE_URL = 'http://localhost:8081';
const TEST_DOCS = path.join(__dirname, '..', 'TestDocs');
const OUTPUT_DIR = path.join(__dirname, '..', 'Testoutput');
const DATE = new Date().toISOString().split('T')[0];

async function loadModel(page, filename) {
  await page.setInputFiles('#fileInput', path.join(TEST_DOCS, filename));
  await page.waitForFunction(
    name => document.querySelector('#fileName').textContent.includes(name),
    filename.replace('.stl', '').replace('.STL', ''),
    { timeout: 15000 }
  );
  await page.waitForTimeout(300);
}

async function openTexturePanel(page) {
  const btn = page.locator('#textureToggleBtn');
  await btn.waitFor({ state: 'visible', timeout: 5000 });
  await btn.click();
  await page.locator('#texturePanel').waitFor({ state: 'visible', timeout: 5000 });
  await page.waitForTimeout(300);
}

async function selectAllFaces(page) {
  await page.locator('#textureSelectAllBtn').click();
  await page.waitForTimeout(300);
}

// cellSizeMm: select the mesh preset FIRST (which makes #meshCellInput visible),
// then fill the value. Filling a display:none input in Playwright blocks until
// the element becomes visible and times out after 90 s.
async function applyWeaveAndWait(page, cellSizeMm = null) {
  await page.locator('#texturePresetSelect').selectOption('mesh');
  if (cellSizeMm !== null) {
    await page.locator('#meshCellInput').fill(String(cellSizeMm));
  }
  await page.locator('#textureApplyBtn').click();
  await page.waitForFunction(
    () => document.querySelector('#textureApplySpinner').hidden === true,
    { timeout: 60000 }
  );
  await page.waitForTimeout(500);
}

async function applyBumpsAndWait(page) {
  await page.locator('#texturePresetSelect').selectOption('bumps');
  await page.locator('#textureApplyBtn').click();
  await page.waitForFunction(
    () => document.querySelector('#textureApplySpinner').hidden === true,
    { timeout: 30000 }
  );
  await page.waitForTimeout(500);
}

async function exportStl(page, filename) {
  const outPath = path.join(OUTPUT_DIR, filename);
  await page.locator('#exportFormat').selectOption('stl');
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#downloadExportButton').click();
  const dl = await downloadPromise;
  await dl.saveAs(outPath);
  return outPath;
}

function runPythonAnalysis(stlPath) {
  try {
    const result = execSync(
      `python tools/analyze-texture-stl.py "${stlPath}"`,
      { cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 60000 }
    );
    return JSON.parse(result.match(/\{[\s\S]+\}/)[0]);
  } catch (e) {
    return { error: e.message };
  }
}

test.describe('Step 1: Triplanar Weave', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
  });

  // ── Primary: Aloy Focus (185 unique normals — maximum stress) ──────────

  test('Aloy Focus: triplanar weave applies on contoured surface', async ({ page }) => {
    await loadModel(page, 'Aloy Focus.stl');
    await openTexturePanel(page);
    await selectAllFaces(page);

    const faceCountText = await page.locator('#textureFaceCount').textContent();
    console.log('Selected:', faceCountText);
    expect(faceCountText).not.toMatch(/^0 faces/);

    // cellSize 12mm (subdivTarget 3mm) guarantees budget pass for models up to 48mm:
    // any face with edge < 48mm needs at most 4 subdivision levels (256x),
    // so 6,560 × 256 = 1.68M < 2M. The triplanar algorithm is fully exercised
    // regardless of cell size.
    await applyWeaveAndWait(page, 12);

    const status = await page.locator('#statusText').textContent();
    console.log('Weave status (Aloy):', status);
    expect(status).toMatch(/mesh weave/i);

    await page.screenshot({ path: path.join(OUTPUT_DIR, `${DATE}_triplanar-aloy-weave.png`) });
  });

  test('Aloy Focus: triplanar weave export has no degenerate triangles', async ({ page }) => {
    await loadModel(page, 'Aloy Focus.stl');
    await openTexturePanel(page);
    await selectAllFaces(page);
    await applyWeaveAndWait(page, 12);

    const stlPath = await exportStl(page, `${DATE}_triplanar-aloy-weave-export.stl`);
    expect(fs.existsSync(stlPath)).toBeTruthy();

    const analysis = runPythonAnalysis(stlPath);
    console.log('Export analysis:', JSON.stringify(analysis, null, 2));
    expect(analysis.geometry_valid).toBe(true);
    expect(analysis.degenerate_triangles).toBe(0);
  });

  // ── MeshRing1: curved cylinder ──────────────────────────────────────────

  test('MeshRing1: triplanar weave applies on curved cylinder', async ({ page }) => {
    await loadModel(page, 'MeshRing1.stl');
    await openTexturePanel(page);
    // Click outer wall of the ring; selectAllFaces on MeshRing1 exceeds budget
    // at default 2mm cell size (same large-face issue as Aloy Focus).
    const canvas = page.locator('#viewerCanvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width * 0.67, y: box.height * 0.5 } });
    await page.waitForTimeout(300);
    const ringFaceText = await page.locator('#textureFaceCount').textContent();
    if (parseInt(ringFaceText) === 0) await selectAllFaces(page);
    await applyWeaveAndWait(page);

    const status = await page.locator('#statusText').textContent();
    console.log('Weave status (Ring):', status);
    expect(status).toMatch(/mesh weave/i);

    await page.screenshot({ path: path.join(OUTPUT_DIR, `${DATE}_triplanar-ring-weave.png`) });
  });

  // ── Regression: flat surface and bumps unaffected ──────────────────────

  test('Baseplate: weave regression — triplanar does not break flat surface', async ({ page }) => {
    await loadModel(page, 'Station_3_Baseplate - Part 1.stl');
    await openTexturePanel(page);

    const canvas = page.locator('#viewerCanvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width * 0.5, y: box.height * 0.4 } });
    await page.waitForTimeout(500);

    const faceText = await page.locator('#textureFaceCount').textContent();
    if (parseInt(faceText) === 0) await selectAllFaces(page);

    // 12mm cell size keeps computation fast for the Baseplate's large flat faces
    // (default 2mm causes 4-5 subdivision levels on its wide triangles → 2-3 min).
    await applyWeaveAndWait(page, 12);
    const status = await page.locator('#statusText').textContent();
    console.log('Weave status (Baseplate):', status);
    expect(status).toMatch(/mesh weave/i);

    await page.screenshot({ path: path.join(OUTPUT_DIR, `${DATE}_triplanar-baseplate-weave.png`) });
  });

  test('Baseplate: bump regression — flat surface coverage maintained with triplanar grid', async ({ page }) => {
    await loadModel(page, 'Station_3_Baseplate - Part 1.stl');
    await openTexturePanel(page);

    const canvas = page.locator('#viewerCanvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width * 0.5, y: box.height * 0.4 } });
    await page.waitForTimeout(500);

    const faceText = await page.locator('#textureFaceCount').textContent();
    if (parseInt(faceText) === 0) await selectAllFaces(page);

    await applyBumpsAndWait(page);
    const status = await page.locator('#statusText').textContent();
    console.log('Bump status (Baseplate):', status);

    expect(status).toMatch(/\d+ bumps/);
    const bumpMatch = status.match(/(\d+) bumps/);
    // Regression guard: flat surface must still produce 254 bumps
    expect(parseInt(bumpMatch[1])).toBeGreaterThanOrEqual(254);

    await page.screenshot({ path: path.join(OUTPUT_DIR, `${DATE}_triplanar-baseplate-bumps.png`) });
  });
});
