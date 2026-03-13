# Playwright Debugging Workflow

## Why this is useful
- Reproduces viewer issues quickly with deterministic browser actions.
- Captures traces, screenshots, and videos on failures.
- Streams browser console/page errors in test output for faster diagnosis.

## Commands
- Install browser: `npm run pw:install`
- Run tests: `npm run test:e2e`
- Debug mode: `npm run test:e2e:debug`
- UI runner: `npm run test:e2e:ui`
- Open HTML report: `npm run test:e2e:report`
- Record new steps: `npm run pw:codegen`

## Current test coverage
- Viewer control panel renders.
- STL file upload path works.
- View style can switch to `Sharp Edges Only`.
- Triangle multiplier slider updates model detail.

## MCP setup
- This repo includes `mcp.playwright.json` with a Playwright MCP server definition.
- In your MCP client, add that server entry (or copy the same values):
  - command: `npx`
  - args: `@playwright/mcp@latest --port 8931`

## Practical debugging loop
1. Run `npm start`.
2. Reproduce manually in browser.
3. Capture a script via `npm run pw:codegen`.
4. Convert generated steps into a Playwright test.
5. Run `npm run test:e2e:debug` and inspect trace/report on failure.