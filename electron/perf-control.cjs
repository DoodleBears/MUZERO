// Dev-only local control endpoint (PRD 20260615-dev-control-endpoint-automation-harness).
//
// A 127.0.0.1 HTTP server that lets a local script (Claude Code via curl) drive the
// running app — switch songs, change settings, run the same code paths the UI runs —
// and slice the trace it already writes to .logs/. It is a DEV automation seam, NOT a
// product backend: it only ever listens when the build is unpackaged AND explicitly
// opted in, forwards to existing renderer actions (no new behavior), and is gated so it
// can never ship (see shouldEnablePerfControl + the prod regression test).
//
// Transport: HTTP (main) → IPC command (main → renderer bridge) → IPC result (renderer
// → main) → HTTP response. The renderer side lives in src/dev/perf-control-bridge.ts.
const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const COMMAND_CHANNEL = "muzero:perfControl:command";
const RESULT_CHANNEL = "muzero:perfControl:result";
const DEFAULT_PORT = 7345;
const TOKEN_HEADER = "x-muzero-perf-token";
const MAX_BODY_BYTES = 1024 * 1024;
// 30s suits the snappy control actions; stream download+mux fetches real media bytes, so
// allow a longer ceiling for those dev-only scenarios.
const DISPATCH_TIMEOUT_MS = 180_000;

/**
 * The single source of truth for whether the control endpoint may exist. Kept pure (no
 * electron import) so the prod regression test can assert the truth table directly:
 * a packaged build NEVER enables it, and even unpackaged requires explicit opt-in.
 */
function shouldEnablePerfControl({ isPackaged, env } = {}) {
  if (isPackaged) return false;
  return (env && env.MUZERO_PERF_CONTROL) === "1";
}

function resolvePort(env) {
  const raw = env && env.MUZERO_PERF_CONTROL_PORT;
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_PORT;
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 65_535 ? parsed : DEFAULT_PORT;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest();
}

/** Constant-time token compare via fixed-length digests (no length leak, no throw). */
function tokenMatches(provided, expected) {
  if (!provided) return false;
  return crypto.timingSafeEqual(sha256(provided), sha256(expected));
}

function presentedToken(req, url) {
  const header = req.headers[TOKEN_HEADER];
  if (typeof header === "string" && header) return header;
  const auth = req.headers.authorization;
  if (typeof auth === "string") {
    const [scheme, value] = auth.split(/\s+/, 2);
    if (scheme && scheme.toLowerCase() === "bearer" && value) return value;
  }
  return url.searchParams.get("token") || "";
}

/** Reject anything but loopback Host + reject cross-origin browser callers (DNS rebinding). */
function isLoopbackRequest(req, port) {
  const host = req.headers.host;
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return false;
  const origin = req.headers.origin;
  if (typeof origin === "string" && origin) {
    try {
      const { hostname } = new URL(origin);
      if (hostname !== "127.0.0.1" && hostname !== "localhost") return false;
    } catch {
      return false;
    }
  }
  return true;
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "content-type": "application/json; charset=utf-8",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) reject(new Error("request body too large"));
      else chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

