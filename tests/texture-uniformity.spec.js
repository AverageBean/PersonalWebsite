/**
 * Bump Uniformity Regression Test
 *
 * Asserts the geodesic / stratified surface Poisson-disk algorithm produces
 * uniform spacing on flat, curved, and contoured surfaces. Locks in the
 * uniformity guarantee against future bump-algorithm changes.
 *
 * Reads accepted bump centers via window.__textureBumpCenters (test hook in
 * applyTextureToGeometry) and computes nearest-neighbor distance statistics:
 *   - No pair below minDist (= spacing * 0.5) within a small tolerance
 *   - Mean NN distance within sane range relative to minDist
 *   - Coefficient of variation (std/mean) below threshold — uniformity
 *
 * Run: npm run test:e2e -- tests/texture-uniformity.spec.js
 */

const { test, expect } = require('@playwright/test');
const path = require('path');

const BASE_URL = 'http://localhost:8081';
const TEST_DOCS = path.join(__dirname, '..', 'TestDocs');
const MIN_DIST_FRACTION = 0.5; // matches MIN_DIST_FRACTION in computeBumpGeometry

async function loadModel(page, filename) {
  await page.setInputFiles('#fileInput', path.join(TEST_DOCS, filename));
  await page.waitForFunction(
    name => document.querySelector('#fileName').textContent.includes(name),
    filename.replace('.stl', '').replace('.STL', ''),
    { timeout: 15000 }
  );
  await page.waitForTimeout(300);
}

async function applyBumps(page, spacing = 5, radius = 1.5) {
  // Open panel if not already visible (multi-region keeps it open after Apply)
  const panel = page.locator('#texturePanel');
  if (!(await panel.isVisible())) {
    await page.locator('#textureToggleBtn').click();
    await panel.waitFor({ state: 'visible', timeout: 5000 });
  }
  await page.locator('#textureSelectAllBtn').click();
  await page.locator('#texturePresetSelect').selectOption('bumps');
  await page.locator('#bumpSpacingInput').fill(String(spacing));
  await page.locator('#bumpRadiusInput').fill(String(radius));
  await page.locator('#textureApplyBtn').click();
  await page.waitForFunction(
    () => document.querySelector('#textureApplySpinner').hidden === true,
    { timeout: 30000 }
  );
  await page.waitForTimeout(300);
}

async function readBumpCenters(page) {
  return page.evaluate(() => {
    const buf = window.__textureBumpCenters;
    if (!buf) return null;
    const out = [];
    for (let i = 0; i < buf.length; i += 3) {
      out.push([buf[i], buf[i + 1], buf[i + 2]]);
    }
    return out;
  });
}

function nearestNeighborStats(centers) {
  const n = centers.length;
  const nn = new Array(n).fill(Infinity);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = centers[i][0] - centers[j][0];
      const dy = centers[i][1] - centers[j][1];
      const dz = centers[i][2] - centers[j][2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < nn[i]) nn[i] = d;
      if (d < nn[j]) nn[j] = d;
    }
  }
  const min = Math.min(...nn);
  const max = Math.max(...nn);
  const mean = nn.reduce((s, v) => s + v, 0) / n;
  const variance = nn.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);
  return { min, max, mean, stdDev, cv: stdDev / mean, count: n };
}

function reportStats(label, stats, minDist) {
  console.log(`${label}: n=${stats.count} min=${stats.min.toFixed(2)} mean=${stats.mean.toFixed(2)} max=${stats.max.toFixed(2)} std=${stats.stdDev.toFixed(2)} cv=${stats.cv.toFixed(3)} (minDist=${minDist}mm)`);
}

