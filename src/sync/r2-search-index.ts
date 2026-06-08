import { db as defaultDb, type MuzeroDB } from "@/db/muzero-db";
import type { RemoteSearchTrack } from "@/db/types";
import {
  matchesRemoteSearchTrack,
  type R2SetSearchPage,
  type R2TrackSearchPage,
  remoteSearchSetToRow,
  remoteSearchTrackToRow,
} from "./r2-search-catalog";

export interface ImportRemoteTrackSearchPageInput {
  catalogId: string;
  driveId: string;
  shareId?: string;
  page: R2TrackSearchPage;
}

export interface ImportRemoteSetSearchPageInput {
  catalogId: string;
  driveId: string;
  shareId?: string;
  page: R2SetSearchPage;
}

export async function importRemoteTrackSearchPage(
  input: ImportRemoteTrackSearchPageInput,
  db: MuzeroDB = defaultDb,
): Promise<void> {
  const rows = input.page.tracks.map((track) =>
    remoteSearchTrackToRow({
      catalogId: input.catalogId,
      driveId: input.driveId,
      shareId: input.shareId,
      track,
    }),
  );
  await db.remoteSearchTracks.bulkPut(rows);
}

export async function importRemoteSetSearchPage(
  input: ImportRemoteSetSearchPageInput,
  db: MuzeroDB = defaultDb,
): Promise<void> {
  const rows = input.page.sets.map((set) =>
    remoteSearchSetToRow({
      catalogId: input.catalogId,
      driveId: input.driveId,
      shareId: input.shareId,
      set,
    }),
  );
  await db.remoteSearchSets.bulkPut(rows);
}

export async function searchRemoteTracks(
  query: string,
  db: MuzeroDB = defaultDb,
): Promise<RemoteSearchTrack[]> {
  const rows = await db.remoteSearchTracks.toArray();
  return rows.filter((row) => matchesRemoteSearchTrack(row, query));
}
