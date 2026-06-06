import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useTrackCoverUrl } from "@/hooks/use-media";
import { resolveStageContent, trackSubtitle } from "@/lib/track-display";
import { cn } from "@/lib/utils";
import { getMediaEngine, usePlayerStore } from "@/stores/player-store";
import { AuraVisualizer } from "./aura-visualizer";

/**
 * The now-playing "stage". Owns the spot where the shared <video> element is
 * mounted, and renders the display-mode fallback the product wants:
 * video-first → cover → title. For audio (or audio-only), the video element is
 * hidden and we show the cover or the Aura visualizer instead.
 */
export function MediaStage({ className }: { className?: string }) {
  const { t } = useTranslation();
  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const displayMode = usePlayerStore((s) => s.displayMode);
  const audioOnly = usePlayerStore((s) => s.audioOnly);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const current = currentIndex >= 0 ? queue[currentIndex] : undefined;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const coverUrl = useTrackCoverUrl(current);
  const content = resolveStageContent({
    track: current,
    displayMode,
    audioOnly,
    hasCover: !!coverUrl,
  });

  // Adopt the persistent media element into this stage; release on unmount
  // (playback keeps going while the element is detached).
  useEffect(() => {
    const engine = getMediaEngine();
    const container = containerRef.current;
    if (engine && container) engine.mount(container);
    return () => getMediaEngine()?.unmount();
  }, []);

  // Show/hide the video element based on the resolved stage content.
  useEffect(() => {
    const el = getMediaEngine()?.element;
    if (!el) return;
    el.className =
      content === "video"
        ? "absolute inset-0 z-10 h-full w-full bg-black object-contain"
        : "pointer-events-none absolute h-0 w-0 opacity-0";
  }, [content]);

  return (
    <div
      ref={containerRef}
      className={cn("relative overflow-hidden rounded-2xl border border-border bg-card", className)}
    >
      {content !== "video" && <AuraVisualizer active={isPlaying} className="absolute inset-0" />}
      {content === "cover" && coverUrl && (
        <img src={coverUrl} alt="" className="absolute inset-0 z-10 h-full w-full object-cover" />
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-card/95 to-transparent p-4">
        <div className="truncate text-lg font-semibold">{current?.title ?? "MUZERO"}</div>
        <div className="truncate text-sm text-muted-foreground">
          {current ? trackSubtitle(current) : t("app.endlessSet")}
        </div>
      </div>
    </div>
  );
}
