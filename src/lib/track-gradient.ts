/**
 * Deterministic gradient from a seed string (e.g. a track id), used as the
 * cover-area placeholder for songs without a cover image. Same seed → same
 * gradient. Hand-rolled (no dep): an FNV-1a hash drives two HSL hues a pleasant
 * distance apart (technique borrowed from string-to-color libs). Pure → testable.
 */

/** FNV-1a 32-bit hash → unsigned int. Stable across runs. */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * A CSS `linear-gradient(...)` derived from `seed`. Two analogous-ish HSL stops
 * (darker toward the end) on a hash-chosen angle — reads as album-art-like
 * placeholder behind a title.
 */
export function trackGradient(seed: string): string {
  const h = hashString(seed || "muzero");
  const hue1 = h % 360;
  const hue2 = (hue1 + 40 + ((h >>> 8) % 60)) % 360; // 40–99° apart
  const sat = 58 + ((h >>> 16) % 22); // 58–79%
  const angle = (h >>> 4) % 360;
  return `linear-gradient(${angle}deg, hsl(${hue1}, ${sat}%, 44%), hsl(${hue2}, ${sat}%, 26%))`;
}
