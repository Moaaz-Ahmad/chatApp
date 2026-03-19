const bcrypt = require("bcryptjs");
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require("../utils/jwt");
const tokenStore = require("../utils/tokenStore");
const { createUser, getUserByEmailWithPassword, getUserById } = require("./userController");

const REFRESH_COOKIE = "refreshToken";

const COOKIE_BASE = {
  httpOnly: true,
  secure:   process.env.NODE_ENV === "production",
  sameSite: "strict",
  path:     "/auth",
};

const COOKIE_SET_OPTS = { ...COOKIE_BASE, maxAge: 7 * 24 * 60 * 60 * 1000 };
const COOKIE_CLR_OPTS = { ...COOKIE_BASE, maxAge: 0 };

function issueTokenPair(user, res) {
  const accessToken = signAccessToken({
    sub:         user.id,
    displayName: user.displayName,
    email:       user.email,
  });
  const { token: refreshToken, jti } = signRefreshToken(user.id);
  tokenStore.add(jti);
  res.cookie(REFRESH_COOKIE, refreshToken, COOKIE_SET_OPTS);
  return accessToken;
}

function safeUser(user) {
  return { id: user.id, email: user.email, username: user.username, displayName: user.displayName };
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /auth/register
// ─────────────────────────────────────────────────────────────────────────────
async function register(req, res) {
  const { email, username, password, displayName } = req.body ?? {};

  if (!email || !username || !password) {
    return res.status(400).json({ error: "email, username, and password are required" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await createUser({ email, username, displayName, passwordHash });
    const accessToken = issueTokenPair(user, res);
    return res.status(201).json({ accessToken, user: safeUser(user) });
  } catch (err) {
    if (err?.code === "P2002") {
      return res.status(409).json({ error: "Email or username already taken" });
    }
    console.error("[register]", err);
    return res.status(500).json({ error: "Registration failed" });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /auth/login
// ─────────────────────────────────────────────────────────────────────────────
async function login(req, res) {
  const { email, password } = req.body ?? {};

  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  const user = await getUserByEmailWithPassword(email);
  // Constant-time comparison even when user not found (prevents timing attacks)
  const hash  = user?.password ?? "$2b$12$invalidhashinvalid00000000000000000000";
  const valid = await bcrypt.compare(password, hash);

  if (!user || !valid) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const accessToken = issueTokenPair(user, res);
  return res.json({ accessToken, user: safeUser(user) });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /auth/refresh
// ─────────────────────────────────────────────────────────────────────────────
async function refresh(req, res) {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (!token) return res.status(401).json({ error: "No refresh token" });

  let payload;
  try {
    payload = verifyRefreshToken(token);
  } catch {
    return res.status(401).json({ error: "Invalid or expired refresh token" });
  }

  if (!tokenStore.has(payload.jti)) {
    console.warn(`[auth] refresh token reuse detected for user ${payload.sub}`);
    return res.status(401).json({ error: "Refresh token already used or revoked" });
  }

  const user = await getUserById(payload.sub);
  if (!user) {
    tokenStore.remove(payload.jti);
    return res.status(401).json({ error: "User not found" });
  }

  tokenStore.remove(payload.jti);
  const accessToken = issueTokenPair(user, res);
  return res.json({ accessToken, user: safeUser(user) });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /auth/logout
// ─────────────────────────────────────────────────────────────────────────────
async function logout(req, res) {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (token) {
    try {
      const payload = verifyRefreshToken(token);
      tokenStore.remove(payload.jti);
    } catch { /* already expired */ }
  }
  res.clearCookie(REFRESH_COOKIE, COOKIE_CLR_OPTS);
  return res.json({ ok: true });
}

module.exports = { register, login, refresh, logout };
