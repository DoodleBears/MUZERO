import { useEffect, useRef, useState } from "react";
import { traceDiagnosticEvent, useTraceEntries } from "@/lib/trace";
import {
  appendTraceArchiveEntries,
  isTraceArchiveEnabled,
  subscribeTraceArchiveEnabled,
} from "@/lib/trace-archive";

export function useTraceArchiveRecorder(): void {
  const entries = useTraceEntries();
  const archivedUntilId = useRef(0);
  const warnedFailure = useRef(false);
  const [enabled, setEnabled] = useState(isTraceArchiveEnabled);

  useEffect(() => subscribeTraceArchiveEnabled(setEnabled), []);

  useEffect(() => {
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
      traceDiagnosticEvent("warn", "trace.archive", "write.failed", "trace archive write failed", {
        category: "app",
        phase: "fail",
        errorKind: "db",
        source: "renderer",
        errorName: error instanceof Error ? error.name : undefined,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    });
  }, [enabled, entries]);
}
