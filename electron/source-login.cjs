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
  void seedNeteaseClientCookies();
  ipcMain.handle("muzero:openSourceLogin", (_event, request) => openSourceLogin(request));
  ipcMain.handle("muzero:readSourceCookies", (_event, request) => readSourceCookies(request));
}

// NetEase's eapi (mobile/client) endpoint only honors VIP when the request carries
// os/appver client cookies. A *web* login sets MUSIC_U but not these, so seed them into
// the DEFAULT session — net.fetch (credentials:"include") then sends MUSIC_U + os + appver
// together. The `.music.163.com` domain covers music.163.com + interface.music.163.com.
async function seedNeteaseClientCookies() {
  try {
    const ses = session.defaultSession;
    for (const [name, value] of [
      ["os", "pc"],
      ["appver", "8.10.35"],
    ]) {
      await ses.cookies.set({
        url: "https://music.163.com",
        name,
        value,
        domain: ".music.163.com",
        path: "/",
      });
    }
  } catch {
    // best-effort; the header path still carries os/appver
  }
}

// Read the default session's cookies for a source's domains — used after an in-app
// QR login succeeds (the poll response's Set-Cookie was stored by net.fetch). Returns
// null until the auth cookie is present, so the renderer keeps polling.
async function readSourceCookies(request) {
  const { cookieUrls, authCookie } = request ?? {};
  if (!Array.isArray(cookieUrls)) return null;
  const ses = session.defaultSession;
  const out = [];
  for (const url of cookieUrls) {
    try {
      const cookies = await ses.cookies.get({ url });
      for (const c of cookies) out.push({ name: c.name, value: c.value });
    } catch {
      // no cookies for this domain yet
    }
  }
  if (authCookie && !out.some((c) => c.name === authCookie && c.value)) return null;
  return out;
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
