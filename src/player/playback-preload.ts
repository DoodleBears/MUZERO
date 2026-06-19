import { ensureCoverBacklightDerivative } from "@/db/cover-derivatives";
import { resolveMediaBlob } from "@/db/media-blob-storage";
import { db as defaultDb, type MuzeroDB } from "@/db/muzero-db";
import { getSettings } from "@/db/repositories";
import type { Track } from "@/db/types";
import { resolveDesktopBridge } from "@/lib/desktop/bridge";
import { log } from "@/lib/logger";
import { exceedsRemoteMediaCacheLimit } from "@/lib/media-size-limits";
import { coverUrlCache } from "@/lib/object-url-cache";
import { getAppFetch } from "@/lib/platform";
import {
  getCachedRemotePlayback,
  playbackCacheLimitBytes,
  putRemotePlaybackCache,
} from "@/player/playback-cache";
import { playbackSourceKind } from "@/streamsrc/source-detect";

export const PLAYBACK_PRELOAD_AHEAD = 2;

const remoteMediaWarmups = new Map<string, Promise<void>>();
type CoverPreloadTrack = Pick<Track, "coverBlobId" | "coverCrop" | "remoteCoverUrl"> &
  Partial<Pick<Track, "id">>;

export function trackCoverCacheKey(
  track: Pick<Track, "coverBlobId" | "coverCrop"> | undefined,
  coverCropped: boolean,
): string | null {
  if (!track?.coverBlobId) return null;
  const crop = coverCropped ? track.coverCrop : undefined;
  return crop
    ? `${track.coverBlobId}:${crop.x},${crop.y},${crop.width},${crop.height}`
    : track.coverBlobId;
}

export function proxyRemoteCover(url: string | undefined): string | null {
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) return url;
  return resolveDesktopBridge().mediaProxyUrl?.(url) ?? url;
}

export async function warmTrackCover(
  track: CoverPreloadTrack | undefined,
  options: {
    coverCropped?: boolean;
    db?: MuzeroDB;
    signal?: AbortSignal;
  } = {},
): Promise<void> {
  if (!track || options.signal?.aborted) return;
  // Crop disabled (Option A, switch-fps cover-crop storm): warm the ORIGINAL blob,
  // keyed by blob id, matching the display + preload paths.
  const key = trackCoverCacheKey(track, false);
  if (!key) {
    await warmImage(proxyRemoteCover(track.remoteCoverUrl), options.signal);
    return;
  }
  if (coverUrlCache.has(key)) return;

  const resolved = await resolveMediaBlob(track.coverBlobId, options.db ?? defaultDb);
  if (!resolved?.blob || options.signal?.aborted) return;
  const out = resolved.blob;
  if (options.signal?.aborted) return;
  const url = URL.createObjectURL(out);
  coverUrlCache.store(key, url, { bytes: resolved.bytes ?? out.size });
}

export async function warmTrackBacklightDerivative(
  track: CoverPreloadTrack | undefined,
  options: {
    coverCropped?: boolean;
    db?: MuzeroDB;
    ensureBacklightDerivative?: typeof ensureCoverBacklightDerivative;
    signal?: AbortSignal;
    traceSource?: string;
  } = {},
): Promise<void> {
  if (!track?.coverBlobId || options.signal?.aborted) return;
  const coverCropped = options.coverCropped ?? true;
  const ensureBacklightDerivative =
    options.ensureBacklightDerivative ?? ensureCoverBacklightDerivative;
  await ensureBacklightDerivative(
    {
      coverBlobId: track.coverBlobId,
      coverCrop: coverCropped ? track.coverCrop : undefined,
      id: track.id ?? "",
      remoteCoverUrl: track.remoteCoverUrl,
    },
    options.db ?? defaultDb,
    { traceSource: options.traceSource },
  );
}

export async function warmTrackMedia(
  track: Track | undefined,
  options: {
    cacheMaxBytes?: number;
    db?: MuzeroDB;
    fetcher?: typeof fetch;
    signal?: AbortSignal;
  } = {},
): Promise<void> {
  if (!track || options.signal?.aborted || track.status !== "ready") return;
  if (playbackSourceKind(track) !== "remote" || !track.remoteMediaUrl) return;
  const url = track.remoteMediaUrl;
  const existing = remoteMediaWarmups.get(url);
  if (existing) return existing;

  const warmup = runRemoteMediaWarmup(track, options).finally(() => remoteMediaWarmups.delete(url));
  remoteMediaWarmups.set(url, warmup);
  return warmup;
}

