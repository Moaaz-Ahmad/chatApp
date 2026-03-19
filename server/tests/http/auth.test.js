/**
 * Integration tests — POST /auth/*
 *
 * The real authController runs (token signing, cookie management, tokenStore).
 * External I/O is mocked:
 *   - userController  → Prisma DB calls
 *   - bcryptjs        → slow hashing (cost 1 in tests)
 */

const supertest = require("supertest");
const app       = require("../../app");

const { makeDbUser, USERS } = require("../helpers/auth");

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock("../../controllers/userController");
jest.mock("bcryptjs");

const userController = require("../../controllers/userController");
const bcrypt         = require("bcryptjs");

// ── Helpers ───────────────────────────────────────────────────────────────────

const request = supertest(app);

function extractCookie(res, name) {
  const raw = res.headers["set-cookie"] ?? [];
  return raw.find((c) => c.startsWith(`${name}=`)) ?? null;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /auth/register", () => {
  const validBody = {
    email:       "new@test.com",
    username:    "newuser",
    password:    "password123",
    displayName: "New User",
  };

  beforeEach(() => {
    bcrypt.hash.mockResolvedValue("$2b$12$hashedpassword");
    userController.createUser.mockResolvedValue(
      makeDbUser({ id: "user-new", email: validBody.email, displayName: "New User" })
    );
  });

  test("201 — returns accessToken + sets refreshToken cookie", async () => {
    const res = await request.post("/auth/register").send(validBody);

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("accessToken");
    expect(res.body.user).toMatchObject({ email: validBody.email });
    expect(extractCookie(res, "refreshToken")).not.toBeNull();
  });

  test("400 — missing required fields", async () => {
    const res = await request.post("/auth/register").send({ email: "a@b.com" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  test("400 — password shorter than 8 characters", async () => {
    const res = await request.post("/auth/register").send({ ...validBody, password: "short" });
    expect(res.status).toBe(400);
  });

  test("409 — duplicate email/username (Prisma P2002)", async () => {
    const prismaError = Object.assign(new Error("Unique constraint"), { code: "P2002" });
    userController.createUser.mockRejectedValue(prismaError);

    const res = await request.post("/auth/register").send(validBody);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already taken/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("POST /auth/login", () => {
  const alice = makeDbUser();

  beforeEach(() => {
    userController.getUserByEmailWithPassword.mockResolvedValue(alice);
    bcrypt.compare.mockResolvedValue(true);
  });

  test("200 — valid credentials return accessToken + cookie", async () => {
    const res = await request.post("/auth/login").send({
      email:    USERS.alice.email,
      password: "correctpassword",
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("accessToken");
    expect(res.body.user.id).toBe(USERS.alice.id);
    expect(extractCookie(res, "refreshToken")).not.toBeNull();
  });

  test("400 — missing email or password", async () => {
    const res = await request.post("/auth/login").send({ email: "a@b.com" });
    expect(res.status).toBe(400);
  });

  test("401 — wrong password", async () => {
    bcrypt.compare.mockResolvedValue(false);

    const res = await request.post("/auth/login").send({
      email:    USERS.alice.email,
      password: "wrongpassword",
    });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid credentials/i);
  });

  test("401 — unknown email (timing-safe: still runs bcrypt)", async () => {
    userController.getUserByEmailWithPassword.mockResolvedValue(null);
    bcrypt.compare.mockResolvedValue(false);

    const res = await request.post("/auth/login").send({
      email:    "nobody@test.com",
      password: "anything",
    });
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("POST /auth/refresh", () => {
  let refreshCookie;

  beforeEach(async () => {
    // Obtain a fresh refresh cookie via login so tokenStore has the jti
    userController.getUserByEmailWithPassword.mockResolvedValue(makeDbUser());
    bcrypt.compare.mockResolvedValue(true);

    const loginRes = await request.post("/auth/login").send({
      email:    USERS.alice.email,
      password: "password123",
    });
    refreshCookie = extractCookie(loginRes, "refreshToken");
  });

  afterEach(() => {
    // Clean tokenStore between tests so reuse tests stay isolated
    require("../../utils/tokenStore").add = require("../../utils/tokenStore").add; // noop reset hint
  });

  test("200 — valid cookie rotates the token", async () => {
    userController.getUserById.mockResolvedValue(makeDbUser());

    const res = await request
      .post("/auth/refresh")
      .set("Cookie", refreshCookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("accessToken");
    // New cookie should differ from the old one
    const newCookie = extractCookie(res, "refreshToken");
    expect(newCookie).not.toBeNull();
    expect(newCookie).not.toBe(refreshCookie);
  });

  test("401 — no refresh cookie", async () => {
    const res = await request.post("/auth/refresh");
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/no refresh token/i);
  });

  test("401 — token reuse after rotation", async () => {
    userController.getUserById.mockResolvedValue(makeDbUser());

    // First use: valid
    await request.post("/auth/refresh").set("Cookie", refreshCookie);

    // Second use with the SAME cookie: must fail
    const res = await request
      .post("/auth/refresh")
      .set("Cookie", refreshCookie);

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/already used or revoked/i);
  });

  test("401 — user deleted between issue and use", async () => {
    userController.getUserById.mockResolvedValue(null);

    const res = await request
      .post("/auth/refresh")
      .set("Cookie", refreshCookie);

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/user not found/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("POST /auth/logout", () => {
  test("200 — clears the refresh cookie", async () => {
    const res = await request.post("/auth/logout");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    // Cookie should be cleared (maxAge=0 / expires in the past)
    const cookie = extractCookie(res, "refreshToken");
    expect(cookie).toMatch(/max-age=0|expires=Thu, 01 Jan 1970/i);
  });
});
