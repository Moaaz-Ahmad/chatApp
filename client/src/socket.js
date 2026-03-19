import { io } from "socket.io-client";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3000";

/**
 * Singleton socket instance.
 * - autoConnect: false — we connect manually once an access token is available.
 * - auth.token is set by useChat before each connect() call so the socketAuth
 *   middleware always receives the latest (potentially refreshed) token.
 */
const socket = io(SERVER_URL, {
  autoConnect: false,
  auth: { token: null }, // placeholder; overwritten before connect
});

export default socket;
