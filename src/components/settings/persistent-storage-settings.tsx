import { useLiveQuery } from "dexie-react-hooks";
import { FolderOpen, Palette, RefreshCw, Trash2, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { StreamCacheControls } from "@/components/settings/stream-cache-controls";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  countMissingCoverDerivatives,
  repairMissingCoverDerivatives,
} from "@/db/cover-derivatives";
import {
  cleanupOrphanedMediaStorageFiles,
  type MediaBlobMigrationProgress,
  migrateLegacyMediaBlobsWithProgress,
  type PersistentMediaStorageBucket,
  type PersistentMediaStorageSummary,
  summarizePersistentMediaStorage,
} from "@/db/media-blob-storage";
import { backfillCoverMetadata, countCoverMetadataBackfillCandidates } from "@/db/repositories";
import type { MediaBlob } from "@/db/types";
import { resolveDesktopBridge } from "@/lib/desktop/bridge";
import { useNavStore } from "@/stores/nav-store";
import { notify } from "@/stores/notification-store";

const EMPTY_BUCKET = { count: 0, bytes: 0 } satisfies PersistentMediaStorageBucket;
const EMPTY_SUMMARY = {
  count: 0,
  bytes: 0,
  legacyMediaCount: 0,
  missingCount: 0,
  orphanedCount: 0,
  byBackend: {
    indexeddb: EMPTY_BUCKET,
    opfs: EMPTY_BUCKET,
    "electron-file": EMPTY_BUCKET,
  },
  byRole: {},
} satisfies PersistentMediaStorageSummary;

const ROLE_LABEL_KEYS = {
  avatar: "streamCache.permanentRole_avatar",
  background: "streamCache.permanentRole_background",
  cover: "streamCache.permanentRole_cover",
  "cover-derivative": "streamCache.permanentRole_coverDerivative",
  gallery: "streamCache.permanentRole_gallery",
  media: "streamCache.permanentRole_media",
  memory: "streamCache.permanentRole_memory",
} as const satisfies Record<MediaBlob["role"], string>;

const COVER_REPAIR_BATCH_SIZE = 25;
const COVER_DERIVATIVE_REPAIR_BATCH_SIZE = 25;

interface BrowserStorageEstimate {
  usage: number;
  quota?: number;
}

