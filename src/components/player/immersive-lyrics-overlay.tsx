import { motion } from "motion/react";
import { FloatingUnpinButton } from "@/components/player/floating-unpin-button";
import { SyncedLyricsView } from "@/components/player/synced-lyrics-view";
import { cn } from "@/lib/utils";
import { dragWindowOnEmptyPress } from "@/lib/window-drag";
import { useDesktopWindowStore } from "@/stores/desktop-window-store";
import { usePlayerStore } from "@/stores/player-store";

/**
 * Full-immersive lyrics surface: when the Now-Playing foreground is hidden in
 * idle (only background + visualizer remain), show the synced lyrics centered
 * over the stage. Mounted ONLY while active (App gates it). `pointer-events-none`
 * — any input exits immersive (mirrors ImmersiveMemoryOverlay), so it's
 * watch-only; the follow-scroll keeps the active line centered.
 *
 * `pinned` adds floating pin controls centered over the lyrics (revealed on
 * pointer activity via `revealed`): while the window is pinned as a lyrics-only
 * capture the chrome is gone, so this is the easy in-overlay way back out.
 */
export function ImmersiveLyricsOverlay({
  lyricsOnly = false,
  pinned = false,
  revealed = false,
}: {
  lyricsOnly?: boolean;
  pinned?: boolean;
  revealed?: boolean;
}) {
  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const pinMode = useDesktopWindowStore((s) => s.pinMode);
  const current = currentIndex >= 0 ? queue[currentIndex] : undefined;
  const windowDragEnabled = pinned && pinMode !== "pin-click-through";
  if (!current) return null;
  return (
    <motion.div
      className="pointer-events-none fixed inset-0 z-20 flex items-center justify-center px-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: passive desktop window-drag surface; controls and lyric buttons remain opt-out targets. */}
      <div
        className={cn(
          "relative h-[68vh] w-full max-w-2xl",
          windowDragEnabled && "lyrics-window-drag-surface pointer-events-auto",
        )}
        data-tauri-drag-region={windowDragEnabled ? "" : undefined}
        onMouseDown={windowDragEnabled ? dragWindowOnEmptyPress : undefined}
      >
        {pinned && <FloatingUnpinButton revealed={revealed} />}
        <SyncedLyricsView
          emptyFallback={lyricsOnly ? "hidden" : "search"}
          showFooter={!lyricsOnly}
          showMemoryStrip={false}
          track={current}
          windowDragEnabled={windowDragEnabled}
        />
      </div>
    </motion.div>
  );
}
