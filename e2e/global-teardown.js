/**
 * Global Teardown — runs once after the entire Playwright test suite finishes.
 *
 * The E2E test users are intentionally left in the database — they are
 * deterministic and the globalSetup is idempotent, so re-runs are safe.
 *
 * If you want a fully clean slate after each CI run, delete the users here
 * by adding a protected DELETE /users/:id admin endpoint to the server, or
 * by running `npx prisma db execute` with a raw SQL DELETE.
 */

"use strict";

async function globalTeardown() {
  // No-op for now. Test users persist across runs intentionally.
  console.log("[E2E] Global teardown — test users retained for next run.");
}

module.exports = globalTeardown;
