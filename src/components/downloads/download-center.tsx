import { useVirtualizer } from "@tanstack/react-virtual";
import { useLiveQuery } from "dexie-react-hooks";
import { Download } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { HoverScrollbar } from "@/components/library/hover-scrollbar";
import { rafObserveElementOffset } from "@/components/library/raf-scroll-offset";
import { db } from "@/db/muzero-db";
import type { DownloadJob } from "@/db/types";
import { hasStreamingSources } from "@/lib/desktop/bridge";
import {
  type DownloadFilter,
  filterDownloadJobs,
  orderDownloadJobs,
  summarizeDownloadCenter,
} from "@/lib/download-center";
import { useSmoothScroll } from "@/lib/smooth-scroll/use-smooth-scroll";
import { cn } from "@/lib/utils";
import { useNavStore } from "@/stores/nav-store";
import { clearFinishedDownloads } from "@/streamsrc/download-action";
import { DownloadJobRow } from "./download-job-row";

const FILTER_KEY = "muzero-download-filter";
const FILTERS: readonly DownloadFilter[] = ["all", "active", "done", "failed"];
const FILTER_LABEL = {
  all: "downloadCenter.filterAll",
  active: "downloadCenter.filterActive",
  done: "downloadCenter.filterDone",
  failed: "downloadCenter.filterFailed",
} as const satisfies Record<DownloadFilter, string>;
const EMPTY_JOBS: DownloadJob[] = [];
const DOWNLOAD_ROW_ESTIMATE = 68;

function savedFilter(): DownloadFilter {
  if (typeof localStorage === "undefined") return "all";
  const saved = localStorage.getItem(FILTER_KEY);
  return FILTERS.includes(saved as DownloadFilter) ? (saved as DownloadFilter) : "all";
}

/**
 * 下载 — the Gallery's 6th tab. A first-class, virtualized download center over the
 * persistent `downloadJobs` queue: aggregate progress header, all-status filter chips,
 * and a TanStack-Virtual list (hundreds of jobs from a big 收藏夹 batch mount only the
 * visible rows). Reads only; row actions call the existing queue functions. Data +
 * progress口径 come from the pure `lib/download-center`.
 */
export function DownloadCenter() {
  const { t } = useTranslation();
  const jobs = useLiveQuery(() => db.downloadJobs.toArray(), [], EMPTY_JOBS);
  const [filter, setFilter] = useState<DownloadFilter>(savedFilter);

  const summary = useMemo(() => summarizeDownloadCenter(jobs), [jobs]);
  const rows = useMemo(() => orderDownloadJobs(filterDownloadJobs(jobs, filter)), [jobs, filter]);
  const counts: Record<DownloadFilter, number> = {
    all: summary.total,
    active: summary.inFlight,
    done: summary.done,
    failed: summary.failed,
  };

  const parentRef = useRef<HTMLDivElement>(null);
  // Same scroll chrome as the set-detail track list (VirtualTrackList): Lenis smooth
  // scroll + a hover-reveal overlay scrollbar (native bar hidden via `no-scrollbar`).
  const { lenisRef } = useSmoothScroll(parentRef);
  const scrollToTop = useCallback(
    (top: number) => {
      if (lenisRef.current) lenisRef.current.scrollTo(top, { immediate: true });
      else parentRef.current?.scrollTo({ top });
    },
    [lenisRef],
  );
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => DOWNLOAD_ROW_ESTIMATE,
    getItemKey: (index) => rows[index]?.id ?? index,
    // Coalesce native wheel-rate scroll into one recompute per frame (matches VirtualTrackList).
    observeElementOffset: rafObserveElementOffset,
    overscan: 8,
  });

  function selectFilter(next: DownloadFilter) {
    setFilter(next);
    if (typeof localStorage !== "undefined") localStorage.setItem(FILTER_KEY, next);
  }

  // A finished download jumps to the set its track landed in (anchoring the track).
  const openTrack = useCallback((job: DownloadJob) => {
    if (job.sessionId) useNavStore.getState().openSet(job.sessionId, job.trackId);
  }, []);

  const pct = summary.progress != null ? Math.round(summary.progress * 100) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="download-center">
      {/* Aggregate header: in-flight count + progress bar, clear-finished. */}
      <div className="flex min-h-6 shrink-0 items-center gap-3 px-4 pb-2">
        <div className="min-w-0 flex-1">
          {summary.inFlight > 0 && (
            <>
              <div className="text-muted-foreground text-xs">
                {t("download.inProgress", { count: summary.inFlight })}
                {pct != null ? ` · ${pct}%` : ""}
              </div>
              {pct != null && (
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full bg-primary transition-[width]"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              )}
            </>
          )}
        </div>
        {summary.done > 0 && (
          <button
            type="button"
            onClick={() => void clearFinishedDownloads()}
            className="shrink-0 text-muted-foreground text-xs transition-colors hover:text-foreground"
          >
            {t("download.queueClear")}
          </button>
        )}
      </div>

      {/* All-status filter chips with per-bucket counts. */}
      <div className="flex shrink-0 flex-wrap gap-2 px-4 pb-3">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            data-testid={`download-filter-${f}`}
            aria-pressed={filter === f}
            onClick={() => selectFilter(f)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs transition-colors",
              filter === f
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {t(FILTER_LABEL[f])}
            <span className="ml-1.5 opacity-60">{counts[f]}</span>
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div
          className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-muted-foreground text-sm"
          data-testid="download-center-empty"
        >
          <Download className="size-6 opacity-40" />
          <p>
            {summary.total === 0
              ? hasStreamingSources()
                ? t("download.queueEmpty")
                : t("downloadCenter.emptyWeb")
              : t("downloadCenter.emptyFiltered")}
          </p>
        </div>
      ) : (
        <div
          ref={parentRef}
          data-testid="download-center-list"
          className="group/list chrome-fade no-scrollbar relative min-h-0 flex-1 overflow-y-auto px-2 pb-chrome-bottom [--chrome-fade-top:0.5rem]"
        >
          <HoverScrollbar scrollRef={parentRef} scrollToTop={scrollToTop} />
          <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
            {virtualizer.getVirtualItems().map((vr) => (
              <div
                key={vr.key}
                data-index={vr.index}
                ref={virtualizer.measureElement}
                className="absolute top-0 left-0 w-full"
                style={{ transform: `translateY(${vr.start}px)` }}
              >
                <DownloadJobRow job={rows[vr.index]} onOpenTrack={openTrack} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
