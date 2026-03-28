#!/usr/bin/env node
/**
 * ChatApp — Socket.IO Load Test
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Simulates N concurrent authenticated Socket.IO clients against the backend.
 * Each virtual client:
 *   • Connects and authenticates with a JWT
 *   • Emits `presence:heartbeat` on a fixed interval
 *   • Stays alive for the test duration
 *   • Measures connection latency (handshake round-trip)
 *   • Detects and logs unexpected disconnections
 *
 * Usage
 * ─────
 *   node socket-load-test.js [options]
 *
 * Options (can also be set via env vars):
 *   --connections=N    Concurrent socket connections        (default: 50)
 *   --duration=N       Test duration in seconds             (default: 60)
 *   --heartbeat=N      Heartbeat interval in seconds        (default: 5)
 *   --server=URL       Socket.IO server URL                 (default: http://localhost:3000)
 *   --ramp=N           Seconds to spread out connection opens (default: 5)
 *   --email=EMAIL      Login via REST API  ┐  optional; if omitted a synthetic
 *   --password=PASS    Login via REST API  ┘  token is generated from .env
 *
 * Examples
 * ────────
 *   node socket-load-test.js
 *   node socket-load-test.js --connections=100 --duration=120
 *   node socket-load-test.js --email=admin@example.com --password=secret
 *
 * Prerequisites
 * ─────────────
 *   1. Server running at http://localhost:3000
 *   2. cd load-test && npm install
 *
 * ══════════════════════════════════════════════════════════════════════════════
 */

"use strict";

const path   = require("path");
const { io } = require("socket.io-client");
const jwt    = require("jsonwebtoken");

// Load the server's .env so we can sign tokens with the same secret
require("dotenv").config({ path: path.join(__dirname, "../server/.env") });

// ── CLI / env argument parsing ─────────────────────────────────────────────────

function arg(name, fallback) {
  const flag = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (flag)                      return flag.split("=")[1];
  if (process.env[name.toUpperCase()]) return process.env[name.toUpperCase()];
  return fallback;
}

const CONFIG = {
  connections : parseInt(arg("connections", "50"),  10),
  durationMs  : parseInt(arg("duration",    "60"),  10) * 1_000,
  heartbeatMs : parseInt(arg("heartbeat",   "5"),   10) * 1_000,
  rampMs      : parseInt(arg("ramp",        "5"),   10) * 1_000,
  serverUrl   : arg("server",   "http://localhost:3000"),
  email       : arg("email",    ""),
  password    : arg("password", ""),
};

// ── Token acquisition ──────────────────────────────────────────────────────────

/**
 * Attempt to log in via the REST API and return a real access token.
 * Falls back to synthetic token generation if the request fails.
 */
