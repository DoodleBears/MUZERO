import type { DesktopBridge } from "./bridge";

/**
 * Plain-browser bridge (Vite dev, vitest, or a hosted web build). No filesystem
 * or save dialog → callers fall back to `<input webkitdirectory>` / anchor
 * downloads. `fetch` is the global (subject to CORS — BYOK endpoints must allow it).
 */
export function createWebBridge(): DesktopBridge {
  return {
    kind: "web",
    fetch: globalThis.fetch.bind(globalThis),
    openExternal: async (rawUrl) => {
      const url = new URL(rawUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("Unsupported external URL protocol");
      }
      window.open(url.toString(), "_blank", "noreferrer");
    },
  };
}
