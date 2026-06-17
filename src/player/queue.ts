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

/**
 * Manual next is an explicit user action: repeat-one only governs what happens
 * when media *ends* (it replays the current track), so the next button still
 * walks forward through the queue — and, like repeat-all, wraps from the last
 * track back to the first. (Mapping "one" → "off" here would wrongly stop at
 * the end; single-track repeat is still a looping playlist for manual nav.)
 */
export function manualNextIndex(length: number, index: number, repeat: RepeatMode): number | null {
  return nextIndex(length, index, repeat === "one" ? "all" : repeat);
}

/**
 * Index of the previous track. Symmetric with {@link manualNextIndex}: both
 * repeat-all and repeat-one wrap (off clamps at the start). prev is always a
 * manual action, so repeat-one wraps here just like next.
 */
export function prevIndex(length: number, index: number, repeat: RepeatMode): number | null {
  if (length <= 0) return null;
  if (index <= 0) return repeat === "off" ? 0 : length - 1;
  return index - 1;
}

/**
 * Where to go when a streamed track fails to resolve mid-playback (VIP / unavailable
 * / region-locked). Walks forward (wrapping) to find another track to try, bounded by
 * `maxSkips` so a queue where every remaining song is un-streamable stops instead of
 * looping. Returns null = give up and stop. Pure — the store tracks the running
 * `skipsSoFar` and acts on the result.
 */
