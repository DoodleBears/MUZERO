import type { TrackBrief } from "@/dj/dj-brief-schema";
import { encodeCoverThumbhash } from "@/lib/cover-thumbhash";
import { newId } from "@/lib/id";
import type { LyricsRecord } from "@/lyrics/provider";
import {
  appendEntries,
  insertNext,
  moveEntry,
  type PlayQueueState,
  removeEntriesByTrackIds,
  removeEntry,
  replaceEntries,
} from "@/player/play-queue";
import { clampIndex } from "@/player/queue";
import { planReorder, ranksAtTop } from "@/player/set-order";
import type { ShortcutGesture } from "@/shortcuts/registry";
import {
  deleteMediaBlob,
  type MediaBlobStorageOptions,
  putMediaBlob,
  resolveMediaBlob,
} from "./media-blob-storage";
import { db as defaultDb, type MuzeroDB } from "./muzero-db";
import {
  type AppSettings,
  type CropRect,
  DEFAULT_DJ_CONFIG,
  DEFAULT_SETTINGS,
  type DjConfig,
  type DjSession,
  type EntityCover,
  type ImportFolder,
  type MediaBlob,
  type Memory,
  type MemoryAuthorRef,
  type PlayQueue,
  type PlayQueueEntry,
  type SetDisplayMode,
  type StreamSourceId,
  type Track,
  type TrackKind,
  type TrackLyrics,
  type TrackMediaMetadata,
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

// ------------------------------------------------------- shortcut overrides ----

/** Set (replace) a user's binding list for one shortcut action. `[]` = unbound. */
export async function setShortcutOverride(
  actionId: string,
  gestures: ShortcutGesture[],
  db: MuzeroDB = defaultDb,
): Promise<void> {
  const settings = await getSettings(db);
  await saveSettings(
    { shortcutOverrides: { ...(settings.shortcutOverrides ?? {}), [actionId]: gestures } },
    db,
  );
}

/** Drop one action's override → it falls back to its built-in default. */
export async function resetShortcut(actionId: string, db: MuzeroDB = defaultDb): Promise<void> {
  const settings = await getSettings(db);
  if (!settings.shortcutOverrides || !(actionId in settings.shortcutOverrides)) return;
  const next = { ...settings.shortcutOverrides };
  delete next[actionId];
  await saveSettings({ shortcutOverrides: next }, db);
}

/** Replace the entire override map (e.g. the resolved plan after a conflict chain). */
export async function setAllShortcutOverrides(
  overrides: Record<string, ShortcutGesture[]>,
  db: MuzeroDB = defaultDb,
): Promise<void> {
  await saveSettings({ shortcutOverrides: overrides }, db);
}

/** Clear every override → the whole keymap returns to defaults. */
export async function resetAllShortcuts(db: MuzeroDB = defaultDb): Promise<void> {
  await saveSettings({ shortcutOverrides: {} }, db);
}

// ----------------------------------------------------------- import folders ----

/**
 * Of the given absolute paths, which are already in the library. Drives the
 * incremental local-folder sync: re-scanning a remembered folder imports only
 * the complement. Uses the `sourcePath` index, so it stays cheap on large sets.
 */
export async function knownSourcePaths(
  paths: string[],
  db: MuzeroDB = defaultDb,
): Promise<Set<string>> {
  if (paths.length === 0) return new Set();
  const rows = await db.tracks.where("sourcePath").anyOf(paths).toArray();
  return new Set(rows.map((t) => t.sourcePath).filter((p): p is string => Boolean(p)));
}

/**
 * Add or update a remembered import folder (matched by id or path). Re-reads
 * settings inside so a concurrent settings write isn't clobbered. Returns the id.
 */
export async function upsertImportFolder(
  folder: Omit<ImportFolder, "id"> & { id?: string },
  db: MuzeroDB = defaultDb,
): Promise<string> {
  const settings = await getSettings(db);
  const list = settings.importFolders ?? [];
  // Match an existing entry by id (when provided) or by path; preserve its stable
  // id across the merge so re-adding the same folder updates rather than dupes.
  const at = list.findIndex((f) => (folder.id && f.id === folder.id) || f.path === folder.path);
  const id = at >= 0 ? list[at].id : (folder.id ?? newId("imf"));
  const next: ImportFolder = { ...folder, id };
  const merged = at >= 0 ? list.map((f, i) => (i === at ? { ...f, ...next } : f)) : [...list, next];
  await saveSettings({ importFolders: merged }, db);
  return id;
}

/** Stop watching a folder. Imported tracks are kept — only the watch entry drops. */
export async function removeImportFolder(id: string, db: MuzeroDB = defaultDb): Promise<void> {
  const settings = await getSettings(db);
  await saveSettings(
    { importFolders: (settings.importFolders ?? []).filter((f) => f.id !== id) },
    db,
  );
}

// ---------------------------------------------------------------- sessions ----

export async function createSession(
  input: {
    name?: string;
    seedPrompt: string;
    config?: Partial<DjConfig>;
    displayMode?: SetDisplayMode;
    /** Tag a sync-created set with its source playlist, for later incremental re-sync. */
    streamPlaylistRef?: { source: StreamSourceId; id: string };
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
    streamPlaylistRef: input.streamPlaylistRef,
    createdAt: now,
    updatedAt: now,
  };
  await db.sessions.put(session);
  return session;
}

/** Find a set previously synced from this external playlist (for incremental re-sync). */
export async function findSessionByStreamPlaylist(
  source: StreamSourceId,
  playlistId: string,
  db: MuzeroDB = defaultDb,
): Promise<DjSession | undefined> {
  return db.sessions
    .filter((s) => s.streamPlaylistRef?.source === source && s.streamPlaylistRef?.id === playlistId)
    .first();
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
    // Idempotent: never add an id the set already contains. A set's trackIds is a
    // membership list (not a queue), so duplicates there double-render library rows.
    const existing = new Set(session.trackIds);
    const fresh = ids.filter((id) => !existing.has(id));
    if (fresh.length === 0) return;
    session.trackIds = [...fresh, ...session.trackIds];
    // A re-add revokes the removal tombstone — the sync merge must not delete it.
    if (session.removedTracks) {
      const tombstones = { ...session.removedTracks };
      for (const id of fresh) delete tombstones[id];
      session.removedTracks = tombstones;
    }
    // Keep the fractional-order invariant: a materialized set ranks every member.
    // New tracks join at the FRONT (newest = cover), below the current minimum rank.
    if (session.trackRanks && Object.keys(session.trackRanks).length > 0) {
      const min = Math.min(...Object.values(session.trackRanks));
      const front = ranksAtTop(min, fresh.length); // increasing, all < min
      const ranks = { ...session.trackRanks };
      fresh.forEach((id, i) => {
        ranks[id] = front[i];
      });
      session.trackRanks = ranks;
    }
    session.updatedAt = Date.now();
    await db.sessions.put(session);
  });
}

