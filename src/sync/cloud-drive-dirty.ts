import { db as defaultDb, type MuzeroDB } from "@/db/muzero-db";
import type { DjSession } from "@/db/types";
import { publishedEntityId } from "./r2-import-stream";

export async function findPendingCloudDriveLocalChangesSince(
  driveId: string,
  db: MuzeroDB = defaultDb,
): Promise<number | undefined> {
  const [sessions, syncRuns] = await Promise.all([
    db.sessions.toArray(),
    db.syncRuns.where("driveId").equals(driveId).toArray(),
  ]);
  const latestCompletedPushAt = syncRuns
    .filter((run) => run.direction === "push" && run.status === "completed")
    .reduce<number | undefined>((latest, run) => {
      const completedAt = run.finishedAt ?? run.startedAt;
      return latest == null ? completedAt : Math.max(latest, completedAt);
    }, undefined);

  const changedAt = sessions
    .filter((session) => publishesToDrive(session, driveId))
    .map((session) => session.updatedAt)
    .filter((updatedAt) => latestCompletedPushAt == null || updatedAt > latestCompletedPushAt);

  return changedAt.length > 0 ? Math.min(...changedAt) : undefined;
}

function publishesToDrive(session: DjSession, driveId: string): boolean {
  if (!session.id.startsWith("ses_remote_")) return true;
  return publishedEntityId("ses", driveId, session.id) !== session.id;
}
