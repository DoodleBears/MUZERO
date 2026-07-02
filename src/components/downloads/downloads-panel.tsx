import { useLiveQuery } from "dexie-react-hooks";
import { useTranslation } from "react-i18next";
import { db } from "@/db/muzero-db";
import type { DownloadJob } from "@/db/types";
import { clearFinishedDownloads } from "@/streamsrc/download-action";
import { DownloadJobRow } from "./download-job-row";

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
            <DownloadJobRow key={job.id} job={job} compact />
          ))}
        </div>
      )}
    </div>
  );
}
