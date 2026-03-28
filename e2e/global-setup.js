/**
 * Global Setup — runs once before the entire Playwright test suite.
 *
 * Responsibility: ensure both E2E test users exist in the database.
 * Strategy      : POST /auth/register; tolerate HTTP 409 (user already exists).
 *
 * The users are deterministic so this script is fully idempotent — re-running
 * the suite never breaks because of stale seed data.
 */

"use strict";

const { TEST_USERS, SERVER_URL } = require("./helpers/constants");

/**
 * Attempts to register a user via the REST API.
 * If the email/username is already taken (409) it verifies the password still
 * works by calling POST /auth/login — catching regressions where a previous
 * run left different credentials in the DB.
 *
 * @param {{ email: string, username: string, displayName: string, password: string }} user
 */
async function ensureUser(user) {
  const registerRes = await fetch(`${SERVER_URL}/auth/register`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(user),
  });

  if (registerRes.ok) {
    console.log(`  [setup] registered  ${user.email}`);
    return;
  }

  if (registerRes.status === 409) {
    // User exists — confirm the expected password still works
    const loginRes = await fetch(`${SERVER_URL}/auth/login`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ email: user.email, password: user.password }),
    });

    if (!loginRes.ok) {
      const body = await loginRes.json().catch(() => ({}));
      throw new Error(
        `[E2E global-setup] ${user.email} exists but login failed: ${JSON.stringify(body)}\n` +
        `Delete the conflicting DB record or update TEST_USERS.password in helpers/constants.js`
      );
    }

    console.log(`  [setup] confirmed   ${user.email} (already existed)`);
    return;
  }

  // Any other HTTP error is unexpected — surface it loudly
  const body = await registerRes.json().catch(() => ({}));
  throw new Error(
    `[E2E global-setup] Failed to seed ${user.email} ` +
    `(HTTP ${registerRes.status}): ${JSON.stringify(body)}`
  );
}

async function globalSetup() {
  console.log("\n[E2E] Global setup — seeding test users …");
  console.log(`       Server: ${SERVER_URL}`);

  // Verify the server is reachable before trying to seed
  try {
    const health = await fetch(`${SERVER_URL}/health`, { signal: AbortSignal.timeout(5_000) });
    if (!health.ok) throw new Error(`/health returned HTTP ${health.status}`);
  } catch (err) {
    throw new Error(
      `[E2E global-setup] Cannot reach the server at ${SERVER_URL}.\n` +
      `Start it first:  cd server && npm run dev\n` +
      `Original error: ${err.message}`
    );
  }

  await Promise.all(TEST_USERS.map(ensureUser));
  console.log("[E2E] Global setup complete.\n");
}

module.exports = globalSetup;
