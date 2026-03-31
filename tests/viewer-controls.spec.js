const fs   = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");

const TESTDOCS_DIR  = path.resolve(__dirname, "..", "TestDocs");
const TESTOUTPUT_DIR = path.resolve(__dirname, "..", "Testoutput");
const RUN_DATE = "2026-03-31";

const tinyStl = `solid tiny
facet normal 0 0 1
  outer loop
    vertex 0 0 0
    vertex 20 0 0
    vertex 0 20 0
  endloop
endfacet
facet normal 0 0 -1
  outer loop
    vertex 0 0 0
    vertex 0 20 0
    vertex 20 0 0
  endloop
endfacet
endsolid tiny`;

test.beforeEach(async ({ page }) => {
  page.on("console", msg => {
    console.log(`[browser:${msg.type()}] ${msg.text()}`);
  });
  page.on("pageerror", error => {
    console.log(`[pageerror] ${error.message}`);
  });
  await page.goto("/");
});

// ── Camera reset ────────────────────────────────────────────────────────────

test("camera reset with no model shows default-view status", async ({ page }) => {
  await page.locator("#resetCameraButton").click();
  await expect(page.locator("#statusMessage")).toContainText(
    "Camera reset to the default empty-scene view."
  );
});

test("camera reset with model loaded shows frame-model status", async ({ page }) => {
  await page.setInputFiles("#fileInput", {
    name: "tiny.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(tinyStl)
  });
  await expect(page.locator("#fileName")).toHaveText("tiny.stl", { timeout: 10000 });

  await page.locator("#resetCameraButton").click();
  await expect(page.locator("#statusMessage")).toContainText(
    "Camera reset to frame the current model."
  );
});

// ── Grid toggle ─────────────────────────────────────────────────────────────

