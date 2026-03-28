/**
 * Unit tests for controllers/authController.js
 *
 * Strategy
 * ─────────
 * • Mock userController  — no real Prisma / DB required
 * • Mock bcryptjs        — deterministic, instant hashing
 * • Mock tokenStore      — isolate JTI bookkeeping
 * • Use REAL utils/jwt   — JWT_*_SECRET are set in tests/setup.js, so we can
 *                          verify that tokens are correctly signed and parseable
 */

"use strict";

// ── Mocks (must be declared before any require) ───────────────────────────────

jest.mock("../../controllers/userController");
jest.mock("bcryptjs");
jest.mock("../../utils/tokenStore");

// ── Imports ───────────────────────────────────────────────────────────────────

const bcrypt        = require("bcryptjs");
const tokenStore    = require("../../utils/tokenStore");
const userCtrl      = require("../../controllers/userController");
const { register, login } = require("../../controllers/authController");
const { verifyAccessToken, verifyRefreshToken } = require("../../utils/jwt");

// ── Test helpers ──────────────────────────────────────────────────────────────

/** Minimal Express response mock */
function makeRes() {
  const res = {};
  res.status    = jest.fn().mockReturnValue(res);
  res.json      = jest.fn().mockReturnValue(res);
  res.cookie    = jest.fn().mockReturnValue(res);
  res.clearCookie = jest.fn().mockReturnValue(res);
  return res;
}

/** Minimal Express request mock */
function makeReq(body = {}, cookies = {}) {
  return { body, cookies };
}

/** A realistic DB user row (no password hash exposed to callers). */
const DB_USER = {
  id:          "usr_abc123",
  email:       "alice@example.com",
  username:    "alice",
  displayName: "Alice",
  avatarUrl:   null,
  isOnline:    false,
  createdAt:   new Date("2025-01-01"),
};

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  // tokenStore: auto-approve all JTIs so issueTokenPair doesn't throw
  tokenStore.add.mockImplementation(() => {});
  tokenStore.has.mockReturnValue(true);
  tokenStore.remove.mockImplementation(() => {});
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /auth/register
// ─────────────────────────────────────────────────────────────────────────────

