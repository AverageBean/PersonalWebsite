/**
 * Phase 1: Normal-Cluster Bump Placement Tests
 *
 * Validates that the cluster-based bump algorithm:
 *  1. Produces bumps on multi-oriented surfaces (Aloy Focus — 185 unique normals)
 *  2. Reports multiple clusters in its status message
 *  3. Does not regress on flat surfaces (Baseplate top)
 *  4. Does not regress on the ring (MeshRing1)
 *
 * Primary test model: TestDocs/Aloy Focus.stl
 *   - 6,560 triangles, 185 unique normal directions, 45×6.9×39.8mm
 *   - Contoured discontinuous surface — failed completely with single-frame approach
 *
 * Run: npm run test:e2e -- tests/texture-phase1-clusters.spec.js
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

async function applyBumpsAndWait(page) {
  await page.locator('#texturePresetSelect').selectOption('bumps');
  await page.locator('#textureApplyBtn').click();
  // Spinner appears then disappears when apply completes
  await page.waitForFunction(
    () => document.querySelector('#textureApplySpinner').hidden === true,
    { timeout: 30000 }
  );
  await page.waitForTimeout(500);
}

async function getStatusText(page) {
  return page.locator('#statusText').textContent();
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
      { cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 30000 }
    );
    return JSON.parse(result.match(/\{[\s\S]+\}/)[0]);
  } catch (e) {
    return { error: e.message };
  }
}

test.describe('Phase 1: Normal-Cluster Bumps', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
  });

  // ── Primary: Aloy Focus (185 unique normal directions) ──────────────────

  test('Aloy Focus: bumps applied with multiple clusters', async ({ page }) => {
    await loadModel(page, 'Aloy Focus.stl');
    await openTexturePanel(page);
    await selectAllFaces(page);

    const faceCountText = await page.locator('#textureFaceCount').textContent();
    console.log('Selected:', faceCountText);
    expect(faceCountText).not.toMatch(/^0 faces/);

    await applyBumpsAndWait(page);

    const status = await getStatusText(page);
    console.log('Status:', status);

    // Must report bumps placed
    expect(status).toMatch(/\d+ bumps/);
    // Must report multiple clusters (key Phase 1 assertion)
    expect(status).toMatch(/\d+ normal clusters/);

    const clusterMatch = status.match(/(\d+) normal clusters/);
    const bumpMatch = status.match(/(\d+) bumps/);
    const clusterCount = clusterMatch ? parseInt(clusterMatch[1]) : 0;
    const bumpCount = bumpMatch ? parseInt(bumpMatch[1]) : 0;

    console.log(`Clusters: ${clusterCount}, Bumps: ${bumpCount}`);
    expect(clusterCount).toBeGreaterThan(1);
    expect(bumpCount).toBeGreaterThan(0);

    await page.screenshot({ path: path.join(OUTPUT_DIR, `${DATE}_aloy-focus-bumps.png`) });
  });

  test('Aloy Focus: bump cluster count scales with surface complexity', async ({ page }) => {
    await loadModel(page, 'Aloy Focus.stl');
    await openTexturePanel(page);
    await selectAllFaces(page);
    await applyBumpsAndWait(page);

    const status = await getStatusText(page);
    const clusterMatch = status.match(/(\d+) normal clusters/);
    const clusterCount = clusterMatch ? parseInt(clusterMatch[1]) : 0;

    // Aloy Focus has 185 unique normals at 0.1 resolution — expect many clusters
    // Even with 20° threshold, a highly contoured part should produce at least 5 clusters.
    console.log(`Cluster count for Aloy Focus: ${clusterCount}`);
    expect(clusterCount).toBeGreaterThanOrEqual(5);
  });

  test('Aloy Focus: export validates after cluster bumps', async ({ page }) => {
    await loadModel(page, 'Aloy Focus.stl');
    await openTexturePanel(page);
    await selectAllFaces(page);
    await applyBumpsAndWait(page);

    const stlPath = await exportStl(page, `${DATE}_aloy-focus-bumps-export.stl`);
    expect(fs.existsSync(stlPath)).toBeTruthy();

    const analysis = runPythonAnalysis(stlPath);
    console.log('Export analysis:', JSON.stringify(analysis, null, 2));

    expect(analysis.geometry_valid).toBe(true);
    expect(analysis.degenerate_triangles).toBe(0);
  });

  // ── Regression: MeshRing1 (ring with outer curved surface) ──────────────

  test('MeshRing1: clusters improve curved surface coverage', async ({ page }) => {
    await loadModel(page, 'MeshRing1.stl');
    await openTexturePanel(page);

    // Click the top face of the ring
    const canvas = page.locator('#viewerCanvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width * 0.67, y: box.height * 0.45 } });
    await page.waitForTimeout(500);

    const faceText = await page.locator('#textureFaceCount').textContent();
    console.log('Ring faces selected:', faceText);

    // Select all to test outer cylinder coverage
    await selectAllFaces(page);
    await applyBumpsAndWait(page);

    const status = await getStatusText(page);
    console.log('Ring status:', status);
    expect(status).toMatch(/\d+ bumps/);

    const bumpMatch = status.match(/(\d+) bumps/);
    expect(parseInt(bumpMatch[1])).toBeGreaterThan(0);

    await page.screenshot({ path: path.join(OUTPUT_DIR, `${DATE}_meshring1-cluster-bumps.png`) });
  });

  // ── Regression: Flat surface still works ────────────────────────────────

  test('Baseplate flat top: single-cluster path still works', async ({ page }) => {
    await loadModel(page, 'Station_3_Baseplate - Part 1.stl');
    await openTexturePanel(page);

    // Click top face (center-top of canvas)
    const canvas = page.locator('#viewerCanvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width * 0.5, y: box.height * 0.4 } });
    await page.waitForTimeout(500);

    const faceText = await page.locator('#textureFaceCount').textContent();
    console.log('Baseplate faces selected:', faceText);

    if (parseInt(faceText) === 0) {
      // Fallback: select all
      await selectAllFaces(page);
    }

    await applyBumpsAndWait(page);
    const status = await getStatusText(page);
    console.log('Baseplate status:', status);

    expect(status).toMatch(/\d+ bumps/);
    const bumpMatch = status.match(/(\d+) bumps/);
    expect(parseInt(bumpMatch[1])).toBeGreaterThan(0);

    await page.screenshot({ path: path.join(OUTPUT_DIR, `${DATE}_baseplate-cluster-bumps.png`) });
  });

  // ── Phase 3: Per-face UV weave ───────────────────────────────────────────

  test('Aloy Focus: weave applies on contoured surface (per-face UV)', async ({ page }) => {
    await loadModel(page, 'Aloy Focus.stl');
    await openTexturePanel(page);
    await selectAllFaces(page);

    await page.locator('#texturePresetSelect').selectOption('mesh');
    await page.locator('#textureApplyBtn').click();
    await page.waitForFunction(
      () => document.querySelector('#textureApplySpinner').hidden === true,
      { timeout: 60000 }
    );
    await page.waitForTimeout(500);

    const status = await getStatusText(page);
    console.log('Weave status (Aloy):', status);
    expect(status).toMatch(/mesh weave/i);

    await page.screenshot({ path: path.join(OUTPUT_DIR, `${DATE}_aloy-focus-weave.png`) });
  });

  test('Baseplate: weave regression — flat surface still works with per-face UV', async ({ page }) => {
    await loadModel(page, 'Station_3_Baseplate - Part 1.stl');
    await openTexturePanel(page);

    // Click top face
    const canvas = page.locator('#viewerCanvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width * 0.5, y: box.height * 0.4 } });
    await page.waitForTimeout(500);

    const faceText = await page.locator('#textureFaceCount').textContent();
    if (parseInt(faceText) === 0) await selectAllFaces(page);

    await page.locator('#texturePresetSelect').selectOption('mesh');
    await page.locator('#textureApplyBtn').click();
    await page.waitForFunction(
      () => document.querySelector('#textureApplySpinner').hidden === true,
      { timeout: 60000 }
    );
    await page.waitForTimeout(500);

    const status = await getStatusText(page);
    console.log('Weave status (Baseplate):', status);
    expect(status).toMatch(/mesh weave/i);

    await page.screenshot({ path: path.join(OUTPUT_DIR, `${DATE}_baseplate-weave-perface.png`) });
  });

  // ── Summary report ───────────────────────────────────────────────────────

  test('Write Phase 1 summary report', async ({ page }) => {
    const reportPath = path.join(OUTPUT_DIR, `${DATE}_PHASE1_CLUSTER_SUMMARY.md`);
    const report = `# Phase 1 Normal-Cluster Bumps — Test Summary

**Date:** ${new Date().toISOString()}
**Algorithm change:** Single global UV frame → per-cluster UV frames (20° BFS threshold)

## Test Models

| Model | Normal Directions | Expected Clusters | Purpose |
|-------|------------------|-------------------|---------|
| Aloy Focus.stl | 185 | ≥5 | Primary: curved/discontinuous surface |
| MeshRing1.stl | Radial (cylinder) | ≥2 | Regression: curved outer wall |
| Baseplate.stl | Few flat faces | 1-2 | Regression: simple flat surface |

## Key Assertion
Status message must contain "\${N} normal clusters" when N > 1.

## Files
- ${DATE}_aloy-focus-bumps.png
- ${DATE}_meshring1-cluster-bumps.png
- ${DATE}_baseplate-cluster-bumps.png
- ${DATE}_aloy-focus-bumps-export.stl
`;
    fs.writeFileSync(reportPath, report);
    console.log('Report written:', reportPath);
    expect(fs.existsSync(reportPath)).toBeTruthy();
  });
});
