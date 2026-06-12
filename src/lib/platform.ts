/**
 * Platform detection + a CORS-safe `fetch`.
 *
 * The CORS-bypassing fetch now lives behind the {@link resolveDesktopBridge}
 * abstraction (Electron `muzfetch://` proxy / Tauri http plugin / plain global
 * fetch). `getAppFetch()` stays as a thin shim so its ~6 consumers (AI SDK,
 * musicgen adapter, all R2 sync) don't change.
 */

import { resolveDesktopBridge } from "@/lib/desktop/bridge";

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export interface OpenExternalUrlOptions {
  isTauriRuntime?: () => boolean;
  openUrl?: (url: string) => Promise<void>;
  openWindow?: (url: string, target: string, features: string) => Window | null | undefined;
}

type FetchFn = typeof globalThis.fetch;

/** The shell's CORS-bypassing `fetch` (Electron proxy / Tauri plugin / global). */
export async function getAppFetch(): Promise<FetchFn> {
  return resolveDesktopBridge().fetch;
}

/** Synchronous best-effort fetch for code paths that can't await (rarely needed). */
export const appFetch: FetchFn = (...args) =>
  getAppFetch().then((f) => f(...(args as Parameters<FetchFn>)));

/**
 * Opens a user-facing external URL in the system browser when running in Tauri,
 * with a browser fallback for Vite/dev/test. Only http(s) links are allowed.
 */
export async function openExternalUrl(
  rawUrl: string,
  options: OpenExternalUrlOptions = {},
): Promise<void> {
  const url = normalizeExternalUrl(rawUrl);
  const bridge = resolveDesktopBridge();
  if (bridge.kind === "electron" && !options.openWindow && !options.openUrl) {
    await bridge.openExternal(url);
    return;
  }
  const isTauriRuntime = options.isTauriRuntime ?? isTauri;
  if (isTauriRuntime()) {
    const openUrl = options.openUrl ?? (await loadTauriOpenUrl());
    await openUrl(url);
    return;
  }
  const openWindow = options.openWindow ?? window.open.bind(window);
  openWindow(url, "_blank", "noreferrer");
}

function normalizeExternalUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Unsupported external URL protocol");
  }
  return url.toString();
}

async function loadTauriOpenUrl(): Promise<(url: string) => Promise<void>> {
  const mod = await import("@tauri-apps/plugin-opener");
  return mod.openUrl;
}
