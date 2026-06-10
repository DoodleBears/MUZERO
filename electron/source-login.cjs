// Streaming-source login: open the source's real login page in a child window and
// capture its session cookie once it appears, so the renderer can store it (BYOK,
// device-local) to unlock VIP / higher quality. Uses the DEFAULT session so the
// cookies also persist in the app's cookie jar (net.fetch then sends them too) and a
// re-login is instant. Returns the RAW captured cookies (the renderer assembles the
// header via the tested assembleCookieHeader) or null if the user closes the window
// before logging in.
const { BrowserWindow, ipcMain, session } = require("electron");

const POLL_MS = 800;
const TIMEOUT_MS = 5 * 60 * 1000; // give up if the window sits open 5 min without auth

function registerSourceLogin() {
  ipcMain.handle("muzero:openSourceLogin", (_event, request) => openSourceLogin(request));
}

function openSourceLogin(request) {
  const { loginUrl, cookieUrls, authCookie } = request ?? {};
  if (!loginUrl || !Array.isArray(cookieUrls) || !authCookie) return Promise.resolve(null);

  return new Promise((resolve) => {
    const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
    const win = new BrowserWindow({
      parent: parent ?? undefined,
      width: 520,
      height: 720,
      title: "Sign in",
      autoHideMenuBar: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
    });
    const ses = session.defaultSession;
    const startedAt = Date.now();
    let settled = false;

    const onChanged = () => {
      void check();
    };

    function finish(value) {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      ses.cookies.removeListener("changed", onChanged);
      if (!win.isDestroyed()) win.close();
      resolve(value);
    }

    async function collect() {
      const out = [];
      for (const url of cookieUrls) {
        try {
          const cookies = await ses.cookies.get({ url });
          for (const c of cookies) out.push({ name: c.name, value: c.value });
        } catch {
          // a domain with no cookies yet — ignore
        }
      }
      return out;
    }

    async function check() {
      if (settled) return;
      const cookies = await collect();
      if (cookies.some((c) => c.name === authCookie && c.value)) {
        finish(cookies);
      } else if (Date.now() - startedAt > TIMEOUT_MS) {
        finish(null);
      }
    }

    const timer = setInterval(() => void check(), POLL_MS);
    ses.cookies.on("changed", onChanged);
    win.webContents.on("did-navigate", () => void check());
    win.on("closed", () => finish(null));
    win.loadURL(loginUrl);
  });
}

module.exports = { registerSourceLogin };
