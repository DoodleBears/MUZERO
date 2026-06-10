import { getTrackBlob, getTrackCover } from "@/db/repositories";
import type { Track } from "@/db/types";
import { resolveDesktopBridge } from "@/lib/desktop/bridge";
import { createTrackExportBlob, type TrackExportMode } from "@/lib/metadata-export";
import { getAppFetch } from "@/lib/platform";

const MIME_EXTENSIONS: Record<string, string> = {
  "audio/aac": "aac",
  "audio/flac": "flac",
  "audio/m4a": "m4a",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/wav": "wav",
  "audio/webm": "webm",
  "video/mp4": "mp4",
  "video/ogg": "ogv",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-matroska": "mkv",
};

export async function downloadTrackMedia(
  track: Track,
  mode: TrackExportMode = "original",
): Promise<void> {
  const media = await resolveTrackDownloadMedia(track, mode);
  const fileName = downloadFileName(track, media.mime);

  const bridge = resolveDesktopBridge();
  if (bridge.saveFile) {
    const bytes = new Uint8Array(await media.blob.arrayBuffer());
    await bridge.saveFile({ fileName, mime: media.mime, bytes });
    return;
  }

  saveWithBrowser(fileName, media.blob);
}

async function resolveTrackDownloadMedia(
  track: Track,
  mode: TrackExportMode,
): Promise<{ blob: Blob; mime: string }> {
  const local = await getTrackBlob(track);
  if (local) {
    return {
      blob: await createTrackExportBlob({
        cover: await getTrackCover(track),
        media: local,
        mode,
        track,
      }),
      mime: local.mime,
    };
  }

  if (track.remoteMediaUrl) {
    if (mode === "withMetadata") {
      throw new Error("Metadata export is only available for locally stored media");
    }
    const fetch = await getAppFetch();
    const response = await fetch(track.remoteMediaUrl);
    if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
    const blob = await response.blob();
    return { blob, mime: response.headers.get("content-type") ?? blob.type };
  }

  throw new Error("Track has no downloadable media");
}

function downloadFileName(track: Track, mime: string): string {
  const ext = extensionFor(track, mime);
  const base = sanitizeFileName(track.title) || "muzero-track";
  return `${base}.${ext}`;
}

function extensionFor(track: Track, mime: string): string {
  const cleanMime = mime.split(";")[0]?.trim().toLowerCase();
  if (cleanMime && MIME_EXTENSIONS[cleanMime]) return MIME_EXTENSIONS[cleanMime];
  return track.kind === "video" ? "mp4" : "mp3";
}

function sanitizeFileName(value: string): string {
  return value
    .replace(/[<>:"/\\|?*]+/g, " ")
    .replaceAll(/./g, (char) => (char.charCodeAt(0) < 32 ? " " : char))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function saveWithBrowser(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noreferrer";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
