/**
 * Socket integration tests — real-time messaging events
 *
 * Tests cover:
 *  - message:send  → ack + message:new broadcast to room
 *  - message:send  → non-member rejection
 *  - message:send  → empty-payload rejection
 *  - message:send  → clientId echoed back for optimistic deduplication
 *  - message:delivered → markDelivered called + relayed to sender's room
 *  - message:read     → markRead called + broadcast to conversation
 */

const {
  createTestServer,
  stopTestServer,
  connectSocket,
  waitForEvent,
  emitWithAck,
  expectNoEvent,
} = require("../helpers/server");
const { tokenFor, USERS, makeMessage } = require("../helpers/auth");

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock("../../lib/redis");      // prevent real ioredis connections
jest.mock("../../lib/presence");
jest.mock("../../lib/typing");
jest.mock("../../controllers/userController");
jest.mock("../../controllers/messageController");
jest.mock("../../controllers/conversationController");

const presence       = require("../../lib/presence");
const typing         = require("../../lib/typing");
const userController = require("../../controllers/userController");
const msgCtrl        = require("../../controllers/messageController");
const convCtrl       = require("../../controllers/conversationController");

// ── Server lifecycle ──────────────────────────────────────────────────────────

let testServer;

beforeAll(async () => {
  testServer = await createTestServer();
});

afterAll(async () => {
  await stopTestServer(testServer);
});

beforeEach(() => {
  presence.add.mockResolvedValue(1);
  presence.remove.mockResolvedValue(0);
  presence.getOnlineStatuses.mockResolvedValue(new Map());

  typing.start.mockResolvedValue(undefined);
  typing.stop.mockResolvedValue(undefined);
  typing.getTypingUsers.mockResolvedValue([]);

  userController.setOnlineStatus.mockResolvedValue(undefined);

  convCtrl.verifyMembership.mockResolvedValue({ userId: USERS.alice.id });
  convCtrl.getConversationById.mockResolvedValue({ members: [] });
  msgCtrl.createMessage.mockResolvedValue(makeMessage({ senderId: USERS.alice.id }));
  msgCtrl.markDelivered.mockResolvedValue(undefined);
  msgCtrl.markRead.mockResolvedValue(undefined);
});

// ── message:send ──────────────────────────────────────────────────────────────

describe("message:send", () => {
  test("ack ok + broadcasts message:new to other room members", async () => {
    const aliceSocket = await connectSocket(testServer.url, tokenFor("alice"));
    const bobSocket   = await connectSocket(testServer.url, tokenFor("bob"));

    // Both join the room
    aliceSocket.emit("conversation:join", "conv-1");
    bobSocket.emit("conversation:join", "conv-1");
    await new Promise((r) => setTimeout(r, 100));

    const newMsgPromise = waitForEvent(bobSocket, "message:new");

    const ack = await emitWithAck(aliceSocket, "message:send", {
      conversationId: "conv-1",
      content:        "Hello Bob",
      clientId:       "client-abc",
    });

    expect(ack.ok).toBe(true);
    expect(ack.message.content).toBe("Hello");   // value from makeMessage default
    expect(ack.message.clientId).toBe("client-abc");  // clientId echoed back

    const received = await newMsgPromise;
    expect(received.conversationId).toBe("conv-1");
    expect(received.clientId).toBe("client-abc");

    aliceSocket.disconnect();
    bobSocket.disconnect();
  });

  test("sender does NOT receive message:new (only ack)", async () => {
    const socket = await connectSocket(testServer.url, tokenFor("alice"));
    socket.emit("conversation:join", "conv-1");
    await new Promise((r) => setTimeout(r, 100));

    const noSelfMessage = expectNoEvent(socket, "message:new");

    await emitWithAck(socket, "message:send", {
      conversationId: "conv-1",
      content:        "Self test",
      clientId:       "client-1",
    });

    await noSelfMessage;
    socket.disconnect();
  });

  test("ack error — non-member cannot send", async () => {
    convCtrl.verifyMembership.mockResolvedValue(null);

    const socket = await connectSocket(testServer.url, tokenFor("alice"));
    const ack = await emitWithAck(socket, "message:send", {
      conversationId: "conv-restricted",
      content:        "Sneak attack",
      clientId:       "client-2",
    });

    expect(ack.ok).toBe(false);
    expect(ack.error).toMatch(/not a member/i);

    socket.disconnect();
  });

  test("ack error — missing content and no attachments", async () => {
    const socket = await connectSocket(testServer.url, tokenFor("alice"));
    const ack = await emitWithAck(socket, "message:send", {
      conversationId: "conv-1",
      content:        "",
      attachments:    [],
      clientId:       "client-3",
    });

    expect(ack.ok).toBe(false);
    expect(ack.error).toMatch(/invalid payload/i);

    socket.disconnect();
  });

  test("createMessage is called with correct arguments", async () => {
    const socket = await connectSocket(testServer.url, tokenFor("alice"));
    socket.emit("conversation:join", "conv-1");
    await new Promise((r) => setTimeout(r, 100));

    await emitWithAck(socket, "message:send", {
      conversationId: "conv-1",
      content:        "Test message",
      type:           "TEXT",
      replyToId:      "msg-parent",
      clientId:       "client-4",
    });

    expect(msgCtrl.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv-1",
        senderId:       USERS.alice.id,
        content:        "Test message",
        type:           "TEXT",
        replyToId:      "msg-parent",
      })
    );

    socket.disconnect();
  });
});

// ── message:delivered ─────────────────────────────────────────────────────────

describe("message:delivered", () => {
  test("calls markDelivered and relays event to the sender's room", async () => {
    const aliceSocket = await connectSocket(testServer.url, tokenFor("alice"));
    const bobSocket   = await connectSocket(testServer.url, tokenFor("bob"));
    await new Promise((r) => setTimeout(r, 100));

    const deliveredPromise = waitForEvent(aliceSocket, "message:delivered");

    // Bob marks a message (sent by Alice) as delivered
    bobSocket.emit("message:delivered", {
      messageId:      "msg-1",
      senderId:       USERS.alice.id,
      conversationId: "conv-1",
    });

    const payload = await deliveredPromise;
    expect(payload.messageId).toBe("msg-1");
    expect(payload.conversationId).toBe("conv-1");
    expect(payload).toHaveProperty("deliveredAt");

    expect(msgCtrl.markDelivered).toHaveBeenCalledWith("msg-1");

    aliceSocket.disconnect();
    bobSocket.disconnect();
  });
});

// ── message:read ──────────────────────────────────────────────────────────────

describe("message:read", () => {
  test("calls markRead and broadcasts read receipt to the whole conversation", async () => {
    const aliceSocket = await connectSocket(testServer.url, tokenFor("alice"));
    const bobSocket   = await connectSocket(testServer.url, tokenFor("bob"));

    aliceSocket.emit("conversation:join", "conv-1");
    bobSocket.emit("conversation:join", "conv-1");
    await new Promise((r) => setTimeout(r, 100));

    const readPromise = waitForEvent(aliceSocket, "message:read");

    bobSocket.emit("message:read", {
      messageId:      "msg-1",
      senderId:       USERS.alice.id,
      conversationId: "conv-1",
    });

    const receipt = await readPromise;
    expect(receipt.messageId).toBe("msg-1");
    expect(receipt.readerId).toBe(USERS.bob.id);
    expect(receipt).toHaveProperty("readAt");

    expect(msgCtrl.markRead).toHaveBeenCalledWith({
      messageId: "msg-1",
      userId:    USERS.bob.id,
    });

    aliceSocket.disconnect();
    bobSocket.disconnect();
  });
});
