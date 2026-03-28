// @ts-check
"use strict";

/**
 * Playwright E2E — Two-user real-time chat flow
 * ═══════════════════════════════════════════════
 *
 * Prerequisites (run before `npm test` in this directory):
 *   cd server   && npm run dev      # API + Socket.IO on :3000
 *   cd client   && npm run dev      # Vite dev server on :5173
 *   Docker PostgreSQL on :5432
 *
 * What this spec covers
 * ─────────────────────
 *   1. Independent login  — Alice and Bob each log in in separate browser contexts.
 *   2. Contact search     — Alice searches for Bob by email and starts a direct chat.
 *   3. Conversation join  — Bob refreshes his page; the new conversation appears in
 *                           his sidebar (loaded from the DB on silent re-auth).
 *   4. Real-time delivery — A message sent by Alice appears instantly on Bob's screen
 *                           without any page reload (via Socket.IO `message:new`).
 *   5. DB persistence     — After Bob refreshes, the message is fetched from the DB
 *                           and rendered again (REST GET /conversations/:id/messages).
 *   6. Reverse send       — Bob replies; Alice sees the reply in real-time.
 *   7. Idempotent chat    — Alice opens the ContactFinder for Bob a second time; the
 *                           existing conversation is reused (not duplicated).
 */

const { test, expect } = require("@playwright/test");
const {
  login,
  waitForSilentAuth,
  startDirectChat,
  openConversationByName,
  waitForSocketConnected,
  sendMessage,
  messageBubble,
  SEL,
} = require("../helpers/page-objects");
const { ALICE, BOB } = require("../helpers/constants");

// ── Unique message content (timestamp guards against cross-run pollution) ──────
const TS          = Date.now();
const MSG_ALICE   = `Hey Bob — E2E message from Alice (${TS})`;
const MSG_BOB     = `Hi Alice — E2E reply from Bob (${TS})`;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Open two independent browser contexts and return both pages.
 * Using separate contexts is the Playwright equivalent of two incognito windows —
 * cookies, localStorage, and socket connections are fully isolated.
 *
 * @param {import('@playwright/test').Browser} browser
 */
