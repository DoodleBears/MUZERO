/**
 * Pure queue math. No DOM, no audio, no DB — just index arithmetic so it's
 * trivially unit-testable. The Zustand player store and the DJ engine both build
 * on these. The queue itself (ordered track ids) is owned by the DJ session;
 * here we only reason about positions within a queue of a given `length`.
 */

export type RepeatMode = "off" | "one" | "all";

/** How many tracks remain after the current one. */
export function upcomingCount(length: number, index: number): number {
  if (length <= 0 || index < 0) return Math.max(0, length);
  return Math.max(0, length - 1 - index);
}

/**
 * The "续上歌单" trigger: should the DJ draft more tracks now? True when the
 * queue is non-empty and the number of upcoming tracks has fallen to/below the
 * refill threshold. Threshold 0 ⇒ refill only when the last track is current.
 */
export function shouldAutoExtend(length: number, index: number, threshold: number): boolean {
  if (length <= 0) return true; // empty queue always wants its first batch
  return upcomingCount(length, index) <= threshold;
}

/**
 * Index of the next track to play, or `null` if playback should stop.
 *  - "off": advance until the end, then stop
 *  - "all": wrap to the start
 *  - "one": repeat the current track
 */
export function nextIndex(length: number, index: number, repeat: RepeatMode): number | null {
  if (length <= 0) return null;
  if (index < 0) return 0;
  if (repeat === "one") return index;
  if (index + 1 < length) return index + 1;
  return repeat === "all" ? 0 : null;
}

/** Index of the previous track. Symmetric with {@link nextIndex}. */
export function prevIndex(length: number, index: number, repeat: RepeatMode): number | null {
  if (length <= 0) return null;
  if (index <= 0) return repeat === "all" ? length - 1 : 0;
  return index - 1;
}

/** Clamp an arbitrary index into `[0, length-1]`, or -1 when empty. */
export function clampIndex(length: number, index: number): number {
  if (length <= 0) return -1;
  return Math.min(Math.max(0, index), length - 1);
}

/**
 * Build a shuffled play order (a permutation of `[0, length)`) with `currentIndex`
 * pinned first so the current track keeps playing. `rng` is injectable for
 * deterministic tests. Fisher–Yates.
 */
export function buildShuffleOrder(
  length: number,
  currentIndex: number,
  rng: () => number = Math.random,
): number[] {
  const order = Array.from({ length }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  if (currentIndex >= 0 && currentIndex < length) {
    const pos = order.indexOf(currentIndex);
    if (pos > 0) [order[0], order[pos]] = [order[pos], order[0]];
  }
  return order;
}
