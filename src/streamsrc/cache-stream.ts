/**
 * Offline-cache orchestration (Phase 5): resolve a streamed track to a playable URL,
 * download the bytes, persist them. Pure + injectable (no store/bridge/db import) so
 * it's unit-testable; the player wires `resolve` from the registry, `fetchBytes` from
 * the media proxy, and `store` from {@link cacheStreamedTrackBlob}.
 *
 * Maps provider verdicts the same way playback does — a VIP/login gate is reported,
 * not cached, so the UI can prompt instead of writing a broken blob.
 */

import type { DiagnosticContext } from "@/lib/diagnostics";
import { createDiagnosticLogger } from "@/lib/logger";
import type { StreamPlaybackResult } from "./resolve-playback";

export interface RunStreamCacheDeps {
  /** Resolve the track to a playable URL (already account/quality-bound). */
  resolve: () => Promise<StreamPlaybackResult>;
  /** Download the resolved media (the caller injects proxy headers / CORS). */
  fetchBytes: (url: string, headers?: Record<string, string>) => Promise<Blob>;
  /** Persist the bytes + set the track's blobId (cacheStreamedTrackBlob bound to the id). */
  store: (blob: Blob, mime: string) => Promise<string>;
  trace?: Pick<DiagnosticContext, "traceId" | "trackId" | "sessionId" | "sourceId">;
}

export type RunStreamCacheResult =
  | { kind: "cached"; blobId: string; bytes: number }
  | { kind: "requires-login" }
  | { kind: "no-permission"; reason: string }
  | { kind: "error"; message: string };

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const cacheLog = createDiagnosticLogger("stream.cache");

/** Resolve → download → store. Never throws; returns a verdict. */
export async function runStreamCache(deps: RunStreamCacheDeps): Promise<RunStreamCacheResult> {
  traceCache("info", "cache.start", deps.trace, {
    message: "stream cache started",
    phase: "start",
  });
  let resolved: StreamPlaybackResult;
  try {
    resolved = await deps.resolve();
  } catch (err) {
    traceCache("error", "cache.failed", deps.trace, {
      message: message(err),
      phase: "fail",
      errorKind: "network_error",
    });
    return { kind: "error", message: message(err) };
  }
  if (resolved.kind === "requires-login") {
    traceCache("warn", "cache.skipped", deps.trace, {
      message: "stream cache requires login",
      phase: "skip",
      errorKind: "auth_required",
    });
    return { kind: "requires-login" };
  }
  if (resolved.kind === "no-permission") {
    traceCache("warn", "cache.skipped", deps.trace, {
      message: "stream cache denied playback",
      phase: "skip",
      errorKind: "permission_denied",
    });
    return { kind: "no-permission", reason: resolved.reason };
  }
  if (resolved.kind !== "ok") {
    traceCache("error", "cache.failed", deps.trace, {
      message: resolved.message,
      phase: "fail",
      errorKind: "unknown",
    });
    return { kind: "error", message: resolved.message };
  }
  try {
    const blob =
      resolved.blob ??
      (resolved.url ? await deps.fetchBytes(resolved.url, resolved.headers) : null);
    if (!blob) {
      // Contract violation — an ok resolve always carries one of blob/url.
      traceCache("error", "cache.failed", deps.trace, {
        message: "resolved stream has neither blob nor url",
        phase: "fail",
        errorKind: "unknown",
      });
      return { kind: "error", message: "resolved stream has neither blob nor url" };
    }
    const mime = resolved.mime || blob.type || "audio/mpeg";
    const blobId = await deps.store(blob, mime);
    traceCache("info", "cache.success", deps.trace, {
      message: "stream cache succeeded",
      phase: "success",
      bytes: blob.size,
      mime,
    });
    return { kind: "cached", blobId, bytes: blob.size };
  } catch (err) {
    traceCache("error", "cache.failed", deps.trace, {
      message: message(err),
      phase: "fail",
      errorKind: "network_error",
    });
    return { kind: "error", message: message(err) };
  }
}

function traceCache(
  level: "info" | "warn" | "error",
  event: string,
  trace: RunStreamCacheDeps["trace"],
  context: {
    message: string;
  } & Pick<DiagnosticContext, "phase" | "errorKind" | "bytes" | "mime">,
): void {
  if (!trace?.traceId) return;
  cacheLog[level](event, {
    ...trace,
    ...context,
    category: "cache",
  });
}
