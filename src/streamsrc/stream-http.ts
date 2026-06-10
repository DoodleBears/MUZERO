/**
 * Production {@link StreamHttp} — backed by the shell's CORS-bypassing
 * `getAppFetch()` (the muzfetch proxy on Electron). Restricted request headers
 * (`Cookie` / `User-Agent` / `Referer` / `Origin`) are moved to `x-muzero-h-*`
 * aliases because Chromium's renderer `fetch` forbids setting them; the main-process
 * proxy restores the real names before `net.fetch`. Header aliasing is forward-
 * compatible: anonymous calls that need no restricted header work regardless.
 */

import { getAppFetch } from "@/lib/platform";
import type { StreamHttp } from "./http";

/** Header names a renderer `fetch` refuses to set — must ride as aliases. */
const RESTRICTED = new Set(["cookie", "user-agent", "referer", "origin"]);
export const STREAM_HEADER_ALIAS_PREFIX = "x-muzero-h-";

/** Rewrite restricted headers to `x-muzero-h-<lower-name>`; pass the rest through. */
export function aliasRestrictedHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (RESTRICTED.has(lower)) out[`${STREAM_HEADER_ALIAS_PREFIX}${lower}`] = value;
    else out[name] = value;
  }
  return out;
}

type FetchFn = typeof globalThis.fetch;

/**
 * Build a StreamHttp. `fetchFactory` defaults to {@link getAppFetch}; injectable so
 * providers can be exercised without the desktop bridge.
 */
export function createStreamHttp(fetchFactory: () => Promise<FetchFn> = getAppFetch): StreamHttp {
  return async (req) => {
    const doFetch = await fetchFactory();
    const res = await doFetch(req.url, {
      method: req.method ?? "GET",
      headers: aliasRestrictedHeaders(req.headers ?? {}),
      body: req.body,
      signal: req.signal,
    });
    return {
      status: res.status,
      text: () => res.text(),
      json: () => res.json(),
    };
  };
}
