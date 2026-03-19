const presence = require("../../lib/presence");
const typing   = require("../../lib/typing");
const { verifyMembership, getConversationById } = require("../../controllers/conversationController");

/**
 * Handles conversation room management events.
 * @param {import("socket.io").Server} io
 * @param {import("socket.io").Socket} socket
 */
function conversationHandler(io, socket) {

  // ── conversation:join ─────────────────────────────────────────────────────
  socket.on("conversation:join", async (conversationId) => {
    const userId = socket.data.userId;

    // Security: confirm membership before allowing room access
    const member = await verifyMembership(conversationId, userId).catch(() => null);
    if (!member) {
      socket.emit("error", { code: "FORBIDDEN", message: "Not a member of this conversation" });
      return;
    }

    socket.join(`conversation:${conversationId}`);

    // Announce this user's presence to the rest of the room
    socket.to(`conversation:${conversationId}`).emit("user:online", { userId });

    // ── Initial presence snapshot ───────────────────────────────────────────
    // Fetch all member user IDs and batch-query their online status so the
    // joining client knows who is already online without waiting for events.
    // Includes who is currently typing so late joiners aren't left in the dark.
    try {
      const conversation = await getConversationById(conversationId);
      const memberUserIds = (conversation?.members ?? []).map((m) => m.userId);

      const [onlineStatuses, typingUserIds] = await Promise.all([
        presence.getOnlineStatuses(memberUserIds),
        typing.getTypingUsers(conversationId),
      ]);

      const onlineUserIds = [...onlineStatuses.entries()]
        .filter(([, isOnline]) => isOnline)
        .map(([uid]) => uid);

      socket.emit("conversation:presence", {
        conversationId,
        onlineUserIds,
        typingUserIds,
      });
    } catch (err) {
      console.error(`[conversation:join] presence snapshot failed for ${conversationId}:`, err.message);
      // Not fatal — client will catch up via incremental user:online/offline events
    }

    console.log(`[socket] ${userId} joined conversation ${conversationId}`);
  });

  // ── conversation:leave ────────────────────────────────────────────────────
  socket.on("conversation:leave", (conversationId) => {
    socket.leave(`conversation:${conversationId}`);
    typing.stop(conversationId, socket.data.userId).catch(() => {});
    console.log(`[socket] ${socket.data.userId} left conversation ${conversationId}`);
  });

  // ── conversation:typing ───────────────────────────────────────────────────
  socket.on("conversation:typing", async ({ conversationId, isTyping }) => {
    const userId = socket.data.userId;

    // Persist typing state for late joiners, then relay to the room
    if (isTyping) {
      await typing.start(conversationId, userId).catch(() => {});
    } else {
      await typing.stop(conversationId, userId).catch(() => {});
    }

    socket.to(`conversation:${conversationId}`).emit("conversation:typing", {
      userId,
      conversationId,
      isTyping,
    });
  });
}

module.exports = conversationHandler;