/** Map an HTTP method + path + body to a renderer command envelope (or null = 404). */
function routeToCommand(method, segments, body) {
  if (method === "GET" && segments.length === 1 && segments[0] === "state") {
    return { kind: "state" };
  }
  if (method === "GET" && segments.length === 1 && segments[0] === "actions") {
    return { kind: "actions" };
  }
  if (method === "POST" && segments.length === 2 && segments[0] === "action") {
    return { kind: "action", actionId: segments[1], payload: body };
  }
  if (method === "POST" && segments.length === 1 && segments[0] === "settings") {
    return { kind: "settings", patch: body };
  }
  if (method === "GET" && segments.length === 1 && segments[0] === "settings") {
    return { kind: "getSettings" };
  }
  if (method === "POST" && segments[0] === "nav" && segments[1] === "tab") {
    return { kind: "navTab", tab: body.tab };
  }
  if (method === "POST" && segments.length === 2 && segments[0] === "player") {
    return { kind: "player", method: segments[1], payload: body };
  }
  if (method === "POST" && segments[0] === "perf" && segments[1] === "marker") {
    return { kind: "marker", label: body.label, meta: body.meta };
  }
  if (method === "POST" && segments[0] === "perf" && segments[1] === "trace") {
    return { kind: "dumpTrace", since: body.since, limit: body.limit };
  }
  if (method === "POST" && segments[0] === "perf" && segments[1] === "sampler") {
    return { kind: "perfSampler", payload: body };
  }
  if (method === "POST" && segments.length === 1 && segments[0] === "search") {
    return { kind: "search", payload: body };
  }
  if (method === "POST" && segments.length === 1 && segments[0] === "editMeta") {
    return { kind: "editMeta", payload: body };
  }
  if (method === "POST" && segments.length === 1 && segments[0] === "renderTrace") {
    return { kind: "renderTrace", payload: body };
  }
  if (method === "POST" && segments.length === 1 && segments[0] === "live-request") {
    return { kind: "liveRequest", payload: body };
  }
  if (method === "POST" && segments[0] === "voice" && segments[1] === "transcript") {
    return { kind: "voiceTranscript", text: body.text, payload: body };
  }
  if (method === "GET" && segments.length === 1 && segments[0] === "notifications") {
    return { kind: "notifications" };
  }
  if (method === "GET" && segments.length === 1 && segments[0] === "sessions") {
    return { kind: "sessions" };
  }
  if (
    method === "POST" &&
    segments.length === 2 &&
    segments[0] === "seed" &&
    segments[1] === "example"
  ) {
    return { kind: "seedExample" };
  }
  if (method === "POST" && segments.length === 2 && segments[0] === "stream" && segments[1] === "probe") {
    return { kind: "streamProbe", payload: body };
  }
  if (
    method === "POST" &&
    segments.length === 2 &&
    segments[0] === "stream" &&
    segments[1] === "download"
  ) {
    return { kind: "streamDownload", payload: body };
  }
  if (
    method === "POST" &&
    segments.length === 2 &&
    segments[0] === "stream" &&
    segments[1] === "library"
  ) {
    return { kind: "downloadToLibrary", payload: body };
  }
  if (
    method === "POST" &&
    segments.length === 2 &&
    segments[0] === "stream" &&
    segments[1] === "cover"
  ) {
    return { kind: "recoverCover", payload: body };
  }
  if (
    method === "POST" &&
    segments.length === 2 &&
    segments[0] === "stream" &&
    segments[1] === "resolve-link"
  ) {
    return { kind: "resolveLink", payload: body };
  }
  if (
    method === "POST" &&
    segments.length === 2 &&
    segments[0] === "stream" &&
    segments[1] === "playlists"
  ) {
    return { kind: "syncPlaylists", payload: body };
  }
  if (
    method === "POST" &&
    segments.length === 2 &&
    segments[0] === "download" &&
    segments[1] === "queue"
  ) {
    return { kind: "downloadQueue", payload: body };
  }
  // Playback-queue-model E2E: POST /playback/:action (seed | playInSet)
  if (method === "POST" && segments.length === 2 && segments[0] === "playback") {
    return { kind: "playbackContext", payload: { action: segments[1], ...body } };
  }
  return null;
}

/**
 * Wire the HTTP server to a renderer dispatcher. `dispatch(command)` must return a
 * promise resolving to the renderer's result (or rejecting). `getReady()` reports
 * whether a renderer is attached. Returns { start, stop, port, token }.
 */
