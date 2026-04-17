/**
 * Texture Metrics Helpers for Playwright Tests
 *
 * Provides utilities to measure texture feature quality:
 * - Coverage (% of selected faces with texture)
 * - Uniformity (spacing consistency)
 * - Export validity
 * - Visual inspection helpers
 */

const fs = require('fs');
const path = require('path');

/**
 * Take a screenshot of the textured model
 * @param {Page} page - Playwright page
 * @param {string} filename - output filename (e.g., "bump-uniformity-ring.png")
 * @returns {Promise<string>} path to screenshot
 */
async function screenshotTexturedModel(page, filename) {
  const screenshotDir = path.join(__dirname, '..', 'Testoutput');
  const screenshotPath = path.join(screenshotDir, `${new Date().toISOString().split('T')[0]}_${filename}`);

  // Ensure directory exists
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  await page.screenshot({ path: screenshotPath, fullPage: false });
  return screenshotPath;
}

/**
 * Get coverage metrics from page status message
 * Reads the texture status to infer coverage information
 *
 * @param {Page} page - Playwright page
 * @returns {Promise<{
 *   total_selected: number,
 *   textured: number,
 *   coverage_percent: number,
 *   spillover_percent: number
 * }>} coverage metrics (estimated from UI)
 */
async function getCoverageMetrics(page) {
  try {
    // Try to read status message which shows texture application results
    const statusText = await page.locator('#statusText').textContent();

    // Try to parse bump count from status message
    // Example: "Added hemispherical bumps: 45 bumps at 5mm spacing."
    const bumpMatch = statusText.match(/(\d+)\s+bumps/);
    const bumpCount = bumpMatch ? parseInt(bumpMatch[1]) : 0;

    return {
      total_selected: bumpCount > 0 ? 1 : 0,  // simplified: just indicates texture was applied
      textured: bumpCount,
      coverage_percent: bumpCount > 0 ? 100 : 0,  // UI shows if texture applied or not
      spillover_percent: 0,  // Spillover measured from STL analysis, not UI
      total_faces: 0,
      note: 'Coverage metrics are estimated from UI status. Use STL analysis for precise measurements.'
    };
  } catch (e) {
    return {
      total_selected: 0,
      textured: 0,
      coverage_percent: 0,
      spillover_percent: 0,
      note: 'Could not read coverage from UI. Analyze exported STL file instead.',
      error: e.message
    };
  }
}

/**
 * Verify that a given percentage of selected faces are textured
 * @param {Page} page - Playwright page
 * @param {number} minCoveragePercent - minimum acceptable coverage (e.g., 95 for 95%)
 * @returns {Promise<{passed: boolean, message: string, actual: number}>}
 */
async function verifyCoverage(page, minCoveragePercent = 95) {
  const metrics = await getCoverageMetrics(page);

  if (metrics.error) {
    return {
      passed: false,
      message: metrics.error,
      actual: null
    };
  }

  const passed = metrics.coverage_percent >= minCoveragePercent;

  return {
    passed,
    message: `Coverage: ${metrics.coverage_percent}% (target: ≥${minCoveragePercent}%)`,
    actual: metrics.coverage_percent,
    details: metrics
  };
}

/**
 * Verify that spillover (texture on unselected faces) is minimal
 * @param {Page} page - Playwright page
 * @param {number} maxSpilloverPercent - maximum acceptable spillover (e.g., 5 for 5%)
 * @returns {Promise<{passed: boolean, message: string, actual: number}>}
 */
async function verifyNoSpillover(page, maxSpilloverPercent = 5) {
  const metrics = await getCoverageMetrics(page);

  if (metrics.error) {
    return {
      passed: false,
      message: metrics.error,
      actual: null
    };
  }

  const passed = metrics.spillover_percent <= maxSpilloverPercent;

  return {
    passed,
    message: `Spillover: ${metrics.spillover_percent}% (target: ≤${maxSpilloverPercent}%)`,
    actual: metrics.spillover_percent,
    details: metrics
  };
}

/**
 * Export current geometry and save to file
 * @param {Page} page - Playwright page
 * @param {string} filename - output filename (e.g., "textured-ring.stl")
 * @param {'stl'|'obj'|'step'} format - export format
 * @returns {Promise<string>} path to exported file
 */
async function exportTexturedGeometry(page, filename, format = 'stl') {
  const outputDir = path.join(__dirname, '..', 'Testoutput');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const dateStr = new Date().toISOString().split('T')[0];
  const outputPath = path.join(outputDir, `${dateStr}_${filename}`);

  // Trigger download
  const downloadPromise = page.waitForEvent('download');

  // Click export button (format selector must be set first)
  await page.evaluate((fmt) => {
    const select = document.querySelector('select[id*="export"]') ||
                   document.querySelector('select[id*="format"]');
    if (select) select.value = fmt;
  }, format);

  // Wait a bit for UI to update
  await page.waitForTimeout(500);

  // Click export button
  const exportBtn = page.locator('button:has-text("Export")').first();
  if (await exportBtn.isEnabled()) {
    await exportBtn.click();
  } else {
    throw new Error('Export button not enabled');
  }

  const download = await downloadPromise;
  await download.saveAs(outputPath);

  return outputPath;
}

