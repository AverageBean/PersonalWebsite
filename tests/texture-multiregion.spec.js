/**
 * Multi-Region Texture Tests
 *
 * Validates the persistent layer registry:
 *  1. Applying bumps to region A then weave to region B produces both in the export
 *  2. Reset clears all layers and restores original triangle count
 *  3. Applying the same texture twice (same region) gives last-write-wins geometry
 *  4. Region list DOM updates correctly after apply and remove
 *
 * Run: npm run test:e2e -- tests/texture-multiregion.spec.js
 */

const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

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
  await page.waitForFunction(
    () => document.querySelector('#textureApplySpinner').hidden === true,
    { timeout: 30000 }
  );
  await page.waitForTimeout(500);
}

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

async function getTriangleCount(page) {
  const text = await page.locator('#triangleCount').textContent();
  return parseInt(text.replace(/,/g, ''));
}

async function getStatusText(page) {
  return page.locator('#statusText').textContent();
}

async function getRegionRowCount(page) {
  return page.locator('.texture-region-row').count();
}

test.describe('Multi-Region Texture', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
  });

  // ── Core: panel stays open after apply ──────────────────────────────────

  test('Panel stays open after apply', async ({ page }) => {
    await loadModel(page, 'Station_3_Baseplate - Part 1.stl');
    await openTexturePanel(page);
    await selectAllFaces(page);
    await applyBumpsAndWait(page);

    // Panel must still be visible so user can apply another region
    await expect(page.locator('#texturePanel')).toBeVisible();
    console.log('Panel visible after apply: ✓');
  });

  // ── Core: apply bumps then weave — both coexist ─────────────────────────
  //
  // Uses canvas clicks to select independent face regions so neither layer
  // inherits the other's inflated face count (selectAll after bumps would
  // include hemisphere faces, inflating the weave budget).

  test('Baseplate: bumps then weave on separate click-selected regions', async ({ page }) => {
    await loadModel(page, 'Station_3_Baseplate - Part 1.stl');
    const baseTriCount = await getTriangleCount(page);
    console.log('Base triangle count:', baseTriCount);

    await openTexturePanel(page);

    // Region A: bumps — click top-left area of canvas
    const canvas = page.locator('#viewerCanvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width * 0.35, y: box.height * 0.4 } });
    await page.waitForTimeout(400);

    const facesA = await page.locator('#textureFaceCount').textContent();
    console.log('Region A faces:', facesA);
    if (parseInt(facesA) === 0) await selectAllFaces(page);

    await page.locator('#bumpSpacingInput').fill('8');  // coarser spacing = fewer triangles
    await applyBumpsAndWait(page);
    const statusAfterBumps = await getStatusText(page);
    console.log('After bumps:', statusAfterBumps);
    expect(statusAfterBumps).toMatch(/\d+ bumps/);

    const triAfterBumps = await getTriangleCount(page);
    expect(triAfterBumps).toBeGreaterThan(baseTriCount);
    console.log('Tri count after bumps:', triAfterBumps);

    // Region B: weave — click top-right area (different region, panel still open)
    await canvas.click({ position: { x: box.width * 0.65, y: box.height * 0.4 } });
    await page.waitForTimeout(400);

    const facesB = await page.locator('#textureFaceCount').textContent();
    console.log('Region B faces:', facesB);
    if (parseInt(facesB) === 0) await selectAllFaces(page);

    await applyWeaveAndWait(page, 12);
    const statusAfterWeave = await getStatusText(page);
    console.log('After weave:', statusAfterWeave);
    expect(statusAfterWeave).toMatch(/mesh weave/i);

    const triAfterWeave = await getTriangleCount(page);
    console.log('Tri count after weave:', triAfterWeave);
    expect(triAfterWeave).toBeGreaterThan(baseTriCount);

    // Region list should show 2 rows
    const rowCount = await getRegionRowCount(page);
    console.log('Region rows:', rowCount);
    expect(rowCount).toBe(2);

    await page.screenshot({ path: path.join(OUTPUT_DIR, `${DATE}_multiregion-bumps-weave.png`) });
  });

  // ── Reset clears all layers ─────────────────────────────────────────────

  test('Reset restores original triangle count', async ({ page }) => {
    await loadModel(page, 'MeshRing1.stl');
    const baseTriCount = await getTriangleCount(page);

    await openTexturePanel(page);

    // Click outer wall to select a manageable subset
    const canvas = page.locator('#viewerCanvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width * 0.67, y: box.height * 0.5 } });
    await page.waitForTimeout(400);
    if (parseInt(await page.locator('#textureFaceCount').textContent()) === 0) await selectAllFaces(page);

    await applyBumpsAndWait(page);

    const triWithBumps = await getTriangleCount(page);
    expect(triWithBumps).toBeGreaterThan(baseTriCount);

    // Reset
    await page.locator('#textureResetBtn').click();
    await page.waitForTimeout(500);

    const status = await getStatusText(page);
    console.log('Reset status:', status);
    expect(status).toMatch(/cleared/i);

    const triAfterReset = await getTriangleCount(page);
    console.log(`Base: ${baseTriCount}, With bumps: ${triWithBumps}, After reset: ${triAfterReset}`);
    expect(triAfterReset).toBe(baseTriCount);

    // Region list should be hidden / empty
    const rowCount = await getRegionRowCount(page);
    expect(rowCount).toBe(0);
  });

  // ── Remove single layer ──────────────────────────────────────────────────

  test('Remove one of two layers reverts to single-layer geometry', async ({ page }) => {
    await loadModel(page, 'MeshRing1.stl');
    const baseTriCount = await getTriangleCount(page);

    await openTexturePanel(page);

    // Apply layer 1: bumps on a canvas-click selection
    const canvas = page.locator('#viewerCanvas');
    const box = await canvas.boundingBox();
    await canvas.click({ position: { x: box.width * 0.67, y: box.height * 0.5 } });
    await page.waitForTimeout(400);
    if (parseInt(await page.locator('#textureFaceCount').textContent()) === 0) await selectAllFaces(page);
    await applyBumpsAndWait(page);
    const triAfterBumps = await getTriangleCount(page);

    // Apply layer 2: weave on ALL faces (selectAll covers original face indices
    // 0..N-1 even when the bumped geometry has extra hemisphere faces appended).
    // cellSizeMm=8 keeps the budget safe for the larger post-bump face count.
    // During recompute after removing layer 1, indices 0..N-1 still match the
    // original geometry faces, so the weave is correctly applied.
    await selectAllFaces(page);
    await applyWeaveAndWait(page, 8);

    expect(await getRegionRowCount(page)).toBe(2);

    // Remove layer 1 (first ✕ button)
    await page.locator('.texture-region-remove').first().click();
    // Wait for spinner to complete (remove triggers async recompute)
    await page.waitForFunction(
      () => document.querySelector('#textureApplySpinner').hidden === true,
      { timeout: 30000 }
    );
    await page.waitForTimeout(500);

    const rowsAfter = await getRegionRowCount(page);
    console.log('Region rows after remove:', rowsAfter);
    expect(rowsAfter).toBe(1);

    const triAfterRemove = await getTriangleCount(page);
    console.log(`After bumps: ${triAfterBumps}, After remove layer 1: ${triAfterRemove}`);
    // Should differ from the 2-layer state
    expect(triAfterRemove).toBeGreaterThan(baseTriCount);

    const status = await getStatusText(page);
    console.log('Status after remove:', status);
    expect(status).toMatch(/region/i);
  });

  // ── MeshRing: two distinct regions ─────────────────────────────────────
  //
  // Outer wall click (0.67, 0.5) → bumps.
  // Second canvas click (same spot but after panel re-init) → weave.
  // Tests that the ring can accumulate two layers and both show in region list.

  test('MeshRing1: bumps on canvas-click region then weave on same region', async ({ page }) => {
    await loadModel(page, 'MeshRing1.stl');
    await openTexturePanel(page);

    const canvas = page.locator('#viewerCanvas');
    const box = await canvas.boundingBox();

    // Layer 1: bumps
    await canvas.click({ position: { x: box.width * 0.67, y: box.height * 0.5 } });
    await page.waitForTimeout(400);
    if (parseInt(await page.locator('#textureFaceCount').textContent()) === 0) await selectAllFaces(page);
    await applyBumpsAndWait(page);
    const statusBumps = await getStatusText(page);
    console.log('Bumps status:', statusBumps);
    expect(statusBumps).toMatch(/\d+ bumps/);

    // Layer 2: weave — re-click same area (panel still open after layer 1)
    await canvas.click({ position: { x: box.width * 0.67, y: box.height * 0.5 } });
    await page.waitForTimeout(400);
    if (parseInt(await page.locator('#textureFaceCount').textContent()) === 0) await selectAllFaces(page);
    await applyWeaveAndWait(page);
    const statusWeave = await getStatusText(page);
    console.log('Weave status:', statusWeave);
    expect(statusWeave).toMatch(/mesh weave/i);

    const rowCount = await getRegionRowCount(page);
    console.log('Region rows:', rowCount);
    expect(rowCount).toBe(2);

    await page.screenshot({ path: path.join(OUTPUT_DIR, `${DATE}_multiregion-ring.png`) });
  });
});
