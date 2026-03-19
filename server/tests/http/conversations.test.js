/**
 * Integration tests — GET|POST|DELETE /conversations/*
 *
 * The real authenticate middleware + JWT verification run.
 * Prisma-backed controllers are mocked.
 */

const supertest = require("supertest");
const app       = require("../../app");

const { tokenFor, USERS, makeConversation, makeMessage } = require("../helpers/auth");

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock("../../controllers/conversationController");
jest.mock("../../controllers/messageController");

const convCtrl = require("../../controllers/conversationController");
const msgCtrl  = require("../../controllers/messageController");

// ── Helpers ───────────────────────────────────────────────────────────────────

const request      = supertest(app);
const aliceToken   = tokenFor("alice");
const authHeader   = (token) => ({ Authorization: `Bearer ${token}` });

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /conversations", () => {
  test("401 — no token", async () => {
    const res = await request.get("/conversations");
    expect(res.status).toBe(401);
  });

  test("401 — malformed token", async () => {
    const res = await request
      .get("/conversations")
      .set("Authorization", "Bearer not.a.token");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TOKEN_INVALID");
  });

  test("200 — returns conversations for authenticated user", async () => {
    const conv = makeConversation();
    convCtrl.getUserConversations.mockResolvedValue([conv]);

    const res = await request
      .get("/conversations")
      .set(authHeader(aliceToken));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(conv.id);
    expect(convCtrl.getUserConversations).toHaveBeenCalledWith(USERS.alice.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("GET /conversations/:id", () => {
  test("200 — member gets conversation details", async () => {
    const conv = makeConversation({ id: "conv-abc" });
    convCtrl.verifyMembership.mockResolvedValue({ userId: USERS.alice.id });
    convCtrl.getConversationById.mockResolvedValue(conv);

    const res = await request
      .get("/conversations/conv-abc")
      .set(authHeader(aliceToken));

    expect(res.status).toBe(200);
    expect(res.body.id).toBe("conv-abc");
  });

  test("403 — non-member is rejected", async () => {
    convCtrl.verifyMembership.mockResolvedValue(null);

    const res = await request
      .get("/conversations/conv-abc")
      .set(authHeader(aliceToken));

    expect(res.status).toBe(403);
  });

  test("404 — conversation does not exist", async () => {
    convCtrl.verifyMembership.mockResolvedValue({ userId: USERS.alice.id });
    convCtrl.getConversationById.mockResolvedValue(null);

    const res = await request
      .get("/conversations/conv-missing")
      .set(authHeader(aliceToken));

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("GET /conversations/:id/messages", () => {
  beforeEach(() => {
    convCtrl.verifyMembership.mockResolvedValue({ userId: USERS.alice.id });
  });

  test("200 — returns paginated messages", async () => {
    const msgs = [makeMessage(), makeMessage({ id: "msg-2" })];
    msgCtrl.getMessages.mockResolvedValue(msgs);

    const res = await request
      .get("/conversations/conv-1/messages?limit=10")
      .set(authHeader(aliceToken));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(msgCtrl.getMessages).toHaveBeenCalledWith(
      "conv-1",
      expect.objectContaining({ limit: "10" })
    );
  });

  test("403 — non-member cannot read messages", async () => {
    convCtrl.verifyMembership.mockResolvedValue(null);

    const res = await request
      .get("/conversations/conv-1/messages")
      .set(authHeader(aliceToken));

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("POST /conversations", () => {
  test("201 — creates a new DIRECT conversation", async () => {
    const conv = makeConversation({ type: "DIRECT" });
    convCtrl.createDirectConversation.mockResolvedValue({ conversation: conv, created: true });

    const res = await request
      .post("/conversations")
      .set(authHeader(aliceToken))
      .send({ type: "DIRECT", targetUserId: USERS.bob.id });

    expect(res.status).toBe(201);
    expect(convCtrl.createDirectConversation).toHaveBeenCalledWith(
      USERS.alice.id,
      USERS.bob.id
    );
  });

  test("200 — returns existing DIRECT conversation (idempotent)", async () => {
    const conv = makeConversation({ type: "DIRECT" });
    convCtrl.createDirectConversation.mockResolvedValue({ conversation: conv, created: false });

    const res = await request
      .post("/conversations")
      .set(authHeader(aliceToken))
      .send({ type: "DIRECT", targetUserId: USERS.bob.id });

    expect(res.status).toBe(200);
  });

  test("400 — DIRECT without targetUserId", async () => {
    const res = await request
      .post("/conversations")
      .set(authHeader(aliceToken))
      .send({ type: "DIRECT" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/targetUserId/i);
  });

  test("201 — creates a GROUP conversation", async () => {
    const conv = makeConversation({ type: "GROUP", name: "Team Chat" });
    convCtrl.createGroupConversation.mockResolvedValue(conv);

    const res = await request
      .post("/conversations")
      .set(authHeader(aliceToken))
      .send({ type: "GROUP", name: "Team Chat", memberIds: [USERS.bob.id, USERS.carol.id] });

    expect(res.status).toBe(201);
    expect(convCtrl.createGroupConversation).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Team Chat", creatorId: USERS.alice.id })
    );
  });

  test("400 — GROUP without name", async () => {
    const res = await request
      .post("/conversations")
      .set(authHeader(aliceToken))
      .send({ type: "GROUP", memberIds: [USERS.bob.id] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name is required/i);
  });

  test("400 — GROUP with empty memberIds", async () => {
    const res = await request
      .post("/conversations")
      .set(authHeader(aliceToken))
      .send({ type: "GROUP", name: "Empty", memberIds: [] });

    expect(res.status).toBe(400);
  });

  test("400 — unknown type", async () => {
    const res = await request
      .post("/conversations")
      .set(authHeader(aliceToken))
      .send({ type: "UNKNOWN" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/DIRECT or GROUP/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("DELETE /conversations/:id/members/me", () => {
  test("200 — member can leave a conversation", async () => {
    convCtrl.verifyMembership.mockResolvedValue({ userId: USERS.alice.id });
    convCtrl.leaveConversation.mockResolvedValue(undefined);

    const res = await request
      .delete("/conversations/conv-1/members/me")
      .set(authHeader(aliceToken));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(convCtrl.leaveConversation).toHaveBeenCalledWith("conv-1", USERS.alice.id);
  });

  test("403 — non-member cannot leave", async () => {
    convCtrl.verifyMembership.mockResolvedValue(null);

    const res = await request
      .delete("/conversations/conv-1/members/me")
      .set(authHeader(aliceToken));

    expect(res.status).toBe(403);
  });
});
