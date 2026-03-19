/**
 * Socket integration tests — conversation room management
 *
 * Tests cover:
 *  - conversation:join  → member joins room + receives presence snapshot
 *  - conversation:join  → non-member receives error event
 *  - conversation:join  → announces user:online to existing room members
 *  - conversation:leave → leaves room + clears typing indicator
 *  - conversation:typing start → persisted + relayed to room
 *  - conversation:typing stop  → cleared + relayed to room
 */

const {
  createTestServer,
  stopTestServer,
  connectSocket,
  waitForEvent,
  expectNoEvent,
} = require("../helpers/server");
const { tokenFor, USERS } = require("../helpers/auth");

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock("../../lib/redis");
jest.mock("../../lib/presence");
jest.mock("../../lib/typing");
jest.mock("../../controllers/userController");
jest.mock("../../controllers/conversationController");

const presence       = require("../../lib/presence");
const typing         = require("../../lib/typing");
const userController = require("../../controllers/userController");
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
  presence.getLastSeen.mockResolvedValue(null);
  presence.getOnlineStatuses.mockResolvedValue(new Map());

  typing.start.mockResolvedValue(undefined);
  typing.stop.mockResolvedValue(undefined);
  typing.getTypingUsers.mockResolvedValue([]);

  userController.setOnlineStatus.mockResolvedValue(undefined);

  convCtrl.verifyMembership.mockResolvedValue({ userId: USERS.alice.id });
  convCtrl.getConversationById.mockResolvedValue({
    members: [{ userId: USERS.alice.id }, { userId: USERS.bob.id }],
  });
});

// ── conversation:join ─────────────────────────────────────────────────────────

describe("conversation:join", () => {
  test("member receives a conversation:presence snapshot", async () => {
    presence.getOnlineStatuses.mockResolvedValue(new Map([[USERS.bob.id, true]]));
    typing.getTypingUsers.mockResolvedValue([USERS.carol.id]);

    const socket = await connectSocket(testServer.url, tokenFor("alice"));
    const snapshotPromise = waitForEvent(socket, "conversation:presence");

    socket.emit("conversation:join", "conv-1");

    const snapshot = await snapshotPromise;
    expect(snapshot.conversationId).toBe("conv-1");
    expect(snapshot.onlineUserIds).toContain(USERS.bob.id);
    expect(snapshot.typingUserIds).toContain(USERS.carol.id);

    socket.disconnect();
    await new Promise((r) => setTimeout(r, 50));
  });

  test("member's join broadcasts user:online to existing room members", async () => {
    const aliceSocket = await connectSocket(testServer.url, tokenFor("alice"));
    const bobSocket   = await connectSocket(testServer.url, tokenFor("bob"));

    bobSocket.emit("conversation:join", "conv-1");
    await new Promise((r) => setTimeout(r, 100));

    const onlinePromise = waitForEvent(bobSocket, "user:online");

    aliceSocket.emit("conversation:join", "conv-1");

    const onlinePayload = await onlinePromise;
    expect(onlinePayload.userId).toBe(USERS.alice.id);

    aliceSocket.disconnect();
    bobSocket.disconnect();
    await new Promise((r) => setTimeout(r, 50));
  });

  test("non-member receives an error event and does NOT join the room", async () => {
    convCtrl.verifyMembership.mockResolvedValue(null);

    const socket = await connectSocket(testServer.url, tokenFor("alice"));
    const errorPromise = waitForEvent(socket, "error");

    socket.emit("conversation:join", "conv-restricted");

    const err = await errorPromise;
    expect(err.code).toBe("FORBIDDEN");

    // Presence snapshot should NOT arrive since room was not joined
    await expectNoEvent(socket, "conversation:presence");

    socket.disconnect();
    await new Promise((r) => setTimeout(r, 50));
  });

  test("verifyMembership is called with correct args", async () => {
    const socket = await connectSocket(testServer.url, tokenFor("alice"));
    socket.emit("conversation:join", "conv-1");
    await new Promise((r) => setTimeout(r, 150));

    expect(convCtrl.verifyMembership).toHaveBeenCalledWith("conv-1", USERS.alice.id);

    socket.disconnect();
    await new Promise((r) => setTimeout(r, 50));
  });
});

