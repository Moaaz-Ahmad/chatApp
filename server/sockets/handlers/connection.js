const presence = require("../../lib/presence");
const typing   = require("../../lib/typing");
const { setOnlineStatus } = require("../../controllers/userController");

/**
 * Handles core connection lifecycle events.
 *
 * socket.data.userId / displayName are already set by socketAuth middleware.
 *
 * @param {import("socket.io").Server} io
 * @param {import("socket.io").Socket} socket
 */
function connectionHandler(io, socket) {
  const { userId, displayName } = socket.data;

  // Personal room — used for targeted server→client pushes (e.g. delivered receipts)
  socket.join(`user:${userId}`);

  // ── Register this socket in the presence store ────────────────────────────
  presence.add(userId, socket.id).then((connectionCount) => {
    console.log(
      `[socket] connected: ${displayName} (${userId}) — socket ${socket.id} ` +
      `(${connectionCount} active connection${connectionCount === 1 ? "" : "s"})`
    );

    // Only update DB and broadcast "online" for the FIRST connection.
    // Second tab opening should NOT re-announce — clients already know.
    if (connectionCount === 1) {
      setOnlineStatus(userId, true).catch((err) =>
        console.error(`[presence] setOnline DB failed for ${userId}:`, err.message)
      );
      // Notify personal room listeners (e.g. the user's own other tabs)
      socket.to(`user:${userId}`).emit("user:online", { userId });
    }
  }).catch((err) => {
    console.error(`[presence] add failed for ${userId}:`, err.message);
  });

  // ── Heartbeat ─────────────────────────────────────────────────────────────
  // Client sends this every 30 s to refresh the presence TTL (90 s).
  // If heartbeats stop (crash, network drop), the entry auto-expires after 90 s.
  socket.on("presence:heartbeat", () => {
    presence.refresh(userId, socket.id).catch((err) =>
      console.error(`[presence] refresh failed for ${userId}:`, err.message)
    );
  });

  // ── Disconnect ────────────────────────────────────────────────────────────
  // "disconnecting" fires while the socket is still in its rooms.
  // "disconnect" fires after leaveAll(), so rooms are already gone by then.
  let conversationRooms = [];
  socket.on("disconnecting", () => {
    conversationRooms = [...socket.rooms].filter((r) =>
      r.startsWith("conversation:")
    );
  });

  socket.on("disconnect", async (reason) => {

    // Remove this specific socket from the presence store.
    // remainingCount > 0 means the user still has other tabs/connections.
    const remainingCount = await presence.remove(userId, socket.id).catch((err) => {
      console.error(`[presence] remove failed for ${userId}:`, err.message);
      return -1; // unknown — assume offline to avoid stale state
    });

    const isFullyOffline = remainingCount <= 0;

    if (isFullyOffline) {
      const lastSeenAt = await presence.getLastSeen(userId) ?? new Date().toISOString();

      // Broadcast to every conversation room this socket was in
      conversationRooms.forEach((room) => {
        // socket.to() uses the Redis adapter when available,
        // so this reaches ALL instances' sockets in this room.
        socket.to(room).emit("user:offline", { userId, lastSeenAt });
      });

      // Persist offline state to DB (non-blocking, best-effort)
      setOnlineStatus(userId, false).catch((err) =>
        console.error(`[presence] setOffline DB failed for ${userId}:`, err.message)
      );

      // Clear any lingering typing indicators for this user
      conversationRooms.forEach((room) => {
        const conversationId = room.replace("conversation:", "");
        typing.stop(conversationId, userId).catch(() => {});
      });
    }

    console.log(
      `[socket] disconnected: ${displayName} (${userId}) — reason: ${reason} ` +
      `| remaining connections: ${remainingCount} | ${isFullyOffline ? "OFFLINE" : "still online"}`
    );
  });
}

module.exports = connectionHandler;
