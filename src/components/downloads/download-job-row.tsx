import type { TFunction } from "i18next";
import { Copy, Download, Loader2, RotateCcw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DownloadJob } from "@/db/types";
import { cn } from "@/lib/utils";
import { notify } from "@/stores/notification-store";
import { removeDownload, retryDownload } from "@/streamsrc/download-action";

/** Localized one-line status for a download job (shared by the tab + the Settings panel). */
export function downloadStatusLabel(job: DownloadJob, t: TFunction): string {
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

export interface DownloadJobRowProps {
  job: DownloadJob;
  /** Compact density for the Settings panel; false (default) = roomier tab row + progress bar. */
  compact?: boolean;
  /** When set, a `done` row is clickable to jump to its created track / set. */
  onOpenTrack?: (job: DownloadJob) => void;
}

/**
 * One download-queue row — cover / title / status / progress + retry·remove·copy-error.
 * Shared between the downloads Gallery tab (roomy, with a progress bar) and the compact
 * Settings panel (`compact`). Actions call the existing queue functions directly.
 */
export function DownloadJobRow({ job, compact = false, onOpenTrack }: DownloadJobRowProps) {
  const { t } = useTranslation();
  const pct =
    job.status === "active" && job.totalBytes
      ? Math.round((job.bytesDone / job.totalBytes) * 100)
      : null;
  const canOpen = job.status === "done" && Boolean(onOpenTrack);

  const identity = (
    <>
      <div
        className={cn(
          "grid shrink-0 place-items-center overflow-hidden bg-secondary text-muted-foreground album-cover-radius",
          compact ? "size-9" : "size-11",
        )}
      >
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
          {downloadStatusLabel(job, t)}
          {pct != null ? ` · ${pct}%` : ""}
        </div>
        {!compact && pct != null && (
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-secondary">
            <div className="h-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
    </>
  );

  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-md px-2 transition-colors hover:bg-accent/40",
        compact ? "py-1.5" : "py-2",
      )}
    >
      {canOpen ? (
        <button
          type="button"
          onClick={() => onOpenTrack?.(job)}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          {identity}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-2.5">{identity}</div>
      )}
      {job.status === "active" && (
        <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
      )}
      {job.status === "failed" && job.lastError && (
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(job.lastError ?? "")
              .then(() => notify.success(t("download.errorCopied")));
          }}
          aria-label={t("download.copyError")}
          title={t("download.copyError")}
          className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:text-foreground"
        >
          <Copy className="size-4" />
        </button>
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
