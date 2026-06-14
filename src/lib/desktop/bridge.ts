/**
 * Desktop shell abstraction. Every native capability the app needs — CORS-free
 * fetch, folder picking, filesystem reads, save dialogs, opening external links —
 * goes through a single {@link DesktopBridge}, resolved once per session by
 * runtime (Electron → Tauri → plain web). This is the seam that lets us pivot
 * the shell (currently Electron-primary, Tauri kept runnable) without scattering
 * `import("@tauri-apps/...")` / `window.muzero` checks across the app.
 *
 * Discipline (see CLAUDE.md): `src/**` must NOT touch a shell API directly — call
 * `resolveDesktopBridge()`. Adding a capability = extend this interface + the
 * three implementations (tauri/electron/web).
 */

import type { AppIconId } from "@/lib/app-icon";
import type { DiagnosticContext } from "@/lib/diagnostics";
import type { DirEntryLike } from "@/lib/folder-import";
import type { TrayActionId } from "@/tray/actions";
import type { TrayMenuModel } from "@/tray/menu-model";
import { createElectronBridge } from "./electron";
import { createTauriBridge } from "./tauri";
import { createWebBridge } from "./web";

export type DesktopKind = "tauri" | "electron" | "web";
export type DesktopPlatform =
  | "aix"
  | "darwin"
  | "freebsd"
  | "linux"
  | "openbsd"
  | "sunos"
  | "win32"
  | "cygwin"
  | "netbsd";

type FetchFn = typeof globalThis.fetch;
export type MediaProxyTrace = Pick<
  DiagnosticContext,
  "traceId" | "trackId" | "sessionId" | "sourceId" | "videoId"
>;

export interface SaveFileInput {
  fileName: string;
  mime: string;
  bytes: Uint8Array;
}

export interface MediaStorageFileInput {
  storageKey: string;
}

export interface WriteMediaStorageFileInput extends MediaStorageFileInput {
  bytes: Uint8Array;
  expectedBytes?: number;
}

export interface LocalMediaUrlInput {
  path: string;
  mime?: string;
  trace?: string | MediaProxyTrace;
}

export interface LocalMediaStorageUrlInput {
  /** A `MediaBlob.storageKey` for an app-managed persistent-media file. */
  storageKey: string;
  mime?: string;
}

export interface MediaStorageFileStat {
  bytes: number;
}

export type DesktopWindowPinMode = "off" | "pin" | "pin-click-through";

export interface DesktopClickThroughRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DesktopWindowState {
  fullscreen: boolean;
  maximized: boolean;
  pinMode?: DesktopWindowPinMode;
}

export interface DesktopWindowControls {
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<DesktopWindowState>;
  setPinMode?: (mode: DesktopWindowPinMode) => Promise<DesktopWindowState>;
  cyclePinMode?: () => Promise<DesktopWindowState>;
  /**
   * Pause/restore OS mouse-passthrough WITHOUT changing the pin mode, so a hovered
   * control (the unpin button) can be clicked while a pin-click-through window
   * otherwise stays click-through. No-op unless currently pin-click-through.
   */
  setClickThroughPaused?: (paused: boolean) => Promise<void>;
  setClickThroughRegions?: (regions: readonly DesktopClickThroughRegion[]) => Promise<void>;
  close: () => Promise<void>;
  hideToTray?: () => Promise<void>;
  showFromTray?: () => Promise<void>;
  quitApp?: () => Promise<void>;
  getState: () => Promise<DesktopWindowState>;
  onClickThroughHover?: (callback: (hovered: boolean) => void) => () => void;
  onStateChange?: (callback: (state: DesktopWindowState) => void) => () => void;
}

export interface DesktopSystemShortcutRegistration {
  actionId: string;
  accelerator: string;
}

export interface DesktopSystemShortcutStatus extends DesktopSystemShortcutRegistration {
  status: "active" | "failed";
  reason?: string;
}

export interface DesktopSystemShortcutConfigureResult {
  supported: boolean;
  statuses: DesktopSystemShortcutStatus[];
}

export interface DesktopSystemShortcuts {
  configure: (
    registrations: readonly DesktopSystemShortcutRegistration[],
  ) => Promise<DesktopSystemShortcutConfigureResult>;
  onAction: (callback: (actionId: string) => void) => () => void;
}