interface CoverRepairProgress {
  failed: number;
  kind?: "backlight" | "metadata" | "thumbnail";
  processed: number;
  total: number;
  updated: number;
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

export function PersistentStorageSettings() {
  const { t } = useTranslation();
  const openMediaStorageFolder = resolveDesktopBridge().openMediaStorageFolder;
  const [busy, setBusy] = useState<
    "cleanup" | "migrate" | "repair-backlights" | "repair-covers" | "repair-thumbnails" | null
  >(null);
  const [migrationProgress, setMigrationProgress] = useState<MediaBlobMigrationProgress | null>(
    null,
  );
  const [coverRepairProgress, setCoverRepairProgress] = useState<CoverRepairProgress | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [storageRefreshToken, setStorageRefreshToken] = useState(0);
  const [browserStorage, setBrowserStorage] = useState<BrowserStorageEstimate | null>(null);
  const migrationAbortRef = useRef<AbortController | null>(null);
  const coverRepairAbortRef = useRef<AbortController | null>(null);
  // These scan tracks / mediaBlobs / derivatives, which the playback warmup writes
  // (covers cached) during playback / song switches — re-rendering a hidden Settings
  // tab. Gate on the settings tab being active so the hidden page doesn't observe those
  // writes (PRD reactivity-render-observability F3). Re-reads on tab enter.
  const settingsActive = useNavStore((s) => s.tab === "settings");
  const summary = useLiveQuery(
    () =>
      settingsActive
        ? summarizePersistentMediaStorage(undefined, { includeHealth: true })
        : Promise.resolve(EMPTY_SUMMARY),
    [refreshToken, settingsActive],
    EMPTY_SUMMARY,
  );
  const coverRepairCount = useLiveQuery(
    () => (settingsActive ? countCoverMetadataBackfillCandidates() : Promise.resolve(0)),
    [refreshToken, settingsActive],
    0,
  );
  const thumbnailRepairCount = useLiveQuery(
    () => (settingsActive ? countMissingCoverDerivatives("thumbnail") : Promise.resolve(0)),
    [refreshToken, settingsActive],
    0,
  );
  const backlightRepairCount = useLiveQuery(
    () => (settingsActive ? countMissingCoverDerivatives("backlight") : Promise.resolve(0)),
    [refreshToken, settingsActive],
    0,
  );

  useEffect(() => {
    void storageRefreshToken;
    let cancelled = false;
    async function loadBrowserStorage() {
      const estimate = await navigator.storage?.estimate?.();
      if (cancelled) return;
      const usage = Math.max(0, Math.round(estimate?.usage ?? 0));
      const quota =
        estimate?.quota && Number.isFinite(estimate.quota) && estimate.quota > 0
          ? Math.round(estimate.quota)
          : undefined;
      setBrowserStorage({ usage, quota });
    }
    loadBrowserStorage().catch(() => {
      if (!cancelled) setBrowserStorage({ usage: 0 });
    });
    return () => {
      cancelled = true;
    };
  }, [storageRefreshToken]);

  async function migrateLegacy() {
    setBusy("migrate");
    const controller = new AbortController();
    migrationAbortRef.current = controller;
    setMigrationProgress({
      cancelled: false,
      failed: 0,
      migrated: 0,
      processed: 0,
      skipped: 0,
      total: summary.legacyMediaCount,
    });
    try {
      const result = await migrateLegacyMediaBlobsWithProgress(undefined, {
        batchSize: 20,
        onProgress: setMigrationProgress,
        signal: controller.signal,
      });
      setMigrationProgress(result);
      notify.success(
        t(
          result.cancelled
            ? "streamCache.permanentMigrateCancelled"
            : "streamCache.permanentMigrateDone",
          { count: result.migrated },
        ),
      );
      setRefreshToken((value) => value + 1);
    } finally {
      migrationAbortRef.current = null;
      setBusy(null);
    }
  }

  function cancelMigration() {
    migrationAbortRef.current?.abort();
  }

  function refreshUsage() {
    setRefreshToken((value) => value + 1);
    setStorageRefreshToken((value) => value + 1);
  }

  async function cleanupOrphans() {
    setBusy("cleanup");
    try {
      const result = await cleanupOrphanedMediaStorageFiles();
      notify.success(t("streamCache.permanentCleanupDone", { count: result.deleted.length }));
      setRefreshToken((value) => value + 1);
    } finally {
      setBusy(null);
    }
  }

  async function repairCoverMetadata() {
    setBusy("repair-covers");
    const controller = new AbortController();
    coverRepairAbortRef.current = controller;
    const total = Math.max(0, coverRepairCount);
    const skipped = new Set<string>();
    const progress: CoverRepairProgress = {
      failed: 0,
      kind: "metadata",
      processed: 0,
      total,
      updated: 0,
    };
    setCoverRepairProgress(progress);
    try {
      while (progress.processed < total && !controller.signal.aborted) {
        const result = await backfillCoverMetadata(undefined, {
          limit: COVER_REPAIR_BATCH_SIZE,
          skip: skipped,
        });
        if (result.attempted.length === 0) break;
        for (const key of result.attempted) skipped.add(key);
        progress.processed = Math.min(total, progress.processed + result.attempted.length);
        progress.updated += result.updated;
        progress.failed += Math.max(0, result.attempted.length - result.updated);
        setCoverRepairProgress({ ...progress });
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (!controller.signal.aborted && progress.processed < total) {
        progress.processed = total;
        setCoverRepairProgress({ ...progress });
      }
      notify.success(
        t(
          controller.signal.aborted
            ? "streamCache.permanentRepairCoversCancelled"
            : "streamCache.permanentRepairCoversDone",
          { count: progress.updated },
        ),
      );
      setRefreshToken((value) => value + 1);
    } finally {
      if (coverRepairAbortRef.current === controller) coverRepairAbortRef.current = null;
      setBusy(null);
    }
  }

  async function repairCoverDerivatives(kind: "backlight" | "thumbnail") {
    const busyKind = kind === "thumbnail" ? "repair-thumbnails" : "repair-backlights";
    setBusy(busyKind);
    const controller = new AbortController();
    coverRepairAbortRef.current = controller;
    const total = Math.max(0, kind === "thumbnail" ? thumbnailRepairCount : backlightRepairCount);
    const skipped = new Set<string>();
    const progress: CoverRepairProgress = { failed: 0, kind, processed: 0, total, updated: 0 };
    setCoverRepairProgress(progress);
    try {
      while (progress.processed < total && !controller.signal.aborted) {
        const result = await repairMissingCoverDerivatives(kind, undefined, {
          limit: COVER_DERIVATIVE_REPAIR_BATCH_SIZE,
          skip: skipped,
        });
        if (result.attempted.length === 0) break;
        for (const key of result.attempted) skipped.add(key);
        progress.processed = Math.min(total, progress.processed + result.processed);
        progress.updated += result.updated;
        progress.failed += result.failed;
        setCoverRepairProgress({ ...progress });
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (!controller.signal.aborted && progress.processed < total) {
        progress.processed = total;
        setCoverRepairProgress({ ...progress });
      }
      notify.success(
        t(
          controller.signal.aborted
            ? "streamCache.permanentRepairCoverDerivativesCancelled"
            : "streamCache.permanentRepairCoverDerivativesDone",
          { count: progress.updated },
        ),
      );
      setRefreshToken((value) => value + 1);
    } finally {
      if (coverRepairAbortRef.current === controller) coverRepairAbortRef.current = null;
      setBusy(null);
    }
  }

  function cancelCoverRepair() {
    coverRepairAbortRef.current?.abort();
  }

  const roles = Object.entries(summary.byRole).filter(
    (entry): entry is [MediaBlob["role"], PersistentMediaStorageBucket] => Boolean(entry[1]),
  );
  const migrationPercent =
    migrationProgress && migrationProgress.total > 0
      ? Math.round((migrationProgress.processed / migrationProgress.total) * 100)
      : 0;
  const coverRepairPercent =
    coverRepairProgress && coverRepairProgress.total > 0
      ? Math.round((coverRepairProgress.processed / coverRepairProgress.total) * 100)
      : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.storageTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-muted-foreground text-xs">{t("streamCache.permanentHint")}</p>
        <StorageUsage estimate={browserStorage} onRefresh={refreshUsage} />
        <StreamCacheControls />
        <p className="font-medium text-sm">
          {t("streamCache.permanentUsage", {
            count: summary.count,
            size: formatBytes(summary.bytes),
          })}
        </p>

        <div className="grid gap-2 text-xs sm:grid-cols-3">
          <StorageStat
            label={t("streamCache.permanentBackendIndexedDb")}
            bucket={summary.byBackend.indexeddb}
          />
          <StorageStat
            label={t("streamCache.permanentBackendOpfs")}
            bucket={summary.byBackend.opfs}
          />
          <StorageStat
            label={t("streamCache.permanentBackendElectron")}
            bucket={summary.byBackend["electron-file"]}
          />
        </div>

        {roles.length > 0 && (
          <div className="grid gap-2 text-xs sm:grid-cols-3">
            {roles.map(([role, bucket]) => (
              <StorageStat key={role} label={t(ROLE_LABEL_KEYS[role])} bucket={bucket} />
            ))}
          </div>
        )}

        <div className="grid gap-2 rounded-md border border-border bg-muted/25 p-3 text-xs sm:grid-cols-4">
          <span>{t("streamCache.permanentLegacy", { count: summary.legacyMediaCount })}</span>
          <span>{t("streamCache.permanentMissing", { count: summary.missingCount })}</span>
          <span>{t("streamCache.permanentOrphaned", { count: summary.orphanedCount })}</span>
          <span>{t("streamCache.permanentCoverRepair", { count: coverRepairCount })}</span>
          <span>
            {t("streamCache.permanentCoverThumbnailRepair", { count: thumbnailRepairCount })}
          </span>
          <span>
            {t("streamCache.permanentCoverBacklightRepair", { count: backlightRepairCount })}
          </span>
        </div>

        {migrationProgress && (
          <div className="rounded-md border border-border bg-muted/20 p-3">
            <div className="mb-2 flex items-center justify-between gap-3 text-xs">
              <span className="font-medium">
                {t("streamCache.permanentProgress", {
                  processed: migrationProgress.processed,
                  total: migrationProgress.total,
                })}
              </span>
              <span className="text-muted-foreground">{migrationPercent}%</span>
            </div>
            <div
              role="progressbar"
              aria-label={t("streamCache.permanentProgress", {
                processed: migrationProgress.processed,
                total: migrationProgress.total,
              })}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={migrationPercent}
              className="h-2 overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{ width: `${migrationPercent}%` }}
              />
            </div>
            <div className="mt-2 grid gap-1 text-muted-foreground text-xs sm:grid-cols-2">
              <span>
                {t("streamCache.permanentProgressDetail", {
                  failed: migrationProgress.failed,
                  migrated: migrationProgress.migrated,
                  skipped: migrationProgress.skipped,
                })}
              </span>
              {migrationProgress.current && (
                <span>
                  {t("streamCache.permanentCurrent", {
                    role: t(ROLE_LABEL_KEYS[migrationProgress.current.role]),
                    size: formatBytes(migrationProgress.current.bytes),
                  })}
                </span>
              )}
            </div>
          </div>
        )}

        {coverRepairProgress && (
          <div className="rounded-md border border-border bg-muted/20 p-3">
            <div className="mb-2 flex items-center justify-between gap-3 text-xs">
              <span className="font-medium">
                {t("streamCache.permanentCoverRepairProgress", {
                  processed: coverRepairProgress.processed,
                  total: coverRepairProgress.total,
                })}
              </span>
              <span className="text-muted-foreground">{coverRepairPercent}%</span>
            </div>
            <div
              role="progressbar"
              aria-label={t("streamCache.permanentCoverRepairProgress", {
                processed: coverRepairProgress.processed,
                total: coverRepairProgress.total,
              })}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={coverRepairPercent}
              className="h-2 overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{ width: `${coverRepairPercent}%` }}
              />
            </div>
            <p className="mt-2 text-muted-foreground text-xs">
              {t("streamCache.permanentCoverRepairDetail", {
                failed: coverRepairProgress.failed,
                updated: coverRepairProgress.updated,
              })}
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {openMediaStorageFolder && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void openMediaStorageFolder()}
            >
              <FolderOpen /> {t("streamCache.permanentOpenFolder")}
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy !== null || summary.legacyMediaCount === 0}
            onClick={() => void migrateLegacy()}
          >
            <RefreshCw /> {t("streamCache.permanentMigrate")}
          </Button>
          {busy === "migrate" && (
            <Button type="button" size="sm" variant="outline" onClick={cancelMigration}>
              <XCircle /> {t("streamCache.permanentCancel")}
            </Button>
          )}
          {busy?.startsWith("repair-") && (
            <Button type="button" size="sm" variant="outline" onClick={cancelCoverRepair}>
              <XCircle /> {t("streamCache.permanentCancelRepair")}
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy !== null || summary.orphanedCount === 0}
            onClick={() => void cleanupOrphans()}
          >
            <Trash2 /> {t("streamCache.permanentCleanup")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy !== null || coverRepairCount === 0}
            onClick={() => void repairCoverMetadata()}
          >
            <Palette /> {t("streamCache.permanentRepairCovers")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy !== null || thumbnailRepairCount === 0}
            onClick={() => void repairCoverDerivatives("thumbnail")}
          >
            <Palette /> {t("streamCache.permanentRepairCoverThumbnails")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy !== null || backlightRepairCount === 0}
            onClick={() => void repairCoverDerivatives("backlight")}
          >
            <Palette /> {t("streamCache.permanentRepairCoverBacklights")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function StorageUsage({
  estimate,
  onRefresh,
}: {
  estimate: BrowserStorageEstimate | null;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const usage = estimate?.usage ?? 0;
  const quota = estimate?.quota;
  const percent = quota ? Math.min(100, Math.round((usage / quota) * 100)) : null;
  const usageText =
    quota == null
      ? t("settings.storageUsageUnavailable", { usage: formatBytes(usage) })
      : t("settings.storageUsageRatio", {
          percent: percent ?? 0,
          quota: formatBytes(quota),
          usage: formatBytes(usage),
        });
  return (
    <div className="rounded-md border border-border bg-muted/25 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-sm">{t("settings.storageUsageTitle")}</p>
          <p className="text-muted-foreground text-xs">{usageText}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onRefresh}>
          <RefreshCw />
          {t("settings.storageUsageRefresh")}
        </Button>
      </div>
      {percent != null && (
        <div
          role="progressbar"
          aria-label={t("settings.storageUsageTitle")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="mt-3 h-2 overflow-hidden rounded-full bg-background"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
    </div>
  );
}

function StorageStat({ label, bucket }: { label: string; bucket: PersistentMediaStorageBucket }) {
  return (
    <div className="rounded-md border border-border p-2">
      <p className="text-muted-foreground">{label}</p>
      <p className="font-medium">
        {bucket.count} · {formatBytes(bucket.bytes)}
      </p>
    </div>
  );
}