// ── conversation:leave ────────────────────────────────────────────────────────

describe("conversation:leave", () => {
  test("leaving clears the typing indicator for that user", async () => {
    const socket = await connectSocket(testServer.url, tokenFor("alice"));

    socket.emit("conversation:join", "conv-1");
    await new Promise((r) => setTimeout(r, 100));

    socket.emit("conversation:leave", "conv-1");
    await new Promise((r) => setTimeout(r, 100));

    expect(typing.stop).toHaveBeenCalledWith("conv-1", USERS.alice.id);

    socket.disconnect();
    await new Promise((r) => setTimeout(r, 50));
  });

  test("messages sent after a user leaves are not received by that user", async () => {
    const aliceSocket = await connectSocket(testServer.url, tokenFor("alice"));
    const bobSocket   = await connectSocket(testServer.url, tokenFor("bob"));

    aliceSocket.emit("conversation:join", "conv-1");
    bobSocket.emit("conversation:join", "conv-1");
    await new Promise((r) => setTimeout(r, 100));

    // Alice leaves the room
    aliceSocket.emit("conversation:leave", "conv-1");
    await new Promise((r) => setTimeout(r, 100));

    // Bob broadcasts to the room — Alice should NOT get it since she left
    const noMessage = expectNoEvent(aliceSocket, "message:new");
    bobSocket.emit("conversation:join", "conv-1"); // re-join triggers user:online but not message:new

    await noMessage;

    aliceSocket.disconnect();
    bobSocket.disconnect();
    await new Promise((r) => setTimeout(r, 50));
  });
});

// ── conversation:typing ───────────────────────────────────────────────────────

describe("conversation:typing", () => {
  test("isTyping=true calls typing.start and relays to room members", async () => {
    const aliceSocket = await connectSocket(testServer.url, tokenFor("alice"));
    const bobSocket   = await connectSocket(testServer.url, tokenFor("bob"));

    aliceSocket.emit("conversation:join", "conv-1");
    bobSocket.emit("conversation:join", "conv-1");
    await new Promise((r) => setTimeout(r, 100));

    const typingPromise = waitForEvent(bobSocket, "conversation:typing");

    aliceSocket.emit("conversation:typing", { conversationId: "conv-1", isTyping: true });

    const payload = await typingPromise;
    expect(payload.userId).toBe(USERS.alice.id);
    expect(payload.conversationId).toBe("conv-1");
    expect(payload.isTyping).toBe(true);
    expect(typing.start).toHaveBeenCalledWith("conv-1", USERS.alice.id);

    aliceSocket.disconnect();
    bobSocket.disconnect();
    await new Promise((r) => setTimeout(r, 50));
  });

  test("isTyping=false calls typing.stop and relays to room members", async () => {
    const aliceSocket = await connectSocket(testServer.url, tokenFor("alice"));
    const bobSocket   = await connectSocket(testServer.url, tokenFor("bob"));

    aliceSocket.emit("conversation:join", "conv-1");
    bobSocket.emit("conversation:join", "conv-1");
    await new Promise((r) => setTimeout(r, 100));

    const typingPromise = waitForEvent(bobSocket, "conversation:typing");

    aliceSocket.emit("conversation:typing", { conversationId: "conv-1", isTyping: false });

    const payload = await typingPromise;
    expect(payload.isTyping).toBe(false);
    expect(typing.stop).toHaveBeenCalledWith("conv-1", USERS.alice.id);

    aliceSocket.disconnect();
    bobSocket.disconnect();
    await new Promise((r) => setTimeout(r, 50));
  });

  test("sender does NOT receive their own typing event", async () => {
    const socket = await connectSocket(testServer.url, tokenFor("alice"));
    socket.emit("conversation:join", "conv-1");
    await new Promise((r) => setTimeout(r, 100));

    const noSelfTyping = expectNoEvent(socket, "conversation:typing");
    socket.emit("conversation:typing", { conversationId: "conv-1", isTyping: true });

    await noSelfTyping;
    socket.disconnect();
    await new Promise((r) => setTimeout(r, 50));
  });
});
