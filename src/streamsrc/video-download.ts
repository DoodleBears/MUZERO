/**
 * Video download orchestration (Phase 2): resolve a plan (video + audio + mux strategy),
 * download both tracks, mux them into one container, persist. Pure + injectable (no
 * store/bridge/db import) so it's unit-testable — the caller wires `resolvePlan` from the
 * provider + {@link buildDownloadPlan}, `fetchBytes` from the media proxy, `mux` from the
 * mediabunny worker (or transcode), and `store` from persistent-media storage. Mirrors
 * {@link ./cache-stream}'s never-throws, verdict-returning shape. See video PRD §4.3.
 */

import type { DiagnosticContext } from "@/lib/diagnostics";
import { createDiagnosticLogger } from "@/lib/logger";
import type { DownloadPlan } from "./download-plan";
import type { MuxContainer } from "./mux/mux-strategy";

/** What `resolvePlan` returns — an ok plan, or the same gates a playback resolve maps. */
export type ResolvedDownloadPlan =
  | { kind: "ok"; plan: DownloadPlan }
  | { kind: "requires-login" }
  | { kind: "no-permission"; reason: string }
  | { kind: "error"; message: string };

export type DownloadStage = "fetch" | "mux" | "store";

export interface RunVideoDownloadDeps {
  /** Resolve video + audio + mux strategy (provider calls live here, kept injectable). */
  resolvePlan: () => Promise<ResolvedDownloadPlan>;
  /** Download a track's bytes (caller injects proxy headers / CORS). */
  fetchBytes: (url: string, headers?: Record<string, string>) => Promise<Blob>;
  /** Combine video + audio into one container blob (copy-remux or transcode). */
  mux: (
    video: Blob,
    audio: Blob,
    plan: DownloadPlan,
    onProgress?: (ratio: number) => void,
  ) => Promise<Blob>;
  /** Persist the muxed bytes; returns the new MediaBlob id (+ storageKey when filed). */
  store: (blob: Blob, mime: string) => Promise<{ blobId: string; storageKey?: string }>;
  onProgress?: (stage: DownloadStage, ratio: number) => void;
  trace?: Pick<DiagnosticContext, "traceId" | "trackId" | "sessionId" | "sourceId">;
}

export type RunVideoDownloadResult =
  | { kind: "downloaded"; blobId: string; storageKey?: string; bytes: number; height: number }
  | { kind: "requires-login" }
  | { kind: "no-permission"; reason: string }
  | { kind: "error"; message: string };

const CONTAINER_MIME: Record<MuxContainer, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mkv: "video/x-matroska",
};

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));
const dlLog = createDiagnosticLogger("stream.video-download");

/** Resolve → fetch (video + audio) → mux → store. Never throws; returns a verdict. */
export async function runVideoDownload(
  deps: RunVideoDownloadDeps,
): Promise<RunVideoDownloadResult> {
  traceDownload("info", "download.start", deps.trace, { message: "video download started" });

  let resolved: ResolvedDownloadPlan;
  try {
    resolved = await deps.resolvePlan();
  } catch (err) {
    return fail(deps.trace, message(err), "network_error");
  }
  if (resolved.kind === "requires-login") {
    traceDownload("warn", "download.skipped", deps.trace, {
      message: "video download requires login",
      errorKind: "auth_required",
    });
    return { kind: "requires-login" };
  }
  if (resolved.kind === "no-permission") {
    traceDownload("warn", "download.skipped", deps.trace, {
      message: "video download denied",
      errorKind: "permission_denied",
    });
    return { kind: "no-permission", reason: resolved.reason };
  }
  if (resolved.kind !== "ok") return fail(deps.trace, resolved.message, "unknown");

  const { plan } = resolved;
  if (plan.strategy.kind === "unsupported") {
    return fail(deps.trace, plan.strategy.reason, "unsupported_source");
  }

  try {
    deps.onProgress?.("fetch", 0);
    // YouTube already has the bytes (blob transport); Bilibili carries a URL to fetch.
    const [videoBytes, audioBytes] = await Promise.all([
      plan.video.blob ?? deps.fetchBytes(plan.video.url ?? "", plan.video.headers),
      plan.audio.blob ?? deps.fetchBytes(plan.audio.mediaUrl ?? "", plan.audio.headers),
    ]);
    deps.onProgress?.("fetch", 1);

    const muxed = await deps.mux(videoBytes, audioBytes, plan, (r) => deps.onProgress?.("mux", r));

    const mime = CONTAINER_MIME[plan.strategy.container] ?? muxed.type ?? "video/mp4";
    const { blobId, storageKey } = await deps.store(muxed, mime);
    deps.onProgress?.("store", 1);

    traceDownload("info", "download.success", deps.trace, {
      message: "video download succeeded",
      bytes: muxed.size,
    });
    return {
      kind: "downloaded",
      blobId,
      storageKey,
      bytes: muxed.size,
      height: plan.video.height ?? 0,
    };
  } catch (err) {
    return fail(deps.trace, message(err), "network_error");
  }
}

function fail(
  trace: RunVideoDownloadDeps["trace"],
  msg: string,
  errorKind: DiagnosticContext["errorKind"],
): RunVideoDownloadResult {
  traceDownload("error", "download.failed", trace, { message: msg, errorKind });
  return { kind: "error", message: msg };
}

function traceDownload(
  level: "info" | "warn" | "error",
  event: string,
  trace: RunVideoDownloadDeps["trace"],
  context: { message: string } & Pick<DiagnosticContext, "errorKind" | "bytes">,
): void {
  if (!trace?.traceId) return;
  dlLog[level](event, { ...trace, ...context, category: "cache" });
}
