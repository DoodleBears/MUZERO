import Dexie, { type EntityTable } from "dexie";
import { newId } from "@/lib/id";
import type {
  AppSettings,
  ChatSession,
  DjSession,
  MediaBlob,
  Memory,
  PlayQueue,
  PlayQueueEntry,
  Track,
} from "./types";

/**
 * MUZERO's on-device store. Everything lives here — tracks, media blobs (audio /
 * video / cover images), sets, settings. No backend, no cloud. The DB name
 * `muzero-db` is a stable codename and must not change across UI/brand tweaks.
 */
export class MuzeroDB extends Dexie {
  tracks!: EntityTable<Track, "id">;
  mediaBlobs!: EntityTable<MediaBlob, "id">;
  sessions!: EntityTable<DjSession, "id">;
  settings!: EntityTable<AppSettings, "id">;
  playQueue!: EntityTable<PlayQueue, "id">;
  memories!: EntityTable<Memory, "id">;
  chatSessions!: EntityTable<ChatSession, "id">;

  constructor(name = "muzero-db") {
    super(name);

    // v1 — original AI-DJ-only schema.
    this.version(1).stores({
      tracks: "id, sessionId, status, createdAt, liked",
      mediaBlobs: "id, trackId",
      sessions: "id, status, updatedAt",
      settings: "id",
    });

    // v2 — annotations (*tags), mixed audio/video tracks (kind), media-blob roles
    // (media vs cover), and set display modes. Backfills existing rows.
    this.version(2)
      .stores({
        tracks: "id, sessionId, status, createdAt, liked, *tags, kind",
        mediaBlobs: "id, trackId, role",
        sessions: "id, status, updatedAt",
        settings: "id",
      })
      .upgrade(async (tx) => {
        await tx
          .table("tracks")
          .toCollection()
          .modify((t: Partial<Track>) => {
            t.kind ??= "audio";
            t.origin ??= "generated";
            t.tags ??= [];
          });
        await tx
          .table("mediaBlobs")
          .toCollection()
          .modify((b: Partial<MediaBlob>) => {
            b.role ??= "media";
          });
        await tx
          .table("sessions")
          .toCollection()
          .modify((s: Partial<DjSession>) => {
            s.displayMode ??= "video";
            if (s.config) s.config.autoExtend ??= true;
          });
      });

    // v3 — split 播放列表(Play Queue) from 歌单(Set). New `playQueue` singleton the
    // player consumes; seed it from the persisted resume point so playback
    // continues seamlessly after the decoupling. (Memory table arrives in a later
    // version.) Only the new table is declared — Dexie inherits the rest.
    this.version(3)
      .stores({ playQueue: "id" })
      .upgrade(async (tx) => {
        const settings = (await tx.table("settings").get("app")) as
          | Partial<AppSettings>
          | undefined;
        let entries: PlayQueueEntry[] = [];
        let currentIndex = -1;
        let contextSetId: string | undefined;
        if (settings?.lastSessionId) {
          const session = (await tx.table("sessions").get(settings.lastSessionId)) as
            | DjSession
            | undefined;
          if (session && session.trackIds.length > 0) {
            entries = session.trackIds.map((trackId) => ({ id: newId("pqe"), trackId }));
            currentIndex = Math.min(Math.max(0, settings.lastTrackIndex ?? 0), entries.length - 1);
            contextSetId = session.id;
          }
        }
        await tx.table("playQueue").put({
          id: "main",
          entries,
          currentIndex,
          repeat: "off",
          contextSetId,
          updatedAt: Date.now(),
        } satisfies PlayQueue);
      });

    // v4 — 歌曲记忆 Memory (one-to-many). New `memories` table; photos reuse
    // `mediaBlobs` with the additive role "memory" (no blob-index change needed).
    // Backfill: each track's single deprecated `note` becomes its first Memory,
    // preserving the recollection. The `Track.note` field stays (nullable,
    // deprecated) for defense; new annotations write memories instead.
    this.version(4)
      .stores({ memories: "id, trackId, createdAt, [trackId+createdAt]" })
      .upgrade(async (tx) => {
        const tracks = (await tx.table("tracks").toArray()) as Track[];
        for (const t of tracks) {
          const note = t.note?.trim();
          if (note) {
            await tx.table("memories").add({
              id: newId("mem"),
              trackId: t.id,
              note,
              createdAt: t.createdAt,
            } satisfies Memory);
          }
        }
      });

    // v5 — AI DJ chat sessions. Messages are stored as one JSON snapshot per
    // session so streaming persistence remains local and simple.
    this.version(5).stores({ chatSessions: "id, updatedAt" });
  }
}

/** The app-wide singleton. Tests construct their own `MuzeroDB(uniqueName)`. */
export const db = new MuzeroDB();
