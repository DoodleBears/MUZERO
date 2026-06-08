import type { TrackBrief } from "@/dj/dj-brief-schema";
import { newId } from "@/lib/id";
import {
  appendEntries,
  insertNext,
  moveEntry,
  type PlayQueueState,
  removeEntry,
  replaceEntries,
} from "@/player/play-queue";
import { clampIndex } from "@/player/queue";
import { db as defaultDb, type MuzeroDB } from "./muzero-db";
import {
  type AppSettings,
  type CropRect,
  DEFAULT_DJ_CONFIG,
  DEFAULT_SETTINGS,
  type DjConfig,
  type DjSession,
  type MediaBlob,
  type Memory,
  type MemoryAuthorRef,
  type PlayQueue,
  type PlayQueueEntry,
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
  // Merge over defaults so settings added later (e.g. new visualizer options) get
  // their default even for rows written before the field existed.
  if (!row) return DEFAULT_SETTINGS;
  const legacy = row as AppSettings & { visualizerInCoverArea?: boolean };
  return {
    ...DEFAULT_SETTINGS,
    ...row,
    visualizerIdleOnly: row.visualizerIdleOnly ?? legacy.visualizerInCoverArea ?? false,
  };
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

/**
 * Add tracks to a 歌单 at the FRONT (newest on top — the topmost track is the
 * set's default cover). All adds (uploads + DJ continuation) prepend; the play
 * queue is fed separately by an id-diff high-water mark, so prepend order here
 * doesn't disturb playback order.
 */
export async function prependTrackIds(
  sessionId: string,
  ids: string[],
  db: MuzeroDB = defaultDb,
): Promise<void> {
  await db.transaction("rw", db.sessions, async () => {
    const session = await db.sessions.get(sessionId);
    if (!session) return;
    session.trackIds = [...ids, ...session.trackIds];
    session.updatedAt = Date.now();
    await db.sessions.put(session);
  });
}

/**
 * Set a 歌单-level cover image: store the bytes in `mediaBlobs` (role "cover",
 * keyed by the set id) and point `coverBlobId` at it. Replaces any prior cover.
 */
export async function setSessionCover(
  sessionId: string,
  blob: Blob,
  mime: string,
  db: MuzeroDB = defaultDb,
): Promise<void> {
  await db.transaction("rw", db.sessions, db.mediaBlobs, async () => {
    const session = await db.sessions.get(sessionId);
    if (!session) return;
    if (session.coverBlobId) await db.mediaBlobs.delete(session.coverBlobId);
    const id = newId("blb");
    await db.mediaBlobs.add({
      id,
      trackId: sessionId,
      role: "cover",
      mime,
      bytes: blob.size,
      blob,
    });
    session.coverBlobId = id;
    session.updatedAt = Date.now();
    await db.sessions.put(session);
  });
}

/** Read a 歌单's cover blob (the set-level cover only — not a track cover). */
export async function getSessionCover(
  sessionId: string,
  db: MuzeroDB = defaultDb,
): Promise<Blob | undefined> {
  const session = await db.sessions.get(sessionId);
  if (!session?.coverBlobId) return undefined;
  return (await db.mediaBlobs.get(session.coverBlobId))?.blob;
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
  input: {
    sessionId: string;
    brief: TrackBrief;
    provider: string;
    providerPreset?: string;
    provenanceMemoryNote?: string;
  },
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
    providerPreset: input.providerPreset,
    status: "pending",
    durationSec: input.brief.durationSec,
    createdAt: Date.now(),
    playCount: 0,
    liked: false,
    tags: [],
  };
  await db.transaction("rw", db.tracks, db.memories, async () => {
    await db.tracks.put(track);
    const note = input.provenanceMemoryNote?.trim();
    if (note) {
      await db.memories.add({
        id: newId("mem"),
        trackId: track.id,
        note,
        createdAt: track.createdAt,
      });
    }
  });
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

/**
 * Attach (or replace) a cover image for a track. The full image is stored; an
 * optional `crop` records the square region to show (non-destructive). Passing
 * no crop clears any previous one.
 */
export async function setTrackCover(
  input: { trackId: string; blob: Blob; mime: string; crop?: CropRect },
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
    await db.tracks.update(input.trackId, { coverBlobId: cover.id, coverCrop: input.crop });
  });
}

