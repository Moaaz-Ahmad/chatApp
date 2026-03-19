/**
 * Manual mock for lib/redis.js used in all socket integration tests.
 *
 * Prevents any real TCP connections to Redis during testing.
 * The null redis singleton makes presence.js and typing.js fall back
 * to their in-memory implementations automatically.
 */

// Throwing forces config/socket.js's try-catch to skip Redis adapter setup,
// so Socket.IO falls back to its in-memory adapter and broadcasts work in tests.
function makeClient() {
  throw new Error("Redis disabled in tests");
}

module.exports = {
  redis:        null,          // presence.js / typing.js fall back to in-memory
  createClient: jest.fn(makeClient),
};