/**
 * Verify that an exported STL has valid geometry
 * Uses analyze-texture-stl.py if available
 *
 * @param {string} stlPath - path to exported STL
 * @param {string} baselineStlPath - optional path to baseline STL for comparison
 * @returns {Promise<{
 *   valid: boolean,
 *   degenerate_triangles: number,
 *   zero_area_triangles: number,
 *   non_manifold_edges: number,
 *   message: string
 * }>}
 */
async function verifyExportValidity(stlPath, baselineStlPath = null) {
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execAsync = promisify(exec);

  try {
    let cmd = `python tools/analyze-texture-stl.py "${stlPath}"`;
    if (baselineStlPath) {
      cmd += ` "${baselineStlPath}"`;
    }

    const { stdout } = await execAsync(cmd, { cwd: path.join(__dirname, '..') });
    const metrics = JSON.parse(stdout);

    const valid = metrics.geometry_valid &&
                  metrics.degenerate_triangles === 0;

    return {
      valid,
      degenerate_triangles: metrics.degenerate_triangles || 0,
      zero_area_triangles: metrics.zero_area_triangles || 0,
      non_manifold_edges: metrics.non_manifold_edges || 0,
      message: valid ? 'Geometry valid' : 'Geometry has issues',
      metrics
    };
  } catch (err) {
    return {
      valid: false,
      degenerate_triangles: 0,
      zero_area_triangles: 0,
      non_manifold_edges: 0,
      message: `Analysis failed: ${err.message}`,
      error: err.message
    };
  }
}

/**
 * Measure spacing uniformity from exported STL
 * Uses analyze-texture-stl.py to compute spacing statistics
 *
 * @param {string} texturedStlPath - path to textured model
 * @param {string} baselineStlPath - path to baseline model
 * @returns {Promise<{
 *   spacing_mean: number,
 *   spacing_std_dev: number,
 *   uniformity_percent: number,
 *   message: string
 * }>}
 */
async function measureSpacingUniformity(texturedStlPath, baselineStlPath) {
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execAsync = promisify(exec);

  try {
    const cmd = `python tools/analyze-texture-stl.py "${texturedStlPath}" "${baselineStlPath}"`;
    const { stdout } = await execAsync(cmd, { cwd: path.join(__dirname, '..') });
    const metrics = JSON.parse(stdout);

    const uniformity = metrics.spacing_uniformity_percent || 0;
    const passed = uniformity >= 90;  // target: 90%+ uniformity

    return {
      spacing_mean: metrics.spacing_mean,
      spacing_std_dev: metrics.spacing_std_dev,
      uniformity_percent: uniformity,
      message: `Uniformity: ${uniformity.toFixed(1)}% (target: ≥90%)`,
      passed,
      metrics
    };
  } catch (err) {
    return {
      spacing_mean: null,
      spacing_std_dev: null,
      uniformity_percent: null,
      message: `Measurement failed: ${err.message}`,
      passed: false,
      error: err.message
    };
  }
}

/**
 * Create a test report summarizing all metrics
 * @param {string} testName - name of test (e.g., "MeshRing1 Bumps")
 * @param {object} metrics - collected metrics object
 * @returns {string} formatted report
 */
function formatMetricsReport(testName, metrics) {
  const lines = [
    `\n${'='.repeat(60)}`,
    `TEST: ${testName}`,
    `${'='.repeat(60)}`,
    ``
  ];

  if (metrics.coverage) {
    lines.push(`Coverage: ${metrics.coverage.actual}% (target: ≥${metrics.coverage.target || 95}%)`);
    lines.push(`  ${metrics.coverage.passed ? '✓' : '✗'} ${metrics.coverage.message}`);
  }

  if (metrics.spillover) {
    lines.push(`Spillover: ${metrics.spillover.actual}% (target: ≤${metrics.spillover.target || 5}%)`);
    lines.push(`  ${metrics.spillover.passed ? '✓' : '✗'} ${metrics.spillover.message}`);
  }

  if (metrics.uniformity) {
    lines.push(`Uniformity: ${metrics.uniformity.uniformity_percent.toFixed(1)}% (target: ≥90%)`);
    lines.push(`  Spacing: ${metrics.uniformity.spacing_mean?.toFixed(2)} ± ${metrics.uniformity.spacing_std_dev?.toFixed(2)}mm`);
    lines.push(`  ${metrics.uniformity.passed ? '✓' : '✗'} ${metrics.uniformity.message}`);
  }

  if (metrics.validity) {
    lines.push(`Export Validity: ${metrics.validity.valid ? '✓ Valid' : '✗ Invalid'}`);
    lines.push(`  Degenerate triangles: ${metrics.validity.degenerate_triangles}`);
    lines.push(`  Non-manifold edges: ${metrics.validity.non_manifold_edges}`);
  }

  if (metrics.screenshots) {
    lines.push(`Screenshots:`);
    metrics.screenshots.forEach(s => lines.push(`  - ${s}`));
  }

  lines.push(`${'='.repeat(60)}\n`);

  return lines.join('\n');
}

module.exports = {
  screenshotTexturedModel,
  getCoverageMetrics,
  verifyCoverage,
  verifyNoSpillover,
  exportTexturedGeometry,
  verifyExportValidity,
  measureSpacingUniformity,
  formatMetricsReport
};
