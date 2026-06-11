import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { CloudDownloadIcon } from "@/components/ui/cloud-download";
import type { CloudDrive } from "@/db/types";
import { log } from "@/lib/logger";
import { useSyncStore } from "@/stores/sync-store";
import {
  loadRemoteSetIndex,
  type RemoteLibraryPreview,
  type RemoteSetPreview,
  subscribeManifest,
} from "@/sync/r2-subscription";

type BrowseStatus = "idle" | "loading" | "loaded" | "error";

/**
 * Browse + import a connected drive's remote sets, inline on the drive row. This
 * replaces the standalone Subscribe page — set discovery/import is a property of
 * a drive. Imports are keyed by `drive.id` so local session/track ids
 * (`ses_remote_<driveId>_…`) stay consistent with the drive, and go through the
 * orchestrated pull (audit F2): dry-run diff gates (keep-local / conflict /
 * blocked), durable pull `syncRuns`, and the per-drive progress pipeline that
 * `CloudDriveLiveProgress` + the sync toast already render.
 */
export function CloudDriveSets({ drive }: { drive: CloudDrive }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<BrowseStatus>("idle");
  const [preview, setPreview] = useState<RemoteLibraryPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importingSetId, setImportingSetId] = useState<string | null>(null);

  async function browse() {
    if (!drive.manifestUrl) return;
    setStatus("loading");
    setError(null);
    try {
      const result = await subscribeManifest(drive.manifestUrl);
      setPreview(result);
      setStatus("loaded");
    } catch (cause) {
      setStatus("error");
      setError(cause instanceof Error ? cause.message : String(cause));
      log.warn("settings", "failed to browse drive sets", cause);
    }
  }

  async function importSet(set: RemoteSetPreview) {
    if (!preview) return;
    setImportingSetId(set.id);
    setError(null);
    try {
      const remoteSet = await loadRemoteSetIndex(preview, set);
      // Outcomes (completed / needs-review / blocked / failed) surface through the
      // drive's progress line + sync toast; this only reports the index fetch.
      await useSyncStore.getState().pullRemoteSet({ driveId: drive.id, remoteSet });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      log.warn("settings", "failed to import remote set", cause);
    } finally {
      setImportingSetId(null);
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={status === "loading" || !drive.manifestUrl}
        onClick={() => void browse()}
      >
        {status === "loading" ? t("settings.cloudPreviewing") : t("settings.cloudPreview")}
      </Button>
      {error && <p className="text-destructive text-xs">{error}</p>}
      {preview?.sets.map((set) => (
        <div
          key={set.id}
          className="flex items-center justify-between gap-3 rounded-md border border-border bg-background/80 px-3 py-2"
        >
          <div className="min-w-0">
            <p className="truncate text-sm">{set.title}</p>
            <p className="text-muted-foreground text-xs">
              {t("settings.cloudSetMeta", {
                tracks: set.trackCount,
                bytes: formatBytes(set.bytes),
              })}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={importingSetId === set.id}
            onClick={() => void importSet(set)}
          >
            <CloudDownloadIcon size={16} />
            {importingSetId === set.id ? t("settings.cloudImporting") : t("settings.cloudImport")}
          </Button>
        </div>
      ))}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}
