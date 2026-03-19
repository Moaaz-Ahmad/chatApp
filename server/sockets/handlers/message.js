const { createMessage, markDelivered, markRead } = require("../../controllers/messageController");
const { verifyMembership } = require("../../controllers/conversationController");

/**
 * Handles real-time message events.
 * @param {import("socket.io").Server} io
 * @param {import("socket.io").Socket} socket
 */
function messageHandler(io, socket) {

  // ── message:send ──────────────────────────────────────────────────────────
  socket.on("message:send", async (payload, ack) => {
    try {
      const { conversationId, content, type = "TEXT", attachments = [], replyToId, clientId } = payload;
      const senderId = socket.data.userId;

      if (!senderId) {
        return ack?.({ ok: false, error: "Not authenticated" });
      }
      if (!conversationId || (!content?.trim() && attachments.length === 0)) {
        return ack?.({ ok: false, error: "Invalid payload" });
      }

      // Security: confirm the sender is actually a member before persisting
      const member = await verifyMembership(conversationId, senderId);
      if (!member) {
        return ack?.({ ok: false, error: "Not a member of this conversation" });
      }

      const message = await createMessage({
        conversationId,
        senderId,
        type,
        content: content?.trim() ?? null,
        replyToId: replyToId ?? null,
        attachments,
      });

      // Attach clientId so the sender can match the optimistic copy
      const outbound = { ...message, clientId };

      // Deliver to all OTHER members — sender confirms via ack only
      socket.to(`conversation:${conversationId}`).emit("message:new", outbound);

      ack?.({ ok: true, message: outbound });
    } catch (err) {
      console.error("[message:send]", err);
      ack?.({ ok: false, error: "Internal server error" });
    }
  });

  // ── message:delivered ─────────────────────────────────────────────────────
  socket.on("message:delivered", async ({ messageId, senderId, conversationId }) => {
    if (!messageId || !senderId) return;

    try {
      await markDelivered(messageId);
    } catch (err) {
      console.error("[message:delivered] db:", err.message);
    }

    // Always relay even if DB update was a no-op (idempotent for client)
    io.to(`user:${senderId}`).emit("message:delivered", {
      messageId,
      conversationId,
      deliveredAt: new Date().toISOString(),
    });
  });

  // ── message:read ──────────────────────────────────────────────────────────
  socket.on("message:read", async ({ messageId, senderId, conversationId }) => {
    const readerId = socket.data.userId;
    if (!messageId || !readerId) return;

    try {
      await markRead({ messageId, userId: readerId });
    } catch (err) {
      console.error("[message:read] db:", err.message);
    }

    io.to(`conversation:${conversationId}`).emit("message:read", {
      messageId,
      conversationId,
      readerId,
      readAt: new Date().toISOString(),
    });
  });
}

module.exports = messageHandler;
