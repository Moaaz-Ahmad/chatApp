/**
 * In-memory store for valid refresh token JTIs.
 *
 * Each refresh token carries a unique `jti` claim. On issue we register it here;
 * on rotation we swap old for new; on logout we remove it.
 * Any token whose jti is not in this set is rejected — even if the JWT signature
 * is technically valid — enabling instant revocation.
 *
 * Production note: replace with Redis (SADD / SISMEMBER / SREM) so it survives
 * restarts and scales horizontally.
 */
const validJTIs = new Set();

const tokenStore = {
  add:    (jti) => validJTIs.add(jti),
  has:    (jti) => validJTIs.has(jti),
  remove: (jti) => validJTIs.delete(jti),
};

module.exports = tokenStore;
