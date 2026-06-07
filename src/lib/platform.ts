/**
 * Platform detection + a CORS-safe `fetch`.
 *
 * In a Tauri WebView we route LLM and music-generation HTTP through the Tauri
 * `http` plugin, which makes requests from the Rust side and bypasses browser
 * CORS / mixed-content rules (e.g. calling a BYOK cloud API that doesn't send
 * CORS headers). In a plain browser (vite dev, vitest) we fall back to the
 * global `fetch`. Providers in the AI SDK and our music-gen adapters accept this
 * shim so the same code path works everywhere.
 */

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export interface OpenExternalUrlOptions {
  isTauriRuntime?: () => boolean;
  openUrl?: (url: string) => Promise<void>;
  openWindow?: (url: string, target: string, features: string) => Window | null | undefined;
}

type FetchFn = typeof globalThis.fetch;

let cachedFetch: FetchFn | null = null;

/**
 * Returns a `fetch` that bypasses CORS inside Tauri. Async-resolves the Tauri
 * http plugin lazily so this module stays importable in a plain browser / tests.
 */
export async function getAppFetch(): Promise<FetchFn> {
  if (cachedFetch) return cachedFetch;
  if (isTauri()) {
    try {
      const mod = await import("@tauri-apps/plugin-http");
      cachedFetch = mod.fetch as unknown as FetchFn;
      return cachedFetch;
    } catch {
      // Plugin not available — fall through to the platform fetch.
    }
  }
  cachedFetch = globalThis.fetch.bind(globalThis);
  return cachedFetch;
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