/**
 * Reorder tracks within ONE set by fractional rank (Notion-block style). Moves
 * `blockIds` (one row, or a whole multi-select block kept in its relative order) so
 * they land immediately before `insertBeforeId` in the set's current order, or at
 * the very END when it's `null`. Lazily materializes ranks on the first drag and
 * rebalances only when a float gap is exhausted (see `player/set-order.ts`). A
 * no-op (dropped in place / empty block / missing set) writes nothing.
 *
 * Membership (`trackIds`) is left as-is — order is derived from `trackRanks` via
 * `orderedSetTrackIds`. The play queue stays decoupled: a set reorder never touches
 * the live `playQueue`.
 */
export async function reorderTracksInSession(
  sessionId: string,
  blockIds: string[],
  insertBeforeId: string | null,
  db: MuzeroDB = defaultDb,
): Promise<void> {
  if (blockIds.length === 0) return;
  await db.transaction("rw", db.sessions, async () => {
    const session = await db.sessions.get(sessionId);
    if (!session) return;
    const plan = planReorder(session.trackIds, session.trackRanks, blockIds, insertBeforeId);
    if (plan.noop) return;
    session.trackRanks = plan.ranks;
    session.updatedAt = Date.now();
    await db.sessions.put(session);
  });
}

/**
 * Set a 歌单-level cover image: store the bytes in `mediaBlobs` (role "cover",
 * keyed by the set id) and point `coverBlobId` at it. Replaces any prior cover.
 * The optional square `crop` is stored non-destructively on the session (mirrors
 * {@link setTrackCover}); a fresh cover without a crop clears any prior one.
 */