function createPerfControlServer({ dispatch, getProcessMetrics, getReady, port, token, version }) {
  const server = http.createServer((req, res) => {
    void handle(req, res).catch((error) => {
      sendJson(res, 500, { ok: false, error: String((error && error.message) || error) });
    });
  });

  async function handle(req, res) {
    const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
    const segments = url.pathname.split("/").filter(Boolean);

    if (!isLoopbackRequest(req, port)) {
      sendJson(res, 403, { ok: false, error: "forbidden origin" });
      return;
    }
    // /health is the only unauthenticated, renderer-free route (liveness probe).
    if (req.method === "GET" && segments.length === 1 && segments[0] === "health") {
      sendJson(res, 200, { ok: true, packaged: false, version, port, rendererReady: getReady() });
      return;
    }
    if (!tokenMatches(presentedToken(req, url), token)) {
      sendJson(res, 401, { ok: false, error: "unauthorized" });
      return;
    }

    let body = {};
    if (req.method === "POST") {
      try {
        body = await readBody(req);
      } catch (error) {
        sendJson(res, 400, { ok: false, error: String(error.message) });
        return;
      }
    }
    if (req.method === "GET" && segments.length === 1 && segments[0] === "processes") {
      if (typeof getProcessMetrics !== "function") {
        sendJson(res, 404, { ok: false, error: "process metrics not wired" });
        return;
      }
      sendJson(res, 200, { ok: true, data: getProcessMetrics() });
      return;
    }
    const command = routeToCommand(req.method, segments, body);
    if (!command) {
      sendJson(res, 404, { ok: false, error: "not found" });
      return;
    }
    if (!getReady()) {
      sendJson(res, 409, { ok: false, error: "renderer not ready", retryAfterMs: 500 });
      return;
    }
    try {
      const data = await dispatch(command);
      sendJson(res, 200, { ok: true, data });
    } catch (error) {
      sendJson(res, 422, { ok: false, error: String((error && error.message) || error) });
    }
  }

  return {
    port,
    token,
    start() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          server.off("error", reject);
          resolve();
        });
      });
    },
    stop() {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

/**
 * Register the dev control endpoint. Call ONLY when shouldEnablePerfControl() is true.
 * electron is required lazily here so the pure helpers stay unit-testable.
 */
function registerPerfControl({ app, BrowserWindow }) {
  const { ipcMain } = require("electron");
  const token = crypto.randomBytes(24).toString("hex");
  const port = resolvePort(process.env);
  const version = (app && app.getVersion && app.getVersion()) || "dev";

  const pending = new Map();
  let counter = 0;

  ipcMain.on(RESULT_CHANNEL, (_event, payload) => {
    const entry = payload && pending.get(payload.id);
    if (!entry) return;
    pending.delete(payload.id);
    clearTimeout(entry.timer);
    if (payload.ok) entry.resolve(payload.data);
    else entry.reject(new Error(payload.error || "command failed"));
  });

  function liveWindow() {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    return win && !win.isDestroyed() ? win : null;
  }

  function dispatch(command) {
    const win = liveWindow();
    if (!win) return Promise.reject(new Error("no window"));
    const id = `pc_${++counter}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("renderer dispatch timeout"));
      }, DISPATCH_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      win.webContents.send(COMMAND_CHANNEL, { id, command });
    });
  }

  const server = createPerfControlServer({
    dispatch,
    getProcessMetrics: () => snapshotProcessMetrics(app),
    getReady: () => liveWindow() != null,
    port,
    token,
    version,
  });

  server
    .start()
    .then(() => {
      writeConnectionFile({ port: server.port, token });
      // eslint-disable-next-line no-console -- main-process dev banner, before logger exists
      console.log(`[muzero:perf-control] http://127.0.0.1:${server.port} token=${token}`);
    })
    .catch((error) => {
      console.warn("[muzero:perf-control] failed to start:", error.message);
    });

  app.on("before-quit", () => void server.stop());
  return server;
}

function snapshotProcessMetrics(app) {
  const metrics = typeof app?.getAppMetrics === "function" ? app.getAppMetrics() : [];
  const processes = metrics.map((metric) => {
    const memory = metric.memory || {};
    const workingSetMb = kbToMb(memory.workingSetSize);
    const privateMb = kbToMb(memory.privateBytes);
    const sharedMb = kbToMb(memory.sharedBytes);
    return {
      cpuPercent: roundMetric(metric.cpu?.percentCPUUsage ?? 0),
      memory: {
        privateMb,
        sharedMb,
        workingSetMb,
      },
      name: metric.name || metric.serviceName || "",
      pid: metric.pid,
      serviceName: metric.serviceName || "",
      type: metric.type,
    };
  });
  const byType = {};
  for (const processMetric of processes) {
    const type = processMetric.type || "unknown";
    const current = byType[type] || { count: 0, privateMb: 0, workingSetMb: 0 };
    current.count += 1;
    current.privateMb += processMetric.memory.privateMb;
    current.workingSetMb += processMetric.memory.workingSetMb;
    byType[type] = current;
  }
  for (const value of Object.values(byType)) {
    value.privateMb = roundMetric(value.privateMb);
    value.workingSetMb = roundMetric(value.workingSetMb);
  }
  return {
    capturedAt: Date.now(),
    processes,
    totals: {
      byType,
      privateMb: roundMetric(processes.reduce((sum, p) => sum + p.memory.privateMb, 0)),
      workingSetMb: roundMetric(processes.reduce((sum, p) => sum + p.memory.workingSetMb, 0)),
    },
    units: "MB",
  };
}

function kbToMb(value) {
  return Number.isFinite(value) ? roundMetric(value / 1024) : 0;
}

function roundMetric(value) {
  return Math.round(value * 10) / 10;
}

/** Drop {port,token} where the local driver (curl loop) can read it without scraping stdout. */
function writeConnectionFile({ port, token }) {
  try {
    const dir = path.join(process.cwd(), ".logs");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "perf-control.json"),
      JSON.stringify({ port, token, url: `http://127.0.0.1:${port}` }, null, 2),
    );
  } catch {
    // best effort; stdout banner still carries the token.
  }
}

module.exports = {
  COMMAND_CHANNEL,
  RESULT_CHANNEL,
  DEFAULT_PORT,
  shouldEnablePerfControl,
  resolvePort,
  routeToCommand,
  tokenMatches,
  createPerfControlServer,
  snapshotProcessMetrics,
  registerPerfControl,
};

// perf-control: search route + driveSearch (harness search scenario)
