const { Server } = require("socket.io");
const socketAuth = require("../middleware/socketAuth");
const registerSocketHandlers = require("../sockets");

let io;

// Dedicated pub/sub clients for the Redis adapter.
// Exported so index.js can close them on graceful shutdown.
let adapterPub = null;
let adapterSub = null;

function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin:      process.env.CLIENT_ORIGIN || "http://localhost:5173",
      methods:     ["GET", "POST"],
      credentials: true,
    },
  });

  // ── Redis adapter (multi-instance broadcasting) ───────────────────────────
  // When REDIS_URL is set, every io.to(...).emit() and socket.to(...).emit()
  // is relayed through Redis pub/sub, so all server instances receive the event
  // and forward it to their locally-connected sockets.
  //
  // If Redis is unavailable, we fall back to the default in-memory adapter,
  // which works correctly for a single-instance deployment.
  if (process.env.REDIS_URL) {
    try {
      const { createAdapter } = require("@socket.io/redis-adapter");
      const { createClient }  = require("../lib/redis");

      // The adapter needs two separate Redis connections:
      // one for PUBLISH and one for SUBSCRIBE (Redis protocol requirement).
      adapterPub = createClient();
      adapterSub = adapterPub.duplicate();

      io.adapter(createAdapter(adapterPub, adapterSub));
      console.log("[socket] Redis adapter enabled — multi-instance broadcasting active");
    } catch (err) {
      console.warn(
        "[socket] Failed to initialize Redis adapter, falling back to in-memory:",
        err.message
      );
    }
  } else {
    console.log("[socket] Redis adapter disabled (REDIS_URL not set) — single-instance mode");
  }

  // Reject unauthenticated handshakes before any handler sees the socket
  io.use(socketAuth);

  registerSocketHandlers(io);

  return io;
}

function getIO() {
  if (!io) throw new Error("Socket.IO has not been initialized. Call initSocket first.");
  return io;
}

/** Called by graceful shutdown logic in index.js. */
async function closeAdapterClients() {
  const clients = [adapterPub, adapterSub].filter(Boolean);
  await Promise.all(clients.map((c) => c.quit().catch(() => {})));
}

module.exports = { initSocket, getIO, closeAdapterClients };
