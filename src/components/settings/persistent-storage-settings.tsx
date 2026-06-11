import { useLiveQuery } from "dexie-react-hooks";
import { RefreshCw, Trash2, XCircle } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  cleanupOrphanedMediaStorageFiles,
  type MediaBlobMigrationProgress,
  migrateLegacyMediaBlobsWithProgress,
  type PersistentMediaStorageBucket,
  type PersistentMediaStorageSummary,
  summarizePersistentMediaStorage,
} from "@/db/media-blob-storage";
import type { MediaBlob } from "@/db/types";
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
  gallery: "streamCache.permanentRole_gallery",
  media: "streamCache.permanentRole_media",
  memory: "streamCache.permanentRole_memory",
} as const satisfies Record<MediaBlob["role"], string>;

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
  const [busy, setBusy] = useState<"migrate" | "cleanup" | null>(null);
  const [migrationProgress, setMigrationProgress] = useState<MediaBlobMigrationProgress | null>(
    null,
  );
  const [refreshToken, setRefreshToken] = useState(0);
  const migrationAbortRef = useRef<AbortController | null>(null);
  const summary = useLiveQuery(
    () => summarizePersistentMediaStorage(undefined, { includeHealth: true }),
    [refreshToken],
    EMPTY_SUMMARY,
  );

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

  const roles = Object.entries(summary.byRole).filter(
    (entry): entry is [MediaBlob["role"], PersistentMediaStorageBucket] => Boolean(entry[1]),
  );
  const migrationPercent =
    migrationProgress && migrationProgress.total > 0
      ? Math.round((migrationProgress.processed / migrationProgress.total) * 100)
      : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("streamCache.permanentTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-muted-foreground text-xs">{t("streamCache.permanentHint")}</p>
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

        <div className="grid gap-2 rounded-md border border-border bg-muted/25 p-3 text-xs sm:grid-cols-3">
          <span>{t("streamCache.permanentLegacy", { count: summary.legacyMediaCount })}</span>
          <span>{t("streamCache.permanentMissing", { count: summary.missingCount })}</span>
          <span>{t("streamCache.permanentOrphaned", { count: summary.orphanedCount })}</span>
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

        <div className="flex flex-wrap gap-2">
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
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy !== null || summary.orphanedCount === 0}
            onClick={() => void cleanupOrphans()}
          >
            <Trash2 /> {t("streamCache.permanentCleanup")}
          </Button>
        </div>
      </CardContent>
    </Card>
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
