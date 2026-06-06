import Dexie, { type EntityTable } from "dexie";
import type { AppSettings, DjSession, MediaBlob, Track } from "./types";

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
  }
}

/** The app-wide singleton. Tests construct their own `MuzeroDB(uniqueName)`. */
export const db = new MuzeroDB();
