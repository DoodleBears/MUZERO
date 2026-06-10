"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "@/db/muzero-db";
import { getMemoryPhoto } from "@/db/repositories";
import type { Memory } from "@/db/types";
import {
  type ImmersiveMemoryInput,
  type ImmersiveMemoryState,
  initialImmersiveMemoryState,
  scheduleImmersiveMemory,
} from "@/lib/immersive-memory-schedule";
import { usePlayerStore } from "@/stores/player-store";

const TICK_MS = 250;

/**
 * Full-immersive memory surface (immersive-memory-moments PRD §5.2c). When the
 * Now-Playing foreground (incl. the memory rail) is hidden, leaving only the
 * background + spectrum, this floats one memory at a time as a top popover:
 * anchored cues fire on their second, floating memories fill idle gaps, each
 * dwelling for a content-sized duration (the pure {@link scheduleImmersiveMemory}).
 * Mounted ONLY while immersive — the parent conditionally renders it, so there's
 * zero cost otherwise. Ambient + `pointer-events-none`: any input exits immersive.
 */
export function ImmersiveMemoryOverlay() {
  const currentTrackId = usePlayerStore((s) =>
    s.currentIndex >= 0 ? s.queue[s.currentIndex]?.id : undefined,
  );
  const memories = useLiveQuery(
    () =>
      currentTrackId
        ? db.memories.where("trackId").equals(currentTrackId).sortBy("createdAt")
        : Promise.resolve([] as Memory[]),
    [currentTrackId],
    [] as Memory[],
  );
  const inputs = useMemo<ImmersiveMemoryInput[]>(
    () =>
      memories.map((m) => ({
        id: m.id,
        note: m.note,
        hasPhoto: Boolean(m.photoBlobId || m.remotePhotoUrl),
        atSec: m.atSec,
      })),
    [memories],
  );
  const memoryById = useMemo(() => new Map(memories.map((m) => [m.id, m])), [memories]);

  const stateRef = useRef<ImmersiveMemoryState>(initialImmersiveMemoryState);
  const [activeId, setActiveId] = useState<string | null>(null);

  // A new track restarts the schedule from scratch (currentTrackId is the trigger).
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset keyed to the track change
  useEffect(() => {
    stateRef.current = initialImmersiveMemoryState;
    setActiveId(null);
  }, [currentTrackId]);

  useEffect(() => {
    if (inputs.length === 0) {
      setActiveId(null);
      return;
    }
    const handle = setInterval(() => {
      const player = usePlayerStore.getState();
      const result = scheduleImmersiveMemory(stateRef.current, {
        nowMs: Date.now(),
        positionSec: player.positionSec,
        isPlaying: player.isPlaying,
        memories: inputs,
      });
      stateRef.current = result.state;
      setActiveId((prev) => (prev === result.activeId ? prev : result.activeId));
    }, TICK_MS);
    return () => clearInterval(handle);
  }, [inputs]);

  const active = activeId ? memoryById.get(activeId) : undefined;
  const photoUrl = useMemoryPhotoUrl(active);

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

/** Resolve the active memory's photo to a (revoked-on-change) object URL. */
function useMemoryPhotoUrl(memory: Memory | undefined): string | undefined {
  const [url, setUrl] = useState<string | undefined>();
  useEffect(() => {
    if (memory?.photoBlobId == null) {
      setUrl(memory?.remotePhotoUrl);
      return;
    }
    let objectUrl: string | undefined;
    let cancelled = false;
    void getMemoryPhoto(memory, db).then((blob) => {
      if (cancelled || !(blob instanceof Blob)) {
        setUrl(undefined);
        return;
      }
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [memory]);
  return url;
}
