const jwt = require("jsonwebtoken");
const { randomUUID } = require("crypto");

const ACCESS_SECRET  = process.env.JWT_ACCESS_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

if (!ACCESS_SECRET || !REFRESH_SECRET) {
  throw new Error(
    "JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be defined in your environment.\n" +
    "Copy .env.example to .env and fill in the values."
  );
}

/**
 * Signs a 15-minute access token.
 * Payload: { sub, displayName, email }
 */
function signAccessToken({ sub, displayName, email }) {
  return jwt.sign({ sub, displayName, email }, ACCESS_SECRET, {
    expiresIn: "15m",
    algorithm: "HS256",
  });
}

/**
 * Signs a 7-day refresh token with a unique jti for rotation tracking.
 * Returns { token, jti }.
 */
function signRefreshToken(sub) {
  const jti = randomUUID();
  const token = jwt.sign({ sub, jti }, REFRESH_SECRET, {
    expiresIn: "7d",
    algorithm: "HS256",
  });
  return { token, jti };
}

/** Throws if invalid or expired. */
function verifyAccessToken(token) {
  return jwt.verify(token, ACCESS_SECRET);
}

/** Throws if invalid or expired. */
function verifyRefreshToken(token) {
  return jwt.verify(token, REFRESH_SECRET);
}

module.exports = { signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken };
