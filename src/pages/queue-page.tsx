import { Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { VirtualTrackList } from "@/components/library/virtual-track-list";
import { Button } from "@/components/ui/button";
import { ImportFolderButton } from "@/components/upload/import-folder-button";
import type { Track } from "@/db/types";
import { MEDIA_ACCEPT } from "@/lib/file-drop";
import { usePlayerStore } from "@/stores/player-store";

const EMPTY_QUEUE: Track[] = [];
const QUEUE_IDLE_PREWARM_DELAY_MS = 700;

/** The active set: every track (generated + uploaded), in order. */
export function QueuePage({ pageActive = true }: { pageActive?: boolean }) {
  const { t } = useTranslation();
  const liveQueue = usePlayerStore((s) => (pageActive ? s.queue : EMPTY_QUEUE));
  const activeSessionId = usePlayerStore((s) => (pageActive ? s.activeSessionId : undefined));
  const addUploads = usePlayerStore((s) => s.addUploads);
  const isUploading = usePlayerStore((s) => (pageActive ? s.isUploading : false));
  const [warmQueue, setWarmQueue] = useState<Track[]>(EMPTY_QUEUE);
  const queue = pageActive ? liveQueue : warmQueue;
  const readyCount = useMemo(() => queue.filter((t) => t.status === "ready").length, [queue]);
  const uploadRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (pageActive) {
      setWarmQueue(liveQueue);
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setWarmQueue(usePlayerStore.getState().queue);
    }, QUEUE_IDLE_PREWARM_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [liveQueue, pageActive]);

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col pt-chrome-top">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t("queue.title")}
        </h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {t("queue.ready", { ready: readyCount, total: queue.length })}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={!activeSessionId || isUploading}
            onClick={() => uploadRef.current?.click()}
          >
            <Upload className="size-3.5" />{" "}
            {isUploading ? t("sessions.importing") : t("queue.addFiles")}
          </Button>
          <input
            ref={uploadRef}
            type="file"
            accept={MEDIA_ACCEPT}
            multiple
            hidden
            onChange={(e) => {
              // Snapshot before clearing: input.value = "" empties the FileList.
              const files = e.target.files ? Array.from(e.target.files) : [];
              e.target.value = "";
              if (files.length) void addUploads(files);
            }}
          />
          <ImportFolderButton
            className="hidden sm:inline-flex"
            onWebFiles={(files) => addUploads(files)}
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 px-2 pb-2">
        <VirtualTrackList
          active={pageActive}
          tracks={queue}
          reactiveRowContent
          emptyHint={t("queue.empty")}
          className="pb-chrome-bottom"
        />
      </div>
    </div>
  );
}
