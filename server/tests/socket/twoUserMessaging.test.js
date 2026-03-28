/**
 * Integration test — Two-user real-time messaging
 *
 * Scenario
 * ────────
 *  1. User A (Alice) connects and joins "room-123"
 *  2. User B (Bob)   connects and joins "room-123"
 *  3. Alice emits  message:send
 *  4. Bob receives message:new with the correct payload
 *  5. Alice receives the ack  (ok: true + persisted message)
 *  6. Alice does NOT receive message:new (only the ack — no self-echo)
 *  7. Both sockets are disconnected after every test (cleanup)
 *
 * Extra edge cases
 * ────────────────
 *  • A third user (Carol) who has NOT joined the room does NOT receive the event
 *  • Bob cannot send if verifyMembership returns null  (non-member guard)
 *  • An empty message is rejected before hitting the DB
 *  • message:delivered is relayed only to the sender's personal room
 *  • message:read is broadcast to the whole conversation room
 *
 * Architecture note
 * ─────────────────
 *  All controller / DB calls are mocked so the test runs without a real
 *  Postgres database.  The Socket.IO layer (auth middleware, room join/leave,
 *  event routing) runs on a real in-process server.
 */

"use strict";

// ── Mocks (must come before any require of server modules) ────────────────────

jest.mock("../../lib/redis");        // prevent real ioredis connections
jest.mock("../../lib/presence");
jest.mock("../../lib/typing");
jest.mock("../../controllers/userController");
jest.mock("../../controllers/messageController");
jest.mock("../../controllers/conversationController");

// ── Imports ───────────────────────────────────────────────────────────────────

const {
  createTestServer,
  stopTestServer,
  connectSocket,
  waitForEvent,
  emitWithAck,
  expectNoEvent,
} = require("../helpers/server");

const { USERS, tokenFor, makeMessage } = require("../helpers/auth");

const presence  = require("../../lib/presence");
const typing    = require("../../lib/typing");
const userCtrl  = require("../../controllers/userController");
const msgCtrl   = require("../../controllers/messageController");
const convCtrl  = require("../../controllers/conversationController");

// ── Constants ─────────────────────────────────────────────────────────────────

const ROOM          = "room-123";              // the shared conversation ID
const MSG_CONTENT   = "Hello from Alice!";
const CLIENT_ID     = "optimistic-client-abc";

// ── Server lifecycle ──────────────────────────────────────────────────────────

let server;

beforeAll(async () => {
  server = await createTestServer();
});

afterAll(async () => {
  await stopTestServer(server);
});

// ── Default mock return values (overridden per test where needed) ─────────────

beforeEach(() => {
  // Presence
  presence.add.mockResolvedValue(1);
  presence.remove.mockResolvedValue(0);
  presence.getOnlineStatuses.mockResolvedValue(new Map());
  presence.refresh.mockResolvedValue(undefined);

  // Typing
  typing.start.mockResolvedValue(undefined);
  typing.stop.mockResolvedValue(undefined);
  typing.getTypingUsers.mockResolvedValue([]);

  // User
  userCtrl.setOnlineStatus.mockResolvedValue(undefined);

  // Conversation — every user is a member of ROOM by default
  convCtrl.verifyMembership.mockResolvedValue({ userId: USERS.alice.id });
  convCtrl.getConversationById.mockResolvedValue({
    id:      ROOM,
    members: [
      { userId: USERS.alice.id },
      { userId: USERS.bob.id   },
    ],
  });

  // Message — simulate the persisted row the DB would return
  msgCtrl.createMessage.mockResolvedValue(
    makeMessage({
      id:             "msg-server-001",
      conversationId: ROOM,
      senderId:       USERS.alice.id,
      content:        MSG_CONTENT,
    })
  );
  msgCtrl.markDelivered.mockResolvedValue(undefined);
  msgCtrl.markRead.mockResolvedValue(undefined);
});

// ─────────────────────────────────────────────────────────────────────────────
// Helper — connect both users and join them into ROOM
// Returns { alice, bob } sockets already in the room.
// ─────────────────────────────────────────────────────────────────────────────

