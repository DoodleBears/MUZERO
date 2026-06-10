import { type IAudioMetadata, type IPicture, parseBlob } from "music-metadata";
import type { TrackMediaMetadata } from "@/db/types";
import { parse163KeyComment } from "@/lib/ncm-decode";

export interface ParsedUploadMetadata {
  embeddedCover?: {
    blob: Blob;
    mime: string;
  };
  mediaMetadata: TrackMediaMetadata;
  title?: string;
  /**
   * Cover URL recovered from a NetEase "163 key" ID3 comment (present on plaintext
   * mp3/flac exported from `.ncm`). The main thread downloads + stores it when the
   * file carries no embedded image. See {@link parse163KeyComment}.
   */
  albumPicUrl?: string;
}

export async function parseUploadedMediaMetadata(file: File): Promise<ParsedUploadMetadata> {
  const metadata = await parseBlob(file, { duration: false, skipCovers: false });
  return metadataFromParsedAudio(metadata, file);
}

export function fallbackUploadMediaMetadata(
  file: File,
  title?: string,
  parsedAt = Date.now(),
): TrackMediaMetadata {
  return pruneMetadata({
    originalExtension: extensionFromName(file.name),
    originalFileName: file.name,
    originalMime: file.type || undefined,
    parser: "manual",
    parsedAt,
    title,
  });
}

export function metadataFromParsedAudio(
  metadata: IAudioMetadata,
  file: Pick<File, "name" | "type">,
  parsedAt = Date.now(),
): ParsedUploadMetadata {
  const common = metadata.common;
  const format = metadata.format;
  let mediaMetadata = pruneMetadata({
    album: cleanString(common.album),
    albumArtists: cleanStrings(common.albumartists ?? splitArtistLike(common.albumartist)),
    artists: cleanStrings(common.artists ?? splitArtistLike(common.artist)),
    bitrate: finiteNumber(format.bitrate),
    bpm: finiteNumber(common.bpm),
    codec: cleanString(format.codec),
    composer: cleanStrings(common.composer),
    container: cleanString(format.container),
    date: cleanString(common.date ?? common.releasedate ?? common.originaldate),
    diskNo: cleanNumber(common.disk?.no),
    diskOf: cleanNumber(common.disk?.of),
    genres: cleanStrings(common.genre),
    isrc: cleanStrings(common.isrc),
    musicBrainzAlbumId: cleanString(common.musicbrainz_albumid),
    musicBrainzArtistIds: cleanStrings(common.musicbrainz_artistid),
    musicBrainzRecordingId: cleanString(common.musicbrainz_recordingid),
    musicBrainzTrackId: cleanString(common.musicbrainz_trackid),
    numberOfChannels: cleanNumber(format.numberOfChannels),
    originalExtension: extensionFromName(file.name),
    originalFileName: file.name,
    originalMime: file.type || undefined,
    parser: "music-metadata",
    parsedAt,
    sampleRate: cleanNumber(format.sampleRate),
    title: cleanString(common.title),
    trackNo: cleanNumber(common.track?.no),
    trackOf: cleanNumber(common.track?.of),
    year: cleanNumber(common.year ?? common.originalyear),
  });
  // NetEase writes its "163 key" metadata blob into the ID3 comment of exported
  // plaintext files — recover the cover URL + backfill any tags ID3 didn't carry.
  const netease = parse163FromComments(common.comment);
  if (netease) {
    if (!mediaMetadata.title && netease.musicName) {
      mediaMetadata = { ...mediaMetadata, title: netease.musicName };
    }
    if (!mediaMetadata.album && netease.album) {
      mediaMetadata = { ...mediaMetadata, album: netease.album };
    }
    if ((mediaMetadata.artists?.length ?? 0) === 0 && netease.artists.length > 0) {
      mediaMetadata = { ...mediaMetadata, artists: netease.artists };
    }
  }

  const picture = pickCoverPicture(common.picture);
  return {
    embeddedCover: picture
      ? {
          blob: new Blob([copyBytes(picture.data)], { type: picture.format || "image/jpeg" }),
          mime: picture.format || "image/jpeg",
        }
      : undefined,
    mediaMetadata,
    title: mediaMetadata.title,
    albumPicUrl: netease?.albumPicUrl,
  };
}

/** Find a NetEase "163 key" blob among the ID3 comment frames, if any. */
function parse163FromComments(comments: ReadonlyArray<{ text?: string }> | undefined) {
  if (!comments) return null;
  for (const comment of comments) {
    const parsed = comment.text ? parse163KeyComment(comment.text) : null;
    if (parsed) return parsed;
  }
  return null;
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function pickCoverPicture(pictures: IPicture[] | undefined): IPicture | undefined {
  if (!pictures || pictures.length === 0) return undefined;
  return (
    pictures.find((picture) => picture.type?.toLowerCase().includes("cover")) ??
    pictures.find((picture) => picture.type?.toLowerCase().includes("front")) ??
    pictures[0]
  );
}

function pruneMetadata(metadata: TrackMediaMetadata): TrackMediaMetadata {
  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => {
      if (Array.isArray(value)) return value.length > 0;
      return value !== undefined && value !== null && value !== "";
    }),
  ) as TrackMediaMetadata;
}

function cleanString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function cleanStrings(values: string[] | undefined): string[] | undefined {
  const clean = Array.from(new Set(values?.map((value) => value.trim()).filter(Boolean)));
  return clean.length > 0 ? clean : undefined;
}

function splitArtistLike(value: string | undefined): string[] | undefined {
  const clean = value?.trim();
  if (!clean) return undefined;
  return clean
    .split(/\s*(?:;|,|\/|\sfeat\.?\s|\sft\.?\s)\s*/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

function finiteNumber(value: number | undefined): number | undefined {
  return Number.isFinite(value) ? value : undefined;
}

function cleanNumber(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function extensionFromName(name: string): string | undefined {
  const match = /\.([^.]+)$/.exec(name);
  return match?.[1]?.toLowerCase();
}
