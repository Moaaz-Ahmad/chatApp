/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",

  // Load env vars + mocks before any test module is required
  setupFiles: ["<rootDir>/tests/setup.js"],

  testMatch: ["<rootDir>/tests/**/*.test.js"],

  // Each test file gets an isolated module registry so mock state never leaks
  clearMocks:   true,  // clear mock.calls / mock.instances between tests
  resetMocks:   false, // do NOT reset return values (set in beforeEach)
  restoreMocks: false,

  // Reasonable timeout for socket connection tests
  testTimeout: 10_000,

  // Force-exit after all tests finish so ioredis reconnect timers don't hang
  forceExit: true,

  collectCoverageFrom: [
    "**/*.js",
    "!**/node_modules/**",
    "!**/tests/**",
    "!index.js",         // entry point — covered by integration tests
    "!jest.config.js",
  ],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov"],
};
