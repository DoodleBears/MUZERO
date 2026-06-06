import Dexie, { type EntityTable } from "dexie";
import type { AppSettings, DjSession, MediaBlob, Track } from "./types";

/**
 * MUZERO's on-device store. Everything lives here — tracks, audio blobs, DJ
 * sessions, settings — there is no backend and no cloud. The DB name
 * `muzero-db` is a stable codename and must not change across UI/brand tweaks
 * (mirrors the doodlekuma "brand rename layers" rule).
 */
export class MuzeroDB extends Dexie {
  tracks!: EntityTable<Track, "id">;
  mediaBlobs!: EntityTable<MediaBlob, "id">;
  sessions!: EntityTable<DjSession, "id">;
  settings!: EntityTable<AppSettings, "id">;

  constructor(name = "muzero-db") {
    super(name);
    this.version(1).stores({
      // Indexes: only fields we filter/sort by. Blobs deliberately excluded.
      tracks: "id, sessionId, status, createdAt, liked",
      mediaBlobs: "id, trackId",
      sessions: "id, status, updatedAt",
      settings: "id",
    });
  }
}

/** The app-wide singleton. Tests construct their own `MuzeroDB(uniqueName)`. */
export const db = new MuzeroDB();
