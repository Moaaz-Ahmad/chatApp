/**
 * Presence store — tracks which users are online and on how many connections.
 *
 * ── Redis mode (production / multi-instance) ─────────────────────────────────
 *
 * Data structure: Sorted Set per user
 *   Key:    presence:{userId}
 *   Score:  Unix timestamp (ms) when this socket entry expires
 *   Member: socketId
 *
 * Why a ZSET instead of a plain SET?
 *   Scores act as per-entry TTLs. A socket that crashes without firing
 *   "disconnect" leaves a stale entry; the score lets us prune it with
 *   ZREMRANGEBYSCORE key -inf <now> before every read — no background job needed.
 *
 * Why not just a counter?
 *   We need to ZREM a specific socketId on disconnect, not decrement a counter.
 *   A counter has no way to tell whether a decrement is from a real disconnect
 *   or a double-fire.
 *
 * Heartbeat contract:
 *   Clients send "presence:heartbeat" every 30 s.
 *   Each heartbeat refreshes the ZSET entry score to now + SOCKET_TTL_MS (90 s).
 *   A socket that stops heartbeating (crash, network drop) naturally expires
 *   from the set after 90 s and will be pruned on next read.
 *
 * ── In-memory fallback (development, single instance) ────────────────────────
 *   Map<userId, Set<socketId>>  — no TTL, cleaned up on normal disconnect.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { redis } = require("./redis");

const SOCKET_TTL_MS  = 90_000;   // 90 s — must be > heartbeat interval (30 s)
const SOCKET_TTL_SEC = 90;
const LASTSEEN_TTL   = 30 * 24 * 60 * 60; // 30 days

const presenceKey  = (uid) => `presence:${uid}`;
const lastSeenKey  = (uid) => `lastSeen:${uid}`;

// ── In-memory fallback ────────────────────────────────────────────────────────
// Map<userId, Set<socketId>>
const localSockets = new Map();

function localAdd(userId, socketId) {
  if (!localSockets.has(userId)) localSockets.set(userId, new Set());
  localSockets.get(userId).add(socketId);
  return localSockets.get(userId).size;
}

function localRemove(userId, socketId) {
  const sockets = localSockets.get(userId);
  if (!sockets) return 0;
  sockets.delete(socketId);
  if (sockets.size === 0) localSockets.delete(userId);
  return sockets.size;
}

function localIsOnline(userId) {
  return (localSockets.get(userId)?.size ?? 0) > 0;
}

// ── Redis helpers ─────────────────────────────────────────────────────────────

async function redisAdd(userId, socketId) {
  const expiry = Date.now() + SOCKET_TTL_MS;
  const key    = presenceKey(userId);
  const pipe   = redis.pipeline();
  pipe.zadd(key, expiry, socketId);
  pipe.expire(key, SOCKET_TTL_SEC + 60); // key TTL = entry TTL + buffer
  await pipe.exec();
  // Return connection count after adding
  return redis.zcount(key, Date.now(), "+inf");
}

async function redisRemove(userId, socketId) {
  const key  = presenceKey(userId);
  const now  = Date.now();
  const pipe = redis.pipeline();
  pipe.zrem(key, socketId);
  pipe.zremrangebyscore(key, "-inf", now); // prune expired entries
  await pipe.exec();
  const count = await redis.zcount(key, now, "+inf");
  if (count === 0) {
    // No more live connections — record last-seen timestamp
    await redis.set(lastSeenKey(userId), new Date().toISOString(), "EX", LASTSEEN_TTL);
  }
  return count; // 0 = fully offline
}

async function redisRefresh(userId, socketId) {
  const expiry = Date.now() + SOCKET_TTL_MS;
  await redis.zadd(presenceKey(userId), expiry, socketId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

const presence = {
  /**
   * Register a new socket connection.
   * Returns the number of active connections for this user after adding.
   */
  async add(userId, socketId) {
    if (!redis) return localAdd(userId, socketId);
    return redisAdd(userId, socketId).catch((err) => {
      console.error("[presence.add]", err.message);
      return localAdd(userId, socketId); // fallback on Redis error
    });
  },

  /**
   * Unregister a socket connection.
   * Returns the remaining connection count (0 = user is now fully offline).
   */
  async remove(userId, socketId) {
    if (!redis) return localRemove(userId, socketId);
    return redisRemove(userId, socketId).catch((err) => {
      console.error("[presence.remove]", err.message);
      return localRemove(userId, socketId);
    });
  },

  /**
   * Refresh the TTL of an existing socket entry (called on heartbeat).
   */
  async refresh(userId, socketId) {
    if (!redis) return; // in-memory has no TTL
    return redisRefresh(userId, socketId).catch((err) =>
      console.error("[presence.refresh]", err.message)
    );
  },

  /**
   * Check if a single user has any live connections.
   */
  async isOnline(userId) {
    if (!redis) return localIsOnline(userId);
    try {
      const count = await redis.zcount(presenceKey(userId), Date.now(), "+inf");
      return count > 0;
    } catch (err) {
      console.error("[presence.isOnline]", err.message);
      return localIsOnline(userId);
    }
  },

  /**
   * Batch-check online status for a list of user IDs.
   * Returns a Map<userId, boolean>.
   *
   * Uses a single Redis pipeline — O(1) round trips regardless of list size.
   */
  async getOnlineStatuses(userIds) {
    if (userIds.length === 0) return new Map();

    if (!redis) {
      return new Map(userIds.map((uid) => [uid, localIsOnline(uid)]));
    }

    try {
      const now  = Date.now();
      const pipe = redis.pipeline();
      for (const uid of userIds) {
        pipe.zcount(presenceKey(uid), now, "+inf");
      }
      const results = await pipe.exec();
      return new Map(
        userIds.map((uid, i) => [uid, (results[i][1] ?? 0) > 0])
      );
    } catch (err) {
      console.error("[presence.getOnlineStatuses]", err.message);
      return new Map(userIds.map((uid) => [uid, localIsOnline(uid)]));
    }
  },

  /**
   * Retrieve the ISO timestamp of when a user was last seen online.
   * Returns null if not available.
   */
  async getLastSeen(userId) {
    if (!redis) return null;
    return redis.get(lastSeenKey(userId)).catch(() => null);
  },
};

module.exports = presence;
