/**
 * Resolve a streamed track to a playable URL just before playback — the seam the
 * player calls. Kept pure + injectable (no store/bridge import) so it's unit-
 * testable; the player wires `resolveSource` from the registry + on-device settings.
 *
 * Streamed URLs are short-lived, so this runs per play (not stored). NetEase URLs
 * play directly in <audio>; Bilibili URLs carry `headers` (Referer) the media proxy
 * must inject — passed through here for the player to route once that's wired.
 */

import type { StreamSourceId } from "@/db/types";
import type { DiagnosticContext } from "@/lib/diagnostics";
import { sanitizeUrlForTrace } from "@/lib/diagnostics";
import { createDiagnosticLogger } from "@/lib/logger";
import type { StreamSourceProvider } from "./provider";

export interface StreamedTrackRef {
  streamSourceId?: StreamSourceId;
  streamExternalId?: string;
}

export interface ResolveStreamedDeps {
  /** Build/lookup the provider for a source (registry-backed in the player). */
  resolveSource: (id: StreamSourceId) => StreamSourceProvider | null;
  /** Preferred per-source quality key from settings. */
  getQuality?: (id: StreamSourceId) => string | undefined;
  signal?: AbortSignal;
  trace?: Pick<DiagnosticContext, "traceId" | "trackId" | "sessionId" | "sourceId">;
}

export type StreamPlaybackResult =
  | { kind: "ok"; url: string; mime: string; headers?: Record<string, string>; quality?: string }
  | { kind: "requires-login"; source: StreamSourceId }
  | { kind: "no-permission"; source: StreamSourceId; reason: string }
  | { kind: "error"; message: string };

const resolveLog = createDiagnosticLogger("stream.resolve");

/** Resolve a streamed track's current playable media, mapping provider verdicts. */
export async function resolveStreamedTrackMedia(
  track: StreamedTrackRef,
  deps: ResolveStreamedDeps,
): Promise<StreamPlaybackResult> {
  const { streamSourceId, streamExternalId } = track;
  if (!streamSourceId || !streamExternalId) {
    traceResolveFailed(deps.trace, "track has no stream source ref", { errorKind: "schema" });
    return { kind: "error", message: "track has no stream source ref" };
  }
  const source = deps.resolveSource(streamSourceId);
  if (!source) {
    traceResolveFailed(deps.trace, `stream source "${streamSourceId}" unavailable`, {
      sourceId: streamSourceId,
      errorKind: "unsupported_source",
    });
    return { kind: "error", message: `stream source "${streamSourceId}" unavailable` };
  }
  if (deps.trace?.traceId) {
    resolveLog.info("resolve.start", {
      message: "stream resolve started",
      ...deps.trace,
      sourceId: streamSourceId,
      category: "stream",
      phase: "start",
    });
  }
  const res = await source.resolve(streamExternalId, {
    quality: deps.getQuality?.(streamSourceId),
    signal: deps.signal,
    trace: deps.trace ? { ...deps.trace, sourceId: streamSourceId } : undefined,
  });
  switch (res.kind) {
    case "ok": {
      if (deps.trace?.traceId) {
        const url = sanitizeUrlForTrace(res.stream.mediaUrl);
        resolveLog.info("resolve.success", {
          message: "stream resolve succeeded",
          ...deps.trace,
          sourceId: streamSourceId,
          category: "stream",
          phase: "success",
          mime: res.stream.mime,
          quality: res.stream.quality,
          requestHost: url.host ?? undefined,
          requestPathHash: url.pathHash,
          redactions: url.redactions,
        });
      }
      return {
        kind: "ok",
        url: res.stream.mediaUrl,
        mime: res.stream.mime,
        headers: res.stream.headers,
        quality: res.stream.quality,
      };
    }
    case "requires-login":
      traceResolveFailed(deps.trace, "stream source requires login", {
        sourceId: streamSourceId,
        errorKind: "auth_required",
      });
      return { kind: "requires-login", source: streamSourceId };
    case "no-permission":
      traceResolveFailed(deps.trace, "stream source denied playback", {
        sourceId: streamSourceId,
        errorKind: "permission_denied",
      });
      return { kind: "no-permission", source: streamSourceId, reason: res.reason };
    default:
      traceResolveFailed(deps.trace, res.message, {
        sourceId: streamSourceId,
        errorKind: "unknown",
      });
      return { kind: "error", message: res.message };
  }
}

function traceResolveFailed(
  trace: ResolveStreamedDeps["trace"],
  message: string,
  context: Pick<DiagnosticContext, "sourceId" | "errorKind">,
): void {
  if (!trace?.traceId) return;
  resolveLog.error("resolve.failed", {
    message,
    ...trace,
    ...context,
    category: "stream",
    phase: "fail",
  });
}