async function openTwoContexts(browser) {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  return {
    pageA: await ctxA.newPage(),
    pageB: await ctxB.newPage(),
    ctxA,
    ctxB,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

test.describe("Two-user chat flow", () => {

  // ── 1. Login ────────────────────────────────────────────────────────────────
  test("both users can log in independently", async ({ browser }) => {
    const { pageA, pageB, ctxA, ctxB } = await openTwoContexts(browser);

    await Promise.all([
      login(pageA, ALICE.email, ALICE.password),
      login(pageB, BOB.email,   BOB.password),
    ]);

    // Sidebar is the post-login landing; both should see it
    await expect(pageA.locator(SEL.sidebar)).toBeVisible();
    await expect(pageB.locator(SEL.sidebar)).toBeVisible();

    await ctxA.close();
    await ctxB.close();
  });

  // ── 2 + 3. Contact search and conversation join ────────────────────────────
  test("Alice searches for Bob by email and starts a direct conversation", async ({ browser }) => {
    const { pageA, pageB, ctxA, ctxB } = await openTwoContexts(browser);

    await Promise.all([
      login(pageA, ALICE.email, ALICE.password),
      login(pageB, BOB.email,   BOB.password),
    ]);

    // Alice opens ContactFinder and creates a direct chat with Bob
    await startDirectChat(pageA, BOB.email);

    // Alice's sidebar now shows Bob's conversation as active
    await expect(
      pageA.locator(SEL.convItemActive, { hasText: BOB.displayName })
    ).toBeVisible();

    // Bob refreshes — his conversations list re-fetches from the DB via silent re-auth
    await pageB.reload();
    await waitForSilentAuth(pageB);

    // Bob sees Alice's conversation in the sidebar
    await expect(
      pageB.locator(SEL.convItem, { hasText: ALICE.displayName })
    ).toBeVisible();

    await ctxA.close();
    await ctxB.close();
  });

  // ── 4. Real-time delivery ──────────────────────────────────────────────────
  test("a message from Alice appears on Bob's screen in real-time (no refresh)", async ({ browser }) => {
    const { pageA, pageB, ctxA, ctxB } = await openTwoContexts(browser);

    // ── Setup: both users logged in and in the same conversation ─────────────
    await Promise.all([
      login(pageA, ALICE.email, ALICE.password),
      login(pageB, BOB.email,   BOB.password),
    ]);

    // Alice opens (or reuses) the direct conversation with Bob
    await startDirectChat(pageA, BOB.email);

    // Bob refreshes to pick up the conversation, then opens it
    await pageB.reload();
    await waitForSilentAuth(pageB);
    await openConversationByName(pageB, ALICE.displayName);

    // Both must be socket-connected before sending
    await Promise.all([
      waitForSocketConnected(pageA),
      waitForSocketConnected(pageB),
    ]);

    // ── Act: Alice sends a unique message ─────────────────────────────────────
    await sendMessage(pageA, MSG_ALICE);

    // ── Assert: Bob sees the message without refreshing ───────────────────────
    await expect(messageBubble(pageB, MSG_ALICE)).toBeVisible();

    await ctxA.close();
    await ctxB.close();
  });

  // ── 5. DB persistence after page refresh ──────────────────────────────────
  test("message persists on Bob's screen after a full page refresh (DB fetch)", async ({ browser }) => {
    const { pageA, pageB, ctxA, ctxB } = await openTwoContexts(browser);

    await Promise.all([
      login(pageA, ALICE.email, ALICE.password),
      login(pageB, BOB.email,   BOB.password),
    ]);

    await startDirectChat(pageA, BOB.email);

    await pageB.reload();
    await waitForSilentAuth(pageB);
    await openConversationByName(pageB, ALICE.displayName);

    await Promise.all([
      waitForSocketConnected(pageA),
      waitForSocketConnected(pageB),
    ]);

    // Alice sends the message
    await sendMessage(pageA, MSG_ALICE);

    // Confirm Bob received it in real-time first (guards against flakiness)
    await expect(messageBubble(pageB, MSG_ALICE)).toBeVisible();

    // ── Bob reloads — session restored via refresh-token cookie ──────────────
    await pageB.reload();
    await waitForSilentAuth(pageB);

    // Bob reopens the conversation — messages are fetched from the DB
    await openConversationByName(pageB, ALICE.displayName);

    // The message must still be there (fetched from REST, not socket)
    await expect(messageBubble(pageB, MSG_ALICE)).toBeVisible();

    await ctxA.close();
    await ctxB.close();
  });

  // ── 6. Reverse send: Bob replies ──────────────────────────────────────────
  test("Bob can reply and Alice sees it in real-time", async ({ browser }) => {
    const { pageA, pageB, ctxA, ctxB } = await openTwoContexts(browser);

    await Promise.all([
      login(pageA, ALICE.email, ALICE.password),
      login(pageB, BOB.email,   BOB.password),
    ]);

    await startDirectChat(pageA, BOB.email);

    await pageB.reload();
    await waitForSilentAuth(pageB);
    await openConversationByName(pageB, ALICE.displayName);

    await Promise.all([
      waitForSocketConnected(pageA),
      waitForSocketConnected(pageB),
    ]);

    // Alice sends first; Bob replies
    await sendMessage(pageA, MSG_ALICE);
    await expect(messageBubble(pageB, MSG_ALICE)).toBeVisible();

    await sendMessage(pageB, MSG_BOB);

    // Alice sees Bob's reply without refreshing
    await expect(messageBubble(pageA, MSG_BOB)).toBeVisible();

    await ctxA.close();
    await ctxB.close();
  });

  // ── 7. Full lifecycle with persistence ────────────────────────────────────
  test("full conversation lifecycle: send → real-time delivery → both users reload → messages persist", async ({ browser }) => {
    const { pageA, pageB, ctxA, ctxB } = await openTwoContexts(browser);

    // ── Login ─────────────────────────────────────────────────────────────────
    await Promise.all([
      login(pageA, ALICE.email, ALICE.password),
      login(pageB, BOB.email,   BOB.password),
    ]);

    // ── Alice starts the conversation ─────────────────────────────────────────
    await startDirectChat(pageA, BOB.email);

    // ── Bob picks up the conversation ─────────────────────────────────────────
    await pageB.reload();
    await waitForSilentAuth(pageB);
    await openConversationByName(pageB, ALICE.displayName);

    // ── Both sockets connected ────────────────────────────────────────────────
    await Promise.all([
      waitForSocketConnected(pageA),
      waitForSocketConnected(pageB),
    ]);

    // ── Send messages in both directions ──────────────────────────────────────
    await sendMessage(pageA, MSG_ALICE);
    await expect(messageBubble(pageB, MSG_ALICE)).toBeVisible();   // real-time
    await sendMessage(pageB, MSG_BOB);
    await expect(messageBubble(pageA, MSG_BOB)).toBeVisible();     // real-time

    // ── Alice reloads — both messages must survive ────────────────────────────
    await pageA.reload();
    await waitForSilentAuth(pageA);
    await openConversationByName(pageA, BOB.displayName);

    await expect(messageBubble(pageA, MSG_ALICE)).toBeVisible();   // persisted
    await expect(messageBubble(pageA, MSG_BOB)).toBeVisible();     // persisted

    // ── Bob reloads — same check ──────────────────────────────────────────────
    await pageB.reload();
    await waitForSilentAuth(pageB);
    await openConversationByName(pageB, ALICE.displayName);

    await expect(messageBubble(pageB, MSG_ALICE)).toBeVisible();   // persisted
    await expect(messageBubble(pageB, MSG_BOB)).toBeVisible();     // persisted

    await ctxA.close();
    await ctxB.close();
  });

  // ── 8. Idempotent chat creation ───────────────────────────────────────────
  test("opening ContactFinder for Bob a second time reuses the existing conversation", async ({ browser }) => {
    const { pageA, ctxA } = await openTwoContexts(browser);

    await login(pageA, ALICE.email, ALICE.password);

    // First chat open
    await startDirectChat(pageA, BOB.email);
    const convCountBefore = await pageA.locator(SEL.convItem).count();

    // Second open — server returns 200 (existing), not 201 (created)
    await startDirectChat(pageA, BOB.email);
    const convCountAfter = await pageA.locator(SEL.convItem).count();

    // No duplicate conversation should be added
    expect(convCountAfter).toBe(convCountBefore);

    await ctxA.close();
  });
});
