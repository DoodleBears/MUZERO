/**
 * UI-facing download glue: turn an online search hit into a downloaded, playable library
 * track. Wires the REAL deps (media-proxy fetch, mediabunny copy-remux, poster frame) into
 * {@link downloadStreamedVideoToLibrary} and ensures a dedicated "Downloads" set — the
 * decision/persist core stays pure + unit-tested; this module only assembles runtime IO.
 */

import {
  clearAllDownloadJobs,
  clearFinishedDownloadJobs,
  deleteDownloadJob,
  listDownloadJobs,
  putDownloadJob,
  updateDownloadJob,
} from "@/db/download-job-repo";
import {
  createSession,
  findSessionByStreamPlaylist,
  getSession,
  getSettings,
  saveSettings,
} from "@/db/repositories";
import type { DownloadJob } from "@/db/types";
import i18n from "@/i18n/i18n";
import { resolveDesktopBridge } from "@/lib/desktop/bridge";
import { newId } from "@/lib/id";
import { extractUsefulVideoPosterFrame } from "@/lib/video-poster-frame";
import { notify } from "@/stores/notification-store";
import { muxCopyTracksViaWorker } from "@/workers/video-mux-client";
import type { EnqueueInput } from "./download-queue";
import { createDownloadQueueRunner, type DownloadQueueRunner } from "./download-queue-runner";
import {
  type DownloadStreamedVideoResult,
  downloadStreamedVideoToLibrary,
} from "./download-to-library";
import { cacheStreamPlaylistCover, cacheStreamPlaylistTrackCovers } from "./playlist-cover-cache";
import type { StreamPart, StreamSearchHit, VideoQualityOption } from "./provider";
import { createStreamSource } from "./registry";
import { isTrackCacheableToDevice } from "./source-detect";
import { createStreamHttp } from "./stream-http";
import { addHitsToSet } from "./streamed-track-repo";

/** Effective default download resolution when the user hasn't set one (Settings shows this). */
export const DEFAULT_VIDEO_QUALITY = "1080";

function makeSource(sourceId: StreamSearchHit["source"], cookie?: string) {
  return createStreamSource(sourceId, {
    http: createStreamHttp(),
    now: () => Date.now(),
    getCookie: () => cookie,
  });
}

/** Find-or-create the dedicated Downloads set (stable via a settings id, like the online set). */
async function ensureDownloadsSet(): Promise<string> {
  const settings = await getSettings();
  if (settings.streamDownloadsSetId) {
    const existing = await getSession(settings.streamDownloadsSetId);
    if (existing) return existing.id;
  }
  const session = await createSession({
    name: i18n.t("download.setName"),
    seedPrompt: "",
    config: { autoExtend: false },
    displayMode: "video",
  });
  await saveSettings({ streamDownloadsSetId: session.id });
  return session.id;
}

/** List the selectable video qualities for a hit (empty if the source can't download video). */
export async function listDownloadQualities(hit: StreamSearchHit): Promise<VideoQualityOption[]> {
  const settings = await getSettings();
  const source = makeSource(hit.source, settings.streamSources?.[hit.source]?.cookie);
  if (!source?.listVideoQualities) return [];
  return source.listVideoQualities(hit.externalId);
}

/** List a video's parts (分P); [] for single-part or sources without multi-part support. */
export async function listVideoParts(hit: StreamSearchHit): Promise<StreamPart[]> {
  const settings = await getSettings();
  const source = makeSource(hit.source, settings.streamSources?.[hit.source]?.cookie);
  if (!source?.listParts) return [];
  return source.listParts(hit.externalId);
}

const videoCapable = new Map<string, boolean>();

/** Whether a source can download video at all (gates the download button). Cached per id. */
export function canDownloadVideo(sourceId: StreamSearchHit["source"]): boolean {
  const cached = videoCapable.get(sourceId);
  if (cached !== undefined) return cached;
  // Audio-only sources (netease / qq) don't implement resolveVideo — data-driven, no id list.
  const ok = Boolean(makeSource(sourceId)?.resolveVideo);
  videoCapable.set(sourceId, ok);
  return ok;
}

export type DownloadProgressStage = "fetch" | "mux" | "store";