export async function warmPlaybackPreload(
  input: {
    backlightTracks?: ReadonlyArray<CoverPreloadTrack>;
    coverTracks: ReadonlyArray<CoverPreloadTrack>;
    mediaTracks: ReadonlyArray<Track>;
  },
  options: {
    cacheMaxBytes?: number;
    coverCropped?: boolean;
    db?: MuzeroDB;
    ensureBacklightDerivative?: typeof ensureCoverBacklightDerivative;
    fetcher?: typeof fetch;
    signal?: AbortSignal;
    warmBacklight?: boolean;
  } = {},
): Promise<void> {
  const backlightTracks = input.backlightTracks ?? input.coverTracks;
  await Promise.all([
    ...input.coverTracks.map((track) =>
      warmTrackCover(track, {
        coverCropped: options.coverCropped,
        db: options.db,
        signal: options.signal,
      }),
    ),
    ...(options.warmBacklight
      ? backlightTracks.map((track) =>
          warmTrackBacklightDerivative(track, {
            coverCropped: options.coverCropped,
            db: options.db,
            ensureBacklightDerivative: options.ensureBacklightDerivative,
            signal: options.signal,
            traceSource: "playback-warmup:backlight",
          }),
        )
      : []),
    warmMediaTracks(input.mediaTracks, options),
  ]);
}

async function warmMediaTracks(
  tracks: ReadonlyArray<Track>,
  options: {
    cacheMaxBytes?: number;
    db?: MuzeroDB;
    fetcher?: typeof fetch;
    signal?: AbortSignal;
  },
): Promise<void> {
  for (const track of tracks) {
    if (options.signal?.aborted) return;
    await warmTrackMedia(track, options);
  }
}

async function runRemoteMediaWarmup(
  track: Track,
  options: {
    cacheMaxBytes?: number;
    db?: MuzeroDB;
    fetcher?: typeof fetch;
    signal?: AbortSignal;
  },
): Promise<void> {
  const db = options.db ?? defaultDb;
  const remoteMediaUrl = track.remoteMediaUrl;
  if (!remoteMediaUrl) return;
  try {
    if (await getCachedRemotePlayback(track, db)) return;
    if (options.signal?.aborted) return;

    const fetcher = options.fetcher ?? (await getAppFetch());
    const response = await fetcher(remoteMediaUrl, {
      cache: "no-store",
      signal: options.signal,
    });
    if (!response.ok) return;
    if (exceedsRemoteMediaCacheLimit(response)) {
      // Warming buffers the whole file via blob() — skip past the cap; playback
      // streams the URL directly instead (PRD F-8).
      void response.body?.cancel().catch(() => {});
      log.debug("player", "playback preload skipped oversized media", {
        trackId: track.id,
        contentLength: response.headers.get("content-length"),
      });
      return;
    }

    const blob = await response.blob();
    if (blob.size === 0 || options.signal?.aborted) return;
    const mime =
      response.headers.get("content-type")?.split(";")[0]?.trim() ||
      blob.type ||
      "application/octet-stream";
    const maxBytes = options.cacheMaxBytes ?? playbackCacheLimitBytes(await getSettings());
    await putRemotePlaybackCache(track, { blob, bytes: blob.size, mime }, { maxBytes }, db);
  } catch (error) {
    if (isAbortError(error)) return;
    log.debug("player", "playback preload failed", {
      trackId: track.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function warmImage(url: string | null, signal?: AbortSignal): Promise<void> {
  if (!url || signal?.aborted || typeof Image === "undefined") return;
  await new Promise<void>((resolve) => {
    const img = new Image();
    const done = () => resolve();
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    img.onload = done;
    img.onerror = done;
    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          img.src = "";
          resolve();
        },
        { once: true },
      );
    }
    img.src = url;
    void img.decode?.().then(done, done);
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
