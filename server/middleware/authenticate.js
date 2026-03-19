const { verifyAccessToken } = require("../utils/jwt");

/**
 * Express middleware — verifies the Bearer access token on protected HTTP routes.
 * Attaches the decoded payload to `req.user` on success.
 */
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing access token" });
  }

  const token = authHeader.slice(7);
  try {
    req.user = verifyAccessToken(token);
    next();
  } catch (err) {
    const isExpired = err.name === "TokenExpiredError";
    return res.status(401).json({
      error: isExpired ? "Access token expired" : "Invalid access token",
      code: isExpired ? "TOKEN_EXPIRED" : "TOKEN_INVALID",
    });
  }
}

module.exports = authenticate;
