import { getTrackBlob } from "@/db/repositories";
import type { Track } from "@/db/types";
import { getAppFetch, isTauri } from "@/lib/platform";

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

export async function downloadTrackMedia(track: Track): Promise<void> {
  const media = await resolveTrackDownloadMedia(track);
  const fileName = downloadFileName(track, media.mime);

  if (isTauri()) {
    await saveWithTauri(fileName, media.mime, media.blob);
    return;
  }

  saveWithBrowser(fileName, media.blob);
}

async function resolveTrackDownloadMedia(track: Track): Promise<{ blob: Blob; mime: string }> {
  const local = await getTrackBlob(track);
  if (local) return { blob: local.blob, mime: local.mime };

  if (track.remoteMediaUrl) {
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

async function saveWithTauri(fileName: string, mime: string, blob: Blob): Promise<void> {
  const [{ save }, { writeFile }] = await Promise.all([
    import("@tauri-apps/plugin-dialog"),
    import("@tauri-apps/plugin-fs"),
  ]);
  const path = await save({
    defaultPath: fileName,
    filters: [{ name: mediaFilterName(mime), extensions: [fileName.split(".").pop() ?? "bin"] }],
    title: "Download track",
  });
  if (!path) return;
  await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
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

function mediaFilterName(mime: string): string {
  if (mime.startsWith("video/")) return "Video";
  if (mime.startsWith("audio/")) return "Audio";
  return "Media";
}