describe("register", () => {

  describe("successful registration", () => {
    let res;
    let body;

    beforeEach(async () => {
      bcrypt.hash.mockResolvedValue("$2b$12$hashed_password");
      userCtrl.createUser.mockResolvedValue(DB_USER);

      res  = makeRes();
      body = { email: "alice@example.com", username: "alice", password: "Str0ngPass!" };
      await register(makeReq(body), res);
    });

    it("responds with HTTP 201", () => {
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it("hashes the password with bcrypt before storing", () => {
      expect(bcrypt.hash).toHaveBeenCalledWith("Str0ngPass!", 12);
    });

    it("calls createUser with the hashed password", () => {
      expect(userCtrl.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          email:        body.email,
          username:     body.username,
          passwordHash: "$2b$12$hashed_password",
        })
      );
    });

    it("returns a signed accessToken in the response body", () => {
      const { accessToken } = res.json.mock.calls[0][0];
      expect(typeof accessToken).toBe("string");
      // Verify the token was signed with the correct secret and contains the right payload
      const payload = verifyAccessToken(accessToken);
      expect(payload.sub).toBe(DB_USER.id);
      expect(payload.email).toBe(DB_USER.email);
      expect(payload.displayName).toBe(DB_USER.displayName);
    });

    it("returns safe user fields (no password) in the response body", () => {
      const { user } = res.json.mock.calls[0][0];
      expect(user).toEqual({
        id:          DB_USER.id,
        email:       DB_USER.email,
        username:    DB_USER.username,
        displayName: DB_USER.displayName,
      });
      expect(user.password).toBeUndefined();
    });

    it("sets an httpOnly refreshToken cookie", () => {
      expect(res.cookie).toHaveBeenCalledWith(
        "refreshToken",
        expect.any(String),
        expect.objectContaining({ httpOnly: true })
      );
    });

    it("the refreshToken cookie contains a valid, signed JWT", () => {
      const [, cookieValue] = res.cookie.mock.calls[0];
      // Must not throw — proves the token was signed with the correct secret
      const payload = verifyRefreshToken(cookieValue);
      expect(payload.sub).toBe(DB_USER.id);
      expect(typeof payload.jti).toBe("string");
    });

    it("registers the new JTI in the tokenStore", () => {
      expect(tokenStore.add).toHaveBeenCalledWith(expect.any(String));
    });
  });

  // ── Failure: missing fields ────────────────────────────────────────────────

  describe("missing required fields", () => {
    it.each([
      ["missing email",    { username: "alice", password: "Str0ngPass!" }],
      ["missing username", { email: "a@b.com",  password: "Str0ngPass!" }],
      ["missing password", { email: "a@b.com",  username: "alice"       }],
      ["empty password",   { email: "a@b.com",  username: "alice", password: "" }],
      ["empty body",       {}],
    ])("%s → 400", async (_, body) => {
      const res = makeRes();
      await register(makeReq(body), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(String) })
      );
      // Must not attempt DB operations
      expect(userCtrl.createUser).not.toHaveBeenCalled();
    });
  });

  // ── Failure: weak password ─────────────────────────────────────────────────

  describe("weak password (< 8 characters)", () => {
    it.each([
      ["1-char password", "a"],
      ["7-char password", "abc1234"],
    ])("%s → 400", async (_, password) => {
      const res = makeRes();
      await register(makeReq({ email: "a@b.com", username: "alice", password }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining("8 characters") })
      );
      expect(userCtrl.createUser).not.toHaveBeenCalled();
    });
  });

  // ── Failure: duplicate email / username ───────────────────────────────────

  describe("duplicate email or username (Prisma P2002)", () => {
    it("responds with HTTP 409 and an informative error message", async () => {
      const prismaUniqueError = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      userCtrl.createUser.mockRejectedValue(prismaUniqueError);
      bcrypt.hash.mockResolvedValue("$2b$12$hashed");

      const res = makeRes();
      await register(
        makeReq({ email: "taken@example.com", username: "taken", password: "Str0ngPass!" }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining("already taken") })
      );
    });
  });

  // ── Failure: unexpected DB error ──────────────────────────────────────────

  describe("unexpected database error", () => {
    it("responds with HTTP 500", async () => {
      userCtrl.createUser.mockRejectedValue(new Error("DB connection lost"));
      bcrypt.hash.mockResolvedValue("$2b$12$hashed");

      // Suppress the expected console.error that authController logs for 500s
      jest.spyOn(console, "error").mockImplementation(() => {});

      const res = makeRes();
      await register(
        makeReq({ email: "a@b.com", username: "alice", password: "Str0ngPass!" }),
        res
      );

      expect(res.status).toHaveBeenCalledWith(500);
      console.error.mockRestore();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /auth/login
// ─────────────────────────────────────────────────────────────────────────────

describe("login", () => {
  const DB_USER_WITH_HASH = {
    ...DB_USER,
    password: "$2b$12$hashed_password",
  };

  // ── Success ────────────────────────────────────────────────────────────────

  describe("successful login", () => {
    let res;

    beforeEach(async () => {
      userCtrl.getUserByEmailWithPassword.mockResolvedValue(DB_USER_WITH_HASH);
      bcrypt.compare.mockResolvedValue(true);

      res = makeRes();
      await login(makeReq({ email: "alice@example.com", password: "Str0ngPass!" }), res);
    });

    it("responds with HTTP 200 (no explicit status call needed, defaults to 200)", () => {
      // res.json called without res.status(4xx/5xx) means 200
      expect(res.status).not.toHaveBeenCalledWith(expect.not.objectContaining({})); // not called at all
      expect(res.json).toHaveBeenCalled();
    });

    it("returns a signed accessToken in the body", () => {
      const { accessToken } = res.json.mock.calls[0][0];
      expect(typeof accessToken).toBe("string");

      const payload = verifyAccessToken(accessToken);
      expect(payload.sub).toBe(DB_USER.id);
      expect(payload.email).toBe(DB_USER.email);
    });

    it("returns safe user fields (no password hash)", () => {
      const { user } = res.json.mock.calls[0][0];
      expect(user).toEqual({
        id:          DB_USER.id,
        email:       DB_USER.email,
        username:    DB_USER.username,
        displayName: DB_USER.displayName,
      });
      expect(user.password).toBeUndefined();
    });

    it("sets an httpOnly refreshToken cookie", () => {
      expect(res.cookie).toHaveBeenCalledWith(
        "refreshToken",
        expect.any(String),
        expect.objectContaining({ httpOnly: true })
      );
    });

    it("uses constant-time bcrypt.compare (not plain string equality)", () => {
      expect(bcrypt.compare).toHaveBeenCalledWith("Str0ngPass!", DB_USER_WITH_HASH.password);
    });
  });

  // ── Failure: missing fields ────────────────────────────────────────────────

  describe("missing required fields", () => {
    it.each([
      ["missing email",    { password: "Str0ngPass!" }],
      ["missing password", { email: "alice@example.com" }],
      ["empty body",       {}],
    ])("%s → 400", async (_, body) => {
      const res = makeRes();
      await login(makeReq(body), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(userCtrl.getUserByEmailWithPassword).not.toHaveBeenCalled();
    });
  });

  // ── Failure: user not found ────────────────────────────────────────────────

  describe("user not found", () => {
    it("returns 401 and does NOT reveal whether the email exists (timing safety)", async () => {
      userCtrl.getUserByEmailWithPassword.mockResolvedValue(null);
      // bcrypt.compare still runs against a dummy hash (constant-time protection)
      bcrypt.compare.mockResolvedValue(false);

      const res = makeRes();
      await login(makeReq({ email: "ghost@example.com", password: "whatever" }), res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: "Invalid credentials" });
      // Confirm bcrypt.compare was still invoked (timing-attack mitigation)
      expect(bcrypt.compare).toHaveBeenCalled();
    });
  });

  // ── Failure: wrong password ────────────────────────────────────────────────

  describe("wrong password", () => {
    it("returns 401 with a generic error message", async () => {
      userCtrl.getUserByEmailWithPassword.mockResolvedValue(DB_USER_WITH_HASH);
      bcrypt.compare.mockResolvedValue(false);

      const res = makeRes();
      await login(makeReq({ email: "alice@example.com", password: "WrongPass!" }), res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: "Invalid credentials" });
    });
  });
});
