// @ts-check
const { defineConfig, devices } = require("@playwright/test");

/**
 * Playwright configuration.
 *
 * Prerequisites (must be running before `npm test`):
 *   • Server  → http://localhost:3000  (cd server && npm run dev)
 *   • Client  → http://localhost:5173  (cd client && npm run dev)
 *   • Postgres → port 5432             (Docker or local)
 *
 * Override the base URLs via environment variables:
 *   E2E_CLIENT_URL=http://localhost:5173
 *   E2E_SERVER_URL=http://localhost:3000
 */
module.exports = defineConfig({
  testDir: "./tests",

  // Seed test users before any test runs and clean up after
  globalSetup:    require.resolve("./global-setup"),
  globalTeardown: require.resolve("./global-teardown"),

  // Per-test timeout (generous — socket delivery + debounced search)
  timeout: 40_000,

  // Playwright expect() timeout
  expect: { timeout: 15_000 },

  // One test file at a time; the spec itself manages two browser contexts in parallel
  workers: 1,
  retries: 0,

  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],

  use: {
    baseURL:    process.env.E2E_CLIENT_URL || "http://localhost:5173",
    video:      "retain-on-failure",
    screenshot: "only-on-failure",
    trace:      "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
