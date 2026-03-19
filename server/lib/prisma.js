const { PrismaClient } = require("@prisma/client");

/**
 * Singleton PrismaClient.
 *
 * Node.js module caching means this file is only evaluated once, so there
 * is only ever one PrismaClient instance — and therefore one connection pool —
 * regardless of how many files require it.
 *
 * The global assignment is an extra safety net for hot-reload environments
 * (e.g. nodemon) where the module cache can be cleared while the process stays
 * alive, which would otherwise create a new pool on every file-change.
 */

const globalForPrisma = global;

const prisma =
  globalForPrisma.__prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "warn", "error"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__prisma = prisma;
}

module.exports = prisma;
