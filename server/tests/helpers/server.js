/**
 * Factory helpers for integration tests.
 *
 * createTestServer() spins up a real http + Socket.IO server on an ephemeral
 * port (0) so tests never clash.  Use stopTestServer() in afterAll.
 *
 * connectSocket() creates and resolves a real socket.io-client connection,
 * returning the connected socket (or throwing on connect_error).
 */

const http = require("http");
const { io: ioClient } = require("socket.io-client");

const app          = require("../../app");
const { initSocket } = require("../../config/socket");

/**
 * Creates a fresh http server + Socket.IO on a random port.
 * Returns { server, io, url }.
 */
async function createTestServer() {
  const server = http.createServer(app);
  const io     = initSocket(server);

  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", (err) => (err ? reject(err) : resolve()));
  });

  const { port } = server.address();
  const url = `http://127.0.0.1:${port}`;

  return { server, io, url };
}

/**
 * Closes the Socket.IO server (disconnects all clients).
 * io.close() calls httpServer.close() internally, so we don't need to close
 * the server separately — doing so would throw "Server is not running."
 */
function stopTestServer({ io }) {
  return new Promise((resolve) => {
    io.close(() => resolve());
  });
}

/**
 * Connects a socket.io-client to the given URL with the provided access token.
 * Resolves with the connected socket; rejects with the connect_error.
 *
 * @param {string} url
 * @param {string|null} token  — pass null to test auth-rejection cases
 * @param {object} [extraOpts] — merged into the io() options
 */
function connectSocket(url, token, extraOpts = {}) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(url, {
      auth:        { token },
      transports:  ["websocket"],
      autoConnect: false,
      ...extraOpts,
    });

    socket.once("connect",       () => resolve(socket));
    socket.once("connect_error", (err) => {
      socket.disconnect();
      reject(err);
    });

    socket.connect();
  });
}

/**
 * Waits for a specific socket event, resolving with its payload.
 * Rejects after `timeout` ms if the event never fires.
 */
function waitForEvent(socket, event, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for "${event}"`)),
      timeout
    );
    socket.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

/**
 * Asserts that a socket event does NOT fire within `delay` ms.
 * Rejects (fails the test) if the event fires before the delay.
 */
function expectNoEvent(socket, event, delay = 200) {
  return new Promise((resolve, reject) => {
    const handler = () => reject(new Error(`Unexpected event: "${event}"`));
    socket.once(event, handler);
    setTimeout(() => {
      socket.off(event, handler);
      resolve();
    }, delay);
  });
}

/**
 * Emits a socket event and awaits the callback (acknowledgement).
 */
function emitWithAck(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

module.exports = {
  createTestServer,
  stopTestServer,
  connectSocket,
  waitForEvent,
  expectNoEvent,
  emitWithAck,
};