/**
 * Use a memory photo as the track cover by copying it into a dedicated cover
 * blob. The original memory photo remains attached to the memory.
 */
export async function setTrackCoverFromMemory(
  memoryId: string,
  db: MuzeroDB = defaultDb,
): Promise<boolean> {
  return db.transaction("rw", db.tracks, db.memories, db.mediaBlobs, async () => {
    const memory = await db.memories.get(memoryId);
    if (!memory?.photoBlobId) return false;
    const photo = await db.mediaBlobs.get(memory.photoBlobId);
    if (!photo?.blob) return false;
    const track = await db.tracks.get(memory.trackId);
    if (!track) return false;

    if (track.coverBlobId) {
      const previous = await db.mediaBlobs.get(track.coverBlobId);
      if (previous?.role === "cover") await db.mediaBlobs.delete(track.coverBlobId);
    }

    const cover: MediaBlob = {
      id: newId("blb"),
      trackId: memory.trackId,
      role: "cover",
      mime: photo.mime,
      bytes: photo.bytes,
      blob: photo.blob,
    };
    await db.mediaBlobs.put(cover);
    await db.tracks.update(memory.trackId, { coverBlobId: cover.id, coverCrop: undefined });
    return true;
  });
}

/** Update just the cover crop (re-crop without re-uploading). Undefined clears it. */
export async function setTrackCoverCrop(
  id: string,
  crop: CropRect | undefined,
  db: MuzeroDB = defaultDb,
): Promise<void> {
  await db.tracks.update(id, { coverCrop: crop });
}

// ----------------------------------------------------------------- memories ----

/**
 * Add a memory to a track ("music carries memories") — a note plus an optional
 * photo. The photo (if any) goes into `mediaBlobs` with role "memory"; the
 * Memory row only references it. One track has many memories.
 */
export async function addMemory(
  input: {
    trackId: string;
    note: string;
    author?: MemoryAuthorRef;
    photo?: { blob: Blob; mime: string };
    /** Timeline timestamp; defaults to now. Pass when importing/backfilling. */
    createdAt?: number;
  },
  db: MuzeroDB = defaultDb,
): Promise<Memory> {
  return db.transaction("rw", db.memories, db.mediaBlobs, async () => {
    let photoBlobId: string | undefined;
    if (input.photo) {
      const photo: MediaBlob = {
        id: newId("blb"),
        trackId: input.trackId,
        role: "memory",
        mime: input.photo.mime,
        bytes: input.photo.blob.size,
        blob: input.photo.blob,
      };
      await db.mediaBlobs.put(photo);
      photoBlobId = photo.id;
    }
    const memory: Memory = {
      id: newId("mem"),
      trackId: input.trackId,
      note: input.note.trim(),
      photoBlobId,
      author: sanitizeMemoryAuthor(input.author),
      createdAt: input.createdAt ?? Date.now(),
    };
    await db.memories.put(memory);
    return memory;
  });
}

function sanitizeMemoryAuthor(author?: MemoryAuthorRef): MemoryAuthorRef | undefined {
  const devicePublicId = author?.devicePublicId.trim();
  if (!devicePublicId) return undefined;
  const displayName = author?.displayName?.trim();
  const avatarSeed = author?.avatarSeed?.trim();
  const avatarUrl = author?.avatarUrl?.trim();
  return {
    devicePublicId,
    displayName: displayName || undefined,
    avatarSeed: avatarSeed || undefined,
    avatarUrl: avatarUrl || undefined,
  };
}

/** A track's memories, oldest → newest (timeline order). */
export function listMemories(trackId: string, db: MuzeroDB = defaultDb): Promise<Memory[]> {
  return db.memories.where("trackId").equals(trackId).sortBy("createdAt");
}

