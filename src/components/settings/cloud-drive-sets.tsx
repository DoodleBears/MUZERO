import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { SourceAttributionChip } from "@/components/cloud/source-attribution-chip";
import { Button } from "@/components/ui/button";
import { CloudDownloadIcon } from "@/components/ui/cloud-download";
import type { CloudDrive, CloudSourceAttribution } from "@/db/types";
import { log } from "@/lib/logger";
import { useSyncStore } from "@/stores/sync-store";
import { refreshImportedSetSourceAttributions } from "@/sync/cloud-source-attribution";
import { getLocalDevice } from "@/sync/device-repo";
import { importRemoteEntityCovers } from "@/sync/r2-import-stream";
import {
  loadRemoteDeviceProfiles,
  loadRemoteEntityCovers,
  loadRemoteSetIndex,
  type RemoteDeviceProfileSummary,
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
  const [deviceProfiles, setDeviceProfiles] = useState<Map<string, RemoteDeviceProfileSummary>>(
    () => new Map(),
  );
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

  const refreshExistingSourceAttributions = useCallback(
    async (
      result: RemoteLibraryPreview,
      profiles: ReadonlyMap<string, RemoteDeviceProfileSummary>,
    ) => {
      try {
        await refreshImportedSetSourceAttributions(
          result.sets.map((set) => ({
            driveId: drive.id,
            remoteSetId: set.id,
            source: sourceForRemoteSet(drive, set, profiles),
          })),
        );
      } catch (cause) {
        log.warn("settings", "failed to refresh imported source attribution", cause);
      }
    },
    [drive],
  );

  const importSetFromPreview = useCallback(
    async (
      result: RemoteLibraryPreview,
      set: RemoteSetPreview,
      profiles: ReadonlyMap<string, RemoteDeviceProfileSummary> = deviceProfiles,
    ) => {
      const publicId = localDevicePublicId ?? (await getLocalDevice())?.publicId;
      if (isSelfPublishedSet(set, publicId)) return;
      const remoteSet = await loadRemoteSetIndex(result, set);
      await useSyncStore.getState().pullRemoteSet({
        driveId: drive.id,
        remoteSet,
        source: sourceForRemoteSet(drive, set, profiles),
      });
    },
    [deviceProfiles, drive, localDevicePublicId],
  );

  const importAllSets = useCallback(
    async (
      result: RemoteLibraryPreview,
      profiles: ReadonlyMap<string, RemoteDeviceProfileSummary> = deviceProfiles,
    ) => {
      setImportingSetId(AUTO_IMPORTING_SET_ID);
      try {
        const publicId = localDevicePublicId ?? (await getLocalDevice())?.publicId;
        for (const set of visibleRemoteSets(result.sets)) {
          if (isSelfPublishedSet(set, publicId)) continue;
          await importSetFromPreview(result, set, profiles);
        }
      } finally {
        setImportingSetId(null);
      }
    },
    [deviceProfiles, importSetFromPreview, localDevicePublicId],
  );

  const browse = useCallback(
    async (options: { importAll?: boolean } = {}) => {
      if (!drive.manifestUrl) return;
      setStatus("loading");
      setError(null);
      try {
        const result = await subscribeManifest(drive.manifestUrl);
        const profiles = await loadDriveDeviceProfiles(result);
        setDeviceProfiles(profiles);
        setPreview(result);
        setStatus("loaded");
        void importDriveEntityCovers(result);
        void refreshExistingSourceAttributions(result, profiles);
        if (options.importAll) await importAllSets(result, profiles);
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
    [
      drive.manifestUrl,
      importAllSets,
      importDriveEntityCovers,
      refreshExistingSourceAttributions,
      t,
    ],
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
      {preview
        ? visibleRemoteSets(preview.sets).map((set) => (
            <div
              key={set.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-background/80 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm">{set.title}</p>
                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-muted-foreground text-xs">
                  <SourceAttributionChip
                    source={sourceForRemoteSet(drive, set, deviceProfiles)}
                    fallback={t("settings.cloudSourceUnknown")}
                  />
                  <span>
                    {t("settings.cloudSetMeta", {
                      tracks: set.trackCount,
                      bytes: formatBytes(set.bytes),
                    })}
                  </span>
                </div>
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
                {importingSetId === set.id
                  ? t("settings.cloudImporting")
                  : t("settings.cloudImport")}
              </Button>
            </div>
          ))
        : null}
    </div>
  );
}

async function loadDriveDeviceProfiles(
  preview: RemoteLibraryPreview,
): Promise<Map<string, RemoteDeviceProfileSummary>> {
  try {
    return await loadRemoteDeviceProfiles(preview);
  } catch (cause) {
    log.warn("settings", "failed to load remote device profiles", cause);
    return new Map();
  }
}

function sourceForRemoteSet(
  drive: CloudDrive,
  set: RemoteSetPreview,
  profiles: ReadonlyMap<string, RemoteDeviceProfileSummary>,
): CloudSourceAttribution {
  const profile = set.publishedBy ? profiles.get(set.publishedBy) : undefined;
  return {
    driveId: drive.id,
    driveLabel: drive.label,
    devicePublicId: set.publishedBy,
    displayName: profile?.displayName,
    avatarSeed: profile?.avatarSeed ?? set.publishedBy,
    avatarUrl: profile?.avatarUrl,
  };
}

function isSelfPublishedSet(
  set: RemoteSetPreview,
  localDevicePublicId: string | undefined,
): boolean {
  return Boolean(localDevicePublicId && set.publishedBy === localDevicePublicId);
}

function visibleRemoteSets(sets: RemoteSetPreview[]): RemoteSetPreview[] {
  const nonEmptyKeys = new Set(
    sets.filter((set) => set.trackCount > 0).map((set) => remoteSetLegacyKey(set)),
  );
  const keptEmptyKeys = new Set<string>();
  return sets.filter((set) => {
    if (set.trackCount > 0) return true;
    const key = remoteSetLegacyKey(set);
    if (nonEmptyKeys.has(key)) return false;
    if (keptEmptyKeys.has(key)) return false;
    keptEmptyKeys.add(key);
    return true;
  });
}

function remoteSetLegacyKey(set: RemoteSetPreview): string {
  const publisher = set.publishedBy ?? "";
  const title = set.title.trim().replace(/\s+/g, " ").toLocaleLowerCase();
  return `${publisher}\u0000${title}`;
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
