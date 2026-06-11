import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { CloudDownloadIcon } from "@/components/ui/cloud-download";
import type { CloudDrive } from "@/db/types";
import { log } from "@/lib/logger";
import { useSyncStore } from "@/stores/sync-store";
import { getLocalDevice } from "@/sync/device-repo";
import { importRemoteEntityCovers } from "@/sync/r2-import-stream";
import {
  loadRemoteEntityCovers,
  loadRemoteSetIndex,
  type RemoteLibraryPreview,
  type RemoteSetPreview,
  subscribeManifest,
} from "@/sync/r2-subscription";

type BrowseStatus = "idle" | "loading" | "loaded" | "error";
const AUTO_IMPORTING_SET_ID = "__all__";

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
  const [localDevicePublicId, setLocalDevicePublicId] = useState<string | undefined>();
  const autoImportStartedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void getLocalDevice()
      .then((device) => {
        if (!cancelled) setLocalDevicePublicId(device?.publicId);
      })
      .catch((cause) =>
        log.warn("settings", "failed to read local device for drive import", cause),
      );
    return () => {
      cancelled = true;
    };
  }, []);

  const importDriveEntityCovers = useCallback(async (result: RemoteLibraryPreview) => {
    try {
      const covers = await loadRemoteEntityCovers(result);
      if (covers) await importRemoteEntityCovers(covers);
    } catch (cause) {
      log.warn("settings", "failed to import drive entity covers", cause);
    }
  }, []);

  const importSetFromPreview = useCallback(
    async (result: RemoteLibraryPreview, set: RemoteSetPreview) => {
      const publicId = localDevicePublicId ?? (await getLocalDevice())?.publicId;
      if (isSelfPublishedSet(set, publicId)) return;
      const remoteSet = await loadRemoteSetIndex(result, set);
      await useSyncStore.getState().pullRemoteSet({ driveId: drive.id, remoteSet });
    },
    [drive.id, localDevicePublicId],
  );

  const importAllSets = useCallback(
    async (result: RemoteLibraryPreview) => {
      setImportingSetId(AUTO_IMPORTING_SET_ID);
      try {
        const publicId = localDevicePublicId ?? (await getLocalDevice())?.publicId;
        for (const set of result.sets) {
          if (isSelfPublishedSet(set, publicId)) continue;
          await importSetFromPreview(result, set);
        }
      } finally {
        setImportingSetId(null);
      }
    },
    [importSetFromPreview, localDevicePublicId],
  );

  const browse = useCallback(
    async (options: { importAll?: boolean } = {}) => {
      if (!drive.manifestUrl) return;
      setStatus("loading");
      setError(null);
      try {
        const result = await subscribeManifest(drive.manifestUrl);
        setPreview(result);
        setStatus("loaded");
        void importDriveEntityCovers(result);
        if (options.importAll) await importAllSets(result);
      } catch (cause) {
        if (isMissingManifest(cause)) {
          setPreview(null);
          setStatus("loaded");
          setError(t("settings.cloudPreviewEmpty"));
          return;
        }
        setStatus("error");
        setError(cause instanceof Error ? cause.message : String(cause));
        log.warn("settings", "failed to browse drive sets", cause);
      }
    },
    [drive.manifestUrl, importAllSets, importDriveEntityCovers, t],
  );

  useEffect(() => {
    if (drive.autoSyncFrequency == null || drive.autoSyncFrequency === "manual") return;
    if (!drive.manifestUrl || autoImportStartedRef.current) return;
    autoImportStartedRef.current = true;
    void browse({ importAll: true });
  }, [browse, drive.autoSyncFrequency, drive.manifestUrl]);

  async function importSet(set: RemoteSetPreview) {
    if (!preview) return;
    setImportingSetId(set.id);
    setError(null);
    try {
      // Outcomes (completed / needs-review / blocked / failed) surface through the
      // drive's progress line + sync toast; this only reports the index fetch.
      await importSetFromPreview(preview, set);
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
            disabled={
              isSelfPublishedSet(set, localDevicePublicId) ||
              importingSetId === set.id ||
              importingSetId === AUTO_IMPORTING_SET_ID
            }
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

function isSelfPublishedSet(
  set: RemoteSetPreview,
  localDevicePublicId: string | undefined,
): boolean {
  return Boolean(localDevicePublicId && set.publishedBy === localDevicePublicId);
}

function isMissingManifest(cause: unknown): boolean {
  return cause instanceof Error && /Failed to fetch manifest: HTTP 404\b/.test(cause.message);
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
