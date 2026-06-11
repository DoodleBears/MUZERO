/**
 * Production {@link StreamHttp} — backed by the shell's CORS-bypassing
 * `getAppFetch()` (the muzfetch proxy on Electron). Restricted request headers
 * (`Cookie` / `User-Agent` / `Referer` / `Origin`) are moved to `x-muzero-h-*`
 * aliases because Chromium's renderer `fetch` forbids setting them; the main-process
 * proxy restores the real names before `net.fetch`. Header aliasing is forward-
 * compatible: anonymous calls that need no restricted header work regardless.
 */

import { sanitizeUrlForTrace } from "@/lib/diagnostics";
import { createDiagnosticLogger } from "@/lib/logger";
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
const httpLog = createDiagnosticLogger("stream.http");

/**
 * Build a StreamHttp. `fetchFactory` defaults to {@link getAppFetch}; injectable so
 * providers can be exercised without the desktop bridge.
 */
export function createStreamHttp(fetchFactory: () => Promise<FetchFn> = getAppFetch): StreamHttp {
  return async (req) => {
    const doFetch = await fetchFactory();
    const method = req.method ?? "GET";
    traceHttp("debug", "request.start", req.url, req.trace, {
      message: "stream http request started",
      phase: "start",
      method,
    });
    let res: Response;
    try {
      res = await doFetch(req.url, {
        method,
        headers: aliasRestrictedHeaders(req.headers ?? {}),
        body: req.body,
        signal: req.signal,
      });
    } catch (error) {
      traceHttp("error", "request.failed", req.url, req.trace, {
        message: error instanceof Error ? error.message : String(error),
        phase: "fail",
        errorKind: "network_error",
        method,
      });
      throw error;
    }
    traceHttp(
      res.status >= 400 ? "error" : "debug",
      res.status >= 400 ? "request.failed" : "request.success",
      req.url,
      req.trace,
      {
        message: "stream http response received",
        phase: res.status >= 400 ? "fail" : "success",
        errorKind: res.status >= 400 ? "http_status" : undefined,
        method,
        httpStatus: res.status,
      },
    );
    return {
      status: res.status,
      text: () => res.text(),
      json: () => res.json(),
    };
  };
}

function traceHttp(
  level: "debug" | "error",
  event: string,
  url: string,
  trace: Parameters<StreamHttp>[0]["trace"],
  context: {
    message: string;
    phase: "start" | "success" | "fail";
    method: string;
    errorKind?: "network_error" | "http_status";
    httpStatus?: number;
  },
): void {
  if (!trace?.traceId) return;
  const safeUrl = sanitizeUrlForTrace(url);
  httpLog[level](event, {
    ...trace,
    ...context,
    category: "network",
    requestHost: safeUrl.host ?? undefined,
    requestPathHash: safeUrl.pathHash,
    redactions: safeUrl.redactions,
  });
}
