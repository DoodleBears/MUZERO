import type { TrackBrief } from "@/dj/dj-brief-schema";
import { newId } from "@/lib/id";
import { db as defaultDb, type MuzeroDB } from "./muzero-db";
import {
  type AppSettings,
  DEFAULT_DJ_CONFIG,
  DEFAULT_SETTINGS,
  type DjConfig,
  type DjSession,
  type MediaBlob,
  type Track,
} from "./types";

/**
 * Thin repository functions over Dexie. Every function takes the DB instance
 * (defaulting to the singleton) so unit tests can pass an isolated `MuzeroDB`.
 * No business logic lives here — just persistence + invariants.
 */

// ---------------------------------------------------------------- settings ----

export async function getSettings(db: MuzeroDB = defaultDb): Promise<AppSettings> {
  const row = await db.settings.get("app");
  return row ?? DEFAULT_SETTINGS;
}

export async function saveSettings(
  patch: Partial<AppSettings>,
  db: MuzeroDB = defaultDb,
): Promise<AppSettings> {
  const current = await getSettings(db);
  const next: AppSettings = { ...current, ...patch, id: "app" };
  await db.settings.put(next);
  return next;
}

// ---------------------------------------------------------------- sessions ----

export async function createSession(
  input: { name?: string; seedPrompt: string; config?: Partial<DjConfig> },
  db: MuzeroDB = defaultDb,
): Promise<DjSession> {
  const now = Date.now();
  const session: DjSession = {
    id: newId("ses"),
    name: input.name?.trim() || defaultSessionName(input.seedPrompt),
    seedPrompt: input.seedPrompt,
    trackIds: [],
    status: "idle",
    config: { ...DEFAULT_DJ_CONFIG, ...input.config },
    createdAt: now,
    updatedAt: now,
  };
  await db.sessions.put(session);
  return session;
}

function defaultSessionName(seed: string): string {
  const trimmed = seed.trim();
  if (!trimmed) return "New set";
  return trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed;
}

export function getSession(id: string, db: MuzeroDB = defaultDb): Promise<DjSession | undefined> {
  return db.sessions.get(id);
}

export function listSessions(db: MuzeroDB = defaultDb): Promise<DjSession[]> {
  return db.sessions.orderBy("updatedAt").reverse().toArray();
}

export async function updateSession(
  id: string,
  patch: Partial<Omit<DjSession, "id">>,
  db: MuzeroDB = defaultDb,
): Promise<void> {
  await db.sessions.update(id, { ...patch, updatedAt: Date.now() });
}

export async function appendTrackIds(
  sessionId: string,
  ids: string[],
  db: MuzeroDB = defaultDb,
): Promise<void> {
  await db.transaction("rw", db.sessions, async () => {
    const session = await db.sessions.get(sessionId);
    if (!session) return;
    session.trackIds = [...session.trackIds, ...ids];
    session.updatedAt = Date.now();
    await db.sessions.put(session);
  });
}

export async function removeTrackFromSession(
  sessionId: string,
  trackId: string,
  db: MuzeroDB = defaultDb,
): Promise<void> {
  await db.transaction("rw", db.sessions, async () => {
    const session = await db.sessions.get(sessionId);
    if (!session) return;
    session.trackIds = session.trackIds.filter((id) => id !== trackId);
    session.updatedAt = Date.now();
    await db.sessions.put(session);
  });
}

// ------------------------------------------------------------------ tracks ----

export async function createPendingTrack(
  input: { sessionId: string; brief: TrackBrief; provider: string },
  db: MuzeroDB = defaultDb,
): Promise<Track> {
  const track: Track = {
    id: newId("trk"),
    sessionId: input.sessionId,
    title: input.brief.title,
    brief: input.brief,
    provider: input.provider,
    status: "pending",
    durationSec: input.brief.durationSec,
    createdAt: Date.now(),
    playCount: 0,
    liked: false,
  };
  await db.tracks.put(track);
  return track;
}

export async function markTrackGenerating(id: string, db: MuzeroDB = defaultDb): Promise<void> {
  await db.tracks.update(id, { status: "generating", error: undefined });
}

export async function markTrackReady(
  input: { trackId: string; blob: Blob; mime: string; durationSec: number },
  db: MuzeroDB = defaultDb,
): Promise<void> {
  const media: MediaBlob = {
    id: newId("blb"),
    trackId: input.trackId,
    mime: input.mime,
    bytes: input.blob.size,
    blob: input.blob,
  };
  await db.transaction("rw", db.tracks, db.mediaBlobs, async () => {
    await db.mediaBlobs.put(media);
    await db.tracks.update(input.trackId, {
      status: "ready",
      blobId: media.id,
      durationSec: input.durationSec,
      generatedAt: Date.now(),
      error: undefined,
    });
  });
}

export async function markTrackFailed(
  id: string,
  error: string,
  db: MuzeroDB = defaultDb,
): Promise<void> {
  await db.tracks.update(id, { status: "failed", error });
}

export function getTrack(id: string, db: MuzeroDB = defaultDb): Promise<Track | undefined> {
  return db.tracks.get(id);
}

/** Fetch tracks for a list of ids, preserving the input order (queue order). */
export async function getTracksByIds(ids: string[], db: MuzeroDB = defaultDb): Promise<Track[]> {
  if (ids.length === 0) return [];
  const rows = await db.tracks.bulkGet(ids);
  const out: Track[] = [];
  for (const row of rows) if (row) out.push(row);
  return out;
}

export async function getTrackBlob(
  track: Track,
  db: MuzeroDB = defaultDb,
): Promise<MediaBlob | undefined> {
  if (!track.blobId) return undefined;
  return db.mediaBlobs.get(track.blobId);
}

export async function incrementPlayCount(id: string, db: MuzeroDB = defaultDb): Promise<void> {
  await db.transaction("rw", db.tracks, async () => {
    const track = await db.tracks.get(id);
    if (track) await db.tracks.update(id, { playCount: track.playCount + 1 });
  });
}

export async function setTrackLiked(
  id: string,
  liked: boolean,
  db: MuzeroDB = defaultDb,
): Promise<void> {
  await db.tracks.update(id, { liked });
}

/** Delete a track plus its audio blob and unlink it from its session. */
export async function deleteTrack(id: string, db: MuzeroDB = defaultDb): Promise<void> {
  await db.transaction("rw", db.tracks, db.mediaBlobs, db.sessions, async () => {
    const track = await db.tracks.get(id);
    if (!track) return;
    await db.mediaBlobs.where("trackId").equals(id).delete();
    await db.tracks.delete(id);
    const session = await db.sessions.get(track.sessionId);
    if (session) {
      session.trackIds = session.trackIds.filter((t) => t !== id);
      await db.sessions.put(session);
    }
  });
}
