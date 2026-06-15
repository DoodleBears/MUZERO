// Zero-dependency Chrome DevTools Protocol client (PRD 20260616-agent-cpu-profiling-harness).
// Node 22+ ships a global WebSocket + fetch, so we talk CDP (JSON-RPC over WS) directly —
// no chrome-remote-interface / puppeteer (keeps the "no new runtime owner" discipline).

/** List CDP targets from the renderer debug port and pick the app's page target. */
export async function pickPageTarget(port, urlMatch) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!res.ok) throw new Error(`/json/list ${res.status} — is electron:dev up with MUZERO_REMOTE_DEBUG_PORT=${port}?`);
  const targets = await res.json();
  const pages = targets.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (pages.length === 0) throw new Error("no page targets on the debug port");
  const match = urlMatch ? pages.find((t) => String(t.url).includes(urlMatch)) : undefined;
  return match ?? pages[0];
}

/** Connect to a target's webSocketDebuggerUrl and return a tiny CDP session. */
export async function connectCdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("CDP websocket error")), { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();

  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id != null && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message} (CDP)`));
      else resolve(msg.result);
      return;
    }
    if (msg.method) {
      const cbs = listeners.get(msg.method);
      if (cbs) for (const cb of cbs) cb(msg.params);
    }
  });

  return {
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    on(method, cb) {
      if (!listeners.has(method)) listeners.set(method, new Set());
      listeners.get(method).add(cb);
    },
    close() {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    },
  };
}