/** Edit a memory's note text in place. */
export async function updateMemoryNote(
  id: string,
  note: string,
  db: MuzeroDB = defaultDb,
): Promise<void> {
  await db.memories.update(id, { note: note.trim() });
}

/** Delete a memory and its photo blob (if any). */
export async function deleteMemory(id: string, db: MuzeroDB = defaultDb): Promise<void> {
  await db.transaction("rw", db.memories, db.mediaBlobs, async () => {
    const memory = await db.memories.get(id);
    if (memory?.photoBlobId) await db.mediaBlobs.delete(memory.photoBlobId);
    await db.memories.delete(id);
  });
}

/** Resolve a memory's photo blob, or undefined when it has none. */
export async function getMemoryPhoto(
  memory: Memory,
  db: MuzeroDB = defaultDb,
): Promise<Blob | undefined> {
  if (!memory.photoBlobId) return undefined;
  const row = await db.mediaBlobs.get(memory.photoBlobId);
  return row?.blob;
}

/** All memory notes for a set of tracks, keyed by trackId — for search joins + DJ context. */
export async function memoryNotesByTrack(
  trackIds: string[],
  db: MuzeroDB = defaultDb,
): Promise<Map<string, string[]>> {
  const rows = await db.memories.where("trackId").anyOf(trackIds).toArray();
  const map = new Map<string, string[]>();
  for (const m of rows.sort((a, b) => a.createdAt - b.createdAt)) {
    const list = map.get(m.trackId);
    if (list) list.push(m.note);
    else map.set(m.trackId, [m.note]);
  }
  return map;
}

// -------------------------------------------------------------- backgrounds ----

/** Sentinel `trackId` for global gallery images (not bound to any track). */
export const GLOBAL_GALLERY_ID = "global";

/** Append a slideshow background image to a track (many allowed per track). */
export async function addTrackBackground(
  input: { trackId: string; blob: Blob; mime: string },
  db: MuzeroDB = defaultDb,
): Promise<MediaBlob> {
  const bg: MediaBlob = {
    id: newId("blb"),
    trackId: input.trackId,
    role: "background",
    mime: input.mime,
    bytes: input.blob.size,
    blob: input.blob,
  };
  await db.mediaBlobs.put(bg);
  return bg;
}

/** A track's bound slideshow backgrounds, oldest first. */
export function listTrackBackgrounds(
  trackId: string,
  db: MuzeroDB = defaultDb,
): Promise<MediaBlob[]> {
  return db.mediaBlobs
    .where("trackId")
    .equals(trackId)
    .filter((b) => b.role === "background")
    .toArray();
}

/** Add an image to the global slideshow gallery. */
export async function addGalleryImage(
  input: { blob: Blob; mime: string },
  db: MuzeroDB = defaultDb,
): Promise<MediaBlob> {
  const img: MediaBlob = {
    id: newId("blb"),
    trackId: GLOBAL_GALLERY_ID,
    role: "gallery",
    mime: input.mime,
    bytes: input.blob.size,
    blob: input.blob,
  };
  await db.mediaBlobs.put(img);
  return img;
}

/** All global gallery images. */
export function listGalleryImages(db: MuzeroDB = defaultDb): Promise<MediaBlob[]> {
  return db.mediaBlobs.where("trackId").equals(GLOBAL_GALLERY_ID).toArray();
}

