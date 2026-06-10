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

import type { DirEntryLike } from "@/lib/folder-import";
import { createElectronBridge } from "./electron";
import { createTauriBridge } from "./tauri";
import { createWebBridge } from "./web";

export type DesktopKind = "tauri" | "electron" | "web";

type FetchFn = typeof globalThis.fetch;

export interface SaveFileInput {
  fileName: string;
  mime: string;
  bytes: Uint8Array;
}

export interface DesktopBridge {
  readonly kind: DesktopKind;
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
  /** Open an http(s) URL in the system browser. */
  openExternal: (url: string) => Promise<void>;
  /**
   * Wrap a media URL so an `<audio>`/`<video>` element streams it through the
   * CORS-free proxy WITH injected request headers (Referer / User-Agent) the element
   * can't set itself, preserving Range/206 for seeking. Absent in web/tauri → the
   * caller uses the raw URL (fine for CDNs that don't gate on Referer, e.g. NetEase;
   * required for Bilibili, whose CDN 403s a foreign Referer).
   */
  mediaProxyUrl?: (url: string, headers?: Record<string, string>) => string;
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