export async function setSessionCover(
  input: { sessionId: string; blob: Blob; mime: string; crop?: CropRect },
  db: MuzeroDB = defaultDb,
): Promise<void> {
  // Encode the blurred preview before the transaction (canvas decode is async and
  // must not run inside a Dexie tx); undefined on failure / non-browser.
  const coverThumbhash = await encodeCoverThumbhash(input.blob, input.crop);
  await db.transaction("rw", db.sessions, db.mediaBlobs, async () => {
    const session = await db.sessions.get(input.sessionId);
    if (!session) return;
    if (session.coverBlobId) await db.mediaBlobs.delete(session.coverBlobId);
    const id = newId("blb");
    await db.mediaBlobs.add({
      id,
      trackId: input.sessionId,
      role: "cover",
      mime: input.mime,
      bytes: input.blob.size,
      blob: input.blob,
    });
    session.coverBlobId = id;
    session.coverCrop = input.crop;
    session.coverThumbhash = coverThumbhash;
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

/**
 * Remove a 歌单's pinned cover (row + blob), reverting to the default fallback —
 * the topmost (newest) member track that has a cover. No-op if none is set.
 */
export async function clearSessionCover(
  sessionId: string,
  db: MuzeroDB = defaultDb,
): Promise<void> {
  await db.transaction("rw", db.sessions, db.mediaBlobs, async () => {
    const session = await db.sessions.get(sessionId);
    if (!session?.coverBlobId) return;
    await db.mediaBlobs.delete(session.coverBlobId);
    session.coverBlobId = undefined;
    session.coverCrop = undefined;
    session.updatedAt = Date.now();
    await db.sessions.put(session);
  });
}

/**
 * Set a user-chosen cover for a DERIVED entity (one artist / album). The
 * `entityKey` is the projection key from `library-index.ts` and becomes the
 * `entityCovers` row id; bytes go in `mediaBlobs` (role "cover", keyed by that
 * id) — the same owner-keyed shape as {@link setSessionCover}. Replaces any prior
 * cover and bumps `updatedAt` (the last-write-wins clock for R2 sync).
 */
export async function setEntityCover(
  input: {
    entityKey: string;
    kind: EntityCover["kind"];
    blob: Blob;
    mime: string;
    crop?: CropRect;
  },
  db: MuzeroDB = defaultDb,
): Promise<void> {
  const thumbhash = await encodeCoverThumbhash(input.blob, input.crop);
  await db.transaction("rw", db.entityCovers, db.mediaBlobs, async () => {
    const prev = await db.entityCovers.get(input.entityKey);
    if (prev?.coverBlobId) await db.mediaBlobs.delete(prev.coverBlobId);
    const cover: MediaBlob = {
      id: newId("blb"),
      trackId: input.entityKey,
      role: "cover",
      mime: input.mime,
      bytes: input.blob.size,
      blob: input.blob,
    };
    await db.mediaBlobs.put(cover);
    await db.entityCovers.put({
      id: input.entityKey,
      kind: input.kind,
      coverBlobId: cover.id,
      crop: input.crop,
      thumbhash,
      updatedAt: Date.now(),
    });
  });
}

/** Read an entity's custom cover blob (override only — not the fallback track). */
export async function getEntityCover(
  entityKey: string,
  db: MuzeroDB = defaultDb,
): Promise<Blob | undefined> {
  const row = await db.entityCovers.get(entityKey);
  if (!row?.coverBlobId) return undefined;
  return (await db.mediaBlobs.get(row.coverBlobId))?.blob;
}

/** Remove an entity's custom cover (row + blob); resolution falls back to a track. */
export async function clearEntityCover(entityKey: string, db: MuzeroDB = defaultDb): Promise<void> {
  await db.transaction("rw", db.entityCovers, db.mediaBlobs, async () => {
    const row = await db.entityCovers.get(entityKey);
    if (!row) return;
    if (row.coverBlobId) await db.mediaBlobs.delete(row.coverBlobId);
    await db.entityCovers.delete(entityKey);
  });
}

export async function removeTrackFromSession(
  sessionId: string,
  trackId: string,
  db: MuzeroDB = defaultDb,
): Promise<void> {
  return removeTracksFromSession(sessionId, [trackId], db);
}

/** Cap kept tombstones so a long-lived set's record can't grow unbounded. */
const REMOVAL_TOMBSTONE_CAP = 200;

function recordRemovalTombstones(
  current: Record<string, number> | undefined,
  removedIds: Set<string>,
): Record<string, number> {
  const next = { ...current };
  const now = Date.now();
  for (const id of removedIds) next[id] = now;
  const entries = Object.entries(next);
  if (entries.length <= REMOVAL_TOMBSTONE_CAP) return next;
  entries.sort((a, b) => b[1] - a[1]);
  return Object.fromEntries(entries.slice(0, REMOVAL_TOMBSTONE_CAP));
}

/**
 * Remove tracks from ONE set's `trackIds` (reversible curation edit). The track
 * rows, their blobs, and the play queue are untouched — the song stays in the
 * library and in any other set. Set vs play queue stay decoupled.
 */
export async function removeTracksFromSession(
  sessionId: string,
  trackIds: string[],
  db: MuzeroDB = defaultDb,
): Promise<void> {
  if (trackIds.length === 0) return;
  const remove = new Set(trackIds);
  await db.transaction("rw", db.sessions, async () => {
    const session = await db.sessions.get(sessionId);
    if (!session) return;
    session.trackIds = session.trackIds.filter((id) => !remove.has(id));
    // Keep the fractional-order invariant: drop the removed members' rank keys.
    if (session.trackRanks) {
      const ranks = { ...session.trackRanks };
      for (const id of remove) delete ranks[id];
      session.trackRanks = ranks;
    }
    session.removedTracks = recordRemovalTombstones(session.removedTracks, remove);
    session.updatedAt = Date.now();
    await db.sessions.put(session);
  });
}

export interface DeleteSessionResult {
  /** Track ids permanently deleted because they lived only in this set. */
  purgedTrackIds: string[];
}

/**
 * Delete a 歌单. Always removes the set row, its cover blob, and any import-folder
 * watches bound to it. With `purgeExclusiveTracks`, also permanently deletes tracks
 * that live ONLY in this set (present in no other set) — their blobs, memories, and
 * play-queue entries go too; tracks shared with other sets are kept. One rw txn.
 */
export async function deleteSession(
  sessionId: string,
  opts: { purgeExclusiveTracks: boolean },
  db: MuzeroDB = defaultDb,
): Promise<DeleteSessionResult> {
  return db.transaction(
    "rw",
    [db.sessions, db.tracks, db.mediaBlobs, db.memories, db.playQueue, db.settings],
    async () => {
      const session = await db.sessions.get(sessionId);
      if (!session) return { purgedTrackIds: [] };

      let purgedTrackIds: string[] = [];
      if (opts.purgeExclusiveTracks && session.trackIds.length > 0) {
        const others = await db.sessions.where("id").notEqual(sessionId).toArray();
        const elsewhere = new Set(others.flatMap((s) => s.trackIds));
        purgedTrackIds = session.trackIds.filter((id) => !elsewhere.has(id));
        if (purgedTrackIds.length > 0) {
          const idSet = new Set(purgedTrackIds);
          await db.mediaBlobs.where("trackId").anyOf(purgedTrackIds).delete();
          await db.memories.where("trackId").anyOf(purgedTrackIds).delete();
          await db.tracks.bulkDelete(purgedTrackIds);
          // No other set references these (exclusive by definition) → no unlink scan.
          await purgeTracksFromPlayQueue(idSet, db);
        }
      }

      // The set-level cover blob (role "cover", trackId === sessionId).
      if (session.coverBlobId) await db.mediaBlobs.delete(session.coverBlobId);
      await db.sessions.delete(sessionId);

      // Drop import-folder watches bound to this set. Done inline (not via
      // removeImportFolder) to keep it inside this single transaction.
      const settingsRow = await db.settings.get("app");
      if (settingsRow?.importFolders?.some((f) => f.setId === sessionId)) {
        await db.settings.put({
          ...settingsRow,
          importFolders: settingsRow.importFolders.filter((f) => f.setId !== sessionId),
        });
      }

      return { purgedTrackIds };
    },
  );
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
    updatedAt: Date.now(),
    playCount: 0,
    liked: false,
    tags: [],
    mediaMetadata: {
      title: input.brief.title,
      bpm: input.brief.bpm,
      key: input.brief.keyscale,
      parser: "track-brief",
      parsedAt: Date.now(),
    },
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
    mediaMetadata?: TrackMediaMetadata;
    embeddedCover?: {
      blob: Blob;
      mime: string;
    };
    /** Absolute on-disk path (local-folder import) — dedup key for re-sync. */
    sourcePath?: string;
  },
  db: MuzeroDB = defaultDb,
  storage: MediaBlobStorageOptions = {},
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
    updatedAt: Date.now(),
    generatedAt: Date.now(),
    playCount: 0,
    liked: false,
    tags: [],
    mediaMetadata: input.mediaMetadata,
    sourcePath: input.sourcePath,
  };
  const media = await putMediaBlob(
    {
      id: newId("blb"),
      trackId: track.id,
      role: "media",
      mime: input.mime,
      bytes: input.blob.size,
      blob: input.blob,
      suggestedName: input.mediaMetadata?.originalFileName ?? input.title,
    },
    db,
    storage,
  );
  track.blobId = media.id;
  const cover: MediaBlob | undefined = input.embeddedCover
    ? {
        id: newId("blb"),
        trackId: track.id,
        role: "cover",
        mime: input.embeddedCover.mime,
        bytes: input.embeddedCover.blob.size,
        storageBackend: "indexeddb",
        blob: input.embeddedCover.blob,
      }
    : undefined;
  if (cover) track.coverBlobId = cover.id;
  try {
    await db.transaction("rw", db.tracks, db.mediaBlobs, async () => {
      if (cover) await db.mediaBlobs.put(cover);
      await db.tracks.put(track);
    });
  } catch (error) {
    await deleteMediaBlob(media.id, db, storage);
    throw error;
  }
  return track;
}

export async function markTrackGenerating(id: string, db: MuzeroDB = defaultDb): Promise<void> {
  await db.tracks.update(id, { status: "generating", error: undefined });
}

export async function markTrackReady(
  input: { trackId: string; blob: Blob; mime: string; durationSec: number },
  db: MuzeroDB = defaultDb,
  storage: MediaBlobStorageOptions = {},
): Promise<void> {
  const media = await putMediaBlob(
    {
      id: newId("blb"),
      trackId: input.trackId,
      role: "media",
      mime: input.mime,
      bytes: input.blob.size,
      blob: input.blob,
    },
    db,
    storage,
  );
  try {
    const updated = await db.tracks.update(input.trackId, {
      status: "ready",
      blobId: media.id,
      durationSec: input.durationSec,
      generatedAt: Date.now(),
      error: undefined,
    });
    if (updated === 0) throw new Error(`Track not found: ${input.trackId}`);
  } catch (error) {
    await deleteMediaBlob(media.id, db, storage);
    throw error;
  }
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
  return resolveMediaBlob(track.blobId, db);
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
  await db.tracks.update(id, { liked, updatedAt: Date.now() });
}

// ------------------------------------------------------------- annotations ----

export async function setTrackTags(
  id: string,
  tags: string[],
  db: MuzeroDB = defaultDb,
): Promise<void> {
  // Normalize: trim, drop empties, de-dupe, lowercase for stable matching.
  const clean = Array.from(new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean)));
  await db.tracks.update(id, { tags: clean, updatedAt: Date.now() });
}