/** Download a hit at the chosen quality into the Downloads set as a playable local track. */
export async function downloadStreamedHit(
  hit: StreamSearchHit,
  opts?: {
    quality?: string;
    audioOnly?: boolean;
    /** Land the track in THIS set (favlist/playlist downloads); else the generic Downloads set. */
    sessionId?: string;
    onProgress?: (stage: DownloadProgressStage, ratio: number) => void;
  },
): Promise<DownloadStreamedVideoResult> {
  const settings = await getSettings();
  const source = makeSource(hit.source, settings.streamSources?.[hit.source]?.cookie);
  if (!source) return { kind: "error", message: `${hit.source} unavailable` };
  const sessionId = opts?.sessionId ?? (await ensureDownloadsSet());
  const bridge = resolveDesktopBridge();
  // No explicit pick (batch / quick download) → fall back to the configured default quality;
  // the source's selector degrades to the closest available tier (prefer-match-else-downgrade).
  const quality = opts?.quality ?? settings.defaultVideoQuality ?? DEFAULT_VIDEO_QUALITY;

  return downloadStreamedVideoToLibrary(
    {
      source,
      sessionId,
      externalId: hit.externalId,
      title: hit.title,
      coverUrl: hit.coverUrl,
      meta: {
        artist: hit.artist,
        album: hit.album,
        coverUrl: hit.coverUrl,
        durationSec: hit.durationSec,
      },
      quality,
      audioOnly: opts?.audioOnly,
    },
    {
      fetchBytes: async (url, headers, onBytes) => {
        const proxied = bridge.mediaProxyUrl ? bridge.mediaProxyUrl(url, headers) : url;
        const resp = await fetch(proxied);
        if (!resp.ok) throw new Error(`fetch ${resp.status}`);
        // The media proxy strips content-length (Chromium stream validation) but echoes
        // it as x-muzero-content-length for download readers.
        const total =
          Number(
            resp.headers.get("content-length") || resp.headers.get("x-muzero-content-length"),
          ) || 0;
        if (!onBytes || !total || !resp.body) return resp.blob();
        // Stream the body so we can report byte progress (single video → real %).
        const reader = resp.body.getReader();
        const chunks: BlobPart[] = [];
        let loaded = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            loaded += value.length;
            onBytes(loaded, total);
          }
        }
        return new Blob(chunks, { type: resp.headers.get("content-type") ?? "" });
      },
      mux: (video, audio, container) => muxCopyTracksViaWorker(video, audio, container),
      posterFrame: async (video, durationSec) => {
        const file = new File([video], "download.mp4", { type: video.type || "video/mp4" });
        const poster = await extractUsefulVideoPosterFrame(file, { durationSec });
        return poster ? { blob: poster.blob, mime: poster.mime } : null;
      },
      onProgress: opts?.onProgress,
    },
  );
}

/**
 * Fire-and-forget single download → the persistent queue. Returns immediately; the user keeps
 * using the app while it downloads. Going through the queue (not a bare fetch) gives automatic
 * retry with backoff on transient CDN failures (Bilibili's `ERR_HTTP2_PROTOCOL_ERROR`, dropped
 * connections) — each attempt re-resolves a fresh signed URL, so a flaky mirror is sidestepped —
 * plus restart recovery and dedupe. Live progress shows in the floating badge + Downloads panel.
 */
export function startBackgroundDownload(
  hit: StreamSearchHit,
  opts?: { quality?: string; audioOnly?: boolean },
): void {
  void enqueueDownload({
    source: hit.source,
    externalId: hit.externalId,
    title: hit.title,
    coverUrl: hit.coverUrl,
    quality: opts?.quality,
    audioOnly: opts?.audioOnly,
  }).then(() => notify.success(i18n.t("download.queued"), { detail: hit.title }));
}

/**
 * Resolve a favlist/playlist ref to its hits + the settings used to fetch it — the shared
 * head of {@link downloadPlaylistVideos} and {@link downloadPlaylistVideosToSet}. Returns
 * null when the source can't import playlists OR the playlist is empty (both callers map
 * that to their own empty result), so the two functions differ ONLY in how they resolve the
 * target set — not in this preamble.
 */
async function resolvePlaylistHits(
  sourceId: StreamSearchHit["source"],
  mediaId: string,
): Promise<{ hits: StreamSearchHit[]; settings: Awaited<ReturnType<typeof getSettings>> } | null> {
  const settings = await getSettings();
  const source = makeSource(sourceId, settings.streamSources?.[sourceId]?.cookie);
  if (!source?.importPlaylist) return null;
  const hits = await source.importPlaylist(mediaId);
  if (hits.length === 0) return null;
  return { hits, settings };
}

/**
 * Add a favlist's hits to `setId`, then enqueue VIDEO downloads for the ones not already
 * local — the shared spine of {@link downloadPlaylistVideos} (ref-bound set) and
 * {@link downloadPlaylistVideosToSet} (explicit set). The two differ only in set resolution;
 * this is their identical tail. `tracks` is 1:1 with `hits` (addHitsToSet pushes one row per
 * hit, in order), so `tracks[i]` is always defined — no guard needed.
 */
