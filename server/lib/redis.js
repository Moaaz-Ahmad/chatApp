const Redis = require("ioredis");

/**
 * Creates a connected ioredis client.
 *
 * Options shared across all clients in this process:
 *  - maxRetriesPerRequest: 2  — fail fast on individual commands instead of
 *    blocking indefinitely; callers are responsible for graceful degradation.
 *  - enableReadyCheck: false  — start issuing commands immediately; don't wait
 *    for Redis to report "ready" (avoids startup delays).
 *  - reconnectOnError       — automatically reconnect after READONLY errors
 *    (needed when a Redis replica becomes the primary in failover scenarios).
 */
function createClient(url = process.env.REDIS_URL) {
  const client = new Redis(url, {
    // Don't attempt the TCP connection until the first command is issued.
    // This prevents an unreachable Redis from crashing the process at startup.
    lazyConnect: true,

    // Commands queued while disconnected are rejected immediately instead of
    // waiting forever. Callers (presence.js, typing.js) catch and fall back.
    enableOfflineQueue: false,

    maxRetriesPerRequest: 2,
    enableReadyCheck: false,
    reconnectOnError(err) {
      return err.message.includes("READONLY");
    },
  });

  client.on("connect",     () => console.log(`[redis] connected (${url?.split("@").pop() ?? "default"})`));
  client.on("error",       (err) => console.error("[redis] error:", err.message));
  client.on("reconnecting", () => console.warn("[redis] reconnecting…"));

  return client;
}

/**
 * Singleton general-purpose client — used by presence.js and typing.js.
 * null when REDIS_URL is not configured (single-instance dev mode).
 */
const redis = process.env.REDIS_URL ? createClient() : null;

if (!process.env.REDIS_URL) {
  console.warn(
    "[redis] REDIS_URL not set — running in single-instance mode. " +
    "Presence and cross-node broadcasting require Redis in production."
  );
}

module.exports = { redis, createClient };
