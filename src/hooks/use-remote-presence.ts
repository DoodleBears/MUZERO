import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState } from "react";
import type { CloudDrive } from "@/db/types";
import { log } from "@/lib/logger";
import { listCloudDrives } from "@/sync/cloud-drive-repo";
import type { R2Presence } from "@/sync/r2-presence";
import { createR2PresencePoller } from "@/sync/r2-presence-poller";
import { readRemotePresence } from "@/sync/r2-presence-read";

/** Mirror of the `ses_remote_<driveId>_<setId>` id scheme in r2-import-stream. */
function safeIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_");
}

/**
 * Find the cloud drive a remote-imported set was streamed from, so its presence
 * can be polled. Local sets and drives without a public base URL never poll.
 * Pure + exported so the id-prefix matching is unit-tested without React.
 */
export function resolvePresenceDrive(
  sessionId: string | null,
  drives: CloudDrive[],
): CloudDrive | null {
  if (!sessionId?.startsWith("ses_remote_")) return null;
  for (const drive of drives) {
    if (!drive.publicBaseUrl) continue;
    if (sessionId.startsWith(`ses_remote_${safeIdPart(drive.id)}_`)) return drive;
  }
  return null;
}

/**
 * Poll currently-playing presence for the active set's source drive while the
 * consuming surface is mounted (the visible-scope guard from PRD §5.5 — mounting
 * the Now Playing presence section sets the poller visible; unmount disposes it).
 * Returns active (non-expired) presence rows; empty for local sets.
 */
export function useRemotePresence(activeSessionId: string | null): R2Presence[] {
  const drives = useLiveQuery(() => listCloudDrives(), [], []);
  const [rows, setRows] = useState<R2Presence[]>([]);
  const drive = useMemo(
    () => resolvePresenceDrive(activeSessionId, drives ?? []),
    [activeSessionId, drives],
  );
  const baseUrl = drive?.publicBaseUrl;

  useEffect(() => {
    if (!baseUrl) {
      setRows([]);
      return;
    }
    setRows([]);
    const poller = createR2PresencePoller({
      readPresence: () => readRemotePresence({ baseUrl }),
      onPresence: setRows,
      onError: (error) => log.warn("presence", "remote presence read failed", error),
    });
    poller.setVisible(true);
    return () => poller.dispose();
  }, [baseUrl]);

  return rows;
}
