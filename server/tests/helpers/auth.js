/**
 * Test helpers for generating JWT tokens and fixture data.
 *
 * These rely on the real signAccessToken so that socketAuth middleware and the
 * authenticate middleware can verify them without any extra mocking.
 */

const { signAccessToken } = require("../../utils/jwt");

// ── Canonical test users ──────────────────────────────────────────────────────

const USERS = {
  alice: { id: "user-alice", email: "alice@test.com", displayName: "Alice" },
  bob:   { id: "user-bob",   email: "bob@test.com",   displayName: "Bob"   },
  carol: { id: "user-carol", email: "carol@test.com", displayName: "Carol" },
};

/**
 * Returns a signed access token for a test user.
 * @param {"alice"|"bob"|"carol"} name
 */
function tokenFor(name) {
  const u = USERS[name];
  return signAccessToken({ sub: u.id, email: u.email, displayName: u.displayName });
}

/**
 * Returns an access token for an arbitrary user payload.
 * @param {{ sub: string, email: string, displayName: string }} payload
 */
function makeToken(payload) {
  return signAccessToken(payload);
}

// ── Message / conversation fixtures ──────────────────────────────────────────

function makeMessage(overrides = {}) {
  return {
    id:             overrides.id             ?? "msg-1",
    conversationId: overrides.conversationId ?? "conv-1",
    senderId:       overrides.senderId       ?? USERS.alice.id,
    type:           overrides.type           ?? "TEXT",
    content:        overrides.content        ?? "Hello",
    status:         overrides.status         ?? "SENT",
    isEdited:       false,
    isDeleted:      false,
    replyToId:      null,
    attachments:    [],
    readReceipts:   [],
    createdAt:      new Date().toISOString(),
    updatedAt:      new Date().toISOString(),
    sender: {
      id:          overrides.senderId ?? USERS.alice.id,
      displayName: "Alice",
      avatarUrl:   null,
    },
    ...overrides,
  };
}

function makeConversation(overrides = {}) {
  return {
    id:          overrides.id          ?? "conv-1",
    type:        overrides.type        ?? "DIRECT",
    name:        overrides.name        ?? null,
    description: overrides.description ?? null,
    avatarUrl:   null,
    createdAt:   new Date().toISOString(),
    updatedAt:   new Date().toISOString(),
    members:     overrides.members     ?? [],
    lastMessage: overrides.lastMessage ?? null,
    _count:      { messages: 0 },
    ...overrides,
  };
}

function makeDbUser(overrides = {}) {
  return {
    id:          overrides.id          ?? USERS.alice.id,
    email:       overrides.email       ?? USERS.alice.email,
    displayName: overrides.displayName ?? USERS.alice.displayName,
    password:    overrides.password    ?? "$2b$12$hashedpassword",
    avatarUrl:   null,
    isOnline:    false,
    lastSeenAt:  null,
    createdAt:   new Date().toISOString(),
    ...overrides,
  };
}

module.exports = { USERS, tokenFor, makeToken, makeMessage, makeConversation, makeDbUser };
