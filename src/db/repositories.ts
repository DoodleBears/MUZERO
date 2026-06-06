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
  type SetDisplayMode,
  type Track,
  type TrackKind,
} from "./types";

/**
 * Thin repository functions over Dexie. Every function takes the DB instance
 * (defaulting to the singleton) so unit tests can pass an isolated `MuzeroDB`.
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
  input: {
    name?: string;
    seedPrompt: string;
    config?: Partial<DjConfig>;
    displayMode?: SetDisplayMode;
  },
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
    displayMode: input.displayMode ?? "video",
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

export async function setSessionDisplayMode(
  id: string,
  displayMode: SetDisplayMode,
  db: MuzeroDB = defaultDb,
): Promise<void> {
  await db.sessions.update(id, { displayMode, updatedAt: Date.now() });
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
    kind: "audio",
    origin: "generated",
    brief: input.brief,
    provider: input.provider,
    status: "pending",
    durationSec: input.brief.durationSec,
    createdAt: Date.now(),
    playCount: 0,
    liked: false,
    tags: [],
  };
  await db.tracks.put(track);
  return track;
}

/** Create a user-uploaded track (audio or video) plus its media blob. */
export async function createUploadedTrack(
  input: {
    sessionId: string;
    title: string;
    kind: TrackKind;
    blob: Blob;
    mime: string;
    durationSec: number;
  },
  db: MuzeroDB = defaultDb,
): Promise<Track> {
  const track: Track = {
    id: newId("trk"),
    sessionId: input.sessionId,
    title: input.title,
    kind: input.kind,
    origin: "uploaded",
    provider: "upload",
    status: "ready",
    durationSec: input.durationSec,
    createdAt: Date.now(),
    generatedAt: Date.now(),
    playCount: 0,
    liked: false,
    tags: [],
  };
  const media: MediaBlob = {
    id: newId("blb"),
    trackId: track.id,
    role: "media",
    mime: input.mime,
    bytes: input.blob.size,
    blob: input.blob,
  };
  track.blobId = media.id;
  await db.transaction("rw", db.tracks, db.mediaBlobs, async () => {
    await db.mediaBlobs.put(media);
    await db.tracks.put(track);
  });
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
    role: "media",
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

export function listAllTracks(db: MuzeroDB = defaultDb): Promise<Track[]> {
  return db.tracks.toArray();
}

export async function getTrackBlob(
  track: Track,
  db: MuzeroDB = defaultDb,
): Promise<MediaBlob | undefined> {
  if (!track.blobId) return undefined;
  return db.mediaBlobs.get(track.blobId);
}

export async function getTrackCover(
  track: Track,
  db: MuzeroDB = defaultDb,
): Promise<MediaBlob | undefined> {
  if (!track.coverBlobId) return undefined;
  return db.mediaBlobs.get(track.coverBlobId);
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

// ------------------------------------------------------------- annotations ----

export async function setTrackTags(
  id: string,
  tags: string[],
  db: MuzeroDB = defaultDb,
): Promise<void> {
  // Normalize: trim, drop empties, de-dupe, lowercase for stable matching.
  const clean = Array.from(new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean)));
  await db.tracks.update(id, { tags: clean });
}

export async function setTrackNote(
  id: string,
  note: string,
  db: MuzeroDB = defaultDb,
): Promise<void> {
  await db.tracks.update(id, { note: note.trim() || undefined });
}

/** Attach (or replace) a cover image for a track. */
export async function setTrackCover(
  input: { trackId: string; blob: Blob; mime: string },
  db: MuzeroDB = defaultDb,
): Promise<void> {
  await db.transaction("rw", db.tracks, db.mediaBlobs, async () => {
    const track = await db.tracks.get(input.trackId);
    if (!track) return;
    if (track.coverBlobId) await db.mediaBlobs.delete(track.coverBlobId);
    const cover: MediaBlob = {
      id: newId("blb"),
      trackId: input.trackId,
      role: "cover",
      mime: input.mime,
      bytes: input.blob.size,
      blob: input.blob,
    };
    await db.mediaBlobs.put(cover);
    await db.tracks.update(input.trackId, { coverBlobId: cover.id });
  });
}

/** Distinct tags across all tracks, with usage counts (desc). */
export async function getAllTags(
  db: MuzeroDB = defaultDb,
): Promise<{ tag: string; count: number }[]> {
  const counts = new Map<string, number>();
  await db.tracks.each((t) => {
    for (const tag of t.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  });
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}

// ------------------------------------------------------------------ delete ----

/** Delete a track plus its blobs (media + cover) and unlink it from its set. */
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
