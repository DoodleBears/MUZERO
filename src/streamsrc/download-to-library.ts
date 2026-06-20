/**
 * Download a streamed video INTO the library as a playable local track (video PRD §3.1,
 * Open Q2): resolve video+audio → fetch/blob → copy-remux → persist the muxed bytes as
 * the track's media blob, keeping `origin:"streamed"` + the source ref (so it still shows
 * provenance and can re-resolve) but now backed by a local file → the player's existing
 * `if (track.blobId)` branch plays it offline.
 *
 * IO (byte fetch + mux) is injected so the decision flow is unit-testable; the DB writes
 * reuse the proven `createStreamedTrack` / `cacheStreamedTrackBlob` (Phase 5) repo.
 */

import type { MediaBlobStorageOptions } from "@/db/media-blob-storage";
import { db as defaultDb, type MuzeroDB } from "@/db/muzero-db";
import { prependTrackIds } from "@/db/repositories";
import type { StreamSourceMeta } from "@/db/types";
import { buildDownloadPlan } from "./download-plan";
import { classifyAudioCodec, type MuxContainer } from "./mux/mux-strategy";
import type { StreamSourceProvider } from "./provider";
import { cacheStreamedTrackBlob, createStreamedTrack } from "./streamed-track-repo";

const CONTAINER_MIME: Record<MuxContainer, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mkv: "video/x-matroska",
};

export interface DownloadStreamedVideoDeps {
  /** Fetch a track's bytes (Bilibili URL via the media proxy); unused for blob transport. */
  fetchBytes: (url: string, headers?: Record<string, string>) => Promise<Blob>;
  /** Copy-remux video + audio into one container blob. */
  mux: (video: Blob, audio: Blob, container: MuxContainer) => Promise<Blob>;
  /** Progress 0..1 per stage. */
  onProgress?: (stage: "fetch" | "mux" | "store", ratio: number) => void;
  db?: MuzeroDB;
  /** Media-blob storage backend (defaults to the app's; injectable for tests). */
  storage?: MediaBlobStorageOptions;
}

export interface DownloadStreamedVideoInput {
  source: StreamSourceProvider;
  /** The set the downloaded track is added to (e.g. a "Downloads" session). */
  sessionId: string;
  externalId: string;
  title: string;
  meta?: StreamSourceMeta;
  coverUrl?: string;
  /** Video quality key (e.g. "1080" / "max"); passed to the source's resolveVideo. */
  quality?: string;
}

export type DownloadStreamedVideoResult =
  | { kind: "downloaded"; trackId: string; bytes: number; height: number; container: MuxContainer }
  | { kind: "requires-login" }
  | { kind: "no-permission"; reason: string }
  | { kind: "error"; message: string };

/** Resolve → fetch/blob → mux → persist as a local-backed streamed video track. */
export async function downloadStreamedVideoToLibrary(
  input: DownloadStreamedVideoInput,
  deps: DownloadStreamedVideoDeps,
): Promise<DownloadStreamedVideoResult> {
  const db = deps.db ?? defaultDb;
  const { source, externalId } = input;
  if (!source.resolveVideo) return { kind: "error", message: `${source.id} has no video download` };

  const videoRes = await source.resolveVideo(externalId, { quality: input.quality });
  if (videoRes.kind === "requires-login") return { kind: "requires-login" };
  if (videoRes.kind === "no-permission") return { kind: "no-permission", reason: videoRes.reason };
  if (videoRes.kind !== "ok") return { kind: "error", message: videoRes.message };

  const audioRes = await source.resolve(externalId, {});
  if (audioRes.kind === "requires-login") return { kind: "requires-login" };
  if (audioRes.kind === "no-permission") return { kind: "no-permission", reason: audioRes.reason };
  if (audioRes.kind !== "ok") return { kind: "error", message: audioRes.message };

  const plan = buildDownloadPlan(videoRes.video, audioRes.stream);
  if (plan.strategy.kind !== "copy") {
    return {
      kind: "error",
      message: "in-app download needs a copy-muxable format (forced transcode is Phase 3)",
    };
  }
  const container = plan.strategy.container;

  try {
    deps.onProgress?.("fetch", 0);
    const [videoBlob, audioBlob] = await Promise.all([
      plan.video.blob ?? deps.fetchBytes(plan.video.url ?? "", plan.video.headers),
      plan.audio.blob ?? deps.fetchBytes(plan.audio.mediaUrl ?? "", plan.audio.headers),
    ]);
    deps.onProgress?.("fetch", 1);

    const muxed = await deps.mux(videoBlob, audioBlob, container);
    deps.onProgress?.("mux", 1);

    const track = await createStreamedTrack(
      {
        sessionId: input.sessionId,
        sourceId: source.id,
        externalId,
        title: input.title,
        kind: "video",
        coverUrl: input.coverUrl,
        meta: input.meta,
      },
      db,
    );
    await prependTrackIds(input.sessionId, [track.id], db);
    await cacheStreamedTrackBlob(track.id, muxed, CONTAINER_MIME[container], db, deps.storage);
    await db.tracks.update(track.id, {
      kind: "video",
      durationSec: input.meta?.durationSec ?? track.durationSec,
      downloadedVideoHeight: videoRes.video.height,
      downloadedContainer: container,
      downloadedCodecs: `${videoRes.video.codec}+${classifyAudioCodec(audioRes.stream.mime)}`,
      updatedAt: Date.now(),
    });
    deps.onProgress?.("store", 1);

    return {
      kind: "downloaded",
      trackId: track.id,
      bytes: muxed.size,
      height: videoRes.video.height ?? 0,
      container,
    };
  } catch (err) {
    return { kind: "error", message: err instanceof Error ? err.message : String(err) };
  }
}
