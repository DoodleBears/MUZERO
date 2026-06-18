import { useSyncExternalStore } from "react";
import type { StreamPlaylist } from "@/streamsrc/provider";
import { canViewTransition, isViewTransitionSuppressed } from "./view-transition";

export const SOURCE_COVER_MORPH_NAME = "gallery-cover";
export const SOURCE_COVER_MORPH_RESET_MS = 1200;

type SourceCoverMorphTarget =
  | { id: string; kind: "set" }
  | { id: string; kind: "system-playlist" }
  | { kind: "online-playlist"; playlist: Pick<StreamPlaylist, "id" | "source"> };

let morphName: string | undefined;
let resetTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

export function sourceCoverMorphNamespace(target: SourceCoverMorphTarget): string {
  switch (target.kind) {
    case "set":
      return `set:${target.id}`;
    case "system-playlist":
      return `system-playlist:${target.id}`;
    case "online-playlist":
      return `online-playlist:${target.playlist.source}:${target.playlist.id}`;
  }
}

export function getNowPlayingSourceCoverMorphName(): string | undefined {
  return morphName;
}

export function subscribeNowPlayingSourceCoverMorph(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useNowPlayingSourceCoverMorphName(): string | undefined {
  return useSyncExternalStore(
    subscribeNowPlayingSourceCoverMorph,
    getNowPlayingSourceCoverMorphName,
    getNowPlayingSourceCoverMorphName,
  );
}

export function clearNowPlayingSourceCoverMorph(): void {
  if (resetTimer) {
    clearTimeout(resetTimer);
    resetTimer = undefined;
  }
  setMorphName(undefined);
}

export function armNowPlayingSourceCoverMorph(): void {
  if (!canViewTransition() || isViewTransitionSuppressed()) return;
  if (resetTimer) clearTimeout(resetTimer);
  setMorphName(SOURCE_COVER_MORPH_NAME);
  resetTimer = setTimeout(() => clearNowPlayingSourceCoverMorph(), SOURCE_COVER_MORPH_RESET_MS);
}

function setMorphName(next: string | undefined): void {
  if (morphName === next) return;
  morphName = next;
  for (const listener of listeners) listener();
}