test("grid toggle button flips aria-pressed and status message", async ({ page }) => {
  // Grid is on by default
  await expect(page.locator("#gridToggleBtn")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#gridToggleBtn")).toHaveClass(/is-active/);

  // Click to turn off
  await page.locator("#gridToggleBtn").click();
  await expect(page.locator("#gridToggleBtn")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#gridToggleBtn")).not.toHaveClass(/is-active/);
  await expect(page.locator("#statusMessage")).toContainText("Grid hidden.");

  // Click to turn back on
  await page.locator("#gridToggleBtn").click();
  await expect(page.locator("#gridToggleBtn")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#gridToggleBtn")).toHaveClass(/is-active/);
  await expect(page.locator("#statusMessage")).toContainText("Grid enabled.");
});

// ── Bbox toggle ─────────────────────────────────────────────────────────────

test("bbox toggle activates after model load and toggles aria-pressed", async ({ page }) => {
  // Disabled before load
  await expect(page.locator("#bboxToggleBtn")).toBeDisabled();

  await page.setInputFiles("#fileInput", {
    name: "tiny.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(tinyStl)
  });
  await expect(page.locator("#fileName")).toHaveText("tiny.stl", { timeout: 10000 });

  // Enabled after load, initially off
  await expect(page.locator("#bboxToggleBtn")).toBeEnabled();
  await expect(page.locator("#bboxToggleBtn")).toHaveAttribute("aria-pressed", "false");

  // Click to turn on
  await page.locator("#bboxToggleBtn").click();
  await expect(page.locator("#bboxToggleBtn")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#bboxToggleBtn")).toHaveClass(/is-active/);

  // Click to turn off
  await page.locator("#bboxToggleBtn").click();
  await expect(page.locator("#bboxToggleBtn")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#bboxToggleBtn")).not.toHaveClass(/is-active/);
});

// ── Camera presets ──────────────────────────────────────────────────────────

test("camera preset selection updates usage tip and status", async ({ page }) => {
  // Switch to Onshape
  await page.locator("#controlPreset").selectOption("onshape");
  await expect(page.locator("#statusMessage")).toContainText("Control preset switched.");
  await expect(page.locator("#usageTip")).toContainText("Onshape-like");

  // Switch to SolidWorks
  await page.locator("#controlPreset").selectOption("solidworks");
  await expect(page.locator("#statusMessage")).toContainText("Control preset switched.");
  await expect(page.locator("#usageTip")).toContainText("SolidWorks-like");

  // Switch back to Web
  await page.locator("#controlPreset").selectOption("web");
  await expect(page.locator("#statusMessage")).toContainText("Control preset switched.");
  await expect(page.locator("#usageTip")).toContainText("Web Orbit");
});

// ── View styles ─────────────────────────────────────────────────────────────

test("all view styles apply without error", async ({ page }) => {
  await page.setInputFiles("#fileInput", {
    name: "tiny.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(tinyStl)
  });
  await expect(page.locator("#fileName")).toHaveText("tiny.stl", { timeout: 10000 });

  const styles = [
    { value: "solid",     label: "Solid Fill" },
    { value: "overlay",   label: "Solid + Triangle Lines" },
    { value: "wireframe", label: "Triangle Lines Only" },
    { value: "flat",      label: "Flat Shaded" }
  ];

  for (const style of styles) {
    await page.locator("#viewStyle").selectOption(style.value);
    await expect(page.locator("#statusMessage")).toContainText(
      `View style changed to ${style.label}.`
    );
    await expect(page.locator("#statusMessage")).not.toContainText("failed");
    await expect(page.locator("#statusMessage")).not.toContainText("error");
  }
});

// ── Background styles ───────────────────────────────────────────────────────

test("all background styles apply without error", async ({ page }) => {
  const backgrounds = [
    { value: "neutral", label: "Neutral Gray" },
    { value: "dark",    label: "Dark Studio" },
    { value: "warm",    label: "Warm Paper" },
    { value: "lab",     label: "Lab Light" }
  ];

  for (const bg of backgrounds) {
    await page.locator("#backgroundStyle").selectOption(bg.value);
    await expect(page.locator("#statusMessage")).toContainText(
      `Background changed to ${bg.label}.`
    );
  }
});

// ── Drag-and-drop ───────────────────────────────────────────────────────────

test("drop zone activates on dragenter and deactivates on dragleave", async ({ page }) => {
  const dropZone = page.locator("#dropZone");

  // Should not have is-active initially
  await expect(dropZone).not.toHaveClass(/is-active/);

  // Simulate dragenter
  await dropZone.dispatchEvent("dragenter", { bubbles: true });
  await expect(dropZone).toHaveClass(/is-active/);

  // Simulate dragleave
  await dropZone.dispatchEvent("dragleave", { bubbles: true });
  await expect(dropZone).not.toHaveClass(/is-active/);
});

test("drop zone click triggers file input", async ({ page }) => {
  // Listen for the file input click event
  const fileInputClicked = page.evaluate(() => {
    return new Promise(resolve => {
      document.getElementById("fileInput").addEventListener("click", () => resolve(true), { once: true });
    });
  });

  await page.locator("#dropZone").click();
  const clicked = await fileInputClicked;
  expect(clicked).toBe(true);
});

test("dropping an STL file loads the model", async ({ page }) => {
  const stlBuffer = Buffer.from(tinyStl);

  // Use page.evaluate to simulate a proper drop event with a File object
  await page.evaluate(async (stlContent) => {
    const dropZone = document.getElementById("dropZone");
    const file = new File([stlContent], "dropped.stl", { type: "model/stl" });
    const dt = new DataTransfer();
    dt.items.add(file);

    const dropEvent = new DragEvent("drop", {
      bubbles: true,
      cancelable: true,
      dataTransfer: dt
    });
    dropZone.dispatchEvent(dropEvent);
  }, tinyStl);

  await expect(page.locator("#fileName")).toHaveText("dropped.stl", { timeout: 10000 });
  await expect(page.locator("#triangleCount")).not.toHaveText("0");
  await expect(page.locator("#statusMessage")).not.toContainText("failed");
});

// ── Export downloads ────────────────────────────────────────────────────────

test("STL export produces a non-empty download", async ({ page }) => {
  await page.setInputFiles("#fileInput", {
    name: "tiny.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(tinyStl)
  });
  await expect(page.locator("#fileName")).toHaveText("tiny.stl", { timeout: 10000 });

  await page.locator("#exportFormat").selectOption("stl");

  // Intercept the download
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#downloadExportButton").click()
  ]);

  expect(download.suggestedFilename()).toMatch(/\.stl$/);
  const downloadPath = await download.path();
  const fileSize = fs.statSync(downloadPath).size;
  expect(fileSize).toBeGreaterThan(0);

  await expect(page.locator("#statusMessage")).toContainText("Exported");
});

test("OBJ export produces a non-empty download", async ({ page }) => {
  await page.setInputFiles("#fileInput", {
    name: "tiny.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(tinyStl)
  });
  await expect(page.locator("#fileName")).toHaveText("tiny.stl", { timeout: 10000 });

  await page.locator("#exportFormat").selectOption("obj");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#downloadExportButton").click()
  ]);

  expect(download.suggestedFilename()).toMatch(/\.obj$/);
  const downloadPath = await download.path();
  const fileSize = fs.statSync(downloadPath).size;
  expect(fileSize).toBeGreaterThan(0);

  await expect(page.locator("#statusMessage")).toContainText("Exported");
});

test("GLB export produces a non-empty download", async ({ page }) => {
  await page.setInputFiles("#fileInput", {
    name: "tiny.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(tinyStl)
  });
  await expect(page.locator("#fileName")).toHaveText("tiny.stl", { timeout: 10000 });

  await page.locator("#exportFormat").selectOption("glb");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#downloadExportButton").click()
  ]);

  expect(download.suggestedFilename()).toMatch(/\.glb$/);
  const downloadPath = await download.path();
  const fileSize = fs.statSync(downloadPath).size;
  expect(fileSize).toBeGreaterThan(0);

  await expect(page.locator("#statusMessage")).toContainText("Exported");
});

test("export button is disabled when no model is loaded", async ({ page }) => {
  await expect(page.locator("#downloadExportButton")).toBeDisabled();
});

test("export hint updates when format is changed", async ({ page }) => {
  await page.setInputFiles("#fileInput", {
    name: "tiny.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(tinyStl)
  });
  await expect(page.locator("#fileName")).toHaveText("tiny.stl", { timeout: 10000 });

  // STL hint
  await page.locator("#exportFormat").selectOption("stl");
  const stlHint = await page.locator("#exportHint").innerText();
  expect(stlHint).toContain(".stl");

  // OBJ hint
  await page.locator("#exportFormat").selectOption("obj");
  const objHint = await page.locator("#exportHint").innerText();
  expect(objHint).toContain(".obj");

  // Step-parametric hint
  await page.locator("#exportFormat").selectOption("step-parametric");
  const paramHint = await page.locator("#exportHint").innerText();
  expect(paramHint.toLowerCase()).toContain("analytical");
});
