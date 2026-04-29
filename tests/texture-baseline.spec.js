/**
 * Texture Feature — File-load Smoke Test
 *
 * The Week-1 "baseline" tests this file used to contain (MeshRing1 bumps,
 * Baseplate weave, partial-selection boundary) were superseded by:
 *   - tests/texture-uniformity.spec.js  (NN distance, determinism, on-surface uniformity)
 *   - tests/texture-phase1-clusters.spec.js  (export validity, bump count thresholds)
 *   - tests/texture-triplanar.spec.js  (regression on flat + curved)
 *
 * The pre-multi-region baselines were also brittle: they used canvas-position
 * clicks that drifted with camera changes and assumed panel-auto-close on Apply
 * (removed in commit 02550b9). They were removed on 2026-04-29 along with the
 * unused metrics helper functions.
 *
 * What remains: a single sanity test that file loading + status updates work.
 *
 * Run: npm run test:e2e -- tests/texture-baseline.spec.js
 */

const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const baseUrl = 'http://localhost:8081';
const testDocsDir = path.join(__dirname, '..', 'TestDocs');

test.describe('Texture Feature — File-load Smoke', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(baseUrl);
    await page.waitForLoadState('networkidle');
  });

  test('Smoke Test: File loading works', async ({ page }) => {
    const meshRingPath = path.join(testDocsDir, 'MeshRing1.stl');
    expect(fs.existsSync(meshRingPath)).toBeTruthy();

    await page.setInputFiles('#fileInput', meshRingPath);

    await page.waitForFunction(
      () => !document.querySelector('#statusText').textContent.includes('Drop an STL'),
      { timeout: 10000 }
    );

    const fileName = await page.locator('#fileName').textContent();
    const triangles = await page.locator('#triangleCount').textContent();

    expect(fileName).toContain('MeshRing1');
    expect(triangles).not.toBe('0');
  });
});
