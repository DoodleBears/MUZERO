/**
 * Pick the next slideshow frame. Pure so the random branch is deterministically
 * unit-tested via an injected `rand` (∈ [0, 1), default `Math.random`).
 * Sequential walks `(i + 1) % length`; shuffle draws uniformly from the *other*
 * frames so the same image never repeats back-to-back. `current` is normalized,
 * so a stale index (the set shrank under it) stays in range.
 */
export function nextSlideIndex(
  current: number,
  length: number,
  shuffle: boolean,
  rand: () => number = Math.random,
): number {
  if (length <= 1) return 0;
  const cur = ((current % length) + length) % length;
  if (!shuffle) return (cur + 1) % length;
  // Uniform over the (length - 1) indices that aren't `cur`: pick in
  // [0, length-1), then shift past `cur` so it's never chosen.
  let n = Math.floor(rand() * (length - 1));
  if (n >= cur) n += 1;
  return n;
}
