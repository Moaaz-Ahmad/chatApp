const { verifyAccessToken } = require("../utils/jwt");

/**
 * Socket.IO middleware — runs before the "connection" event is emitted.
 * Rejects the handshake entirely if the token is missing or invalid,
 * so unauthenticated sockets never reach any event handler.
 *
 * The client sends the access token via:
 *   socket.auth = { token: "<access_token>" }
 *
 * Error message conventions (read by the client's connect_error handler):
 *   "AUTH_MISSING"  — no token provided
 *   "AUTH_EXPIRED"  — valid token but past exp; client should refresh and retry
 *   "AUTH_INVALID"  — malformed / tampered token; client should log out
 */
function socketAuth(socket, next) {
  const token = socket.handshake.auth?.token;

  if (!token) {
    return next(new Error("AUTH_MISSING"));
  }

  try {
    const payload = verifyAccessToken(token);
    // Attach identity so all downstream handlers can trust socket.data.userId
    socket.data.userId      = payload.sub;
    socket.data.displayName = payload.displayName;
    socket.data.email       = payload.email;
    next();
  } catch (err) {
    const code =
      err.name === "TokenExpiredError" ? "AUTH_EXPIRED" : "AUTH_INVALID";
    next(new Error(code));
  }
}

module.exports = socketAuth;