async function fetchRealToken(email, password) {
  const res = await fetch(`${CONFIG.serverUrl}/auth/login`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Login failed (HTTP ${res.status}): ${body.error ?? "unknown"}`);
  }
  const { accessToken } = await res.json();
  return accessToken;
}

/**
 * Sign a synthetic JWT that the server's `socketAuth` middleware will accept.
 * The userId is a deterministic but fake UUID — no DB record needed.
 *
 * Used when --email / --password are not provided, keeping the load test
 * self-contained without requiring DB accounts.
 *
 * Note: `setOnlineStatus` inside connectionHandler will log errors for the
 * non-existent userId, but those are caught and won't affect the socket.
 */
function syntheticToken(index) {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) {
    throw new Error(
      "JWT_ACCESS_SECRET is not set.\n" +
      "Either copy server/.env.example → server/.env, or pass --email/--password to use real auth."
    );
  }
  return jwt.sign(
    {
      sub:         `load-test-user-${String(index).padStart(4, "0")}`,
      displayName: `LoadBot-${index}`,
      email:       `loadbot-${index}@loadtest.internal`,
    },
    secret,
    { expiresIn: "5m", algorithm: "HS256" }
  );
}

// ── Metrics ────────────────────────────────────────────────────────────────────

class Metrics {
  constructor() {
    this.connectLatencies = [];   // ms per successful connection
    this.connectSuccesses = 0;
    this.connectFailures  = 0;
    this.drops            = 0;    // unexpected disconnections after initial connect
    this.heartbeatsSent   = 0;
    this.errors           = [];   // { index, message }
    this.startTime        = Date.now();
  }

  recordConnect(latencyMs) {
    this.connectSuccesses++;
    this.connectLatencies.push(latencyMs);
  }

  recordConnectFailure(index, reason) {
    this.connectFailures++;
    this.errors.push({ index, message: reason });
  }

  recordDrop(index, reason) {
    this.drops++;
    this.errors.push({ index, message: `DROP: ${reason}` });
  }

  recordHeartbeat() {
    this.heartbeatsSent++;
  }

  percentile(sorted, p) {
    if (sorted.length === 0) return 0;
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  }

  latencyStats() {
    const sorted = [...this.connectLatencies].sort((a, b) => a - b);
    const sum    = sorted.reduce((a, b) => a + b, 0);
    return {
      min  : sorted[0]                     ?? 0,
      avg  : sorted.length ? Math.round(sum / sorted.length) : 0,
      p50  : this.percentile(sorted, 50)   ?? 0,
      p95  : this.percentile(sorted, 95)   ?? 0,
      p99  : this.percentile(sorted, 99)   ?? 0,
      max  : sorted[sorted.length - 1]     ?? 0,
    };
  }

  summary() {
    const elapsed = ((Date.now() - this.startTime) / 1_000).toFixed(1);
    const lat     = this.latencyStats();

    const line  = "═".repeat(58);
    const lines = [
      "",
      `${line}`,
      `  ChatApp Socket.IO Load Test — Results`,
      `${line}`,
      `  Duration          : ${elapsed}s`,
      `  Target connections: ${CONFIG.connections}`,
      `  Successful        : ${this.connectSuccesses}`,
      `  Failed to connect : ${this.connectFailures}`,
      `  Mid-test drops    : ${this.drops}`,
      `  Heartbeats sent   : ${this.heartbeatsSent}`,
      ``,
      `  Connection Latency (ms)`,
      `    min  : ${lat.min}`,
      `    avg  : ${lat.avg}`,
      `    p50  : ${lat.p50}`,
      `    p95  : ${lat.p95}`,
      `    p99  : ${lat.p99}`,
      `    max  : ${lat.max}`,
    ];

    if (this.errors.length > 0) {
      lines.push("", `  Errors / Drops (first 20)`);
      this.errors.slice(0, 20).forEach(({ index, message }) => {
        lines.push(`    [client-${String(index).padStart(3, "0")}] ${message}`);
      });
    }

    lines.push(line, "");
    return lines.join("\n");
  }
}

// ── Virtual client ─────────────────────────────────────────────────────────────

/**
 * A single load-test socket client.
 *
 * Lifecycle:
 *   open()  → connect() fires → heartbeat loop starts
 *   close() → socket.disconnect() called after duration elapses
 */
class VirtualClient {
  /**
   * @param {number}  index   0-based client index (for logging)
   * @param {string}  token   JWT access token
   * @param {Metrics} metrics shared metrics collector
   */
  constructor(index, token, metrics) {
    this.index   = index;
    this.token   = token;
    this.metrics = metrics;
    this.socket  = null;
    this.timers  = [];           // interval / timeout handles
    this.opened  = false;
    this.dropped = false;
    this._connectAt = 0;
  }

  open() {
    return new Promise((resolve) => {
      this._connectAt = Date.now();

      this.socket = io(CONFIG.serverUrl, {
        auth          : { token: this.token },
        transports    : ["websocket"],      // skip long-polling for accurate latency
        reconnection  : false,              // we want to detect drops, not hide them
        timeout       : 10_000,
      });

      // ── connect ─────────────────────────────────────────────────────────────
      this.socket.on("connect", () => {
        const latency = Date.now() - this._connectAt;
        this.opened   = true;
        this.metrics.recordConnect(latency);
        this._startHeartbeat();
        resolve();                          // unblock ramp-up
      });

      // ── connect_error ────────────────────────────────────────────────────────
      this.socket.on("connect_error", (err) => {
        if (!this.opened) {
          this.metrics.recordConnectFailure(this.index, err.message);
          resolve();                        // still unblock ramp-up
        }
        // If already connected once, treat as a drop
        if (this.opened && !this.dropped) {
          this.dropped = true;
          this.metrics.recordDrop(this.index, `connect_error: ${err.message}`);
        }
      });

      // ── unexpected disconnect ────────────────────────────────────────────────
      this.socket.on("disconnect", (reason) => {
        // "io client disconnect" is normal (we called socket.disconnect() at the end)
        if (reason === "io client disconnect") return;
        if (!this.dropped) {
          this.dropped = true;
          this.metrics.recordDrop(this.index, reason);
        }
        this._clearTimers();
      });

      // ── server-side error events ─────────────────────────────────────────────
      this.socket.on("error", (payload) => {
        this.metrics.errors.push({
          index   : this.index,
          message : `server error: ${JSON.stringify(payload)}`,
        });
      });
    });
  }

  _startHeartbeat() {
    const handle = setInterval(() => {
      if (!this.socket?.connected) return;

      // `presence:heartbeat` is fire-and-forget on the server — no ack.
      // We record emit time; true RTT cannot be measured without a server ack.
      const emitAt = Date.now();
      this.socket.emit("presence:heartbeat");
      this.metrics.recordHeartbeat();

      if (process.env.VERBOSE) {
        const elapsed = Date.now() - emitAt;
        process.stdout.write(
          `  [client-${String(this.index).padStart(3, "0")}] heartbeat emit (+${elapsed}ms)\n`
        );
      }
    }, CONFIG.heartbeatMs);

    this.timers.push(handle);
  }

  _clearTimers() {
    this.timers.forEach(clearInterval);
    this.timers = [];
  }

  close() {
    this._clearTimers();
    if (this.socket?.connected) {
      this.socket.disconnect();
    }
  }
}

// ── Progress reporter ──────────────────────────────────────────────────────────

function startProgressReporter(metrics, clients) {
  const handle = setInterval(() => {
    const active  = clients.filter((c) => c.socket?.connected).length;
    const elapsed = ((Date.now() - metrics.startTime) / 1_000).toFixed(1);
    const beats   = metrics.heartbeatsSent;
    const drops   = metrics.drops + metrics.connectFailures;

    process.stdout.write(
      `\r  [${elapsed}s]  active: ${String(active).padStart(3)} / ${CONFIG.connections}` +
      `  |  drops: ${drops}` +
      `  |  heartbeats: ${beats}` +
      `  |  errors: ${metrics.errors.length}    `
    );
  }, 1_000);

  return handle;
}

// ── Entry point ────────────────────────────────────────────────────────────────

async function run() {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║        ChatApp — Socket.IO Concurrent Load Test          ║
╚══════════════════════════════════════════════════════════╝

  Server      : ${CONFIG.serverUrl}
  Connections : ${CONFIG.connections}
  Duration    : ${CONFIG.durationMs / 1_000}s
  Heartbeat   : every ${CONFIG.heartbeatMs / 1_000}s
  Ramp-up     : ${CONFIG.rampMs / 1_000}s
  Auth mode   : ${CONFIG.email ? `real user (${CONFIG.email})` : "synthetic JWT (from server/.env)"}
`);

  // ── Obtain token(s) ──────────────────────────────────────────────────────────
  let sharedToken = null;
  if (CONFIG.email && CONFIG.password) {
    try {
      sharedToken = await fetchRealToken(CONFIG.email, CONFIG.password);
      console.log("  Auth    : logged in, token acquired.");
    } catch (err) {
      console.error(`  Auth    : login failed — ${err.message}`);
      console.error("            Falling back to synthetic tokens.");
    }
  }

  // ── Build virtual clients ─────────────────────────────────────────────────────
  const metrics = new Metrics();
  const clients = Array.from({ length: CONFIG.connections }, (_, i) => {
    const token = sharedToken ?? syntheticToken(i);
    return new VirtualClient(i, token, metrics);
  });

  // ── Ramp up: open connections gradually ─────────────────────────────────────
  // Spreading out connection opens avoids thundering-herd on the server.
  console.log("  Ramping up connections …\n");

  const delayBetween = CONFIG.rampMs / CONFIG.connections;  // ms between each open()

  const openPromises = clients.map((client, i) =>
    new Promise((resolve) =>
      setTimeout(async () => {
        await client.open();
        resolve();
      }, i * delayBetween)
    )
  );

  // Start the live progress reporter while connections are being established
  const progressHandle = startProgressReporter(metrics, clients);

  await Promise.all(openPromises);

  const connected = clients.filter((c) => c.socket?.connected).length;
  process.stdout.write("\n");
  console.log(`\n  Ramp complete — ${connected}/${CONFIG.connections} connections established.`);

  if (connected === 0) {
    clearInterval(progressHandle);
    console.error("\n  [FAIL] No connections established. Check that the server is running.");
    process.exit(1);
  }

  // ── Hold connections for the test duration ───────────────────────────────────
  await new Promise((resolve) => setTimeout(resolve, CONFIG.durationMs));

  // ── Tear down ─────────────────────────────────────────────────────────────────
  clearInterval(progressHandle);
  process.stdout.write("\n");
  console.log("  Disconnecting all clients …");
  clients.forEach((c) => c.close());

  // Give sockets time to close cleanly
  await new Promise((resolve) => setTimeout(resolve, 500));

  // ── Print summary ─────────────────────────────────────────────────────────────
  console.log(metrics.summary());

  // Exit with a non-zero code if there were any problems
  const hasFailures = metrics.connectFailures > 0 || metrics.drops > 0;
  process.exit(hasFailures ? 1 : 0);
}

run().catch((err) => {
  console.error("\n[fatal]", err.message);
  process.exit(2);
});