export async function setTrackNote(
  id: string,
  note: string,
  db: MuzeroDB = defaultDb,
): Promise<void> {
  await db.tracks.update(id, { note: note.trim() || undefined, updatedAt: Date.now() });
}

// ------------------------------------------------------------------ lyrics ----

/** The fetched/manual lyrics row for a track (1:1), or undefined. */
export function getTrackLyrics(
  trackId: string,
  db: MuzeroDB = defaultDb,
): Promise<TrackLyrics | undefined> {
  return db.lyrics.where("trackId").equals(trackId).first();
}

/**
 * Upsert a track's lyrics (auto-fetched or manual). Reuses the existing row id so
 * the 1:1 mapping stays stable. `record.status === "notFound"` is the negative
 * cache that stops re-hitting the API.
 */
export async function setTrackLyrics(
  input: {
    trackId: string;
    record: LyricsRecord;
    matched?: TrackLyrics["matched"];
    fetchedAt?: number;
  },
  db: MuzeroDB = defaultDb,
): Promise<void> {
  const existing = await getTrackLyrics(input.trackId, db);
  await db.lyrics.put({
    id: existing?.id ?? newId("lyr"),
    trackId: input.trackId,
    ...input.record,
    matched: input.matched,
    fetchedAt: input.fetchedAt ?? Date.now(),
  });
}

