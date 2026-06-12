import type { DiagnosticEntry } from "@/lib/diagnostics";
import type { DirEntryLike } from "@/lib/folder-import";
import { assembleCookieHeader, type StreamCookie } from "@/streamsrc/login";
import type { TrayActionId } from "@/tray/actions";
import type { TrayMenuModel } from "@/tray/menu-model";
import type {
  DesktopBridge,
  DesktopLiveRequestIntakeControls,
  DesktopPlatform,
  DesktopSystemShortcutConfigureResult,
  DesktopSystemShortcutRegistration,
  DesktopWindowState,
  LocalMediaUrlInput,
  MediaProxyTrace,
  MediaStorageFileInput,
  SaveFileInput,
  StreamLoginRequest,
  WriteMediaStorageFileInput,
} from "./bridge";

type FetchFn = typeof globalThis.fetch;

/** Shape the Electron preload exposes on `window.muzero` (see electron/preload.cjs). */
interface MuzeroApi {
  kind: "electron";
  platform?: DesktopPlatform;
  pickFolder(): Promise<string | null>;
  readDir(path: string): Promise<DirEntryLike[]>;
  readFile(path: string): Promise<ArrayBuffer>;
  grantFolderAccess(path: string): Promise<void>;
  localMediaToken(input: { path: string; mime?: string }): Promise<string>;
  saveFile(input: { fileName: string; mime: string; bytes: ArrayBuffer }): Promise<boolean>;
  writeMediaStorageFile(
    input: Omit<WriteMediaStorageFileInput, "bytes"> & { bytes: ArrayBuffer },
  ): Promise<void>;
  readMediaStorageFile(input: MediaStorageFileInput): Promise<ArrayBuffer>;
  deleteMediaStorageFile(input: MediaStorageFileInput): Promise<void>;
  statMediaStorageFile(input: MediaStorageFileInput): Promise<{ bytes: number } | null>;
  openMediaStorageFolder(): Promise<void>;
  openExternal(url: string): Promise<void>;
  setAppIcon(icon: string): Promise<void>;
  /** Main returns the RAW captured cookies (renderer assembles the header). */
  openSourceLogin(request: StreamLoginRequest): Promise<StreamCookie[] | null>;
  readSourceCookies(request: StreamLoginRequest): Promise<StreamCookie[] | null>;
  evalYoutubeN(functionSource: string, n: string): Promise<string>;
  windowControls?: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<DesktopWindowState>;
    close(): Promise<void>;
    hideToTray(): Promise<void>;
    showFromTray(): Promise<void>;
    quitApp(): Promise<void>;
    getState(): Promise<DesktopWindowState>;
    onStateChange(callback: (state: DesktopWindowState) => void): () => void;
  };
  tray?: {
    update(model: TrayMenuModel): Promise<void>;
    onAction(callback: (actionId: TrayActionId) => void): () => void;
  };
  diagnostics?: {
    onEvent(callback: (entry: DiagnosticEntry) => void): () => void;
  };
  systemShortcuts?: {
    configure(
      registrations: readonly DesktopSystemShortcutRegistration[],
    ): Promise<DesktopSystemShortcutConfigureResult>;
    onAction(callback: (actionId: string) => void): () => void;
  };
  liveRequestIntake?: DesktopLiveRequestIntakeControls;
}

const PROXY_URL = "muzfetch://proxy/";
const MEDIA_PROXY_URL = "muzfetch://media/";
const LOCAL_MEDIA_URL = "muzfetch://local-media/";
const TARGET_HEADER = "x-muzero-target";

/**
 * Build a `muzfetch://media/` URL an `<audio>`/`<video>` element can stream through
 * the proxy with injected request headers. A media element's own GET can't set
 * Referer/User-Agent, so the target URL + headers ride in the query (`__mzurl` +
 * `__mzh_<name>`); the main process restores them and preserves Range/206. Used for
 * Bilibili, whose CDN 403s a foreign Referer.
 */
export function electronMediaProxyUrl(
  url: string,
  headers?: Record<string, string>,
  trace?: string | MediaProxyTrace,
): string {
  const params = new URLSearchParams({ __mzurl: url });
  const traceContext = typeof trace === "string" ? { traceId: trace } : trace;
  if (traceContext?.traceId) params.set("__mztrace", traceContext.traceId);
  if (traceContext?.trackId) params.set("__mztrack", traceContext.trackId);
  if (traceContext?.sessionId) params.set("__mzsession", traceContext.sessionId);
  if (traceContext?.sourceId) params.set("__mzsource", traceContext.sourceId);
  if (traceContext?.videoId) params.set("__mzvideo", traceContext.videoId);
  if (headers) {
    for (const [name, value] of Object.entries(headers)) {
      params.set(`__mzh_${name.toLowerCase()}`, value);
    }
  }
  return `${MEDIA_PROXY_URL}?${params.toString()}`;
}

export function electronLocalMediaUrl(input: {
  token: string;
  mime?: string;
  sourcePath?: string;
  trace?: string | MediaProxyTrace;
}): string {
  const params = new URLSearchParams({ __mztoken: input.token });
  if (input.mime) params.set("__mzmime", input.mime);
  const traceContext = typeof input.trace === "string" ? { traceId: input.trace } : input.trace;
  if (traceContext?.traceId) params.set("__mztrace", traceContext.traceId);
  if (traceContext?.trackId) params.set("__mztrack", traceContext.trackId);
  if (traceContext?.sessionId) params.set("__mzsession", traceContext.sessionId);
  if (traceContext?.sourceId) params.set("__mzsource", traceContext.sourceId);
  if (traceContext?.videoId) params.set("__mzvideo", traceContext.videoId);
  return `${LOCAL_MEDIA_URL}?${params.toString()}`;
}

