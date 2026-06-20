/**
 * Runtime wiring for playlist/favlist auto-sync — instantiates the pure
 * {@link @/sync/playlist-auto-sync} scheduler against the live DB + download queue. Mirrors
 * {@link ./cloud-auto-sync.ts}. `syncBoundPlaylistSet` does ONE playlist fetch, adds new items
 * to the bound set (deduped by the repo), records `lastAutoSyncAt`, and — when the set opted in
 * via `autoDownloadNew` — enqueues ONLY the genuinely-new items for video download (so a 529-item
 * favlist downloads everything on first sync, then only newly-added videos thereafter).
 */
import {
  getSession,
  getSettings,
  getTracksByIds,
  listSessions,
  updateSession,
} from "@/db/repositories";
import type { DjSession, StreamSourceId } from "@/db/types";
import { log } from "@/lib/logger";
import {
  canDownloadVideo,
  DEFAULT_VIDEO_QUALITY,
  enqueueDownload,
} from "@/streamsrc/download-action";
import { cacheStreamPlaylistTrackCovers } from "@/streamsrc/playlist-cover-cache";
import type { StreamSearchHit } from "@/streamsrc/provider";
import { createStreamSource } from "@/streamsrc/registry";
import { createStreamHttp } from "@/streamsrc/stream-http";
import { addHitsToSet } from "@/streamsrc/streamed-track-repo";
import {
  createPlaylistAutoSyncScheduler,
  type PlaylistAutoSyncScheduler,
} from "@/sync/playlist-auto-sync";

const AUTO_SYNC_TICK_MS = 60_000;
const AUTO_SYNC_JITTER_MAX_MS = 30_000;

let scheduler: PlaylistAutoSyncScheduler | null = null;
const jitterBySet = new Map<string, number>();
/** Sets currently mid-sync (shared between scheduler ticks + any future manual trigger). */
const inFlight = new Set<string>();

async function fetchPlaylistHits(
  sourceId: StreamSourceId,
  playlistId: string,
): Promise<StreamSearchHit[]> {
  const settings = await getSettings();
  const source = createStreamSource(sourceId, {
    http: createStreamHttp(),
    now: () => Date.now(),
    getCookie: (sid) => settings.streamSources?.[sid]?.cookie,
  });
  return (await source?.importPlaylist?.(playlistId)) ?? [];
}

/** Sync one bound set: add new playlist items, record the sync, enqueue new downloads if opted-in. */
export async function syncBoundPlaylistSet(setId: string): Promise<void> {
  const session = await getSession(setId);
  const ref = session?.streamPlaylistRef;
  if (!session || !ref) return;
  inFlight.add(setId);
  try {
    // Snapshot which externalIds are already members so we can enqueue ONLY new ones below.
    const existing = await getTracksByIds(session.trackIds);
    const existingExternal = new Set(
      existing.map((t) => t.streamExternalId).filter((id): id is string => Boolean(id)),
    );

    const hits = await fetchPlaylistHits(ref.source, ref.id);
    if (hits.length > 0) {
      await addHitsToSet(setId, hits);
      void cacheStreamPlaylistTrackCovers({ sessionId: setId, hits });
    }
    await updateSession(setId, { lastAutoSyncAt: Date.now() });

    if (session.autoDownloadNew && hits.length > 0) {
      const settings = await getSettings();
      const quality = settings.defaultVideoQuality ?? DEFAULT_VIDEO_QUALITY;
      const newHits = hits.filter(
        (h) => !existingExternal.has(h.externalId) && canDownloadVideo(h.source),
      );
      for (const hit of newHits) {
        await enqueueDownload({
          source: hit.source,
          externalId: hit.externalId,
          title: hit.title,
          coverUrl: hit.coverUrl,
          sessionId: setId,
          quality,
        });
      }
    }
  } finally {
    inFlight.delete(setId);
  }
}

/** Sets eligible for auto-sync: bound to a playlist with a non-manual cadence. */
async function getBoundSets(): Promise<DjSession[]> {
  const sets = await listSessions();
  return sets.filter(
    (s) =>
      s.streamPlaylistRef != null &&
      s.autoSyncFrequency != null &&
      s.autoSyncFrequency !== "manual",
  );
}

export function startPlaylistAutoSyncScheduler(): () => void {
  if (scheduler) return () => scheduler?.stop();
  scheduler = createPlaylistAutoSyncScheduler({
    intervalMs: AUTO_SYNC_TICK_MS,
    getSets: getBoundSets,
    isSetRunning: (setId) => inFlight.has(setId),
    isVisible: () => typeof document === "undefined" || document.visibilityState !== "hidden",
    isOnline: () => typeof navigator === "undefined" || navigator.onLine !== false,
    now: () => Date.now(),
    jitterMs: stableJitterMs,
    syncSet: syncBoundPlaylistSet,
    onError: (error) => log.warn("sync", "playlist auto-sync scheduler tick failed", { error }),
  });
  scheduler.start();
  return () => {
    scheduler?.stop();
    scheduler = null;
  };
}

function stableJitterMs(setId: string): number {
  const existing = jitterBySet.get(setId);
  if (existing != null) return existing;
  const next = Math.floor(Math.random() * AUTO_SYNC_JITTER_MAX_MS);
  jitterBySet.set(setId, next);
  return next;
}
