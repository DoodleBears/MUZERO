import { motion } from "motion/react";
import { SyncedLyricsView } from "@/components/player/synced-lyrics-view";
import { usePlayerStore } from "@/stores/player-store";

/**
 * Full-immersive lyrics surface: when the Now-Playing foreground is hidden in
 * idle (only background + visualizer remain), show the synced lyrics centered
 * over the stage. Mounted ONLY while active (App gates it). `pointer-events-none`
 * — any input exits immersive (mirrors ImmersiveMemoryOverlay), so it's
 * watch-only; the follow-scroll keeps the active line centered.
 */
export function ImmersiveLyricsOverlay() {
  const queue = usePlayerStore((s) => s.queue);
  const currentIndex = usePlayerStore((s) => s.currentIndex);
  const current = currentIndex >= 0 ? queue[currentIndex] : undefined;
  if (!current) return null;
  return (
    <motion.div
      className="pointer-events-none fixed inset-0 z-20 flex items-center justify-center px-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
    >
      <div className="h-[68vh] w-full max-w-2xl">
        <SyncedLyricsView track={current} />
      </div>
    </motion.div>
  );
}