export interface DesktopTrayControls {
  update: (model: TrayMenuModel) => Promise<void>;
  onAction?: (callback: (actionId: TrayActionId) => void) => () => void;
}

export interface DesktopBridge {
  readonly kind: DesktopKind;
  readonly platform?: DesktopPlatform;
  /**
   * A `fetch` that bypasses browser CORS / mixed-content for BYOK + R2 calls.
   * MUST support streaming bodies (DJ SSE, large R2 PUTs). Synchronous to call;
   * implementations may lazily resolve the underlying transport internally.
   */
  fetch: FetchFn;
  /** Native folder picker → absolute path, or null if cancelled. Absent in web. */
  pickFolder?: () => Promise<string | null>;
  /** List one directory level (the scanner recurses itself). Absent in web. */
  readDir?: (path: string) => Promise<DirEntryLike[]>;
  /** Read a file's bytes (ArrayBuffer-backed so it's a valid `BlobPart`). Absent in web. */
  readFile?: (path: string) => Promise<Uint8Array<ArrayBuffer>>;
  /** Join a path segment (platform separator aware). Absent in web. */
  join?: (base: string, name: string) => Promise<string> | string;
  /** Add a folder to the runtime read allowlist (Tauri scope / Electron in-memory). */
  grantFolderAccess?: (path: string) => Promise<void>;
  /** Save-as dialog + write. Absent in web → caller falls back to a browser download. */
  saveFile?: (input: SaveFileInput) => Promise<boolean>;
  /** Write an app-managed persistent media file. Electron only for now. */
  writeMediaStorageFile?: (input: WriteMediaStorageFileInput) => Promise<void>;
  /** Read an app-managed persistent media file. Electron only for now. */
  readMediaStorageFile?: (input: MediaStorageFileInput) => Promise<Uint8Array<ArrayBuffer>>;
  /** Delete an app-managed persistent media file. Electron only for now. */
  deleteMediaStorageFile?: (input: MediaStorageFileInput) => Promise<void>;
  /** Stat an app-managed persistent media file. Electron only for now. */
  statMediaStorageFile?: (input: MediaStorageFileInput) => Promise<MediaStorageFileStat | null>;
  /** Reveal the app-managed persistent media/cache folder in the OS file manager. */
  openMediaStorageFolder?: () => Promise<void>;
  /** Open an http(s) URL in the system browser. */
  openExternal: (url: string) => Promise<void>;
  /**
   * Swap the RUNNING dock / taskbar icon to a built-in variant (the user's
   * choice in Settings → Appearance). Electron only — web/tauri omit it, so the
   * apply hook + the Settings picker no-op there. The installed bundle icon is
   * static (baked at build time); this only affects the live process.
   */
  setAppIcon?: (icon: AppIconId) => Promise<void>;
  /** Frameless desktop shell controls. Electron Windows uses these for custom chrome. */
  windowControls?: DesktopWindowControls;
  /** Electron OS-level global shortcut registration; absent on web/Tauri v1. */
  systemShortcuts?: DesktopSystemShortcuts;
  /** Native system tray menu bridge. Electron desktop only for v1. */
  tray?: DesktopTrayControls;
  /**
   * Start a native window drag for the current press (frameless window move).
   * Tauri only — Electron drags via `-webkit-app-region` CSS, web has no window —
   * so absent elsewhere. Call synchronously from a `mousedown`. See {@link dragWindowOnEmptyPress}.
   */
  startWindowDrag?: () => Promise<void>;
  /**
   * Wrap a media URL so an `<audio>`/`<video>` element streams it through the
   * CORS-free proxy WITH injected request headers (Referer / User-Agent) the element
   * can't set itself, preserving Range/206 for seeking. Absent in web/tauri → the
   * caller uses the raw URL (fine for CDNs that don't gate on Referer, e.g. NetEase;
   * required for Bilibili, whose CDN 403s a foreign Referer).
   */
  mediaProxyUrl?: (
    url: string,
    headers?: Record<string, string>,
    trace?: string | MediaProxyTrace,
  ) => string;
  /**
   * Build a tokenized local-media URL for an Electron-granted absolute source path.
   * The returned URL must not contain the raw path; the main process validates and
   * stores the path behind a short opaque token.
   */
  localMediaUrl?: (input: LocalMediaUrlInput) => Promise<string>;
  /**
   * Like {@link localMediaUrl} but for an app-managed persistent-media file
   * addressed by its `MediaBlob.storageKey` (covers/media) — the main process
   * resolves the key to a file under the media root with the same traversal-safe
   * mapping as fs IPC, behind a token. Lets an `<img>`/`<video>` load it natively
   * instead of `blob → object URL → a JS-heap bitmap`. Electron only.
   */
  localMediaUrlForStorageKey?: (input: LocalMediaStorageUrlInput) => Promise<string>;
  /**
   * Open a streaming source's real login page in a desktop auth window and resolve
   * the captured `Cookie:` header once the session cookie appears (or null if the
   * user closes it first). The cookie is stored on-device (BYOK) to unlock VIP /
   * higher quality. Absent in web/tauri (no privileged window). See `src/streamsrc/login.ts`.
   */
  openSourceLogin?: (request: StreamLoginRequest) => Promise<string | null>;
  /**
   * Read the current session's `Cookie:` header for a source's domains — used after
   * an in-app QR login succeeds (the platform's poll response Set-Cookie is stored in
   * the default session by net.fetch). Returns null until the auth cookie is present.
   */
  readSourceCookies?: (request: StreamLoginRequest) => Promise<string | null>;
  /**
   * Run YouTube's extracted `n`-throttling function source on a value inside a Node
   * `vm` sandbox in the main process (never the renderer's own realm). The source is
   * parsed from player.js by tested TS (`youtube-nsig`); this just evaluates it.
   * Absent in web/tauri → YouTube playback is desktop-only.
   */
  evalYoutubeN?: (functionSource: string, n: string) => Promise<string>;
}