/** Remove a track's lyrics row (re-enables auto-fetch). No-op if absent. */
export async function clearTrackLyrics(trackId: string, db: MuzeroDB = defaultDb): Promise<void> {
  await db.lyrics.where("trackId").equals(trackId).delete();
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
  const coverThumbhash = await encodeCoverThumbhash(input.blob, input.crop);
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
    await db.tracks.update(input.trackId, {
      coverBlobId: cover.id,
      coverCrop: input.crop,
      coverThumbhash,
      updatedAt: Date.now(),
    });
  });
}

/**
 * Remove a track's cover (row + blob), reverting to the placeholder. No-op if
 * none is set. Mirrors {@link clearSessionCover} / {@link clearEntityCover};
 * a track has no fallback cover, so it simply goes back to the disc icon.
 */
export async function clearTrackCover(trackId: string, db: MuzeroDB = defaultDb): Promise<void> {
  await db.transaction("rw", db.tracks, db.mediaBlobs, async () => {
    const track = await db.tracks.get(trackId);
    if (!track?.coverBlobId) return;
    await db.mediaBlobs.delete(track.coverBlobId);
    await db.tracks.update(trackId, {
      coverBlobId: undefined,
      coverCrop: undefined,
      coverThumbhash: undefined,
      updatedAt: Date.now(),
    });
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
    await db.tracks.update(memory.trackId, {
      coverBlobId: cover.id,
      coverCrop: undefined,
      updatedAt: Date.now(),
    });
    return true;
  });
}

