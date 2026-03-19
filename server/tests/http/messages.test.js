/**
 * Integration tests — PATCH|DELETE /messages/:id
 *
 * The route uses prisma.message.findUnique directly (before delegating to
 * messageController), so prisma is mocked alongside the controllers.
 */

const supertest = require("supertest");
const app       = require("../../app");

const { tokenFor, USERS, makeMessage } = require("../helpers/auth");

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock("../../lib/prisma", () => ({
  message: {
    findUnique: jest.fn(),
  },
  $disconnect: jest.fn(),
}));
jest.mock("../../controllers/conversationController");
jest.mock("../../controllers/messageController");

const prisma    = require("../../lib/prisma");
const convCtrl  = require("../../controllers/conversationController");
const msgCtrl   = require("../../controllers/messageController");

// ── Helpers ───────────────────────────────────────────────────────────────────

const request    = supertest(app);
const aliceToken = tokenFor("alice");
const authHeader = (token) => ({ Authorization: `Bearer ${token}` });

// ─────────────────────────────────────────────────────────────────────────────

describe("PATCH /messages/:id", () => {
  beforeEach(() => {
    // Default: message exists, Alice is the sender, and she's a member
    prisma.message.findUnique.mockResolvedValue({
      conversationId: "conv-1",
      senderId:       USERS.alice.id,
    });
    convCtrl.verifyMembership.mockResolvedValue({ userId: USERS.alice.id });
  });

  test("200 — owner can edit their message", async () => {
    const updated = makeMessage({ content: "Edited content" });
    msgCtrl.editMessage.mockResolvedValue(updated);

    const res = await request
      .patch("/messages/msg-1")
      .set(authHeader(aliceToken))
      .send({ content: "Edited content" });

    expect(res.status).toBe(200);
    expect(res.body.content).toBe("Edited content");
    expect(msgCtrl.editMessage).toHaveBeenCalledWith({
      messageId: "msg-1",
      senderId:  USERS.alice.id,
      content:   "Edited content",
    });
  });

  test("400 — empty content is rejected", async () => {
    const res = await request
      .patch("/messages/msg-1")
      .set(authHeader(aliceToken))
      .send({ content: "   " });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/content is required/i);
  });

  test("404 — message does not exist", async () => {
    prisma.message.findUnique.mockResolvedValue(null);

    const res = await request
      .patch("/messages/msg-ghost")
      .set(authHeader(aliceToken))
      .send({ content: "Hello" });

    expect(res.status).toBe(404);
  });

  test("403 — non-member cannot edit a message in the conversation", async () => {
    convCtrl.verifyMembership.mockResolvedValue(null);

    const res = await request
      .patch("/messages/msg-1")
      .set(authHeader(aliceToken))
      .send({ content: "Hello" });

    expect(res.status).toBe(403);
  });

  test("403 — member cannot edit another user's message", async () => {
    // editMessage returns null when senderId doesn't match
    msgCtrl.editMessage.mockResolvedValue(null);

    const res = await request
      .patch("/messages/msg-1")
      .set(authHeader(aliceToken))
      .send({ content: "Not my message" });

    expect(res.status).toBe(403);
  });

  test("401 — request without token is rejected", async () => {
    const res = await request
      .patch("/messages/msg-1")
      .send({ content: "No token" });

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("DELETE /messages/:id", () => {
  beforeEach(() => {
    prisma.message.findUnique.mockResolvedValue({
      conversationId: "conv-1",
      senderId:       USERS.alice.id,
    });
    convCtrl.verifyMembership.mockResolvedValue({ userId: USERS.alice.id });
  });

  test("200 — owner can soft-delete their message", async () => {
    msgCtrl.softDeleteMessage.mockResolvedValue({ id: "msg-1", isDeleted: true });

    const res = await request
      .delete("/messages/msg-1")
      .set(authHeader(aliceToken));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(msgCtrl.softDeleteMessage).toHaveBeenCalledWith({
      messageId: "msg-1",
      senderId:  USERS.alice.id,
    });
  });

  test("404 — message not found", async () => {
    prisma.message.findUnique.mockResolvedValue(null);

    const res = await request
      .delete("/messages/msg-ghost")
      .set(authHeader(aliceToken));

    expect(res.status).toBe(404);
  });

  test("403 — cannot delete another user's message", async () => {
    msgCtrl.softDeleteMessage.mockResolvedValue(null);

    const res = await request
      .delete("/messages/msg-1")
      .set(authHeader(aliceToken));

    expect(res.status).toBe(403);
  });

  test("403 — non-member is rejected before ownership check", async () => {
    convCtrl.verifyMembership.mockResolvedValue(null);

    const res = await request
      .delete("/messages/msg-1")
      .set(authHeader(aliceToken));

    expect(res.status).toBe(403);
  });
});
