import { useLiveQuery } from "dexie-react-hooks";
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
 * Drive the shared memory carousel for a track: loads its memories reactively, ticks
 * the pure `scheduleImmersiveMemory` state machine (anchored cues + floating fillers,
 * content-sized dwell), and resolves the active memory's photo to a revoked object URL.
 * Consumed by BOTH the full-immersive overlay and the lyrics-mode strip so the schedule
 * lives in one place (hard rule #6/#7). `undefined` trackId — or no memories — is idle:
 * no interval, no active memory, zero cost.
 */
export function useScheduledMemory(trackId: string | undefined): {
  active: Memory | undefined;
  photoUrl: string | undefined;
} {
  const memories = useLiveQuery(
    () =>
      trackId
        ? db.memories.where("trackId").equals(trackId).sortBy("createdAt")
        : Promise.resolve([] as Memory[]),
    [trackId],
    [] as Memory[],
  );
  const inputs = useMemo<ImmersiveMemoryInput[]>(
    () =>
      memories.map((memory) => ({
        id: memory.id,
        note: memory.note,
        hasPhoto: Boolean(memory.photoBlobId || memory.remotePhotoUrl),
        atSec: memory.atSec,
      })),
    [memories],
  );
  const memoryById = useMemo(
    () => new Map(memories.map((memory) => [memory.id, memory])),
    [memories],
  );

  const stateRef = useRef<ImmersiveMemoryState>(initialImmersiveMemoryState);
  const [activeId, setActiveId] = useState<string | null>(null);

  // A new track restarts the schedule from scratch (trackId is the trigger).
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset keyed to the track change
  useEffect(() => {
    stateRef.current = initialImmersiveMemoryState;
    setActiveId(null);
  }, [trackId]);

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
  return { active, photoUrl };
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
