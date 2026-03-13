const path = require("path");
const { defineConfig, devices } = require("@playwright/test");

const tempRoot = process.env.TEMP || process.cwd();

module.exports = defineConfig({
  testDir: "./tests",
  timeout: 90000,
  fullyParallel: false,
  workers: 1,
  outputDir: path.join(tempRoot, "pw-results-personal-website"),
  reporter: [["list"], ["html", { open: "never", outputFolder: path.join(tempRoot, "pw-report-personal-website") }]],
  use: {
    baseURL: "http://127.0.0.1:8081",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  webServer: {
    command: "npm run start:e2e",
    url: "http://127.0.0.1:8081",
    timeout: 120000,
    reuseExistingServer: !process.env.CI
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
