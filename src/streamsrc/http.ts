/**
 * The HTTP seam for stream sources — an injected client, so source providers are
 * unit-testable with a stub and have zero static dependency on the desktop bridge.
 *
 * In production this is backed by `getAppFetch()` (the muzfetch proxy), with the
 * restricted request headers (`Cookie` / `User-Agent` / `Referer`) passed as
 * `x-muzero-h-*` aliases the main process restores — Chromium's renderer `fetch`
 * forbids setting them directly. That wiring lives in the desktop layer (Phase 1
 * infra); this module only declares the contract the providers code against.
 */

import type { DiagnosticContext } from "@/lib/diagnostics";

export interface StreamHttpRequest {
  url: string;
  method?: "GET" | "POST";
  /** May include Cookie / User-Agent / Referer — the prod transport injects them via proxy. */
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  trace?: Pick<DiagnosticContext, "traceId" | "trackId" | "sessionId" | "sourceId">;
}

export interface StreamHttpResponse {
  status: number;
  /** Final URL after redirects (for share-link expansion). Surfaced by the muzfetch
   *  proxy via `x-muzero-final-url`; on web it's the native `Response.url`. */
  url?: string;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export type StreamHttp = (req: StreamHttpRequest) => Promise<StreamHttpResponse>;

/** Append query params to a URL, preserving any already present. */
export function withQuery(base: string, params: Record<string, string>): string {
  const qs = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  if (!qs) return base;
  return base.includes("?") ? `${base}&${qs}` : `${base}?${qs}`;
}
