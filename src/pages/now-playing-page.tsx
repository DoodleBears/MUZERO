import { Headphones, Image as ImageIcon, Type, Video } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { DjConsole } from "@/components/dj/dj-console";
import { VirtualTrackList } from "@/components/library/virtual-track-list";
import { MediaStage } from "@/components/player/media-stage";
import { AnnotationEditor } from "@/components/track/annotation-editor";
import type { SetDisplayMode } from "@/db/types";
import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/stores/player-store";

const DISPLAY_MODES: { id: SetDisplayMode; icon: typeof Video }[] = [
  { id: "video", icon: Video },
  { id: "cover", icon: ImageIcon },
  { id: "title", icon: Type },
];

/** The stage + memory/annotation panel, with a persistent queue rail on desktop. */
export function NowPlayingPage() {
  const { t } = useTranslation();
  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const displayMode = usePlayerStore((s) => s.displayMode);
  const audioOnly = usePlayerStore((s) => s.audioOnly);
  const djEnabled = usePlayerStore((s) => s.djEnabled);
  const setDisplayMode = usePlayerStore((s) => s.setDisplayMode);
  const setAudioOnly = usePlayerStore((s) => s.setAudioOnly);
  const current = currentIndex >= 0 ? queue[currentIndex] : undefined;

  return (
    <div className="h-full p-4 lg:p-6">
      <div className="mx-auto grid h-full w-full max-w-6xl gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)]">
        <section className="flex min-h-0 flex-col items-center gap-3 overflow-y-auto">
          <MediaStage className="aspect-square w-full max-w-md" />

          <div className="flex w-full max-w-md items-center justify-between gap-2">
            <div className="flex rounded-lg border border-border p-0.5">
              {DISPLAY_MODES.map(({ id, icon: Icon }) => {
                const label = t(`displayMode.${id}`);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => void setDisplayMode(id)}
                    className={cn(
                      "flex items-center gap-1 rounded-md px-2.5 py-1 text-xs transition-colors",
                      displayMode === id
                        ? "bg-accent text-primary"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    title={t("nowPlaying.modeTitle", { mode: label })}
                  >
                    <Icon className="size-3.5" />
                    <span className="hidden sm:inline">{label}</span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => setAudioOnly(!audioOnly)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs transition-colors",
                audioOnly
                  ? "bg-accent text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
              title={t("nowPlaying.audioOnlyHint")}
            >
              <Headphones className="size-3.5" />
              {t("nowPlaying.audioOnly")}
            </button>
          </div>

          {current?.brief?.djNote && (
            <div className="w-full max-w-md rounded-xl border border-border bg-secondary/40 p-3 text-sm italic text-muted-foreground">
              “{current.brief.djNote}”
            </div>
          )}

          {current && (
            <div className="flex w-full max-w-md flex-wrap gap-1.5 text-xs text-muted-foreground">
              {current.brief?.bpm && <Chip>{current.brief.bpm} BPM</Chip>}
              {current.brief?.keyscale && <Chip>{current.brief.keyscale}</Chip>}
              {current.origin === "uploaded" && (
                <Chip>
                  {current.kind === "video" ? t("track.uploadedVideo") : t("track.uploadedAudio")}
                </Chip>
              )}
              {current.brief && <Chip>{current.provider}</Chip>}
            </div>
          )}

          {current && (
            <div className="w-full max-w-md">
              <AnnotationEditor key={current.id} track={current} />
            </div>
          )}

          {djEnabled && (
            <div className="w-full max-w-md">
              <DjConsole />
            </div>
          )}
        </section>

        <aside className="hidden min-h-0 flex-col rounded-2xl border border-border bg-card/40 lg:flex">
          <h3 className="px-4 py-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {t("nowPlaying.upNext")}
          </h3>
          <div className="min-h-0 flex-1 px-2 pb-2">
            <VirtualTrackList tracks={queue} emptyHint={t("queue.empty")} />
          </div>
        </aside>
      </div>
    </div>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return <span className="rounded-full border border-border px-2 py-0.5">{children}</span>;
}
