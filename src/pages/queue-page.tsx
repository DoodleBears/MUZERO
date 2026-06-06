import { VirtualTrackList } from "@/components/library/virtual-track-list";
import { usePlayerStore } from "@/stores/player-store";

/** The live set: every track the DJ has drafted for the active session, in order. */
export function QueuePage() {
  const queue = usePlayerStore((s) => s.queue);
  const readyCount = queue.filter((t) => t.status === "ready").length;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-baseline justify-between px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Queue
        </h2>
        <span className="text-xs text-muted-foreground">
          {readyCount}/{queue.length} ready
        </span>
      </div>
      <div className="min-h-0 flex-1 px-2 pb-2">
        <VirtualTrackList tracks={queue} />
      </div>
    </div>
  );
}
