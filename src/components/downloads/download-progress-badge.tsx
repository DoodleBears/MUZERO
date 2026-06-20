import { useLiveQuery } from "dexie-react-hooks";
import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { db } from "@/db/muzero-db";
import type { DownloadJob } from "@/db/types";
import { useNavStore } from "@/stores/nav-store";

/**
 * Floating progress chip for the persistent download queue — shown only while downloads are
 * in flight (active + pending), so favlist/batch downloads have visible feedback outside
 * Settings → Downloads (per the user request). Tapping jumps to Settings (the full panel).
 * Bilibili reports byte %, YouTube downloads internally (blob transport) so it shows count only.
 */
export function DownloadProgressBadge() {
  const { t } = useTranslation();
  const setTab = useNavStore((s) => s.setTab);
  const jobs = useLiveQuery(
    () => db.downloadJobs.where("status").anyOf(["active", "pending"]).toArray(),
    [],
    [] as DownloadJob[],
  );

  if (jobs.length === 0) return null;
  const withBytes = jobs.filter((j) => j.status === "active" && (j.totalBytes ?? 0) > 0);
  const pct = withBytes.length
    ? Math.round(
        (withBytes.reduce((sum, j) => sum + j.bytesDone / (j.totalBytes ?? 1), 0) /
          withBytes.length) *
          100,
      )
    : null;

  return (
    <button
      type="button"
      onClick={() => setTab("settings")}
      title={t("download.queueTitle")}
      className="fixed top-14 right-4 z-50 inline-flex items-center gap-1.5 rounded-full border border-border bg-background/90 px-3 py-1.5 text-xs shadow-lg backdrop-blur transition-colors hover:bg-accent"
    >
      <Download className="size-3.5 animate-pulse text-primary" />
      <span className="tabular-nums">
        {t("download.inProgress", { count: jobs.length })}
        {pct != null ? ` · ${pct}%` : ""}
      </span>
    </button>
  );
}
