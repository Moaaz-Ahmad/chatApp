"use strict";

const SERVER_URL = process.env.E2E_SERVER_URL || "http://localhost:3000";
const CLIENT_URL = process.env.E2E_CLIENT_URL || "http://localhost:5173";

/**
 * Deterministic E2E test accounts.
 * These are created by globalSetup and used throughout the test suite.
 *
 * WARNING: Do NOT use real credentials here.
 *     Do NOT commit real secrets to version control.
 *     These are throwaway test-only accounts.
 */
const TEST_USERS = [
  {
    email:       "e2e.alice@chatapp.test",
    username:    "e2e_alice",
    displayName: "Alice E2E",
    password:    "E2eAlice123!",
  },
  {
    email:       "e2e.bob@chatapp.test",
    username:    "e2e_bob",
    displayName: "Bob E2E",
    password:    "E2eBob123!",
  },
];

const ALICE = TEST_USERS[0];
const BOB   = TEST_USERS[1];

module.exports = { SERVER_URL, CLIENT_URL, TEST_USERS, ALICE, BOB };
