/**
 * Pure media-ingest core: bytes → parsed metadata → an uploaded Track row. No DOM
 * (unlike `probeMediaFile`), so it runs in a Web Worker off the main thread; the
 * worker client falls back to calling it on the main thread where Worker is
 * unavailable (tests). Kind comes from the caller (extension classification) and
 * duration from `music-metadata` — codec playability is checked at first play
 * (`MediaEngine`), trading reject-on-import for a fast, jank-free import.
 *
 * `.ncm` files take the {@link ingestNcmBytes} branch: decrypt → plaintext audio
 * blob + embedded metadata/cover, with the carried `albumPic` URL returned so the
 * main thread can fetch+store the cover (Workers can't reach the desktop bridge).
 */

import { parseBlob } from "music-metadata";
import { db as defaultDb, type MuzeroDB } from "@/db/muzero-db";
import { createUploadedTrack } from "@/db/repositories";
import type { TrackKind, TrackMediaMetadata } from "@/db/types";
import { fallbackUploadMediaMetadata, metadataFromParsedAudio } from "@/lib/media-metadata";
import { decodeNcm } from "@/lib/ncm-decode";

export interface IngestBytesInput {
  setId: string;
  /** Basename (used as the fallback title + the File name). */
  name: string;
  kind: TrackKind;
  mime: string;
  /** Absolute on-disk path → `Track.sourcePath` (dedup key). Absent for uploads. */
  sourcePath?: string;
  /** Raw file bytes (transferred into the worker). */
  bytes: ArrayBuffer;
  /** Set for containers decrypted in-worker before ingest (`.ncm`). */
  decode?: "ncm";
}

export interface IngestResult {
  trackId: string;
  /** Remote cover URL to fetch on the main thread when no image was embedded (`.ncm`). */
  albumPicUrl?: string;
  /** Whether a cover blob was already stored (embedded) — skip the remote fetch. */
  hasCover: boolean;
}

export async function ingestMediaBytes(
  input: IngestBytesInput,
  db: MuzeroDB = defaultDb,
): Promise<IngestResult> {
  if (input.decode === "ncm") return ingestNcmBytes(input, db);

  const file = new File([new Uint8Array(input.bytes)], input.name, { type: input.mime });
  const titleFromName = input.name.replace(/\.[^.]+$/, "") || input.name;

  let title: string | undefined;
  let durationSec = 0;
  let mediaMetadata = fallbackUploadMediaMetadata(file, titleFromName);
  let embeddedCover: { blob: Blob; mime: string } | undefined;
  let albumPicUrl: string | undefined;
  try {
    // Header-based parse (duration:false) — fast, no full-file scan.
    const metadata = await parseBlob(file, { duration: false, skipCovers: false });
    const parsed = metadataFromParsedAudio(metadata, file);
    title = parsed.title;
    mediaMetadata = parsed.mediaMetadata;
    embeddedCover = parsed.embeddedCover;
    albumPicUrl = parsed.albumPicUrl; // NetEase "163 key" comment cover, if present
    durationSec = Number.isFinite(metadata.format.duration) ? Number(metadata.format.duration) : 0;
  } catch {
    // Unreadable tags — still import with filename metadata (plays may fail later).
  }

  const track = await createUploadedTrack(
    {
      sessionId: input.setId,
      title: title ?? titleFromName,
      kind: input.kind,
      blob: file,
      mime: input.mime,
      durationSec,
      mediaMetadata,
      embeddedCover,
      sourcePath: input.sourcePath,
    },
    db,
  );
  return {
    trackId: track.id,
    // Only surface the remote cover when no image was embedded — else skip the fetch.
    albumPicUrl: embeddedCover ? undefined : albumPicUrl,
    hasCover: Boolean(embeddedCover),
  };
}

/**
 * Decrypt a `.ncm` container → store its plaintext audio as an uploaded track.
 * The container's own JSON metadata (title/artist/album) is authoritative and
 * overlays anything parsed from the decrypted stream. Cover priority: the
 * container's embedded image → the audio's own embedded picture → (returned)
 * `albumPicUrl` for the main thread to download.
 */
async function ingestNcmBytes(input: IngestBytesInput, db: MuzeroDB): Promise<IngestResult> {
  const decoded = decodeNcm(input.bytes);
  const titleFromName = input.name.replace(/\.[^.]+$/, "") || input.name;
  const audioFile = new File([decoded.audio], input.name, { type: decoded.audioMime });

  let parsedTitle: string | undefined;
  let durationSec = decoded.meta.durationMs ? decoded.meta.durationMs / 1000 : 0;
  let mediaMetadata: TrackMediaMetadata = fallbackUploadMediaMetadata(audioFile, titleFromName);
  let embeddedCover: { blob: Blob; mime: string } | undefined;
  try {
    const metadata = await parseBlob(audioFile, { duration: false, skipCovers: false });
    const parsed = metadataFromParsedAudio(metadata, audioFile);
    parsedTitle = parsed.title;
    mediaMetadata = parsed.mediaMetadata;
    embeddedCover = parsed.embeddedCover;
    if (Number.isFinite(metadata.format.duration)) durationSec = Number(metadata.format.duration);
  } catch {
    // Decrypted stream has unreadable tags — rely on the container's JSON metadata.
  }

  // The container's JSON metadata wins for the human-facing fields.
  if (decoded.meta.musicName) mediaMetadata = { ...mediaMetadata, title: decoded.meta.musicName };
  if (decoded.meta.album) mediaMetadata = { ...mediaMetadata, album: decoded.meta.album };
  if (decoded.meta.artists.length > 0) {
    mediaMetadata = { ...mediaMetadata, artists: decoded.meta.artists };
  }
  mediaMetadata = { ...mediaMetadata, originalFileName: input.name, originalExtension: "ncm" };

  // Embedded container image takes precedence over any picture inside the audio.
  if (decoded.cover) {
    embeddedCover = {
      blob: new Blob([decoded.cover.bytes], { type: decoded.cover.mime }),
      mime: decoded.cover.mime,
    };
  }

  const track = await createUploadedTrack(
    {
      sessionId: input.setId,
      title: decoded.meta.musicName ?? parsedTitle ?? titleFromName,
      kind: "audio",
      blob: audioFile,
      mime: decoded.audioMime,
      durationSec,
      mediaMetadata,
      embeddedCover,
      sourcePath: input.sourcePath,
    },
    db,
  );
  return {
    trackId: track.id,
    albumPicUrl: decoded.meta.albumPicUrl,
    hasCover: Boolean(embeddedCover),
  };
}
