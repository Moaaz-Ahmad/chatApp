/**
 * Socket integration tests — connection lifecycle
 *
 * Tests cover:
 *  - auth rejection (missing / invalid token)
 *  - successful connection + personal room assignment
 *  - presence tracking (first vs subsequent connection)
 *  - presence:heartbeat event
 *  - disconnect → user:offline broadcast (last connection)
 *  - disconnect → no user:offline when other tabs remain open
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
  presence.refresh.mockResolvedValue(undefined);
  presence.getLastSeen.mockResolvedValue(null);
  presence.getOnlineStatuses.mockResolvedValue(new Map());
  presence.isOnline.mockResolvedValue(false);

  typing.start.mockResolvedValue(undefined);
  typing.stop.mockResolvedValue(undefined);
  typing.getTypingUsers.mockResolvedValue([]);

  userController.setOnlineStatus.mockResolvedValue(undefined);

  convCtrl.verifyMembership.mockResolvedValue({ userId: USERS.alice.id });
  convCtrl.getConversationById.mockResolvedValue({ members: [] });
});

// ── Authentication guard ──────────────────────────────────────────────────────

describe("socketAuth middleware", () => {
  test("rejects connection with no token (AUTH_MISSING)", async () => {
    await expect(connectSocket(testServer.url, null)).rejects.toMatchObject({
      message: "AUTH_MISSING",
    });
  });

  test("rejects connection with a tampered token (AUTH_INVALID)", async () => {
    await expect(
      connectSocket(testServer.url, "totally.invalid.token")
    ).rejects.toMatchObject({ message: "AUTH_INVALID" });
  });

  test("connects successfully with a valid access token", async () => {
    const socket = await connectSocket(testServer.url, tokenFor("alice"));
    expect(socket.connected).toBe(true);
    socket.disconnect();
  });
});

// ── Presence on connect ───────────────────────────────────────────────────────

describe("connect — presence tracking", () => {
  test("adds socket to presence store and marks user online in DB", async () => {
    const socket = await connectSocket(testServer.url, tokenFor("alice"));
    await new Promise((r) => setTimeout(r, 100));

    expect(presence.add).toHaveBeenCalledWith(USERS.alice.id, socket.id);
    expect(userController.setOnlineStatus).toHaveBeenCalledWith(USERS.alice.id, true);

    socket.disconnect();
    await new Promise((r) => setTimeout(r, 50));
  });

  test("does NOT re-broadcast online when a second tab connects", async () => {
    presence.add.mockResolvedValue(2); // simulate second connection

    const socket = await connectSocket(testServer.url, tokenFor("alice"));
    await new Promise((r) => setTimeout(r, 100));

    expect(userController.setOnlineStatus).not.toHaveBeenCalledWith(USERS.alice.id, true);

    socket.disconnect();
    await new Promise((r) => setTimeout(r, 50));
  });
});

// ── Heartbeat ─────────────────────────────────────────────────────────────────

describe("presence:heartbeat", () => {
  test("calls presence.refresh with userId and socketId", async () => {
    const socket = await connectSocket(testServer.url, tokenFor("alice"));
    const sid = socket.id;

    socket.emit("presence:heartbeat");
    await new Promise((r) => setTimeout(r, 100));

    expect(presence.refresh).toHaveBeenCalledWith(USERS.alice.id, sid);

    socket.disconnect();
    await new Promise((r) => setTimeout(r, 50));
  });
});

// ── Presence on disconnect ────────────────────────────────────────────────────

describe("disconnect — presence tracking", () => {
  test("removes socket from presence store on disconnect", async () => {
    const socket = await connectSocket(testServer.url, tokenFor("alice"));
    const sid = socket.id;

    socket.disconnect();
    await new Promise((r) => setTimeout(r, 200));

    expect(presence.remove).toHaveBeenCalledWith(USERS.alice.id, sid);
  });

  test("marks user offline in DB when last connection closes", async () => {
    presence.remove.mockResolvedValue(0);

    const socket = await connectSocket(testServer.url, tokenFor("alice"));
    socket.disconnect();
    await new Promise((r) => setTimeout(r, 200));

    expect(userController.setOnlineStatus).toHaveBeenCalledWith(USERS.alice.id, false);
  });

  test("does NOT mark offline when other tabs remain open", async () => {
    presence.remove.mockResolvedValue(1); // still 1 connection left

    const socket = await connectSocket(testServer.url, tokenFor("alice"));
    socket.disconnect();
    await new Promise((r) => setTimeout(r, 200));

    expect(userController.setOnlineStatus).not.toHaveBeenCalledWith(USERS.alice.id, false);
  });

  test("broadcasts user:offline to conversation rooms when fully offline", async () => {
    presence.remove.mockResolvedValue(0);
    presence.getLastSeen.mockResolvedValue("2024-01-01T00:00:00.000Z");

    const aliceSocket = await connectSocket(testServer.url, tokenFor("alice"));
    const bobSocket   = await connectSocket(testServer.url, tokenFor("bob"));

    // Both join the same conversation room
    aliceSocket.emit("conversation:join", "conv-1");
    bobSocket.emit("conversation:join", "conv-1");
    await new Promise((r) => setTimeout(r, 150));

    const offlinePromise = waitForEvent(bobSocket, "user:offline");

    aliceSocket.disconnect();

    const payload = await offlinePromise;
    expect(payload.userId).toBe(USERS.alice.id);
    expect(payload.lastSeenAt).toBe("2024-01-01T00:00:00.000Z");

    bobSocket.disconnect();
    await new Promise((r) => setTimeout(r, 50));
  });
});
