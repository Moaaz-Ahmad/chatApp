const BASE = import.meta.env.VITE_SERVER_URL || "http://localhost:3000";

/**
 * Thin fetch wrapper.
 * - Always sends/receives JSON
 * - Includes credentials so the httpOnly refresh token cookie travels with requests
 * - Throws an enriched Error on non-2xx responses
 */
async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error ?? "Request failed");
    err.status = res.status;
    err.code   = data.code;
    err.data   = data;
    throw err;
  }
  return data;
}

export const authApi = {
  register: (body) => request("/auth/register", { method: "POST", body: JSON.stringify(body) }),
  login:    (body) => request("/auth/login",    { method: "POST", body: JSON.stringify(body) }),
  /** Silent refresh — uses the httpOnly cookie, returns { accessToken, user }. */
  refresh:  ()     => request("/auth/refresh",  { method: "POST" }),
  logout:   ()     => request("/auth/logout",   { method: "POST" }),
};
