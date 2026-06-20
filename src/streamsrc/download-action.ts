/**
 * UI-facing download glue: turn an online search hit into a downloaded, playable library
 * track. Wires the REAL deps (media-proxy fetch, mediabunny copy-remux, poster frame) into
 * {@link downloadStreamedVideoToLibrary} and ensures a dedicated "Downloads" set — the
 * decision/persist core stays pure + unit-tested; this module only assembles runtime IO.
 */

import { createSession, getSession, getSettings, saveSettings } from "@/db/repositories";
import i18n from "@/i18n/i18n";
import { resolveDesktopBridge } from "@/lib/desktop/bridge";
import { extractUsefulVideoPosterFrame } from "@/lib/video-poster-frame";
import { notify } from "@/stores/notification-store";
import { muxCopyTracksViaWorker } from "@/workers/video-mux-client";
import {
  type DownloadStreamedVideoResult,
  downloadStreamedVideoToLibrary,
} from "./download-to-library";
import type { StreamPart, StreamSearchHit, VideoQualityOption } from "./provider";
import { createStreamSource } from "./registry";
import { createStreamHttp } from "./stream-http";

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
    onProgress?: (stage: DownloadProgressStage, ratio: number) => void;
  },
): Promise<DownloadStreamedVideoResult> {
  const settings = await getSettings();
  const source = makeSource(hit.source, settings.streamSources?.[hit.source]?.cookie);
  if (!source) return { kind: "error", message: `${hit.source} unavailable` };
  const sessionId = await ensureDownloadsSet();
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

function stageDetail(stage: DownloadProgressStage): string {
  return stage === "fetch"
    ? i18n.t("download.stageFetch")
    : stage === "mux"
      ? i18n.t("download.stageMux")
      : i18n.t("download.stageStore");
}

function notifyResult(notifId: string, result: DownloadStreamedVideoResult, title: string): void {
  if (result.kind === "downloaded") {
    notify.update(notifId, {
      type: "success",
      message: i18n.t("download.done"),
      detail: title,
      duration: 3000,
    });
  } else if (result.kind === "requires-login") {
    notify.update(notifId, {
      type: "error",
      message: i18n.t("download.loginRequired"),
      detail: title,
    });
  } else if (result.kind === "no-permission") {
    notify.update(notifId, {
      type: "error",
      message: i18n.t("download.failed"),
      detail: result.reason,
    });
  } else {
    notify.update(notifId, {
      type: "error",
      message: i18n.t("download.failed"),
      detail: result.message,
    });
  }
}

/** Download one hit with its OWN progress notification; resolves when it finishes. */
async function downloadWithNotification(
  hit: StreamSearchHit,
  opts?: { quality?: string; audioOnly?: boolean },
): Promise<DownloadStreamedVideoResult> {
  const notifId = notify.loading(hit.title, { detail: stageDetail("fetch"), progress: 0 });
  let lastPct = -1;
  let result: DownloadStreamedVideoResult;
  try {
    result = await downloadStreamedHit(hit, {
      quality: opts?.quality,
      audioOnly: opts?.audioOnly,
      onProgress: (stage, ratio) => {
        if (stage === "fetch") {
          const pct = Math.round(ratio * 100);
          if (pct === lastPct) return; // throttle: ~100 updates max, not one per chunk
          lastPct = pct;
          notify.update(notifId, { progress: ratio, detail: `${pct}%` });
        } else {
          notify.update(notifId, { progress: 1, detail: stageDetail(stage) });
        }
      },
    });
  } catch (err) {
    result = { kind: "error", message: err instanceof Error ? err.message : String(err) };
  }
  notifyResult(notifId, result, hit.title);
  return result;
}

/**
 * Fire-and-forget download with a progress NOTIFICATION (no blocking modal). Returns
 * immediately; the user keeps using the app while it downloads in the background.
 */
export function startBackgroundDownload(
  hit: StreamSearchHit,
  opts?: { quality?: string; audioOnly?: boolean },
): void {
  void downloadWithNotification(hit, opts);
}

/**
 * Download many hits as video SEQUENTIALLY — each gets its own progress notification
 * (exactly like a single search download), at the default quality (prefer-match-else-
 * degrade). Sequential so a big favlist doesn't fire N parallel downloads / hit a rate
 * limit. Stops the batch on an auth wall.
 */
export async function downloadHitsAsVideo(
  hits: StreamSearchHit[],
  opts?: { quality?: string },
): Promise<{ ok: number; total: number }> {
  let ok = 0;
  for (const hit of hits) {
    const result = await downloadWithNotification(hit, { quality: opts?.quality });
    if (result.kind === "downloaded") ok += 1;
    else if (result.kind === "requires-login") break;
  }
  return { ok, total: hits.length };
}

/** Import a source playlist/favlist's videos, then download each as video (per-video progress). */
export async function downloadPlaylistVideos(
  sourceId: StreamSearchHit["source"],
  mediaId: string,
  opts?: { quality?: string },
): Promise<{ ok: number; total: number }> {
  const settings = await getSettings();
  const source = makeSource(sourceId, settings.streamSources?.[sourceId]?.cookie);
  if (!source?.importPlaylist) return { ok: 0, total: 0 };
  const hits = await source.importPlaylist(mediaId);
  return downloadHitsAsVideo(hits, opts);
}

/** Fire-and-forget batch (分P) download at the default quality, with N/total progress. */
export function startBackgroundBatchDownload(hit: StreamSearchHit, parts: StreamPart[]): void {
  if (parts.length === 0) return;
  const notifId = notify.loading(hit.title, {
    detail: i18n.t("download.downloadingPart", { done: 1, total: parts.length }),
  });
  void (async () => {
    let ok = 0;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      notify.update(notifId, {
        detail: i18n.t("download.downloadingPart", { done: i + 1, total: parts.length }),
      });
      const result = await downloadStreamedHit({
        ...hit,
        externalId: part.externalId,
        title: part.title,
        durationSec: part.durationSec ?? hit.durationSec,
      });
      if (result.kind === "downloaded") ok += 1;
      else if (result.kind === "requires-login") {
        notify.update(notifId, {
          type: "error",
          message: i18n.t("download.loginRequired"),
          detail: hit.title,
        });
        return;
      }
    }
    notify.update(notifId, {
      type: "success",
      message: i18n.t("download.doneCount", { count: ok }),
      detail: hit.title,
      duration: 3000,
    });
  })();
}
