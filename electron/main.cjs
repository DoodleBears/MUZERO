const { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, Menu, net, protocol, screen, shell, Tray } = require("electron");
const { registerIpc } = require("./ipc.cjs");
const { handleMuzfetch } = require("./fetch-proxy.cjs");
const { registerElectronGlobalShortcuts } = require("./global-shortcuts.cjs");
const { registerLiveRequestIntake } = require("./live-request-intake.cjs");
const { registerPerfControl, shouldEnablePerfControl } = require("./perf-control.cjs");
const { applyAppIcon, appIconPath, DEFAULT_APP_ICON } = require("./app-icon.cjs");
const { attachDiagnosticsWindow } = require("./diagnostics.cjs");
const { createTrayController } = require("./tray.cjs");
const { windowPin } = require("./window-pin.cjs");

const devUrl = process.env.MUZERO_ELECTRON_URL;
const distDir = path.join(__dirname, "..", "dist");
const appOrigin = "app://muzero";
const distUrl = "app://muzero/index.html";
const isMac = process.platform === "darwin";
const isWindows = process.platform === "win32";
const defaultWindowBounds = { height: 780, width: 1180 };
const minWindowBounds = { height: 600, width: 380 };
const windowStateFileName = "window-state.json";
const trayController = createTrayController({
  app,
  iconPath: appIconPath(DEFAULT_APP_ICON),
  Menu,
  platform: process.platform,
  Tray,
});

app.setName("MUZERO");
// Dev-only renderer CPU-profiling seam (PRD 20260616-agent-cpu-profiling-harness): expose
// the Chromium remote-debugging port so a local script can attach CDP `Profiler` to the
// renderer and capture a .cpuprofile around a driven interaction. NEVER in a packaged
// build, and only when explicitly opted in (the port is a full debug surface). Origins
// are locked to loopback (CDP has no token) — appendSwitch must run before app ready.
if (!app.isPackaged && process.env.MUZERO_REMOTE_DEBUG_PORT) {
  const dbgPort = String(process.env.MUZERO_REMOTE_DEBUG_PORT);
  app.commandLine.appendSwitch("remote-debugging-port", dbgPort);
  app.commandLine.appendSwitch("remote-allow-origins", `http://127.0.0.1:${dbgPort}`);
}
protocol.registerSchemesAsPrivileged([
  { privileges: { secure: true, standard: true, supportFetchAPI: true }, scheme: "app" },
  // CORS-free fetch proxy: streaming both ways, bypasses CSP for the renderer.
  {
    scheme: "muzfetch",
    // corsEnabled: a `standard` scheme has its own origin, so fetch() from the
    // http(s) renderer is cross-origin and is blocked unless CORS is enabled here
    // (the proxy replies with access-control-allow-origin:*). Without it every
    // muzfetch call — R2 sync, AI, stream sources — fails with ERR_FAILED.
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      bypassCSP: true,
    },
  },
]);

function registerDistProtocol() {
  protocol.handle("app", (request) => {
    const url = new URL(request.url);
    const decoded = decodeURIComponent(url.pathname);
    const relative = path.normalize(decoded).replace(/^(\.\.([/\\]|$))+/, "").replace(/^[/\\]+/, "");
    const candidate = path.join(distDir, relative || "index.html");
    const insideDist = candidate === distDir || candidate.startsWith(`${distDir}${path.sep}`);
    let filePath = insideDist ? candidate : path.join(distDir, "index.html");
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      filePath = path.join(distDir, "index.html");
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

function isAppUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === "app:" && url.host === "muzero") return true;
    if (!devUrl) return false;
    const dev = new URL(devUrl);
    return url.protocol === dev.protocol && url.host === dev.host;
  } catch {
    return false;
  }
}

function isLoopbackUrl(url) {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
}

function openExternalFrom(source, rawUrl) {
  if (isAppUrl(rawUrl)) {
    console.warn(`[muzero:electron] blocked internal ${source}: ${rawUrl}`);
    return;
  }
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    console.warn(`[muzero:electron] blocked invalid ${source}: ${rawUrl}`);
    return;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    console.warn(`[muzero:electron] blocked non-http ${source}: ${rawUrl}`);
    return;
  }
  if (devUrl && isLoopbackUrl(url)) {
    console.warn(`[muzero:electron] blocked loopback ${source}: ${url.toString()}`);
    return;
  }
  console.warn(`[muzero:electron] open external from ${source}: ${url.toString()}`);
  void shell.openExternal(url.toString());
}

function windowStatePath() {
  return path.join(app.getPath("userData"), windowStateFileName);
}

function numberOrNull(value) {
  return Number.isFinite(value) ? Math.round(value) : null;
}

function intersectsDisplay(bounds) {
  return screen.getAllDisplays().some(({ workArea }) => {
    const right = bounds.x + bounds.width;
    const bottom = bounds.y + bounds.height;
    const displayRight = workArea.x + workArea.width;
    const displayBottom = workArea.y + workArea.height;
    return bounds.x < displayRight && right > workArea.x && bounds.y < displayBottom && bottom > workArea.y;
  });
}

function normalizeWindowState(raw) {
  if (!raw || typeof raw !== "object") return null;
  const width = Math.max(minWindowBounds.width, numberOrNull(raw.width) ?? defaultWindowBounds.width);
  const height = Math.max(
    minWindowBounds.height,
    numberOrNull(raw.height) ?? defaultWindowBounds.height,
  );
  const x = numberOrNull(raw.x);
  const y = numberOrNull(raw.y);
  const bounds = { height, width };
  if (x != null && y != null && intersectsDisplay({ height, width, x, y })) {
    bounds.x = x;
    bounds.y = y;
  }
  return { ...bounds, maximized: raw.maximized === true };
}

