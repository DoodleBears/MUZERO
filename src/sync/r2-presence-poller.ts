import type { R2Presence } from "./r2-presence";
import { filterActivePresence } from "./r2-presence";

export interface R2PresencePollerOptions {
  intervalMs?: number;
  now?: () => number;
  readPresence: () => Promise<R2Presence[]>;
  onPresence: (rows: R2Presence[]) => void;
  onError?: (error: unknown) => void;
}

export interface R2PresencePoller {
  setVisible: (visible: boolean) => void;
  isVisible: () => boolean;
  dispose: () => void;
}

export const MIN_R2_PRESENCE_POLL_INTERVAL_MS = 60_000;

export function createR2PresencePoller(options: R2PresencePollerOptions): R2PresencePoller {
  const intervalMs = Math.max(
    MIN_R2_PRESENCE_POLL_INTERVAL_MS,
    Math.round(options.intervalMs ?? MIN_R2_PRESENCE_POLL_INTERVAL_MS),
  );
  let visible = false;
  let disposed = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  function clearTimer() {
    if (!timer) return;
    clearInterval(timer);
    timer = undefined;
  }

  async function poll(): Promise<void> {
    if (!visible || disposed) return;
    try {
      const rows = await options.readPresence();
      if (!visible || disposed) return;
      options.onPresence(filterActivePresence(rows, options.now?.() ?? Date.now()));
    } catch (error) {
      if (!visible || disposed) return;
      options.onError?.(error);
    }
  }

  function setVisible(nextVisible: boolean): void {
    if (disposed || visible === nextVisible) return;
    visible = nextVisible;
    clearTimer();
    if (!visible) return;
    void poll();
    timer = setInterval(() => void poll(), intervalMs);
  }

  return {
    setVisible,
    isVisible: () => visible,
    dispose: () => {
      disposed = true;
      visible = false;
      clearTimer();
    },
  };
}
