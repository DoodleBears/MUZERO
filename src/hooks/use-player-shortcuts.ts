import { useEffect } from "react";
import { resolvePlayerShortcut } from "@/player/player-shortcuts";
import { nextRepeatMode } from "@/player/transport";
import { usePlayerStore } from "@/stores/player-store";

const VOLUME_STEP = 0.05;
const SEEK_STEP = 5;

/** Don't hijack keys while the user is typing in a field. */
function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/**
 * Global player keyboard shortcuts (Space/⌘P, ←→/AD, Shift±5s, ↑↓ volume, ⌘R
 * repeat, R restart). Wired once from App. Reads the store imperatively per
 * keypress (no re-subscription), and never fires while typing or when Space/Enter
 * would activate a focused button. The pure mapping lives in `player-shortcuts`.
 */
export function usePlayerShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const action = resolvePlayerShortcut(e);
      if (!action) return;
      // Let a focused button/link handle Space/Enter itself (no double-trigger).
      if (
        (e.key === " " || e.key === "Enter") &&
        e.target instanceof HTMLElement &&
        (e.target.tagName === "BUTTON" || e.target.tagName === "A")
      ) {
        return;
      }
      e.preventDefault();
      const s = usePlayerStore.getState();
      switch (action) {
        case "toggle-play":
          s.togglePlay();
          break;
        case "next":
          void s.next();
          break;
        case "prev":
          void s.prev();
          break;
        case "seek-forward":
          s.seek(s.positionSec + SEEK_STEP);
          break;
        case "seek-back":
          s.seek(Math.max(0, s.positionSec - SEEK_STEP));
          break;
        case "volume-up":
          s.setVolume(Math.min(1, s.volume + VOLUME_STEP));
          break;
        case "volume-down":
          s.setVolume(Math.max(0, s.volume - VOLUME_STEP));
          break;
        case "cycle-repeat":
          s.setRepeat(nextRepeatMode(s.repeat));
          break;
        case "restart":
          s.seek(0);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
