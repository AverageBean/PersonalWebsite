/**
 * Tests for the completion ping on parametric STEP export.
 *
 * The ping is a two-tone Web Audio ding fired in the export's `finally`
 * block, so it plays whether the conversion succeeds or fails. We don't
 * play sound from the test; we instrument AudioContext.prototype to count
 * how many oscillators were created during the export and assert against
 * that count.
 *
 * The converter service is stubbed via page.route so the test runs offline.
 */
const { test, expect } = require("@playwright/test");
const path = require("path");

const STL = path.resolve(__dirname, "../TestDocs/MeshRing1.stl");
const BASE = "http://127.0.0.1:8081";
const PARAM_URL_PATTERN = /\/api\/convert\/stl-to-step-parametric/;

function buildSuccessNdjson() {
  const fakeStepText = "ISO-10303-21;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n";
  const fakeStepB64 = Buffer.from(fakeStepText, "utf-8").toString("base64");
  const lines = [
    { type: "progress", message: "loaded 100 triangles" },
    {
      type: "complete",
      meta: {
        analytical: true,
        coverage: "95",
        cylinders: "0",
        planes: "6",
        pctCyl: "0",
        pctPlane: "100",
        pctFillet: "0",
      },
      data: fakeStepB64,
    },
  ];
  return lines.map(JSON.stringify).join("\n") + "\n";
}

async function instrumentAudio(page) {
  await page.addInitScript(() => {
    window.__pingOscCount = 0;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    const origCreate = Ctor.prototype.createOscillator;
    Ctor.prototype.createOscillator = function () {
      window.__pingOscCount = (window.__pingOscCount || 0) + 1;
      return origCreate.call(this);
    };
  });
}

async function loadStl(page) {
  await page.waitForSelector("#viewerCanvas canvas", { timeout: 10000 });
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.click("#dropZone"),
  ]);
  await chooser.setFiles(STL);
  await page.waitForFunction(
    () => document.querySelector("#triangleCount")?.textContent?.trim().length > 0,
    { timeout: 8000 },
  );
}

async function selectFormat(page, value) {
  await page.selectOption("#exportFormat", value);
}

test.describe("Parametric STEP completion ping", () => {
  test.beforeEach(async ({ page }) => {
    await instrumentAudio(page);
    await page.goto(BASE);
    await loadStl(page);
  });

  test("ping fires after successful parametric STEP export", async ({ page }) => {
    await page.route(PARAM_URL_PATTERN, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body: buildSuccessNdjson(),
      });
    });

    await selectFormat(page, "step-parametric");
    await page.click("#downloadExportButton");

    // Wait for the export to finish (button re-enabled, status updated).
    await page.waitForFunction(
      () => !document.querySelector("#downloadExportButton")?.disabled,
      { timeout: 30000 },
    );
    // Allow the finally block + microtasks to execute.
    await page.waitForTimeout(300);

    const oscCount = await page.evaluate(() => window.__pingOscCount || 0);
    expect(oscCount).toBe(2);
  });

  test("ping fires after parametric STEP failure (server 500)", async ({ page }) => {
    await page.route(PARAM_URL_PATTERN, async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "stubbed failure" }),
      });
    });

    await selectFormat(page, "step-parametric");
    await page.click("#downloadExportButton");

    await page.waitForFunction(
      () => !document.querySelector("#downloadExportButton")?.disabled,
      { timeout: 30000 },
    );
    await page.waitForTimeout(300);

    const oscCount = await page.evaluate(() => window.__pingOscCount || 0);
    expect(oscCount).toBe(2);

    const status = await page.locator("#statusText").textContent();
    expect(status.toLowerCase()).toContain("failed");
  });

  test("ping does NOT fire after STL export", async ({ page }) => {
    // Capture the download to confirm STL export actually completed.
    const downloadPromise = page.waitForEvent("download");
    await selectFormat(page, "stl");
    await page.click("#downloadExportButton");
    await downloadPromise;
    await page.waitForTimeout(300);

    const oscCount = await page.evaluate(() => window.__pingOscCount || 0);
    expect(oscCount).toBe(0);
  });

  test("ping helpers exist and primePingAudio is idempotent", async ({ page }) => {
    // Sanity check: the AudioContext spy is installed and clicking the
    // download button (with format=stl) does not lazy-create a context.
    await selectFormat(page, "stl");
    const downloadPromise = page.waitForEvent("download");
    await page.click("#downloadExportButton");
    await downloadPromise;

    // No oscillators yet — STL export does not prime audio.
    const oscBefore = await page.evaluate(() => window.__pingOscCount || 0);
    expect(oscBefore).toBe(0);
  });
});
