import { DjConsole } from "@/components/dj/dj-console";
import { AuraVisualizer } from "@/components/player/aura-visualizer";
import { usePlayerStore } from "@/stores/player-store";

/** The "stage": visualizer, current track, the DJ's segue note, and DJ status. */
export function NowPlayingPage() {
  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const current = currentIndex >= 0 ? queue[currentIndex] : undefined;

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-card">
        <AuraVisualizer active={isPlaying} className="absolute inset-0" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-card to-transparent p-4">
          <div className="truncate text-lg font-semibold">{current?.title ?? "MUZERO"}</div>
          <div className="truncate text-sm text-muted-foreground">
            {current?.brief.caption ?? "Your endless AI DJ set"}
          </div>
        </div>
      </div>

      {current?.brief.djNote && (
        <div className="mx-auto w-full max-w-sm rounded-xl border border-border bg-secondary/40 p-3 text-sm italic text-muted-foreground">
          “{current.brief.djNote}”
        </div>
      )}

      {current && (
        <div className="mx-auto flex w-full max-w-sm flex-wrap gap-1.5 text-xs text-muted-foreground">
          {current.brief.bpm && <Chip>{current.brief.bpm} BPM</Chip>}
          {current.brief.keyscale && <Chip>{current.brief.keyscale}</Chip>}
          {current.brief.vocalLanguage && <Chip>{current.brief.vocalLanguage}</Chip>}
          <Chip>{current.provider}</Chip>
        </div>
      )}

      <div className="mx-auto w-full max-w-sm">
        <DjConsole />
      </div>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full border border-border px-2 py-0.5">{children}</span>;
}
