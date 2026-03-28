"use strict";

/**
 * Page-Object helpers for the ChatApp E2E suite.
 *
 * All functions accept a Playwright `Page` and interact via stable CSS
 * selectors, ARIA roles, and placeholder/title attributes that are owned by
 * the production source — they will break loudly if the UI changes, giving
 * an actionable signal.
 */

// ── Selectors (single source of truth) ────────────────────────────────────────

const SEL = {
  // Auth
  authCard:          ".auth-card",
  emailInput:        "#email",
  passwordInput:     "#password",
  submitBtn:         ".auth-submit",

  // App chrome
  sidebar:           ".sidebar",
  newChatBtn:        'button[title="New conversation"]',

  // ContactFinder modal
  cfModal:           '[role="dialog"][aria-label="Find a contact"]',
  cfSearchInput:     'input[placeholder="Search by email address…"]',
  cfResultItem:      ".cf-result-item",
  cfChatBtn:         ".cf-chat-btn",
  cfSpinner:         ".cf-spinner",

  // Sidebar conversation list
  convItem:          ".conv-item",
  convItemActive:    ".conv-item--active",
  convItemName:      ".conv-item__name",

  // Chat pane
  chatHeader:        ".chat-header",
  messageTextarea:   'textarea[placeholder="Type a message…"]',
  sendBtn:           'button[title="Send"]',
  bubbleText:        ".bubble__text",

  // Status / connection
  connectedLabel:    ".chat-header__conn--ok",
};

// ── Auth helpers ──────────────────────────────────────────────────────────────

/**
 * Navigate to the app root and sign in via the login form.
 * Resolves when the sidebar is visible (login succeeded).
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} email
 * @param {string} password
 */
async function login(page, email, password) {
  await page.goto("/");

  // Wait for the auth card — the app first tries a silent token refresh
  await page.waitForSelector(SEL.authCard, { timeout: 10_000 });

  // The "Sign In" tab is the default; no need to switch
  await page.fill(SEL.emailInput,    email);
  await page.fill(SEL.passwordInput, password);
  await page.click(SEL.submitBtn);

  // Login is complete when the sidebar renders
  await page.waitForSelector(SEL.sidebar, { timeout: 15_000 });
}

/**
 * After a page.reload(), the app silently re-authenticates via the
 * httpOnly refresh-token cookie.  Wait for the sidebar to confirm success.
 *
 * @param {import('@playwright/test').Page} page
 */
async function waitForSilentAuth(page) {
  await page.waitForSelector(SEL.sidebar, { timeout: 15_000 });
}

// ── ContactFinder helpers ─────────────────────────────────────────────────────

/**
 * Open the ContactFinder modal, search for `targetEmail`, and click "Chat".
 * Resolves when the modal has closed and the new conversation is active.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} targetEmail
 */
async function startDirectChat(page, targetEmail) {
  // Open the modal
  await page.click(SEL.newChatBtn);
  await page.waitForSelector(SEL.cfModal, { state: "visible" });

  // Type the email — the component debounces for 400 ms
  await page.fill(SEL.cfSearchInput, targetEmail);

  // Wait for the spinner to disappear then results to appear
  await page.waitForSelector(SEL.cfSpinner, { state: "detached", timeout: 5_000 }).catch(() => {
    // Spinner may never appear for very fast responses — ignore
  });
  await page.waitForSelector(SEL.cfResultItem, { timeout: 8_000 });

  // Click the Chat button on the first result
  await page.locator(`${SEL.cfResultItem} ${SEL.cfChatBtn}`).first().click();

  // The modal closes and the conversation becomes active in the sidebar
  await page.waitForSelector(SEL.cfModal, { state: "detached", timeout: 8_000 });
  await page.waitForSelector(SEL.convItemActive, { timeout: 8_000 });
}

// ── Conversation helpers ──────────────────────────────────────────────────────

/**
 * Click the conversation whose sidebar name contains `nameFragment`.
 * Waits for the conversation to become the active one.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} nameFragment  Partial or full display name shown in the sidebar
 */
async function openConversationByName(page, nameFragment) {
  const item = page.locator(SEL.convItem, { hasText: nameFragment });
  await item.waitFor({ state: "visible", timeout: 10_000 });
  await item.click();

  // Wait for the active state — confirms the pane switched
  await page.locator(SEL.convItemActive, { hasText: nameFragment })
            .waitFor({ state: "visible", timeout: 8_000 });
}

// ── Messaging helpers ─────────────────────────────────────────────────────────

/**
 * Wait until the socket shows as "Connected" in the chat header.
 * Ensures `sendMessage` won't silently no-op because `isConnected` is false.
 *
 * @param {import('@playwright/test').Page} page
 */
async function waitForSocketConnected(page) {
  await page.waitForSelector(SEL.connectedLabel, { timeout: 15_000 });
}

/**
 * Type `text` into the message input and click Send.
 * Waits for the optimistic bubble to appear before returning, confirming the
 * client accepted the message.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} text
 */
async function sendMessage(page, text) {
  await page.fill(SEL.messageTextarea, text);
  await page.click(SEL.sendBtn);

  // The optimistic bubble appears immediately in the sender's list
  await page
    .locator(SEL.bubbleText, { hasText: text })
    .waitFor({ state: "visible", timeout: 8_000 });
}

/**
 * Assert that a message bubble containing `text` is visible on `page`.
 * Does NOT throw by itself — returns the Locator so the caller can chain
 * `.waitFor()` or pass it to `expect()`.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} text
 * @returns {import('@playwright/test').Locator}
 */
function messageBubble(page, text) {
  return page.locator(SEL.bubbleText, { hasText: text });
}

module.exports = {
  SEL,
  login,
  waitForSilentAuth,
  startDirectChat,
  openConversationByName,
  waitForSocketConnected,
  sendMessage,
  messageBubble,
};
