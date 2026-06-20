import { useLiveQuery } from "dexie-react-hooks";
import type { TFunction } from "i18next";
import { Download, Loader2, RotateCcw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { db } from "@/db/muzero-db";
import type { DownloadJob } from "@/db/types";
import { cn } from "@/lib/utils";
import { clearFinishedDownloads, removeDownload, retryDownload } from "@/streamsrc/download-action";

/** The persistent download queue — live progress, per-job retry/remove, clear-finished. */
export function DownloadsPanel() {
  const { t } = useTranslation();
  const jobs = useLiveQuery(
    () => db.downloadJobs.orderBy("createdAt").reverse().toArray(),
    [],
    [] as DownloadJob[],
  );
  const hasFinished = jobs.some((j) => j.status === "done");

  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between">
        <span className="font-medium text-sm">{t("download.queueTitle")}</span>
        {hasFinished && (
          <button
            type="button"
            onClick={() => void clearFinishedDownloads()}
            className="text-muted-foreground text-xs transition-colors hover:text-foreground"
          >
            {t("download.queueClear")}
          </button>
        )}
      </div>
      {jobs.length === 0 ? (
        <p className="py-3 text-center text-muted-foreground text-xs">{t("download.queueEmpty")}</p>
      ) : (
        <div className="space-y-1">
          {jobs.map((job) => (
            <DownloadRow key={job.id} job={job} />
          ))}
        </div>
      )}
    </div>
  );
}

function statusLabel(job: DownloadJob, t: TFunction): string {
  switch (job.status) {
    case "pending":
      return t("download.statusPending");
    case "active":
      return t("download.statusActive");
    case "paused":
      return t("download.statusPaused");
    case "failed":
      return job.lastError
        ? `${t("download.statusFailed")} · ${job.lastError}`
        : t("download.statusFailed");
    case "done":
      return t("download.done");
  }
}

function DownloadRow({ job }: { job: DownloadJob }) {
  const { t } = useTranslation();
  const pct =
    job.status === "active" && job.totalBytes
      ? Math.round((job.bytesDone / job.totalBytes) * 100)
      : null;
  return (
    <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/40">
      <div className="grid size-9 shrink-0 place-items-center overflow-hidden bg-secondary text-muted-foreground album-cover-radius">
        {job.coverUrl ? (
          <img
            src={job.coverUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="size-full object-cover"
          />
        ) : (
          <Download className="size-3.5" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{job.title}</div>
        <div
          className={cn(
            "truncate text-xs",
            job.status === "failed" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {statusLabel(job, t)}
          {pct != null ? ` · ${pct}%` : ""}
        </div>
      </div>
      {job.status === "active" && (
        <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
      )}
      {job.status === "failed" && (
        <button
          type="button"
          onClick={() => void retryDownload(job.id)}
          aria-label={t("download.retry")}
          title={t("download.retry")}
          className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:text-foreground"
        >
          <RotateCcw className="size-4" />
        </button>
      )}
      {job.status !== "active" && (
        <button
          type="button"
          onClick={() => void removeDownload(job.id)}
          aria-label={t("download.remove")}
          title={t("download.remove")}
          className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}
