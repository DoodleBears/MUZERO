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