async function setupTwoUsers() {
  const [alice, bob] = await Promise.all([
    connectSocket(server.url, tokenFor("alice")),
    connectSocket(server.url, tokenFor("bob")),
  ]);

  // Both join the conversation room
  alice.emit("conversation:join", ROOM);
  bob.emit("conversation:join",   ROOM);

  // Wait for server-side room joins to be processed
  await new Promise((r) => setTimeout(r, 80));

  return { alice, bob };
}

function disconnectAll(...sockets) {
  sockets.forEach((s) => s?.disconnect());
}

// ─────────────────────────────────────────────────────────────────────────────
// Core scenario
// ─────────────────────────────────────────────────────────────────────────────

describe("Two-user messaging in a shared conversation room", () => {

  // ── 1. Happy path — full round trip ───────────────────────────────────────

  test("Alice sends a message → Bob receives message:new with correct payload", async () => {
    const { alice, bob } = await setupTwoUsers();

    // Register Bob's listener BEFORE Alice sends (avoids race)
    const bobReceived = waitForEvent(bob, "message:new");

    const ack = await emitWithAck(alice, "message:send", {
      conversationId: ROOM,
      content:        MSG_CONTENT,
      clientId:       CLIENT_ID,
    });

    // ── Alice's ack ──────────────────────────────────────────────────────────
    expect(ack.ok).toBe(true);
    expect(ack.message).toMatchObject({
      id:             "msg-server-001",
      conversationId: ROOM,
      senderId:       USERS.alice.id,
      content:        MSG_CONTENT,
      clientId:       CLIENT_ID,   // echoed back for optimistic UI deduplication
      status:         "SENT",
    });

    // ── Bob's event ──────────────────────────────────────────────────────────
    const event = await bobReceived;
    expect(event).toMatchObject({
      id:             "msg-server-001",
      conversationId: ROOM,
      senderId:       USERS.alice.id,
      content:        MSG_CONTENT,
      clientId:       CLIENT_ID,
    });
    // Bob should never see the raw password or any server-internal fields
    expect(event).not.toHaveProperty("password");

    disconnectAll(alice, bob);
  });

  // ── 2. Sender does NOT receive message:new (only the ack) ─────────────────

  test("Alice does NOT receive message:new for her own message", async () => {
    const { alice, bob } = await setupTwoUsers();

    // Set up the "should not fire" assertion before sending
    const noSelfEcho = expectNoEvent(alice, "message:new", 300);

    await emitWithAck(alice, "message:send", {
      conversationId: ROOM,
      content:        MSG_CONTENT,
      clientId:       CLIENT_ID,
    });

    await noSelfEcho; // passes only if alice never receives message:new

    disconnectAll(alice, bob);
  });

  // ── 3. Message is persisted before broadcast ───────────────────────────────

  test("createMessage is called once with Alice's sender ID and room", async () => {
    const { alice, bob } = await setupTwoUsers();

    await emitWithAck(alice, "message:send", {
      conversationId: ROOM,
      content:        MSG_CONTENT,
      type:           "TEXT",
      clientId:       CLIENT_ID,
    });

    expect(msgCtrl.createMessage).toHaveBeenCalledTimes(1);
    expect(msgCtrl.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: ROOM,
        senderId:       USERS.alice.id,
        content:        MSG_CONTENT,
        type:           "TEXT",
      })
    );

    disconnectAll(alice, bob);
  });

  // ── 4. Out-of-room user does not receive the event ────────────────────────

  test("Carol (in the room by membership but not joined via socket) does NOT receive message:new", async () => {
    const { alice, bob } = await setupTwoUsers();

    // Carol connects but does NOT emit conversation:join for ROOM
    const carol = await connectSocket(server.url, tokenFor("carol"));
    const carolNoMessage = expectNoEvent(carol, "message:new", 300);

    await emitWithAck(alice, "message:send", {
      conversationId: ROOM,
      content:        MSG_CONTENT,
      clientId:       CLIENT_ID,
    });

    await carolNoMessage; // passes only if carol never received the event

    disconnectAll(alice, bob, carol);
  });

  // ── 5. Membership guard — non-member is rejected ──────────────────────────

  test("Bob cannot send if the server says he is not a member", async () => {
    const { alice, bob } = await setupTwoUsers();

    // Override: membership check returns null → not a member
    convCtrl.verifyMembership.mockResolvedValue(null);

    const ack = await emitWithAck(bob, "message:send", {
      conversationId: ROOM,
      content:        "Sneaky message",
      clientId:       "client-sneaky",
    });

    expect(ack.ok).toBe(false);
    expect(ack.error).toMatch(/not a member/i);
    // Confirm the message was never persisted
    expect(msgCtrl.createMessage).not.toHaveBeenCalled();

    disconnectAll(alice, bob);
  });

  // ── 6. Empty message rejected before hitting the DB ──────────────────────

  test("Empty content with no attachments is rejected without calling createMessage", async () => {
    const { alice, bob } = await setupTwoUsers();

    const ack = await emitWithAck(alice, "message:send", {
      conversationId: ROOM,
      content:        "   ",   // whitespace-only → trims to ""
      attachments:    [],
      clientId:       "client-empty",
    });

    expect(ack.ok).toBe(false);
    expect(ack.error).toMatch(/invalid payload/i);
    expect(msgCtrl.createMessage).not.toHaveBeenCalled();

    disconnectAll(alice, bob);
  });

  // ── 7. message:delivered — relayed to sender's personal room ──────────────

  test("Bob marks Alice's message as delivered → Alice receives message:delivered", async () => {
    const { alice, bob } = await setupTwoUsers();

    const deliveredPromise = waitForEvent(alice, "message:delivered");

    bob.emit("message:delivered", {
      messageId:      "msg-server-001",
      senderId:       USERS.alice.id,   // tells server whose personal room to notify
      conversationId: ROOM,
    });

    const receipt = await deliveredPromise;
    expect(receipt.messageId).toBe("msg-server-001");
    expect(receipt.conversationId).toBe(ROOM);
    expect(receipt).toHaveProperty("deliveredAt");
    expect(msgCtrl.markDelivered).toHaveBeenCalledWith("msg-server-001");

    disconnectAll(alice, bob);
  });

  // ── 8. message:read — broadcast to the whole conversation room ────────────

  test("Bob reads Alice's message → entire room receives message:read", async () => {
    const { alice, bob } = await setupTwoUsers();

    // Register Alice's listener before Bob emits
    const readPromise = waitForEvent(alice, "message:read");

    bob.emit("message:read", {
      messageId:      "msg-server-001",
      senderId:       USERS.alice.id,
      conversationId: ROOM,
    });

    const receipt = await readPromise;
    expect(receipt).toMatchObject({
      messageId:      "msg-server-001",
      conversationId: ROOM,
      readerId:       USERS.bob.id,
    });
    expect(receipt).toHaveProperty("readAt");

    expect(msgCtrl.markRead).toHaveBeenCalledWith({
      messageId: "msg-server-001",
      userId:    USERS.bob.id,
    });

    disconnectAll(alice, bob);
  });

  // ── 9. Full round-trip: send → delivered → read ───────────────────────────

  test("complete message lifecycle: Alice sends, Bob delivers, Bob reads", async () => {
    const { alice, bob } = await setupTwoUsers();

    // Step 1 — Alice sends
    const bobReceives = waitForEvent(bob, "message:new");
    const ack = await emitWithAck(alice, "message:send", {
      conversationId: ROOM,
      content:        MSG_CONTENT,
      clientId:       CLIENT_ID,
    });
    expect(ack.ok).toBe(true);
    const msg = await bobReceives;

    // Step 2 — Bob marks delivered
    const deliveredPromise = waitForEvent(alice, "message:delivered");
    bob.emit("message:delivered", {
      messageId:      msg.id,
      senderId:       USERS.alice.id,
      conversationId: ROOM,
    });
    const delivered = await deliveredPromise;
    expect(delivered.messageId).toBe(msg.id);

    // Step 3 — Bob marks read
    const readPromise = waitForEvent(alice, "message:read");
    bob.emit("message:read", {
      messageId:      msg.id,
      senderId:       USERS.alice.id,
      conversationId: ROOM,
    });
    const read = await readPromise;
    expect(read.messageId).toBe(msg.id);
    expect(read.readerId).toBe(USERS.bob.id);

    // Verify all DB operations were called
    expect(msgCtrl.createMessage).toHaveBeenCalledTimes(1);
    expect(msgCtrl.markDelivered).toHaveBeenCalledWith(msg.id);
    expect(msgCtrl.markRead).toHaveBeenCalledWith({ messageId: msg.id, userId: USERS.bob.id });

    disconnectAll(alice, bob);
  });
});
