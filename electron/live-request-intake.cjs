const http = require("node:http");
const { ipcMain } = require("electron");

const MESSAGE_CHANNEL = "muzero:liveRequest:message";
const START_CHANNEL = "muzero:liveRequest:start";
const STOP_CHANNEL = "muzero:liveRequest:stop";
const STATUS_CHANNEL = "muzero:liveRequest:status";
const DEFAULT_MAX_BODY_BYTES = 256 * 1024;

function createLiveRequestIntake({ emit }) {
  let server = null;
  let current = null;

  function status() {
    if (!server || !current) {
      return { supported: true, listening: false };
    }
    return { supported: true, listening: true, port: current.port };
  }

  async function start(input) {
    if (!input || typeof input !== "object") {
      throw new Error("Live request intake settings are required.");
    }
    const port = normalizePort(input.port);
    const token = typeof input.token === "string" ? input.token : "";
    if (!token) throw new Error("Live request intake token is required.");
    const maxBodyBytes = normalizeMaxBodyBytes(input.maxBodyBytes);

    await stop();

    const next = http.createServer((req, res) => {
      void handleRequest({
        emit,
        maxBodyBytes,
        req,
        res,
        token,
      });
    });

    next.keepAliveTimeout = 5_000;
    next.headersTimeout = 10_000;
    next.requestTimeout = 10_000;

    await new Promise((resolve, reject) => {
      const fail = (error) => {
        next.off("listening", ready);
        reject(error);
      };
      const ready = () => {
        next.off("error", fail);
        resolve();
      };
      next.once("error", fail);
      next.once("listening", ready);
      next.listen(port, "127.0.0.1");
    });

    server = next;
    current = { port: server.address().port };
    return status();
  }

  async function stop() {
    if (!server) {
      current = null;
      return status();
    }
    const closing = server;
    server = null;
    current = null;
    await new Promise((resolve, reject) => {
      closing.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    return status();
  }

  return { start, status, stop };
}

async function handleRequest({ emit, maxBodyBytes, req, res, token }) {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { apiVersion: 1, app: "MUZERO", ok: true });
    return;
  }
  if (req.method !== "POST" || url.pathname !== "/v1/audience/request") {
    sendJson(res, 404, { accepted: false, message: "not found" });
    return;
  }
  if (!hasValidToken(req, url, token)) {
    sendJson(res, 401, { accepted: false, message: "unauthorized" });
    drain(req);
    return;
  }

  try {
    const body = await readBody(req, maxBodyBytes);
    emit({ body, receivedAt: Date.now() });
    sendJson(res, 202, { accepted: true, status: "queued" });
  } catch (error) {
    const tooLarge = error && error.code === "BODY_TOO_LARGE";
    sendJson(res, tooLarge ? 413 : 400, {
      accepted: false,
      message: tooLarge ? "request body too large" : "invalid request body",
    });
    drain(req);
  }
}

function normalizePort(port) {
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("Live request intake port must be between 0 and 65535.");
  }
  return port;
}

function normalizeMaxBodyBytes(value) {
  if (value == null) return DEFAULT_MAX_BODY_BYTES;
  if (!Number.isInteger(value) || value < 1 || value > DEFAULT_MAX_BODY_BYTES) {
    throw new Error(`Live request body limit must be between 1 and ${DEFAULT_MAX_BODY_BYTES}.`);
  }
  return value;
}

function hasValidToken(req, url, token) {
  const header = req.headers.authorization;
  if (typeof header === "string") {
    const [scheme, value] = header.split(/\s+/, 2);
    if (scheme?.toLowerCase() === "bearer" && value === token) return true;
  }
  return url.searchParams.get("token") === token;
}

function readBody(req, maxBodyBytes) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let total = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      if (settled) return;
      total += chunk.length;
      if (total > maxBodyBytes) {
        settled = true;
        const error = new Error("request body too large");
        error.code = "BODY_TOO_LARGE";
        reject(error);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "content-type": "application/json; charset=utf-8",
  });
  res.end(body);
}

function drain(req) {
  req.resume();
}

function registerLiveRequestIntake({ BrowserWindow }) {
  const intake = createLiveRequestIntake({
    emit(payload) {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(MESSAGE_CHANNEL, payload);
      }
    },
  });

  ipcMain.handle(START_CHANNEL, (_event, input) => intake.start(input));
  ipcMain.handle(STOP_CHANNEL, () => intake.stop());
  ipcMain.handle(STATUS_CHANNEL, () => intake.status());
  return intake;
}

module.exports = {
  MESSAGE_CHANNEL,
  START_CHANNEL,
  STATUS_CHANNEL,
  STOP_CHANNEL,
  createLiveRequestIntake,
  registerLiveRequestIntake,
};
