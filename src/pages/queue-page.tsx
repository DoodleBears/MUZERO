import { Upload } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { VirtualTrackList } from "@/components/library/virtual-track-list";
import { Button } from "@/components/ui/button";
import { usePlayerStore } from "@/stores/player-store";

/** The active set: every track (generated + uploaded), in order. */
export function QueuePage() {
  const { t } = useTranslation();
  const queue = usePlayerStore((s) => s.queue);
  const activeSessionId = usePlayerStore((s) => s.activeSessionId);
  const addUploads = usePlayerStore((s) => s.addUploads);
  const isUploading = usePlayerStore((s) => s.isUploading);
  const readyCount = queue.filter((t) => t.status === "ready").length;
  const uploadRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col">
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
            accept="audio/*,video/*"
            multiple
            hidden
            onChange={(e) => {
              // Snapshot before clearing: input.value = "" empties the FileList.
              const files = e.target.files ? Array.from(e.target.files) : [];
              e.target.value = "";
              if (files.length) void addUploads(files);
            }}
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 px-2 pb-2">
        <VirtualTrackList tracks={queue} emptyHint={t("queue.empty")} />
      </div>
    </div>
  );
}