/** What the desktop auth window needs to drive a source login + capture its cookie. */
export interface StreamLoginRequest {
  loginUrl: string;
  cookieUrls: string[];
  authCookie: string;
}

declare global {
  interface Window {
    /** Injected by the Electron preload (contextBridge). Presence ⇒ Electron runtime. */
    muzero?: { kind: "electron" } & Record<string, unknown>;
    __TAURI_INTERNALS__?: unknown;
  }
}

let cached: DesktopBridge | null = null;

/** Detect the host shell. Electron is checked first (it's the primary target). */
export function desktopKind(): DesktopKind {
  if (typeof window === "undefined") return "web";
  if (window.muzero?.kind === "electron") return "electron";
  if ("__TAURI_INTERNALS__" in window) return "tauri";
  return "web";
}

/** The session's desktop bridge (cached). Lazily builds the matching implementation. */
export function resolveDesktopBridge(): DesktopBridge {
  if (cached) return cached;
  // The three factories are cheap and side-effect-free: the Tauri one keeps its
  // heavy `@tauri-apps/*` modules behind lazy `import()` inside each method, so
  // statically importing all three never loads a shell SDK we aren't running.
  switch (desktopKind()) {
    case "electron":
      cached = createElectronBridge();
      break;
    case "tauri":
      cached = createTauriBridge();
      break;
    default:
      cached = createWebBridge();
  }
  return cached;
}

/** Test seam: force a specific bridge (or clear with `null`). */
export function __setDesktopBridge(bridge: DesktopBridge | null): void {
  cached = bridge;
}

/** Whether the current shell can pick + read local folders (Tauri or Electron). */
export function hasFolderAccess(): boolean {
  const bridge = resolveDesktopBridge();
  return Boolean(bridge.pickFolder && bridge.readDir && bridge.readFile);
}

/**
 * Whether the shell can stream external sources (NetEase / Bilibili / YouTube) — it
 * needs the CORS-free fetch + media proxy (Referer/UA injection + Range). Only
 * Electron implements `mediaProxyUrl` today; web/tauri return false, so the UI hides
 * the online-source entry points there (per the streaming-sources PRD, desktop-only).
 */
export function hasStreamingSources(): boolean {
  return Boolean(resolveDesktopBridge().mediaProxyUrl);
}

/**
 * Whether the shell can swap the running app icon (Electron only). Gates the
 * Settings → Appearance "App Icon" picker, which is meaningless on web/tauri.
 */
export function hasAppIcon(): boolean {
  return Boolean(resolveDesktopBridge().setAppIcon);
}
