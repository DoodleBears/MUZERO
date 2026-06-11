import { useEffect, useRef, useState } from "react";
import { getTraceEntries, subscribeTrace, traceDiagnosticEvent } from "@/lib/trace";
import {
  appendTraceArchiveEntries,
  isTraceArchiveEnabled,
  subscribeTraceArchiveEnabled,
} from "@/lib/trace-archive";

/** Trailing collect window — bounds archive work to ≤1 IndexedDB write cycle
 *  per second during bursts, instead of one open→put→prune→close per event
 *  (memory-perf-audit PRD F-L1). The trace ring holds 300 entries, so a burst
 *  hotter than 300 events/window can rotate its oldest lines out of the
 *  archive — acceptable for a best-effort diagnostic mirror. */
const ARCHIVE_COLLECT_DELAY_MS = 1000;

export function useTraceArchiveRecorder(): void {
  const archivedUntilId = useRef(0);
  const warnedFailure = useRef(false);
  const [enabled, setEnabled] = useState(isTraceArchiveEnabled);

  useEffect(() => subscribeTraceArchiveEnabled(setEnabled), []);

  // Deliberately NOT useTraceEntries(): subscribing through React would
  // re-render + re-snapshot the ring on every log line. A plain subscription
  // with a trailing timer reads the ring once per window.
  useEffect(() => {
    let timer: number | null = null;

    const flush = () => {
      timer = null;
      const entries = getTraceEntries();
      const latestId = entries.at(-1)?.id ?? archivedUntilId.current;
      if (!enabled) {
        archivedUntilId.current = latestId;
        return;
      }
      const pending = entries.filter((entry) => entry.id > archivedUntilId.current);
      archivedUntilId.current = latestId;
      if (pending.length === 0) return;

      appendTraceArchiveEntries(pending).catch((error: unknown) => {
        if (warnedFailure.current) return;
        warnedFailure.current = true;
        traceDiagnosticEvent(
          "warn",
          "trace.archive",
          "write.failed",
          "trace archive write failed",
          {
            category: "app",
            phase: "fail",
            errorKind: "db",
            source: "renderer",
            errorName: error instanceof Error ? error.name : undefined,
            errorMessage: error instanceof Error ? error.message : String(error),
          },
        );
      });
    };

    const schedule = () => {
      if (timer !== null) return;
      timer = window.setTimeout(flush, ARCHIVE_COLLECT_DELAY_MS);
    };

    schedule(); // catch entries logged before mount
    const unsubscribe = subscribeTrace(schedule);
    return () => {
      unsubscribe();
      if (timer !== null) window.clearTimeout(timer);
      flush(); // best-effort: don't drop the tail on unmount
    };
  }, [enabled]);
}