async function addAndQueuePlaylistVideos(
  setId: string,
  hits: StreamSearchHit[],
  quality: string,
  onProgress?: (done: number, total: number) => void,
): Promise<{ added: number; skipped: number; queued: number }> {
  const { added, skipped, tracks } = await addHitsToSet(setId, hits, undefined, onProgress);
  void cacheStreamPlaylistTrackCovers({ sessionId: setId, hits });
  // Only enqueue items not already downloaded locally — never re-download a video you have.
  const pending = hits.filter((_, i) => isTrackCacheableToDevice(tracks[i]));
  const queued = await enqueueHitsForDownload(pending, { sessionId: setId, quality });
  return { added, skipped, queued };
}

/**
 * Import a favlist/playlist's videos INTO its own bound set (create/find by `streamPlaylistRef`),
 * add the items so the 歌单 shows them, then enqueue each for video download targeting that set —
 * so the synced favlist's tracks become local videos IN PLACE (not dumped in a generic bucket).
 */
export async function downloadPlaylistVideos(
  sourceId: StreamSearchHit["source"],
  mediaId: string,
  opts?: { quality?: string; name?: string; coverUrl?: string },
): Promise<{ queued: number; setId: string | null }> {
  const resolved = await resolvePlaylistHits(sourceId, mediaId);
  if (!resolved) return { queued: 0, setId: null };
  const { hits, settings } = resolved;

  let set = await findSessionByStreamPlaylist(sourceId, mediaId);
  if (!set) {
    set = await createSession({
      name: opts?.name ?? mediaId,
      seedPrompt: "",
      config: { autoExtend: false },
      displayMode: "video",
      streamPlaylistRef: { source: sourceId, id: mediaId },
    });
    if (opts?.coverUrl)
      void cacheStreamPlaylistCover({ sessionId: set.id, coverUrl: opts.coverUrl });
  }
  const quality = opts?.quality ?? settings.defaultVideoQuality ?? DEFAULT_VIDEO_QUALITY;
  const { queued } = await addAndQueuePlaylistVideos(set.id, hits, quality);
  return { queued, setId: set.id };
}

/**
 * Incremental favlist re-sync into an EXPLICIT set (the matched 歌单, or one the user picks)
 * rather than the playlist-ref-bound set {@link downloadPlaylistVideos} resolves: add the
 * items (deduped, with progress) then enqueue each for video download targeting THAT set.
 *
 * Why this exists: the old re-sync path cached to in-memory blobs WITHOUT the persistent
 * queue, so a 收藏夹 → 同一歌单 re-sync downloaded no MVs and showed no download progress
 * (the indicator only watches `downloadJobs`). Going through the queue gives the synced
 * favlist the same in-place video download + unified progress as a fresh import.
 */
export async function downloadPlaylistVideosToSet(
  sourceId: StreamSearchHit["source"],
  mediaId: string,
  targetSetId: string,
  opts?: { quality?: string; onProgress?: (done: number, total: number) => void },
): Promise<{ added: number; skipped: number; queued: number }> {
  // Incremental: addAndQueuePlaylistVideos downloads only what isn't already local — the NEW
  // items plus any existing refs never downloaded (e.g. added by the old no-download re-sync
  // path). Already-downloaded MVs are skipped, so re-syncing a 收藏夹 doesn't re-pull videos
  // you already have.
  const resolved = await resolvePlaylistHits(sourceId, mediaId);
  if (!resolved) return { added: 0, skipped: 0, queued: 0 };
  const { hits, settings } = resolved;
  const quality = opts?.quality ?? settings.defaultVideoQuality ?? DEFAULT_VIDEO_QUALITY;
  return addAndQueuePlaylistVideos(targetSetId, hits, quality, opts?.onProgress);
}

// ---- Persistent download queue (PRD 20260621): concurrency + retry + restart recovery ----

let queueConcurrency = 2;
let queueRunner: DownloadQueueRunner | null = null;