/** Update just the cover crop (re-crop without re-uploading). Undefined clears it.
 *  Regenerates the thumbhash so the blurred preview keeps matching the framing. */
export async function setTrackCoverCrop(
  id: string,
  crop: CropRect | undefined,
  db: MuzeroDB = defaultDb,
): Promise<void> {
  const track = await db.tracks.get(id);
  const blob = track?.coverBlobId ? (await db.mediaBlobs.get(track.coverBlobId))?.blob : undefined;
  const coverThumbhash = blob ? await encodeCoverThumbhash(blob, crop) : undefined;
  await db.tracks.update(id, { coverCrop: crop, coverThumbhash, updatedAt: Date.now() });
}

/**
 * Generate missing cover thumbhashes for EXISTING covers (instant-cover-thumbnails
 * PRD Phase 3). Covers set before this feature — or imported — have a `coverBlobId`
 * but no `*Thumbhash`; this fills them so they too get an instant blurred preview.
 *
 * Owner-aware (queries `tracks` / `sessions` / `entityCovers` directly — the generic
 * cover hook can't know which table to write back to), incremental (`limit` per
 * call), and pure-testable (`encode` is injected). `skip` lets a throttled caller
 * avoid re-attempting covers it already tried this session (e.g. ones that failed
 * to decode), so the loop converges. Returns how many rows were updated and which
 * cover blob ids were attempted.
 */
