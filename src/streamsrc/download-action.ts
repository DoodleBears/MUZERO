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
import { muxCopyTracksViaWorker } from "@/workers/video-mux-client";
import {
  type DownloadStreamedVideoResult,
  downloadStreamedVideoToLibrary,
} from "./download-to-library";
import type { StreamSearchHit, VideoQualityOption } from "./provider";
import { createStreamSource } from "./registry";
import { createStreamHttp } from "./stream-http";

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
    onProgress?: (stage: DownloadProgressStage, ratio: number) => void;
  },
): Promise<DownloadStreamedVideoResult> {
  const settings = await getSettings();
  const source = makeSource(hit.source, settings.streamSources?.[hit.source]?.cookie);
  if (!source) return { kind: "error", message: `${hit.source} unavailable` };
  const sessionId = await ensureDownloadsSet();
  const bridge = resolveDesktopBridge();

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
      quality: opts?.quality,
    },
    {
      fetchBytes: async (url, headers) => {
        const proxied = bridge.mediaProxyUrl ? bridge.mediaProxyUrl(url, headers) : url;
        const resp = await fetch(proxied);
        if (!resp.ok) throw new Error(`fetch ${resp.status}`);
        return resp.blob();
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
