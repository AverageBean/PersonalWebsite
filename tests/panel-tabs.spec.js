const { test, expect } = require("@playwright/test");

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("tab bar renders all three tabs", async ({ page }) => {
  const tabs = page.locator('[role="tab"]');
  await expect(tabs).toHaveCount(3);
  await expect(tabs.nth(0)).toHaveText("STL Viewer");
  await expect(tabs.nth(1)).toHaveText("Bonsai Vitals");
  await expect(tabs.nth(2)).toHaveText("Train Spotting");
});

test("STL Viewer tab is active by default and viewer controls are visible", async ({ page }) => {
  await expect(page.locator('[data-tab="stl-viewer"]')).toHaveClass(/is-active/);
  await expect(page.locator("#tab-stl-viewer")).toBeVisible();
  await expect(page.locator("#controlPreset")).toBeVisible();
});

test("clicking Bonsai Vitals tab shows placeholder and hides viewer", async ({ page }) => {
  await page.locator('[data-tab="bonsai-vitals"]').click();
  await expect(page.locator("#tab-bonsai-vitals")).toBeVisible();
  await expect(page.locator("#tab-stl-viewer")).not.toBeVisible();
  await expect(page.locator('[data-tab="bonsai-vitals"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-tab="stl-viewer"]')).toHaveAttribute("aria-selected", "false");
});

test("clicking Train Spotting tab shows placeholder and hides viewer", async ({ page }) => {
  await page.locator('[data-tab="train-spotting"]').click();
  await expect(page.locator("#tab-train-spotting")).toBeVisible();
  await expect(page.locator("#tab-stl-viewer")).not.toBeVisible();
  await expect(page.locator('[data-tab="train-spotting"]')).toHaveAttribute("aria-selected", "true");
});

test("switching back to STL Viewer restores viewer controls", async ({ page }) => {
  await page.locator('[data-tab="bonsai-vitals"]').click();
  await page.locator('[data-tab="stl-viewer"]').click();
  await expect(page.locator("#tab-stl-viewer")).toBeVisible();
  await expect(page.locator("#controlPreset")).toBeVisible();
  await expect(page.locator('[data-tab="stl-viewer"]')).toHaveAttribute("aria-selected", "true");
});

test("only one tab pane is visible at a time", async ({ page }) => {
  const panes = page.locator(".tab-pane");
  await expect(panes).toHaveCount(3);

  // Default: only STL Viewer visible
  await expect(page.locator("#tab-stl-viewer")).toBeVisible();
  await expect(page.locator("#tab-bonsai-vitals")).not.toBeVisible();
  await expect(page.locator("#tab-train-spotting")).not.toBeVisible();

  // Switch to Bonsai Vitals
  await page.locator('[data-tab="bonsai-vitals"]').click();
  await expect(page.locator("#tab-stl-viewer")).not.toBeVisible();
  await expect(page.locator("#tab-bonsai-vitals")).toBeVisible();
  await expect(page.locator("#tab-train-spotting")).not.toBeVisible();
});
