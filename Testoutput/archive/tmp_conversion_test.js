const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto('http://127.0.0.1:8081');
  await page.waitForSelector('#viewerCanvas');

  const fileInput = await page.$('#fileInput');
  await fileInput.setInputFiles('C:/Users/berry/WebstormProjects/PersonalWebsite/TestDocs/MeshRing1.stl');
  await page.waitForTimeout(3000);

  await page.selectOption('#exportFormat', 'step-parametric');
  await page.click('#downloadExportButton');

  // Wait for conversionResult to become visible
  try {
    await page.waitForFunction(() => {
      const el = document.getElementById('conversionResult');
      return el && !el.hidden;
    }, { timeout: 60000 });
  } catch(e) {
    console.log('Timed out waiting for conversion result');
  }

  await page.waitForTimeout(500);
  await page.screenshot({
    path: 'C:/Users/berry/WebstormProjects/PersonalWebsite/Testoutput/2026-03-19_conversion-result-panel.png',
    fullPage: true
  });
  await browser.close();
})();
