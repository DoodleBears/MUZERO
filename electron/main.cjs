const { existsSync, statSync } = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, net, protocol, shell } = require("electron");
const { registerIpc } = require("./ipc.cjs");
const { handleMuzfetch } = require("./fetch-proxy.cjs");

const devUrl = process.env.MUZERO_ELECTRON_URL;
const distDir = path.join(__dirname, "..", "dist");
const appOrigin = "app://muzero";
const distUrl = "app://muzero/index.html";

app.setName("MUZERO");
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

function createWindow() {
  const win = new BrowserWindow({
    backgroundColor: "#09090b",
    height: 780,
    minHeight: 600,
    minWidth: 380,
    show: false,
    title: "MUZERO",
    titleBarStyle: "hiddenInset",
    width: 1180,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  win.once("ready-to-show", () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (url === devUrl || url === distUrl) return;
    if (url.startsWith(appOrigin) && !devUrl) return;
    event.preventDefault();
    void shell.openExternal(url);
  });

  void win.loadURL(devUrl || distUrl);
  if (devUrl) win.webContents.openDevTools({ mode: "detach" });
}

app.whenReady().then(() => {
  registerDistProtocol();
  protocol.handle("muzfetch", handleMuzfetch);
  registerIpc();
  require("./source-login.cjs").registerSourceLogin();
  require("./updater.cjs").initDesktopUpdater();
  createWindow();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