function readWindowState() {
  try {
    const file = windowStatePath();
    if (!existsSync(file)) return null;
    return normalizeWindowState(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return null;
  }
}

function writeWindowState(win) {
  if (win.isDestroyed() || win.isFullScreen()) return;
  const bounds = win.isMaximized() ? win.getNormalBounds() : win.getBounds();
  const state = {
    height: bounds.height,
    maximized: win.isMaximized(),
    width: bounds.width,
    x: bounds.x,
    y: bounds.y,
  };
  try {
    const file = windowStatePath();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(state, null, 2));
  } catch {
    // Best effort only; a failed write should never block app startup/shutdown.
  }
}

function persistWindowState(win) {
  let timer = null;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => writeWindowState(win), 350);
  };
  win.on("resize", schedule);
  win.on("move", schedule);
  win.on("maximize", schedule);
  win.on("unmaximize", schedule);
  win.on("close", () => {
    if (timer) clearTimeout(timer);
    writeWindowState(win);
  });
}

function createWindow() {
  const savedWindowState = readWindowState();
  const win = new BrowserWindow({
    autoHideMenuBar: true,
    backgroundColor: isWindows ? "#00000000" : "#09090b",
    // Default window/taskbar icon (Windows/Linux; ignored on macOS, which uses the
    // dock icon set in app.whenReady). The renderer refines it to the saved choice.
    icon: appIconPath(DEFAULT_APP_ICON),
    frame: !isWindows,
    height: savedWindowState?.height ?? defaultWindowBounds.height,
    hasShadow: true,
    minHeight: minWindowBounds.height,
    minWidth: minWindowBounds.width,
    show: false,
    title: "MUZERO",
    titleBarStyle: isMac ? "hiddenInset" : undefined,
    transparent: isWindows,
    width: savedWindowState?.width ?? defaultWindowBounds.width,
    ...(savedWindowState?.x != null && savedWindowState?.y != null
      ? { x: savedWindowState.x, y: savedWindowState.y }
      : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  if (isWindows) {
    win.removeMenu();
    win.setMenuBarVisibility(false);
  }

  const sendWindowState = () => {
    if (win.isDestroyed()) return;
    win.webContents.send("muzero:window:state", {
      fullscreen: win.isFullScreen(),
      maximized: win.isMaximized(),
      pinMode: windowPin.getMode(win),
    });
  };
  win.on("maximize", sendWindowState);
  win.on("unmaximize", sendWindowState);
  win.on("enter-full-screen", sendWindowState);
  win.on("leave-full-screen", sendWindowState);
  windowPin.attachFocusRecovery(win, sendWindowState);
  persistWindowState(win);

  win.once("ready-to-show", () => {
    if (savedWindowState?.maximized) win.maximize();
    win.show();
  });
  attachDiagnosticsWindow(win);
  // DevTools toggle. The Windows build strips the application menu (above), so the
  // default Ctrl+Shift+I / F12 accelerators are gone — wire them here on the
  // webContents so they work on every platform regardless of menu state.
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const key = input.key?.toLowerCase();
    const isToggleCombo = key === "i" && input.shift && (isMac ? input.meta : input.control);
    if (key === "f12" || isToggleCombo) {
      win.webContents.toggleDevTools();
      event.preventDefault();
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalFrom("window.open", url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (isAppUrl(url) || url === distUrl) return;
    event.preventDefault();
    openExternalFrom("will-navigate", url);
  });

  void win.loadURL(devUrl || distUrl);
  if (devUrl && process.env.MUZERO_ELECTRON_DEVTOOLS === "1") {
    win.webContents.openDevTools({ mode: "detach" });
  }
  trayController.attachWindow(win);
  return win;
}

app.whenReady().then(() => {
  if (isWindows) Menu.setApplicationMenu(null);
  registerDistProtocol();
  protocol.handle("muzfetch", handleMuzfetch);
  registerIpc({ trayController });
  registerElectronGlobalShortcuts();
  registerLiveRequestIntake({ BrowserWindow });
  require("./source-login.cjs").registerSourceLogin();
  require("./youtube-engine.cjs").registerYoutubeEngine();
  require("./updater.cjs").initDesktopUpdater();
  trayController.ensureTray();
  // Dev-only automation control endpoint. Never enabled in a packaged build (gate).
  if (shouldEnablePerfControl({ isPackaged: app.isPackaged, env: process.env })) {
    registerPerfControl({ app, BrowserWindow });
  }
  createWindow();
  trayController.onAction((actionId) => {
    const [win] = BrowserWindow.getAllWindows();
    switch (actionId) {
      case "window.show":
        trayController.showWindow(win);
        break;
      case "window.hide":
        trayController.hideToTray(win);
        break;
      case "app.quit":
        trayController.quitApp();
        break;
      default:
        if (win && !win.isDestroyed()) win.webContents.send("muzero:tray:action", actionId);
        break;
    }
  });
  // macOS dock icon (no window icon there). The renderer's use-app-icon hook
  // re-applies the user's saved variant once settings load.
  applyAppIcon(DEFAULT_APP_ICON);
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => {
  trayController.markQuitting();
});
app.on("activate", () => {
  const [win] = BrowserWindow.getAllWindows();
  if (win) {
    trayController.showWindow(win);
  } else {
    createWindow();
  }
});
