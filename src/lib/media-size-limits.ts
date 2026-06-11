/**
 * Whole-file in-memory guards for remote media (memory-perf-audit PRD F-8).
 *
 * Playback preload, R2 offline caching and musicgen downloads all buffer the
 * full response via `response.blob()` — fine for songs, an OOM risk for a
 * multi-hundred-MB remote video (Chromium may disk-back large blobs; Tauri's
 * WKWebView gives no such guarantee). One shared cap; oversized files SKIP the
 * cache/warmup path and play via the streaming `loadUrl` route instead.
 */

export const REMOTE_MEDIA_CACHE_MAX_BYTES = 256 * 1024 * 1024;

type HeadersLike = { headers: { get(name: string): string | null } };

/** Parsed `content-length` in bytes, or null when missing/malformed (chunked). */
export function responseContentLength(response: HeadersLike): number | null {
  const raw = response.headers.get("content-length");
  if (!raw) return null;
  const bytes = Number(raw);
  return Number.isFinite(bytes) && bytes >= 0 ? bytes : null;
}

/** True when the declared size is past the cap. Unknown size → false (still cached). */
export function exceedsRemoteMediaCacheLimit(
  response: HeadersLike,
  maxBytes: number = REMOTE_MEDIA_CACHE_MAX_BYTES,
): boolean {
  const bytes = responseContentLength(response);
  return bytes !== null && bytes > maxBytes;
}

/** Thrown by cache paths so per-track callers count a failure and move on. */
export class RemoteMediaTooLargeError extends Error {
  override readonly name = "RemoteMediaTooLargeError";

  constructor(bytes: number, maxBytes: number) {
    super(`remote media is ${bytes} bytes — past the ${maxBytes} byte cache cap`);
  }
}
