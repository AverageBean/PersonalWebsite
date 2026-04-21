/**
 * Texture Feature — Week 1 Baseline Measurement Tests
 *
 * Purpose: Measure current implementation's coverage, uniformity, and export validity
 * These tests DO NOT validate correctness; they establish baseline metrics for Week 2-4 improvements
 *
 * Run with: npm run test:e2e -- tests/texture-baseline.spec.js
 */

const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const helpers = require('./texture-metrics-helpers');

const baseUrl = 'http://localhost:8081';
const testDocsDir = path.join(__dirname, '..', 'TestDocs');

test.describe('Texture Feature — Week 1 Baseline Measurements', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(baseUrl);
    await page.waitForLoadState('networkidle');
  });

  /**
   * Smoke Test: Verify file loading works
   */
  test('Smoke Test: File loading works', async ({ page }) => {
    const meshRingPath = path.join(testDocsDir, 'MeshRing1.stl');
    expect(fs.existsSync(meshRingPath)).toBeTruthy();

    console.log('Loading file:', meshRingPath);
    await page.setInputFiles('#fileInput', meshRingPath);

    // Wait for file to load
    await page.waitForFunction(
      () => !document.querySelector('#statusText').textContent.includes('Drop an STL'),
      { timeout: 10000 }
    );

    const fileName = await page.locator('#fileName').textContent();
    const triangles = await page.locator('#triangleCount').textContent();

    console.log('Loaded file:', fileName);
    console.log('Triangle count:', triangles);

    expect(fileName).toContain('MeshRing1');
    expect(triangles).not.toBe('0');
  });

  /**
   * Test Case 1: MeshRing1 with Hemispherical Bumps
   *
   * Setup: Load MeshRing1.stl, select outer surface, apply bumps at default spacing (5mm)
   * Measure: Coverage %, spillover %, spacing uniformity, export validity
   * Expected Baseline (before Week 2 fixes): 80-90% coverage with some spillover
   */
  test('Baseline: MeshRing1 bumps at 5mm spacing', async ({ page }) => {
    // Load MeshRing1
    const meshRingPath = path.join(testDocsDir, 'MeshRing1.stl');
    expect(fs.existsSync(meshRingPath)).toBeTruthy();

    console.log('Loading MeshRing1...');
    await page.setInputFiles('#fileInput', meshRingPath);

    // Wait for model to load (check status message updates)
    await page.waitForFunction(
      () => document.querySelector('#fileName').textContent.includes('MeshRing1'),
      { timeout: 10000 }
    );
    console.log('Model loaded');

    // Wait for texture button to be enabled
    const textureToggleBtn = page.locator('#textureToggleBtn');
    await textureToggleBtn.waitFor({ state: 'enabled', timeout: 5000 });
    console.log('Texture button enabled');

    // Open texture panel
    await textureToggleBtn.click();
    await page.waitForTimeout(500);
    console.log('Texture panel opened');

    // Verify panel is visible
    await page.waitForSelector('#texturePanel, [id*="texture"][id*="panel"]', { visible: true, timeout: 5000 });

    // Select bumps preset (verify it exists first)
    const presetSelect = page.locator('select');
    const selectCount = await presetSelect.count();
    console.log(`Found ${selectCount} select elements`);

    // Click on outer surface of ring (use center of canvas)
    const canvas = page.locator('#viewerCanvas');
    await canvas.waitFor({ state: 'visible' });
    const box = await canvas.boundingBox();

    if (box) {
      console.log(`Clicking canvas at (${box.width * 0.5}, ${box.height * 0.5})`);
      // Click center of canvas for Ring outer surface
      await canvas.click({ position: { x: box.width * 0.5, y: box.height * 0.5 } });
      await page.waitForTimeout(1000);
      console.log('Face selected');
    } else {
      console.warn('Could not get canvas bounding box');
    }

    // Apply texture using stable ID locator + spinner-based completion wait
    const applyBtn = page.locator('#textureApplyBtn');
    await applyBtn.waitFor({ state: 'enabled', timeout: 5000 });
    console.log('Applying texture...');
    await applyBtn.click();
    await page.waitForFunction(
      () => document.querySelector('#textureApplySpinner').hidden === true,
      { timeout: 30000 }
    );
    console.log('Texture applied');

    // Take screenshot
    const screenshotPath = await helpers.screenshotTexturedModel(page, 'bump-ring-baseline.png');
    console.log('Screenshot saved:', screenshotPath);

    // Export and analyze (primary measurement method)
    const stlPath = await helpers.exportTexturedGeometry(page, 'MeshRing1-bumps-baseline.stl', 'stl');
    const validity = await helpers.verifyExportValidity(stlPath);
    const uniformity = await helpers.measureSpacingUniformity(stlPath, path.join(testDocsDir, 'MeshRing1.stl'));

    console.log('Export Validity:', validity);
    console.log('Spacing Uniformity:', uniformity);

    // Log results
    const report = helpers.formatMetricsReport('MeshRing1 Bumps (Baseline)', {
      validity: validity,
      uniformity: uniformity,
      screenshots: [screenshotPath, stlPath]
    });
    console.log(report);

    // Save results to file
    const resultsPath = path.join(__dirname, '..', 'Testoutput', 'BASELINE_MESHRING1_BUMPS.txt');
    fs.writeFileSync(resultsPath, report);

    // Assertion: Just verify export is valid (primary success criteria)
    expect(validity.valid).toBeTruthy();
  });

  /**
   * Test Case 2: Baseplate with Mesh Weave
   *
   * Setup: Load Baseplate, select flat top surface, apply weave at default settings
   * Measure: Coverage %, spillover to sides, uniformity, export validity
   * Expected Baseline: 70-85% coverage with visible spillover to sides
   */
  test('Baseline: Baseplate weave at default settings', async ({ page }) => {
    // Load Baseplate
    const baseplatePath = path.join(testDocsDir, 'Station_3_Baseplate - Part 1.stl');
    expect(fs.existsSync(baseplatePath)).toBeTruthy();

    // Use the hidden file input (same as working tests)
    await page.setInputFiles('#fileInput', baseplatePath);
    await page.waitForTimeout(2000);

    // Open texture panel using stable ID locators
    const textureToggleBtn = page.locator('#textureToggleBtn');
    await textureToggleBtn.waitFor({ state: 'visible', timeout: 5000 });
    await textureToggleBtn.click();
    await page.locator('#texturePanel').waitFor({ state: 'visible', timeout: 5000 });

    // Select mesh weave preset
    await page.locator('#texturePresetSelect').selectOption('mesh');

    // Click on flat top surface
    const canvas = page.locator('#viewerCanvas');
    const box = await canvas.boundingBox();
    if (box) {
      await canvas.click({ position: { x: box.width * 0.5, y: box.height * 0.4 } });
      await page.waitForTimeout(500);
    }

    // Apply using stable ID + spinner wait
    await page.locator('#textureApplyBtn').click();
    await page.waitForFunction(
      () => document.querySelector('#textureApplySpinner').hidden === true,
      { timeout: 60000 }
    );

    // Take screenshot
    const screenshotPath = await helpers.screenshotTexturedModel(page, 'weave-baseplate-baseline.png');

    // Export and analyze
    const stlPath = await helpers.exportTexturedGeometry(page, 'Baseplate-weave-baseline.stl', 'stl');
    const validity = await helpers.verifyExportValidity(stlPath);
    const uniformity = await helpers.measureSpacingUniformity(
      stlPath,
      path.join(testDocsDir, 'Station_3_Baseplate - Part 1.stl')
    );

    // Log results
    const report = helpers.formatMetricsReport('Baseplate Weave (Baseline)', {
      validity: validity,
      uniformity: uniformity,
      screenshots: [screenshotPath, stlPath]
    });
    console.log(report);

    const resultsPath = path.join(__dirname, '..', 'Testoutput', 'BASELINE_BASEPLATE_WEAVE.txt');
    fs.writeFileSync(resultsPath, report);

    expect(validity.valid).toBeTruthy();
  });

  /**
   * Test Case 3: Partial Selection Boundary Test
   *
   * Setup: Load simple model, select half the surface, apply bumps
   * Measure: Does texture stop cleanly at selection boundary?
   * Expected Baseline: Visible bleed/gap at boundary
   */
  test('Baseline: Texture boundary behavior on partial selection', async ({ page }) => {
    // Use Baseplate and select only a small portion of top surface
    const baseplatePath = path.join(testDocsDir, 'Station_3_Baseplate - Part 1.stl');
    expect(fs.existsSync(baseplatePath)).toBeTruthy();

    // Use the hidden file input (same as working tests)
    await page.setInputFiles('#fileInput', baseplatePath);
    await page.waitForTimeout(2000);

    // Open texture panel
    const textureToggleBtn = page.locator('button:has-text("Texture")');
    if (textureToggleBtn.isVisible()) {
      await textureToggleBtn.click();
    }

    await page.waitForSelector('[id*="texture"][id*="panel"]', { visible: true, timeout: 5000 });

    // Make small selection (single click without shift-expansion)
    const canvas = page.locator('#viewerCanvas');
    const box = await canvas.boundingBox();
    if (box) {
      // Single click (no shift)
      await canvas.click({ position: { x: box.width * 0.3, y: box.height * 0.4 }, modifiers: [] });
      await page.waitForTimeout(500);
    }

    // Apply bumps to partial selection
    const presetSelect = page.locator('select[id*="preset"]');
    if (presetSelect.isVisible()) {
      await presetSelect.selectOption('bumps');
    }

    const applyBtn = page.locator('button:has-text("Apply")').first();
    if (applyBtn.isEnabled()) {
      await applyBtn.click();
      await page.waitForTimeout(2000);
    }

    // Screenshot showing boundary behavior
    const screenshotPath = await helpers.screenshotTexturedModel(page, 'texture-boundary-baseline.png');

    // Export and check
    const stlPath = await helpers.exportTexturedGeometry(page, 'Baseplate-partial-bumps-baseline.stl', 'stl');
    const validity = await helpers.verifyExportValidity(stlPath);

    const report = `Partial Selection Boundary Test (Baseline)\n\n` +
                   `Geometry Valid: ${validity.valid ? 'YES' : 'NO'}\n` +
                   `Degenerate Triangles: ${validity.degenerate_triangles}\n\n` +
                   `Screenshot: ${screenshotPath}\n` +
                   `Export: ${stlPath}\n\n` +
                   `Note: Visually inspect screenshot for boundary bleed or gaps\n`;

    const resultsPath = path.join(__dirname, '..', 'Testoutput', 'BASELINE_BOUNDARY_TEST.txt');
    fs.writeFileSync(resultsPath, report);

    expect(validity.valid).toBeTruthy();
  });

  /**
   * Cleanup and Summary
   *
   * Collect all baseline results into a summary report
   */
  test('Week 1: Generate baseline summary report', async ({ page }) => {
    const testoutputDir = path.join(__dirname, '..', 'Testoutput');
    const baselineFiles = fs.readdirSync(testoutputDir)
      .filter(f => f.startsWith('BASELINE_'))
      .sort();

    const summaryPath = path.join(testoutputDir, 'BASELINE_SUMMARY.md');
    const summaryLines = [
      '# Week 1 Baseline Metrics Summary\n',
      `Generated: ${new Date().toISOString()}\n`,
      '## Overview\n',
      'These measurements establish baseline metrics for the current texture implementation.',
      'They do NOT validate correctness; Week 2-4 will improve these metrics.\n',
      '## Test Cases\n'
    ];

    for (const file of baselineFiles) {
      const filePath = path.join(testoutputDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      summaryLines.push(`### ${file}\n\`\`\`\n${content}\n\`\`\`\n`);
    }

    summaryLines.push('## Key Findings for Week 2+\n');
    summaryLines.push('Based on baselines above, Week 2-4 implementation should:\n');
    summaryLines.push('1. Improve coverage precision (target: >99% selected, <1% spillover)\n');
    summaryLines.push('2. Ensure clean boundaries (no visible gaps or bleed)\n');
    summaryLines.push('3. Verify export geometry validity in FreeCAD\n');
    summaryLines.push('4. Measure spacing uniformity with cross-section analysis\n');

    fs.writeFileSync(summaryPath, summaryLines.join('\n'));
    console.log(`Baseline summary written to ${summaryPath}`);

    expect(fs.existsSync(summaryPath)).toBeTruthy();
  });
});