function getQueueRunner(): DownloadQueueRunner {
  if (queueRunner) return queueRunner;
  queueRunner = createDownloadQueueRunner({
    now: () => Date.now(),
    newId: () => newId("dlj"),
    getConcurrency: () => queueConcurrency,
    listJobs: () => listDownloadJobs(),
    putJob: (job) => putDownloadJob(job),
    updateJob: (id, patch) => updateDownloadJob(id, patch),
    runJob: async (job, onProgress) => {
      const result = await downloadStreamedHit(
        {
          source: job.source,
          externalId: job.externalId,
          title: job.title,
          coverUrl: job.coverUrl,
        },
        {
          quality: job.quality,
          audioOnly: job.audioOnly,
          // Land favlist/playlist downloads in their own set (the bound 歌单), not the generic
          // Downloads bucket — so the synced set's items become local videos in place.
          sessionId: job.sessionId,
          // P1: byte-fraction only (×100). Phase 2 (resume) reports real bytes.
          onProgress: (stage, ratio) => {
            if (stage === "fetch") onProgress(Math.round(ratio * 100), 100);
          },
        },
      );
      if (result.kind === "downloaded")
        return { ok: true, trackId: result.trackId, retriable: false };
      if (result.kind === "requires-login") return { ok: false, retriable: false, error: "login" };
      if (result.kind === "no-permission")
        return { ok: false, retriable: false, error: result.reason };
      return { ok: false, retriable: true, error: result.message }; // network/expired → retry
    },
    scheduleRetry: (delayMs, cb) => {
      setTimeout(cb, delayMs);
    },
    // Terminal failure (login/permission, or out of retries) → a copyable error toast. The
    // detail line is concise; the copy button carries the full message + stack (errorToText
    // preserved it from the throw site through `lastError`).
    onPermanentFailure: (job) => {
      const raw = job.lastError ?? "";
      if (raw === "login") {
        notify.error(i18n.t("player.streamNeedsAccess"), { detail: job.title });
        return;
      }
      notify.error(i18n.t("download.failed"), {
        detail: job.title,
        debug: {
          message: raw.split("\n")[0] || job.title,
          stack: raw,
          source: `download:${job.source}`,
        },
      });
    },
  });
  return queueRunner;
}

/** Add a download to the persistent queue (deduped). The runner drives it per concurrency. */
export function enqueueDownload(input: EnqueueInput): Promise<DownloadJob> {
  return getQueueRunner().enqueue(input);
}

/** On app start: refresh concurrency from settings + resume jobs left mid-flight (rule: persist + recover). */
export async function recoverDownloadQueue(): Promise<void> {
  const settings = await getSettings();
  queueConcurrency = Math.max(1, settings.downloadConcurrency ?? 2);
  await getQueueRunner().recover();
}

/** Panel action: re-queue a failed/cancelled job (keeps bytesDone for resume). */
export async function retryDownload(id: string): Promise<void> {
  await updateDownloadJob(id, { status: "pending", lastError: undefined });
  void getQueueRunner().tick();
}

/** Panel action: remove a job from the queue. */
export async function removeDownload(id: string): Promise<void> {
  await deleteDownloadJob(id);
}

/** Panel action: clear all finished (done) jobs. */
export async function clearFinishedDownloads(): Promise<number> {
  return clearFinishedDownloadJobs();
}

/** Panel action: clear every job (in-flight downloads finish in the background). */
export async function clearAllDownloads(): Promise<number> {
  return clearAllDownloadJobs();
}

/**
 * Enqueue every 分P part for video download (default quality) through the persistent
 * queue. Returns the count queued. Going through the queue (not a direct fetch loop) is
 * what gives分P downloads the same retry / restart-recovery / dedupe as single + favlist
 * downloads — and surfaces their progress in the unified download indicator. The
 * `enqueue` dep is injected for tests.
 */
export async function enqueuePartsForDownload(
  hit: StreamSearchHit,
  parts: StreamPart[],
  enqueue: (input: EnqueueInput) => Promise<unknown> = enqueueDownload,
): Promise<number> {
  for (const part of parts) {
    await enqueue({
      source: hit.source,
      externalId: part.externalId,
      title: part.title,
      coverUrl: hit.coverUrl,
    });
  }
  return parts.length;
}

/**
 * Enqueue each hit for VIDEO download (default quality) targeting `sessionId`, through the
 * persistent queue — so a favlist import / re-sync downloads its MVs in place AND surfaces
 * progress in the unified download indicator. Mirrors {@link enqueuePartsForDownload}; the
 * `enqueue` dep is injected for tests. Returns the count enqueued.
 */
export async function enqueueHitsForDownload(
  hits: StreamSearchHit[],
  opts: { sessionId?: string; quality?: string },
  enqueue: (input: EnqueueInput) => Promise<unknown> = enqueueDownload,
): Promise<number> {
  for (const hit of hits) {
    await enqueue({
      source: hit.source,
      externalId: hit.externalId,
      title: hit.title,
      coverUrl: hit.coverUrl,
      sessionId: opts.sessionId,
      quality: opts.quality,
    });
  }
  return hits.length;
}

/** Fire-and-forget batch (分P) download → the persistent queue (progress shows in the indicator). */
export function startBackgroundBatchDownload(hit: StreamSearchHit, parts: StreamPart[]): void {
  if (parts.length === 0) return;
  void enqueuePartsForDownload(hit, parts).then((count) =>
    notify.success(i18n.t("download.queuedVideos", { count })),
  );
}
