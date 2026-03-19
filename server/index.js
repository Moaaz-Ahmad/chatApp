require("dotenv").config();

const http = require("http");
const app  = require("./app");
const { initSocket, closeAdapterClients } = require("./config/socket");
const { redis } = require("./lib/redis");
const prisma = require("./lib/prisma");

const PORT = process.env.PORT || 3000;

const server = http.createServer(app);
initSocket(server);

server.listen(PORT, () => {
  console.log(`[server] running on port ${PORT} (${process.env.NODE_ENV ?? "development"})`);
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
// On SIGTERM (Docker/Kubernetes stop) or SIGINT (Ctrl+C):
//  1. Stop accepting new HTTP connections
//  2. Wait for in-flight requests to complete (server.close)
//  3. Flush and close Socket.IO Redis adapter pub/sub clients
//  4. Close the general-purpose Redis client
//  5. Disconnect Prisma (returns pool connections to Postgres)

async function shutdown(signal) {
  console.log(`\n[server] received ${signal} — shutting down gracefully…`);

  server.close(async () => {
    try {
      await closeAdapterClients();
      if (redis) await redis.quit();
      await prisma.$disconnect();
      console.log("[server] all connections closed, exiting.");
    } catch (err) {
      console.error("[server] error during shutdown:", err.message);
    } finally {
      process.exit(0);
    }
  });

  // Force-exit if graceful shutdown takes longer than 10 s
  setTimeout(() => {
    console.error("[server] shutdown timeout — forcing exit");
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
