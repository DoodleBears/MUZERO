const CHANNEL = "muzero:diagnostics:event";
const MAX_ENTRIES = 100;

function createMainDiagnostics() {
  let nextId = 1;
  let entries = [];
  const subscribers = new Set();

  function emit(level, scope, event, message, context = {}) {
    const entry = {
      id: nextId++,
      at: Date.now(),
      level,
      scope,
      event,
      message,
      context: sanitizeContext(context),
    };
    entries = [...entries, entry].slice(-MAX_ENTRIES);
    for (const subscriber of subscribers) subscriber(entry);
    return entry;
  }

  function subscribe(subscriber) {
    for (const entry of entries) subscriber(entry);
    subscribers.add(subscriber);
    return () => subscribers.delete(subscriber);
  }

  function snapshot() {
    return entries;
  }

  return { emit, subscribe, snapshot };
}

const mainDiagnostics = createMainDiagnostics();

function emitMainDiagnostic(level, scope, event, message, context) {
  return mainDiagnostics.emit(level, scope, event, message, context);
}

function attachDiagnosticsWindow(win) {
  const send = (entry) => {
    if (win.isDestroyed()) return;
    win.webContents.send(CHANNEL, entry);
  };
  const unsubscribe = mainDiagnostics.subscribe(send);
  win.once("closed", unsubscribe);
  return unsubscribe;
}

function sanitizeContext(value) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sanitizeContext);
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    const lower = key.toLowerCase();
    if (lower === "url" || lower.endsWith("url")) {
      out[key] = typeof child === "string" ? sanitizeUrl(child) : "[redacted:url]";
      continue;
    }
    if (/(authorization|cookie|token|secret|password|api[-_]?key)/i.test(key)) {
      out[key] = "[redacted:secret]";
      continue;
    }
    out[key] = sanitizeContext(child);
  }
  return out;
}

function sanitizeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return {
      host: url.host,
      pathHash: stableHash(url.pathname),
      redactions: [...url.searchParams.keys()].map((key) => `url.query.${key}`).sort(),
    };
  } catch {
    return {
      host: null,
      pathHash: stableHash(rawUrl),
      redactions: ["url.invalid"],
    };
  }
}

function stableHash(input) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

module.exports = {
  CHANNEL,
  attachDiagnosticsWindow,
  createMainDiagnostics,
  emitMainDiagnostic,
};
