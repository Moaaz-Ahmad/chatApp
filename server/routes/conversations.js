const { Router } = require("express");
const authenticate = require("../middleware/authenticate");
const {
  getUserConversations,
  getConversationById,
  createDirectConversation,
  createGroupConversation,
  verifyMembership,
  leaveConversation,
} = require("../controllers/conversationController");
const { getMessages } = require("../controllers/messageController");

const router = Router();

// All routes require a valid access token
router.use(authenticate);

// ─────────────────────────────────────────────────────────────────────────────
// GET /conversations
// Returns all conversations for the authenticated user
// ─────────────────────────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const conversations = await getUserConversations(req.user.sub);
    res.json(conversations);
  } catch (err) {
    console.error("[GET /conversations]", err);
    res.status(500).json({ error: "Failed to fetch conversations" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /conversations/:id
// ─────────────────────────────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const member = await verifyMembership(req.params.id, req.user.sub);
    if (!member) return res.status(403).json({ error: "Not a member of this conversation" });

    const conversation = await getConversationById(req.params.id);
    if (!conversation) return res.status(404).json({ error: "Conversation not found" });

    res.json(conversation);
  } catch (err) {
    console.error("[GET /conversations/:id]", err);
    res.status(500).json({ error: "Failed to fetch conversation" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /conversations/:id/messages
// Cursor-based paginated message history
//   ?before=<ISO timestamp>   load messages older than this
//   ?after=<ISO timestamp>    load messages newer than this
//   ?limit=<number>           page size (default 30, max 100)
// ─────────────────────────────────────────────────────────────────────────────
router.get("/:id/messages", async (req, res) => {
  try {
    const member = await verifyMembership(req.params.id, req.user.sub);
    if (!member) return res.status(403).json({ error: "Not a member of this conversation" });

    const { before, after, limit } = req.query;
    const messages = await getMessages(req.params.id, { before, after, limit });
    res.json(messages);
  } catch (err) {
    console.error("[GET /conversations/:id/messages]", err);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /conversations
// Body: { type: "DIRECT", targetUserId } | { type: "GROUP", name, memberIds[] }
// ─────────────────────────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  try {
    const { type, targetUserId, name, description, memberIds } = req.body ?? {};

    if (type === "DIRECT") {
      if (!targetUserId) return res.status(400).json({ error: "targetUserId is required" });
      const { conversation, created } = await createDirectConversation(req.user.sub, targetUserId);
      return res.status(created ? 201 : 200).json(conversation);
    }

    if (type === "GROUP") {
      if (!name?.trim())  return res.status(400).json({ error: "name is required for group conversations" });
      if (!Array.isArray(memberIds) || memberIds.length === 0) {
        return res.status(400).json({ error: "memberIds must be a non-empty array" });
      }
      const conversation = await createGroupConversation({
        name: name.trim(),
        description,
        creatorId: req.user.sub,
        memberIds,
      });
      return res.status(201).json(conversation);
    }

    return res.status(400).json({ error: "type must be DIRECT or GROUP" });
  } catch (err) {
    console.error("[POST /conversations]", err);
    res.status(500).json({ error: "Failed to create conversation" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /conversations/:id/members/me  — leave a conversation
// ─────────────────────────────────────────────────────────────────────────────
router.delete("/:id/members/me", async (req, res) => {
  try {
    const member = await verifyMembership(req.params.id, req.user.sub);
    if (!member) return res.status(403).json({ error: "Not a member of this conversation" });

    await leaveConversation(req.params.id, req.user.sub);
    res.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /conversations/:id/members/me]", err);
    res.status(500).json({ error: "Failed to leave conversation" });
  }
});

module.exports = router;
