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
import { prependTrackIds, setTrackCover } from "@/db/repositories";
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
  /** Extract a poster frame from the muxed video (fallback cover; needs DOM, so injected). */
  posterFrame?: (video: Blob, durationSec?: number) => Promise<{ blob: Blob; mime: string } | null>;
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

    // Enrich title / meta / OFFICIAL cover from the source for explicit-id downloads that
    // came without search-hit metadata (Bilibili `view.pic`, YouTube thumbnail).
    let { title, meta, coverUrl } = input;
    if ((!coverUrl || !title || title === externalId) && source.getTracksByIds) {
      try {
        const [hit] = await source.getTracksByIds([externalId]);
        if (hit) {
          coverUrl ??= hit.coverUrl;
          if (!title || title === externalId) title = hit.title;
          meta ??= {
            artist: hit.artist,
            album: hit.album,
            coverUrl: hit.coverUrl,
            durationSec: hit.durationSec,
          };
        }
      } catch {
        // best-effort enrichment
      }
    }

    const track = await createStreamedTrack(
      {
        sessionId: input.sessionId,
        sourceId: source.id,
        externalId,
        title,
        kind: "video",
        coverUrl,
        meta,
      },
      db,
    );
    await prependTrackIds(input.sessionId, [track.id], db);
    await cacheStreamedTrackBlob(track.id, muxed, CONTAINER_MIME[container], db, deps.storage);
    await db.tracks.update(track.id, {
      kind: "video",
      durationSec: meta?.durationSec ?? track.durationSec,
      downloadedVideoHeight: videoRes.video.height,
      downloadedContainer: container,
      downloadedCodecs: `${videoRes.video.codec}+${classifyAudioCodec(audioRes.stream.mime)}`,
      updatedAt: Date.now(),
    });

    // Cover (best-effort; never fails the download): prefer the source's official cover,
    // else extract a poster frame from the downloaded video itself.
    await applyDownloadedCover(track.id, {
      coverUrl,
      video: muxed,
      durationSec: meta?.durationSec,
      fetchBytes: deps.fetchBytes,
      posterFrame: deps.posterFrame,
      db,
      storage: deps.storage,
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

/**
 * Give a downloaded track a local cover (best-effort — a missing cover never fails the
 * download): prefer the source's official cover URL (downloaded to a local blob, so it's
 * offline + WebGL-safe), else fall back to a poster frame extracted from the video.
 */
async function applyDownloadedCover(
  trackId: string,
  opts: {
    coverUrl?: string;
    video: Blob;
    durationSec?: number;
    fetchBytes: DownloadStreamedVideoDeps["fetchBytes"];
    posterFrame?: DownloadStreamedVideoDeps["posterFrame"];
    db: MuzeroDB;
    storage?: MediaBlobStorageOptions;
  },
): Promise<void> {
  if (opts.coverUrl) {
    try {
      // No headers — cover CDNs (e.g. hdslb) reject a foreign Referer; the proxy strips it.
      const blob = await opts.fetchBytes(opts.coverUrl);
      if (blob.size > 0) {
        await setTrackCover(
          { trackId, blob, mime: blob.type || "image/jpeg" },
          opts.db,
          opts.storage,
        );
        return;
      }
    } catch {
      // fall through to a poster frame
    }
  }
  if (opts.posterFrame) {
    try {
      const poster = await opts.posterFrame(opts.video, opts.durationSec);
      if (poster && poster.blob.size > 0) {
        await setTrackCover(
          { trackId, blob: poster.blob, mime: poster.mime },
          opts.db,
          opts.storage,
        );
      }
    } catch {
      // best-effort: a cover is a nice-to-have, not required
    }
  }
}

export interface RecoverCoverDeps {
  fetchBytes: (url: string, headers?: Record<string, string>) => Promise<Blob>;
  /** Read a stored media blob by id (for the poster fallback) — injected from the repo. */
  readMedia?: (blobId: string) => Promise<Blob | null>;
  posterFrame?: (video: Blob, durationSec?: number) => Promise<{ blob: Blob; mime: string } | null>;
  db?: MuzeroDB;
  storage?: MediaBlobStorageOptions;
}

/**
 * Add/refresh a cover on an EXISTING streamed track WITHOUT re-downloading the video:
 * fetch the source's official cover (preferred), else extract a poster from the already-
 * stored media blob. For backfilling tracks downloaded before cover support existed.
 */
export async function recoverStreamedTrackCover(
  trackId: string,
  source: StreamSourceProvider,
  deps: RecoverCoverDeps,
): Promise<{ ok: boolean; via?: "official" | "poster"; coverUrl?: string }> {
  const db = deps.db ?? defaultDb;
  const track = await db.tracks.get(trackId);
  if (!track?.streamExternalId) return { ok: false };

  let coverUrl: string | undefined;
  if (source.getTracksByIds) {
    try {
      const [hit] = await source.getTracksByIds([track.streamExternalId]);
      coverUrl = hit?.coverUrl;
    } catch {
      // fall through
    }
  }
  if (coverUrl) {
    try {
      const blob = await deps.fetchBytes(coverUrl);
      if (blob.size > 0) {
        await setTrackCover({ trackId, blob, mime: blob.type || "image/jpeg" }, db, deps.storage);
        return { ok: true, via: "official", coverUrl };
      }
    } catch {
      // fall through to poster
    }
  }
  if (deps.posterFrame && deps.readMedia && track.blobId) {
    try {
      const media = await deps.readMedia(track.blobId);
      const poster = media ? await deps.posterFrame(media, track.durationSec) : null;
      if (poster && poster.blob.size > 0) {
        await setTrackCover({ trackId, blob: poster.blob, mime: poster.mime }, db, deps.storage);
        return { ok: true, via: "poster" };
      }
    } catch {
      // best-effort
    }
  }
  return { ok: false };
}