export async function backfillCoverThumbhashes(
  db: MuzeroDB = defaultDb,
  encode: (blob: Blob, crop?: CropRect) => Promise<string | undefined> = encodeCoverThumbhash,
  opts: { limit?: number; skip?: ReadonlySet<string> } = {},
): Promise<{ updated: number; attempted: string[] }> {
  const limit = opts.limit ?? 12;
  const skip = opts.skip;

  type Candidate = { blobId: string; crop?: CropRect; persist: (hash: string) => Promise<void> };
  const candidates: Candidate[] = [];

  for (const t of await db.tracks.filter((t) => !!t.coverBlobId && !t.coverThumbhash).toArray()) {
    if (t.coverBlobId)
      candidates.push({
        blobId: t.coverBlobId,
        crop: t.coverCrop,
        persist: async (hash) => {
          await db.tracks.update(t.id, { coverThumbhash: hash });
        },
      });
  }
  for (const s of await db.sessions.filter((s) => !!s.coverBlobId && !s.coverThumbhash).toArray()) {
    if (s.coverBlobId)
      candidates.push({
        blobId: s.coverBlobId,
        crop: s.coverCrop,
        persist: async (hash) => {
          await db.sessions.update(s.id, { coverThumbhash: hash });
        },
      });
  }
  for (const e of await db.entityCovers.filter((e) => !!e.coverBlobId && !e.thumbhash).toArray()) {
    if (e.coverBlobId)
      candidates.push({
        blobId: e.coverBlobId,
        crop: e.crop,
        persist: async (hash) => {
          await db.entityCovers.update(e.id, { thumbhash: hash });
        },
      });
  }

  const attempted: string[] = [];
  let updated = 0;
  let processed = 0;
  for (const c of candidates) {
    if (processed >= limit) break;
    if (skip?.has(c.blobId)) continue;
    processed += 1;
    attempted.push(c.blobId);
    const blob = (await db.mediaBlobs.get(c.blobId))?.blob;
    if (!blob) continue;
    const hash = await encode(blob, c.crop);
    if (!hash) continue;
    await c.persist(hash);
    updated += 1;
  }
  return { updated, attempted };
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
    /** Optional playback anchor (seconds). Negative/non-finite → floating. */
    atSec?: number;
  },
  db: MuzeroDB = defaultDb,
): Promise<Memory> {
  return db.transaction("rw", db.tracks, db.memories, db.mediaBlobs, async () => {
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
      atSec: sanitizeAtSec(input.atSec),
    };
    await db.memories.put(memory);
    // A memory is a track annotation ("music carries memories") — bump the parent's
    // last-edit clock so the 最后修改 sort reflects it.
    await db.tracks.update(input.trackId, { updatedAt: Date.now() });
    return memory;
  });
}

/**
 * Validate a playback anchor: keep finite, non-negative seconds; otherwise drop
 * to undefined (floating). Upper-bound clamping to `track.durationSec` is the
 * caller's job (the repo doesn't know the track's duration).
 */