test.describe('Bump Placement Uniformity', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
  });

  // ── Spacing floor: every NN ≥ minDist (within float-precision tolerance) ──

  test('Aloy Focus: no bump pair below minimum distance', async ({ page }) => {
    await loadModel(page, 'Aloy Focus.stl');
    await applyBumps(page, 5, 1.5);

    const centers = await readBumpCenters(page);
    expect(centers).not.toBeNull();
    expect(centers.length).toBeGreaterThan(30);

    const minDist = 5 * MIN_DIST_FRACTION;
    const stats = nearestNeighborStats(centers);
    reportStats('Aloy', stats, minDist);

    // Algorithm guarantees min ≥ minDist; allow 1% slack for float math
    expect(stats.min).toBeGreaterThanOrEqual(minDist * 0.99);
  });

  test('MeshRing1: no bump pair below minimum distance', async ({ page }) => {
    await loadModel(page, 'MeshRing1.stl');
    await applyBumps(page, 5, 1.5);

    const centers = await readBumpCenters(page);
    expect(centers).not.toBeNull();
    expect(centers.length).toBeGreaterThan(30);

    const minDist = 5 * MIN_DIST_FRACTION;
    const stats = nearestNeighborStats(centers);
    reportStats('Ring', stats, minDist);

    expect(stats.min).toBeGreaterThanOrEqual(minDist * 0.99);
  });

  test('Baseplate: no bump pair below minimum distance', async ({ page }) => {
    await loadModel(page, 'Station_3_Baseplate - Part 1.stl');
    await applyBumps(page, 5, 1.5);

    const centers = await readBumpCenters(page);
    expect(centers).not.toBeNull();
    expect(centers.length).toBeGreaterThan(30);

    const minDist = 5 * MIN_DIST_FRACTION;
    const stats = nearestNeighborStats(centers);
    reportStats('Baseplate', stats, minDist);

    expect(stats.min).toBeGreaterThanOrEqual(minDist * 0.99);
  });

  // ── Uniformity: NN distance distribution is tight relative to its mean ──
  // Greedy Poisson on a candidate cloud typically gives cv = std/mean ≈ 0.2–0.4.
  // The triplanar grid produced cv ≈ 0.5+ on contoured surfaces (anisotropic).

  test('Aloy Focus: nearest-neighbor distance distribution is uniform', async ({ page }) => {
    await loadModel(page, 'Aloy Focus.stl');
    await applyBumps(page, 5, 1.5);

    const centers = await readBumpCenters(page);
    const stats = nearestNeighborStats(centers);
    reportStats('Aloy uniformity', stats, 2.5);

    // Mean NN should be moderately above minDist (2.5mm) — Poisson typical
    expect(stats.mean).toBeGreaterThanOrEqual(2.5);
    expect(stats.mean).toBeLessThanOrEqual(8.0);
    // Spread relative to mean — uniformity guarantee
    expect(stats.cv).toBeLessThan(0.45);
  });

  test('MeshRing1: nearest-neighbor distance distribution is uniform', async ({ page }) => {
    await loadModel(page, 'MeshRing1.stl');
    await applyBumps(page, 5, 1.5);

    const centers = await readBumpCenters(page);
    const stats = nearestNeighborStats(centers);
    reportStats('Ring uniformity', stats, 2.5);

    expect(stats.mean).toBeGreaterThanOrEqual(2.5);
    expect(stats.mean).toBeLessThanOrEqual(8.0);
    expect(stats.cv).toBeLessThan(0.45);
  });

  test('Baseplate: nearest-neighbor distance distribution is uniform', async ({ page }) => {
    await loadModel(page, 'Station_3_Baseplate - Part 1.stl');
    await applyBumps(page, 5, 1.5);

    const centers = await readBumpCenters(page);
    const stats = nearestNeighborStats(centers);
    reportStats('Baseplate uniformity', stats, 2.5);

    expect(stats.mean).toBeGreaterThanOrEqual(2.5);
    expect(stats.mean).toBeLessThanOrEqual(8.0);
    expect(stats.cv).toBeLessThan(0.45);
  });

  // ── Determinism: same inputs produce identical bump centers ──

  test('Aloy Focus: identical inputs produce identical bump centers', async ({ page }) => {
    await loadModel(page, 'Aloy Focus.stl');
    await applyBumps(page, 5, 1.5);
    const first = await readBumpCenters(page);

    // Reset and re-apply with identical params
    await page.locator('#textureResetBtn').click();
    await page.waitForTimeout(500);
    await applyBumps(page, 5, 1.5);
    const second = await readBumpCenters(page);

    expect(second.length).toBe(first.length);
    for (let i = 0; i < first.length; i++) {
      expect(second[i][0]).toBeCloseTo(first[i][0], 4);
      expect(second[i][1]).toBeCloseTo(first[i][1], 4);
      expect(second[i][2]).toBeCloseTo(first[i][2], 4);
    }
  });
});
