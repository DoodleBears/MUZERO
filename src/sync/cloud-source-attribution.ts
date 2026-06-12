import { db as defaultDb, type MuzeroDB } from "@/db/muzero-db";
import type { CloudSourceAttribution } from "@/db/types";
import { sanitizeCloudSource } from "./r2-import-stream";

export interface ImportedSetSourceAttributionInput {
  driveId: string;
  remoteSetId: string;
  source?: CloudSourceAttribution;
}

export interface ImportedSetSourceAttributionResult {
  sessionsUpdated: number;
  tracksUpdated: number;
}

export async function refreshImportedSetSourceAttribution(
  input: ImportedSetSourceAttributionInput,
  db: MuzeroDB = defaultDb,
): Promise<ImportedSetSourceAttributionResult> {
  if (!input.source) return { sessionsUpdated: 0, tracksUpdated: 0 };

  const source = sanitizeCloudSource(input.source);
  const sessionId = remoteLocalId("ses", input.driveId, input.remoteSetId);
  const trackIdPrefix = remoteIdPrefix("trk", input.driveId);
  let sessionsUpdated = 0;
  let tracksUpdated = 0;

  await db.transaction("rw", db.sessions, db.tracks, async () => {
    const session = await db.sessions.get(sessionId);
    if (!session) return;

    if (!sameCloudSource(session.cloudSource, source)) {
      await db.sessions.update(sessionId, { cloudSource: source });
      sessionsUpdated = 1;
    }

    const remoteTrackIds = session.trackIds.filter((trackId) => trackId.startsWith(trackIdPrefix));
    const tracks = await db.tracks.bulkGet(remoteTrackIds);
    await Promise.all(
      tracks.map((track) => {
        if (!track || sameCloudSource(track.cloudSource, source)) return undefined;
        tracksUpdated += 1;
        return db.tracks.update(track.id, { cloudSource: source });
      }),
    );
  });

  return { sessionsUpdated, tracksUpdated };
}

export async function refreshImportedSetSourceAttributions(
  inputs: ImportedSetSourceAttributionInput[],
  db: MuzeroDB = defaultDb,
): Promise<ImportedSetSourceAttributionResult> {
  let sessionsUpdated = 0;
  let tracksUpdated = 0;
  for (const input of inputs) {
    const result = await refreshImportedSetSourceAttribution(input, db);
    sessionsUpdated += result.sessionsUpdated;
    tracksUpdated += result.tracksUpdated;
  }
  return { sessionsUpdated, tracksUpdated };
}

function remoteLocalId(prefix: "ses" | "trk", driveId: string, remoteId: string): string {
  return `${remoteIdPrefix(prefix, driveId)}${safeIdPart(remoteId)}`;
}

function remoteIdPrefix(prefix: "ses" | "trk", driveId: string): string {
  return `${prefix}_remote_${safeIdPart(driveId)}_`;
}

function safeIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_");
}

function sameCloudSource(
  a: CloudSourceAttribution | undefined,
  b: CloudSourceAttribution,
): boolean {
  return (
    a?.driveId === b.driveId &&
    (a.driveLabel ?? undefined) === (b.driveLabel ?? undefined) &&
    (a.devicePublicId ?? undefined) === (b.devicePublicId ?? undefined) &&
    (a.displayName ?? undefined) === (b.displayName ?? undefined) &&
    (a.avatarSeed ?? undefined) === (b.avatarSeed ?? undefined) &&
    (a.avatarUrl ?? undefined) === (b.avatarUrl ?? undefined)
  );
}
