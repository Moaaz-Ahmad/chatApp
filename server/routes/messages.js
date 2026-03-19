const { Router } = require("express");
const authenticate = require("../middleware/authenticate");
const { verifyMembership } = require("../controllers/conversationController");
const { editMessage, softDeleteMessage } = require("../controllers/messageController");
const prisma = require("../lib/prisma");

const router = Router();

router.use(authenticate);

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /messages/:id  — edit own message
// Body: { content: string }
// ─────────────────────────────────────────────────────────────────────────────
router.patch("/:id", async (req, res) => {
  try {
    const { content } = req.body ?? {};
    if (!content?.trim()) return res.status(400).json({ error: "content is required" });

    // Resolve conversationId for the membership check
    const msg = await prisma.message.findUnique({
      where:  { id: req.params.id },
      select: { conversationId: true, senderId: true },
    });
    if (!msg) return res.status(404).json({ error: "Message not found" });

    const member = await verifyMembership(msg.conversationId, req.user.sub);
    if (!member) return res.status(403).json({ error: "Forbidden" });

    const updated = await editMessage({
      messageId: req.params.id,
      senderId:  req.user.sub,
      content:   content.trim(),
    });

    if (!updated) return res.status(403).json({ error: "Cannot edit this message" });

    res.json(updated);
  } catch (err) {
    console.error("[PATCH /messages/:id]", err);
    res.status(500).json({ error: "Failed to edit message" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /messages/:id  — soft-delete own message
// ─────────────────────────────────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  try {
    const msg = await prisma.message.findUnique({
      where:  { id: req.params.id },
      select: { conversationId: true, senderId: true },
    });
    if (!msg) return res.status(404).json({ error: "Message not found" });

    const member = await verifyMembership(msg.conversationId, req.user.sub);
    if (!member) return res.status(403).json({ error: "Forbidden" });

    const deleted = await softDeleteMessage({
      messageId: req.params.id,
      senderId:  req.user.sub,
    });

    if (!deleted) return res.status(403).json({ error: "Cannot delete this message" });

    res.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /messages/:id]", err);
    res.status(500).json({ error: "Failed to delete message" });
  }
});

module.exports = router;
