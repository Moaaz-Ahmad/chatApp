/**
 * Cross-instance typing indicator state.
 *
 * ── Why Redis for typing? ─────────────────────────────────────────────────────
 * Socket.IO's `socket.to(room).emit(...)` already propagates typing events
 * across instances via the Redis adapter. However, a user who joins a
 * conversation mid-stream would see nothing until the next keystroke.
 *
 * This module stores live typing state in Redis so that `conversation:join`
 * can include `typingUserIds` in the initial presence snapshot.
 *
 * ── Data structure ────────────────────────────────────────────────────────────
 * Hash per conversation, field per typing user:
 *   Key:   typing:{conversationId}
 *   Field: userId
 *   Value: Unix timestamp (ms) when this typing entry expires
 *
 * Redis HSET does not support per-field TTL, so we simulate it:
 *  - The hash key gets a PEXPIRE equal to the longest active entry.
 *  - On read, expired entries (value < Date.now()) are filtered out.
 *
 * ── In-memory fallback ────────────────────────────────────────────────────────
 * Map<conversationId, Map<userId, expiryMs>> — used when Redis is unavailable.
 */

const { redis } = require("./redis");

const TYPING_TTL_MS = 5_000; // auto-expire typing state after 5 s of no update

const typingKey = (convId) => `typing:${convId}`;

// ── In-memory fallback ────────────────────────────────────────────────────────
const localTyping = new Map(); // Map<convId, Map<userId, expiryMs>>

function localStart(conversationId, userId) {
  if (!localTyping.has(conversationId)) localTyping.set(conversationId, new Map());
  localTyping.get(conversationId).set(userId, Date.now() + TYPING_TTL_MS);
}

function localStop(conversationId, userId) {
  localTyping.get(conversationId)?.delete(userId);
}

function localGetTyping(conversationId) {
  const map = localTyping.get(conversationId);
  if (!map) return [];
  const now = Date.now();
  return [...map.entries()]
    .filter(([, exp]) => exp > now)
    .map(([uid]) => uid);
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

const typing = {
  /** Mark a user as actively typing in a conversation. */
  async start(conversationId, userId) {
    localStart(conversationId, userId); // always keep local in sync
    if (!redis) return;
    try {
      const expiry = Date.now() + TYPING_TTL_MS;
      await redis
        .pipeline()
        .hset(typingKey(conversationId), userId, expiry)
        .pexpire(typingKey(conversationId), TYPING_TTL_MS + 1_000)
        .exec();
    } catch (err) {
      console.error("[typing.start]", err.message);
    }
  },

  /** Clear a user's typing indicator. */
  async stop(conversationId, userId) {
    localStop(conversationId, userId);
    if (!redis) return;
    try {
      await redis.hdel(typingKey(conversationId), userId);
    } catch (err) {
      console.error("[typing.stop]", err.message);
    }
  },

  /**
   * Get all users currently typing in a conversation.
   * Expired entries (value < Date.now()) are filtered out.
   */
  async getTypingUsers(conversationId) {
    if (!redis) return localGetTyping(conversationId);
    try {
      const all = await redis.hgetall(typingKey(conversationId));
      if (!all) return [];
      const now = Date.now();
      return Object.entries(all)
        .filter(([, expiry]) => Number(expiry) > now)
        .map(([uid]) => uid);
    } catch (err) {
      console.error("[typing.getTypingUsers]", err.message);
      return localGetTyping(conversationId);
    }
  },
};

module.exports = typing;
