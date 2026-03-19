import { useState, useEffect, useCallback, useRef } from "react";
import { authApi } from "../api/auth";

/** Decode a JWT payload without verifying the signature (client-side only). */
function decodePayload(token) {
  try {
    return JSON.parse(atob(token.split(".")[1]));
  } catch {
    return null;
  }
}

/**
 * Manages authentication state for the whole app.
 *
 * Security model:
 *  - Access token  → stored in React state (JS memory, NOT localStorage).
 *                    Lost on page refresh; recovered via silent refresh on mount.
 *  - Refresh token → httpOnly cookie set by the server.
 *                    Invisible to JS; sent automatically to /auth/* endpoints.
 *
 * Token rotation:
 *  - A timer is scheduled 60 s before access token expiry.
 *  - On each refresh, the server issues a new refresh token (rotation),
 *    invalidating the previous one.
 */
export function useAuth() {
  const [accessToken, setAccessTokenState] = useState(null);
  const [user, setUser]                   = useState(null);
  const [isLoading, setIsLoading]         = useState(true); // true while checking session on mount
  const refreshTimerRef                   = useRef(null);

  // ── Token management ───────────────────────────────────────────────────────
  const setAccessToken = useCallback((token) => {
    setAccessTokenState(token);

    if (!token) {
      clearTimeout(refreshTimerRef.current);
      return;
    }

    const payload   = decodePayload(token);
    const expiresIn = payload.exp * 1000 - Date.now();         // ms until expiry
    const refreshIn = Math.max(expiresIn - 60_000, 5_000);     // 60 s before expiry, min 5 s

    clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(async () => {
      try {
        const data = await authApi.refresh();
        setAccessToken(data.accessToken);
        setUser(data.user);
      } catch {
        // Refresh failed (cookie expired / revoked) — force logout
        setAccessTokenState(null);
        setUser(null);
      }
    }, refreshIn);
  }, []);

  // ── Silent re-auth on mount ────────────────────────────────────────────────
  // Attempts to restore the session from the existing httpOnly cookie.
  // If no valid cookie exists the user lands on the login screen.
  useEffect(() => {
    authApi
      .refresh()
      .then((data) => {
        setAccessToken(data.accessToken);
        setUser(data.user);
      })
      .catch(() => {
        // No active session — that's fine
      })
      .finally(() => setIsLoading(false));

    return () => clearTimeout(refreshTimerRef.current);
  }, [setAccessToken]);

  // ── Public API ─────────────────────────────────────────────────────────────
  const login = useCallback(
    async (credentials) => {
      const data = await authApi.login(credentials);
      setAccessToken(data.accessToken);
      setUser(data.user);
      return data;
    },
    [setAccessToken]
  );

  const register = useCallback(
    async (credentials) => {
      const data = await authApi.register(credentials);
      setAccessToken(data.accessToken);
      setUser(data.user);
      return data;
    },
    [setAccessToken]
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // Best-effort — clear client state regardless
    }
    clearTimeout(refreshTimerRef.current);
    setAccessTokenState(null);
    setUser(null);
  }, []);

  return { user, accessToken, isLoading, login, register, logout };
}