/**
 * Route every request through the privileged `muzfetch://` scheme, which the main
 * process handles via `net.fetch` (no renderer CORS / mixed-content). Streaming is
 * preserved in both directions — DJ SSE and large R2 PUT bodies flow through — and
 * the real target URL rides along in a header (the scheme can't carry an arbitrary
 * absolute URL safely). To `getAppFetch()` consumers this is just a `fetch`.
 */
const electronFetch: FetchFn = (input, init) => {
  const original = new Request(input as RequestInfo, init);
  const proxied = new Request(PROXY_URL, {
    method: original.method,
    headers: original.headers,
    body: original.body,
    signal: original.signal,
    // duplex is required by the Fetch spec when sending a streaming body.
    ...(original.body ? { duplex: "half" } : {}),
  } as RequestInit);
  proxied.headers.set(TARGET_HEADER, original.url);
  return globalThis.fetch(proxied);
};

export function createElectronBridge(): DesktopBridge {
  const api = window.muzero as unknown as MuzeroApi;
  return {
    kind: "electron",
    platform: api.platform,
    fetch: electronFetch,
    pickFolder: () => api.pickFolder(),
    readDir: (path) => api.readDir(path),
    // Join renderer-side (no IPC round-trip per entry): forward slashes are fine
    // because the main process realpath-normalizes every path before reading.
    join: (base, name) => `${base.replace(/[/\\]+$/, "")}/${name}`,
    readFile: async (path) => new Uint8Array(await api.readFile(path)),
    grantFolderAccess: (path) => api.grantFolderAccess(path),
    saveFile: ({ fileName, mime, bytes }: SaveFileInput) =>
      api.saveFile({ fileName, mime, bytes: toStandaloneBuffer(bytes) }),
    writeMediaStorageFile: ({ storageKey, bytes, expectedBytes }) =>
      api.writeMediaStorageFile({
        storageKey,
        bytes: toStandaloneBuffer(bytes),
        expectedBytes,
      }),
    readMediaStorageFile: async (input) => new Uint8Array(await api.readMediaStorageFile(input)),
    deleteMediaStorageFile: (input) => api.deleteMediaStorageFile(input),
    statMediaStorageFile: (input) => api.statMediaStorageFile(input),
    openMediaStorageFolder: () => api.openMediaStorageFolder(),
    openExternal: (url) => api.openExternal(url),
    setAppIcon: (icon) => api.setAppIcon(icon),
    mediaProxyUrl: electronMediaProxyUrl,
    localMediaUrl: async (input: LocalMediaUrlInput) => {
      const token = await api.localMediaToken({ path: input.path, mime: input.mime });
      return electronLocalMediaUrl({ token, mime: input.mime, trace: input.trace });
    },
    openSourceLogin: async (request) => {
      const cookies = await api.openSourceLogin(request);
      return cookies && cookies.length > 0 ? assembleCookieHeader(cookies) : null;
    },
    readSourceCookies: async (request) => {
      const cookies = await api.readSourceCookies(request);
      return cookies && cookies.length > 0 ? assembleCookieHeader(cookies) : null;
    },
    evalYoutubeN: (functionSource, n) => api.evalYoutubeN(functionSource, n),
    windowControls: api.windowControls
      ? {
          minimize: () => api.windowControls?.minimize() ?? Promise.resolve(),
          toggleMaximize: () =>
            api.windowControls?.toggleMaximize() ??
            Promise.resolve({ fullscreen: false, maximized: false }),
          close: () => api.windowControls?.close() ?? Promise.resolve(),
          hideToTray: () => api.windowControls?.hideToTray() ?? Promise.resolve(),
          showFromTray: () => api.windowControls?.showFromTray() ?? Promise.resolve(),
          quitApp: () => api.windowControls?.quitApp() ?? Promise.resolve(),
          getState: () =>
            api.windowControls?.getState() ??
            Promise.resolve({ fullscreen: false, maximized: false }),
          onStateChange: (callback) => api.windowControls?.onStateChange(callback) ?? (() => {}),
        }
      : undefined,
    systemShortcuts: api.systemShortcuts
      ? {
          configure: (registrations) =>
            api.systemShortcuts?.configure([...registrations]) ??
            Promise.resolve({ supported: false, statuses: [] }),
          onAction: (callback) => api.systemShortcuts?.onAction(callback) ?? (() => {}),
        }
      : undefined,
    liveRequestIntake: api.liveRequestIntake,
    tray: api.tray
      ? {
          update: (model) => api.tray?.update(model) ?? Promise.resolve(),
          onAction: (callback) => api.tray?.onAction(callback) ?? (() => {}),
        }
      : undefined,
  };
}

export function subscribeElectronDiagnostics(
  callback: (entry: DiagnosticEntry) => void,
): () => void {
  if (typeof window === "undefined") return () => undefined;
  const api = window.muzero as unknown as MuzeroApi | undefined;
  return api?.diagnostics?.onEvent(callback) ?? (() => undefined);
}

/** A standalone ArrayBuffer for IPC (not a view into a larger/shared buffer). */
function toStandaloneBuffer(bytes: Uint8Array): ArrayBuffer {
  if (
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength &&
    bytes.buffer instanceof ArrayBuffer
  ) {
    return bytes.buffer;
  }
  return bytes.slice().buffer;
}
