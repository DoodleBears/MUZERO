import { useLiveQuery } from "dexie-react-hooks";
import { RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  cleanupOrphanedMediaStorageFiles,
  migrateLegacyMediaBlobs,
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
  const [refreshToken, setRefreshToken] = useState(0);
  const summary = useLiveQuery(
    () => summarizePersistentMediaStorage(undefined, { includeHealth: true }),
    [refreshToken],
    EMPTY_SUMMARY,
  );

  async function migrateLegacy() {
    setBusy("migrate");
    try {
      const result = await migrateLegacyMediaBlobs();
      notify.success(t("streamCache.permanentMigrateDone", { count: result.migrated }));
      setRefreshToken((value) => value + 1);
    } finally {
      setBusy(null);
    }
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
