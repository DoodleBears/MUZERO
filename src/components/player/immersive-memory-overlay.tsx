"use client";

import { AnimatePresence, motion } from "motion/react";
import { useScheduledMemory } from "@/hooks/use-scheduled-memory";
import { usePlayerStore } from "@/stores/player-store";

/**
 * Full-immersive memory surface (immersive-memory-moments PRD §5.2c). When the
 * Now-Playing foreground (incl. the memory rail) is hidden, leaving only the
 * background + spectrum, this floats one memory at a time as a top popover:
 * anchored cues fire on their second, floating memories fill idle gaps, each
 * dwelling for a content-sized duration. Mounted ONLY while immersive — the parent
 * conditionally renders it. Shares the schedule with the lyrics strip via
 * {@link useScheduledMemory}. Ambient + `pointer-events-none`: any input exits immersive.
 */
export function ImmersiveMemoryOverlay() {
  const currentTrackId = usePlayerStore((s) =>
    s.currentIndex >= 0 ? s.queue[s.currentIndex]?.id : undefined,
  );
  const { active, photoUrl } = useScheduledMemory(currentTrackId);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-0 z-20 flex justify-center px-4 pt-chrome-top"
      data-testid="immersive-memory-overlay"
    >
      <AnimatePresence mode="wait">
        {active && (
          <motion.div
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            className="max-w-md rounded-2xl border border-border/60 bg-background/70 px-4 py-3 text-center shadow-lg backdrop-blur-md"
            data-testid="immersive-memory-card"
            exit={{ opacity: 0, y: -8, filter: "blur(6px)" }}
            initial={{ opacity: 0, y: -8, filter: "blur(6px)" }}
            key={active.id}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          >
            {photoUrl && (
              <img
                alt=""
                className="mx-auto mb-2 max-h-32 w-auto rounded-lg object-contain"
                src={photoUrl}
              />
            )}
            <p className="whitespace-pre-wrap break-words font-medium text-sm">{active.note}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