function sanitizeAtSec(atSec?: number | null): number | undefined {
  return typeof atSec === "number" && Number.isFinite(atSec) && atSec >= 0 ? atSec : undefined;
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

/**
 * Patch a memory's note and/or playback anchor in place.
 *  - `note` (when given) is trimmed.
 *  - `atSec: number` sets/moves the anchor (sanitized; invalid → cleared).
 *  - `atSec: null` explicitly clears the anchor (→ floating).
 *  - `atSec` absent leaves the anchor untouched.
 */
export async function updateMemory(
  id: string,
  patch: { note?: string; atSec?: number | null },
  db: MuzeroDB = defaultDb,
): Promise<void> {
  await db.transaction("rw", db.tracks, db.memories, async () => {
    let trackId: string | undefined;
    await db.memories
      .where("id")
      .equals(id)
      .modify((memory: Memory) => {
        trackId = memory.trackId;
        if (patch.note !== undefined) memory.note = patch.note.trim();
        if (patch.atSec === null) {
          memory.atSec = undefined;
        } else if (patch.atSec !== undefined) {
          memory.atSec = sanitizeAtSec(patch.atSec);
        }
      });
    // Memory edit → bump the parent track's last-edit clock (最后修改 sort).
    if (trackId) await db.tracks.update(trackId, { updatedAt: Date.now() });
  });
}

/** Edit a memory's note text in place (leaves the anchor untouched). */
export async function updateMemoryNote(
  id: string,
  note: string,
  db: MuzeroDB = defaultDb,
): Promise<void> {
  await updateMemory(id, { note }, db);
}

/** Delete a memory and its photo blob (if any). */
export async function deleteMemory(id: string, db: MuzeroDB = defaultDb): Promise<void> {
  await db.transaction("rw", db.tracks, db.memories, db.mediaBlobs, async () => {
    const memory = await db.memories.get(id);
    if (memory?.photoBlobId) await db.mediaBlobs.delete(memory.photoBlobId);
    await db.memories.delete(id);
    // Removing a memory is an edit to the track's annotations (最后修改 sort).
    if (memory) await db.tracks.update(memory.trackId, { updatedAt: Date.now() });
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

/**
 * Permanently delete tracks: all their blobs (media / cover / background / memory
 * photos — every blob keyed by the track id), their memory rows, unlink them from
 * EVERY set that references them, and purge them from the play queue. One rw txn.
 */
export async function deleteTracks(ids: string[], db: MuzeroDB = defaultDb): Promise<void> {
  if (ids.length === 0) return;
  const idSet = new Set(ids);
  await db.transaction(
    "rw",
    [db.tracks, db.mediaBlobs, db.sessions, db.memories, db.playQueue],
    async () => {
      await db.mediaBlobs.where("trackId").anyOf(ids).delete();
      await db.memories.where("trackId").anyOf(ids).delete();
      await db.tracks.bulkDelete(ids);
      // Unlink from every set that referenced any of these tracks (not just the
      // origin set — a track can live in many sets via `trackIds`).
      const sessions = await db.sessions.toArray();
      for (const session of sessions) {
        if (!session.trackIds.some((t) => idSet.has(t))) continue;
        await db.sessions.update(session.id, {
          trackIds: session.trackIds.filter((t) => !idSet.has(t)),
          removedTracks: recordRemovalTombstones(
            session.removedTracks,
            new Set(session.trackIds.filter((t) => idSet.has(t))),
          ),
          updatedAt: Date.now(),
        });
      }
      await purgeTracksFromPlayQueue(idSet, db);
    },
  );
}

/** Permanently delete one track everywhere (blobs + all sets + queue + memories). */
export function deleteTrack(id: string, db: MuzeroDB = defaultDb): Promise<void> {
  return deleteTracks([id], db);
}

/** Remove play-queue entries for the given track ids, in the CURRENT transaction. */
async function purgeTracksFromPlayQueue(removed: Set<string>, db: MuzeroDB): Promise<void> {
  const pq = await db.playQueue.get(PLAY_QUEUE_ID);
  if (!pq) return;
  const next = removeEntriesByTrackIds(
    { entries: pq.entries, currentIndex: pq.currentIndex },
    removed,
  );
  await db.playQueue.put({
    ...pq,
    entries: next.entries,
    currentIndex: next.currentIndex,
    updatedAt: Date.now(),
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