export function nextStreamSkipIndex(
  length: number,
  index: number,
  skipsSoFar: number,
  maxSkips: number,
): number | null {
  if (length <= 1 || index < 0) return null;
  // Never scan a track more than once: cap at the other tracks in the queue.
  if (skipsSoFar >= Math.min(maxSkips, length - 1)) return null;
  return (index + 1) % length;
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

/**
 * Step forward through a shuffled order. Returns the next queue index (or null to
 * stop) plus the order to keep (it reshuffles when a cycle wraps under "all", and
 * rebuilds if it's stale vs `length`). Pure + injectable rng for tests.
 */
export function shuffleNext(
  order: number[],
  length: number,
  currentIndex: number,
  repeat: RepeatMode,
  rng: () => number = Math.random,
): { index: number | null; order: number[] } {
  if (length <= 0) return { index: null, order: [] };
  let ord = order.length === length ? order : buildShuffleOrder(length, currentIndex, rng);
  if (repeat === "one") return { index: currentIndex, order: ord };
  const pos = ord.indexOf(currentIndex);
  if (pos + 1 < ord.length) return { index: ord[pos + 1], order: ord };
  // Reached the end of this shuffle cycle.
  if (repeat === "all") {
    ord = buildShuffleOrder(length, -1, rng);
    return { index: ord[0], order: ord };
  }
  return { index: null, order: ord };
}

/** Shuffled manual next, with the same repeat-one semantics as manualNextIndex. */
export function shuffleManualNext(
  order: number[],
  length: number,
  currentIndex: number,
  repeat: RepeatMode,
  rng: () => number = Math.random,
): { index: number | null; order: number[] } {
  return shuffleNext(order, length, currentIndex, repeat === "one" ? "all" : repeat, rng);
}

/** Step backward through a shuffled order. Symmetric with {@link shuffleNext}. */
export function shufflePrev(
  order: number[],
  length: number,
  currentIndex: number,
  repeat: RepeatMode,
  rng: () => number = Math.random,
): { index: number | null; order: number[] } {
  if (length <= 0) return { index: null, order: [] };
  const ord = order.length === length ? order : buildShuffleOrder(length, currentIndex, rng);
  const pos = ord.indexOf(currentIndex);
  if (pos - 1 >= 0) return { index: ord[pos - 1], order: ord };
  // repeat-one wraps for manual prev too, mirroring shuffleManualNext.
  if (repeat !== "off") return { index: ord[ord.length - 1], order: ord };
  return { index: currentIndex, order: ord };
}

/**
 * Preview the next manual-advance queue indices without mutating playback state.
 * This is intentionally "manual next" semantics, so repeat-one still advances
 * when a user presses Next / E. In shuffle mode it follows the active shuffle
 * cycle; when the cycle wraps we reuse that cycle order for warmup rather than
 * drawing a new random order just for preloading.
 */
export function upcomingManualIndices(opts: {
  count: number;
  currentIndex: number;
  length: number;
  repeat: RepeatMode;
  shuffleOrder?: readonly number[];
}): number[] {
  const { count, currentIndex, length, repeat, shuffleOrder } = opts;
  if (count <= 0 || length <= 0 || currentIndex < 0 || currentIndex >= length) return [];
  const seen = new Set<number>([currentIndex]);
  const out: number[] = [];

  if (!shuffleOrder) {
    let cursor = currentIndex;
    while (out.length < count) {
      const next = manualNextIndex(length, cursor, repeat);
      if (next === null || seen.has(next)) break;
      out.push(next);
      seen.add(next);
      cursor = next;
    }
    return out;
  }

  if (shuffleOrder.length !== length) return [];
  let cursorPos = shuffleOrder.indexOf(currentIndex);
  if (cursorPos < 0) return [];
  const effectiveRepeat = repeat === "one" ? "all" : repeat;

  while (out.length < count) {
    let nextPos = cursorPos + 1;
    if (nextPos >= shuffleOrder.length) {
      if (effectiveRepeat === "off") break;
      nextPos = 0;
    }
    const next = shuffleOrder[nextPos];
    if (next == null || seen.has(next)) break;
    out.push(next);
    seen.add(next);
    cursorPos = nextPos;
  }

  return out;
}

/**
 * One manual step from `index` in `dir` (+1 = next, -1 = prev), mode-aware, and
 * — crucially for the cover pager window — NON-mutating for shuffle: it walks the
 * EXISTING `shuffleOrder` (wrapping under repeat≠off) and never reshuffles. The
 * real reshuffle-on-wrap only happens when playback actually advances (shuffleNext);
 * the window just peeks, so the visual neighbour and the committed target stay in
 * sync (the commit jumps to the absolute index this returns). Returns null when
 * there is no distinct track that way — repeat-off at the boundary, OR a step that
 * lands back on `index` (single-track / clamped prev) — mirroring peekTrack's
 * `index === currentIndex → undefined` rule so a "null slot" === "no commit".
 */
export function manualStepIndex(opts: {
  index: number;
  length: number;
  repeat: RepeatMode;
  dir: 1 | -1;
  shuffleOrder?: readonly number[];
}): number | null {
  const { index, length, repeat, dir, shuffleOrder } = opts;
  if (length <= 0 || index < 0 || index >= length) return null;
  let stepped: number | null;
  if (!shuffleOrder) {
    stepped = dir === 1 ? manualNextIndex(length, index, repeat) : prevIndex(length, index, repeat);
  } else if (shuffleOrder.length !== length) {
    return null;
  } else {
    const pos = shuffleOrder.indexOf(index);
    if (pos < 0) return null;
    let nextPos = pos + dir;
    if (nextPos < 0) {
      if (repeat === "off") return null;
      nextPos = length - 1;
    } else if (nextPos >= length) {
      if (repeat === "off") return null;
      nextPos = 0;
    }
    stepped = shuffleOrder[nextPos] ?? null;
  }
  if (stepped === null || stepped === index) return null;
  return stepped;
}

/**
 * The ±radius window of manual-advance indices around `currentIndex` for the cover
 * pager. `next[k]` is the track at offset +(k+1), `prev[k]` at offset -(k+1) (each
 * array ordered nearest-first). Walks via {@link manualStepIndex}, so it is
 * shuffle/repeat/wrap-aware and — unlike {@link upcomingManualIndices} — does NOT
 * dedup: a short looping queue (e.g. length 2, repeat-all) intentionally shows its
 * wrapped repeats so the carousel loops. Stops (shorter array) at a repeat-off
 * boundary or a single-track dead end (manualStepIndex → null).
 */
export function windowManualIndices(opts: {
  radius: number;
  currentIndex: number;
  length: number;
  repeat: RepeatMode;
  shuffleOrder?: readonly number[];
}): { prev: number[]; next: number[] } {
  const { radius, currentIndex, length, repeat, shuffleOrder } = opts;
  const walk = (dir: 1 | -1): number[] => {
    const out: number[] = [];
    let cursor = currentIndex;
    for (let k = 0; k < radius; k += 1) {
      const stepped = manualStepIndex({ index: cursor, length, repeat, dir, shuffleOrder });
      if (stepped === null) break;
      out.push(stepped);
      cursor = stepped;
    }
    return out;
  };
  if (radius <= 0 || length <= 0 || currentIndex < 0 || currentIndex >= length) {
    return { prev: [], next: [] };
  }
  return { prev: walk(-1), next: walk(1) };
}