/** Delete a single background or gallery image blob by id. */
export async function deleteImageBlob(id: string, db: MuzeroDB = defaultDb): Promise<void> {
  await db.mediaBlobs.delete(id);
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

// -------------------------------------------------------------- play queue ----

/**
 * 播放列表(Play Queue) — the singleton ordered list the player consumes, decoupled
 * from 歌单(Set). These wrap the pure ops in `@/player/play-queue` (load → apply →
 * persist). `playQueueSet` loads a set into the queue; the rest push / edit it.
 */

const PLAY_QUEUE_ID = "main" as const;

export async function getPlayQueue(db: MuzeroDB = defaultDb): Promise<PlayQueue> {
  const row = await db.playQueue.get(PLAY_QUEUE_ID);
  return (
    row ?? {
      id: PLAY_QUEUE_ID,
      entries: [],
      currentIndex: -1,
      repeat: "off",
      updatedAt: Date.now(),
    }
  );
}

function entriesFor(trackIds: string[]): PlayQueueEntry[] {
  return trackIds.map((trackId) => ({ id: newId("pqe"), trackId }));
}

async function writePlayQueue(pq: PlayQueue, db: MuzeroDB): Promise<PlayQueue> {
  const updated: PlayQueue = { ...pq, updatedAt: Date.now() };
  await db.playQueue.put(updated);
  return updated;
}

/** Apply a pure entries/index transform to the persisted queue. */
async function mutatePlayQueue(
  fn: (state: PlayQueueState) => PlayQueueState,
  db: MuzeroDB,
): Promise<PlayQueue> {
  const pq = await getPlayQueue(db);
  const next = fn({ entries: pq.entries, currentIndex: pq.currentIndex });
  return writePlayQueue({ ...pq, entries: next.entries, currentIndex: next.currentIndex }, db);
}

/** Load a set's tracks into the queue (replace), optionally pinning index + context. */
export async function playQueueSet(
  trackIds: string[],
  opts: { currentIndex?: number; contextSetId?: string } = {},
  db: MuzeroDB = defaultDb,
): Promise<PlayQueue> {
  const pq = await getPlayQueue(db);
  const next = replaceEntries(
    entriesFor(trackIds),
    opts.currentIndex ?? (trackIds.length ? 0 : -1),
  );
  return writePlayQueue(
    {
      ...pq,
      entries: next.entries,
      currentIndex: next.currentIndex,
      contextSetId: opts.contextSetId,
    },
    db,
  );
}

/** Append tracks to the end of the queue. */
export function playQueueAppend(trackIds: string[], db: MuzeroDB = defaultDb): Promise<PlayQueue> {
  return mutatePlayQueue((s) => appendEntries(s, entriesFor(trackIds)), db);
}

/** Insert tracks right after the current one ("play next"). */
export function playQueuePlayNext(
  trackIds: string[],
  db: MuzeroDB = defaultDb,
): Promise<PlayQueue> {
  return mutatePlayQueue((s) => insertNext(s, entriesFor(trackIds)), db);
}

/** Remove a queue entry by its entry id. */
export function playQueueRemove(entryId: string, db: MuzeroDB = defaultDb): Promise<PlayQueue> {
  return mutatePlayQueue((s) => removeEntry(s, entryId), db);
}

/** Move a queue entry from one position to another. */
export function playQueueReorder(
  from: number,
  to: number,
  db: MuzeroDB = defaultDb,
): Promise<PlayQueue> {
  return mutatePlayQueue((s) => moveEntry(s, from, to), db);
}

/** Set the current play position (clamped). */
export async function playQueueSetIndex(
  index: number,
  db: MuzeroDB = defaultDb,
): Promise<PlayQueue> {
  const pq = await getPlayQueue(db);
  return writePlayQueue({ ...pq, currentIndex: clampIndex(pq.entries.length, index) }, db);
}

/** Set the loop mode. */
export async function playQueueSetRepeat(
  repeat: PlayQueue["repeat"],
  db: MuzeroDB = defaultDb,
): Promise<PlayQueue> {
  const pq = await getPlayQueue(db);
  return writePlayQueue({ ...pq, repeat }, db);
}

/** Set which 歌单 the queue is "playing from" (drives autoExtend continuation). */
export async function playQueueSetContext(
  contextSetId: string | undefined,
  db: MuzeroDB = defaultDb,
): Promise<PlayQueue> {
  const pq = await getPlayQueue(db);
  return writePlayQueue({ ...pq, contextSetId }, db);
}
