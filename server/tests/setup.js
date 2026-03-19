/**
 * Loaded by Jest via setupFiles — runs before any test module is required.
 *
 * Set all environment variables here so modules like utils/jwt.js that throw
 * at load-time (if secrets are missing) are safe to import in tests.
 */

process.env.NODE_ENV          = "test";
process.env.JWT_ACCESS_SECRET  = "test-access-secret-that-is-at-least-32-characters";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-that-is-at-least-32-characters";

// Prevent ioredis from attempting a real connection; presence/typing fall back
// to their in-memory implementations when REDIS_URL is absent.
delete process.env.REDIS_URL;

// Suppress Prisma query-level logs in test output
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/chatapp_test";
