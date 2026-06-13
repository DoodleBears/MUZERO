/**
 * Pure A–Z fast-scroll index for a name-sorted list. `buildAlphabetIndex` walks the
 * ALREADY-SORTED rows and records the first row index of each letter group, so the
 * UI strip can jump there. `firstAlphaLabel` is the default bucketer (diacritic-
 * folded latin first letter, else "#"); for CJK the caller injects a letter fn that
 * transliterates first (pinyin / kana → latin), reusing the search engine. See the
 * list-scroll-affordances PRD, Phase 2.
 */
export interface AlphabetBucket {
  /** "A".."Z" or "#". */
  label: string;
  /** Index of the first row in this group within the sorted list. */
  firstIndex: number;
}

/** Diacritic-folded uppercase first letter, or "#" for digits / symbols / empty. */
export function firstAlphaLabel(value: string): string {
  const ch = value.trim().normalize("NFKD").replace(/[̀-ͯ]/g, "").charAt(0).toUpperCase();
  return ch >= "A" && ch <= "Z" ? ch : "#";
}

/**
 * Buckets in first-appearance order, one per distinct label, each pointing at the
 * EARLIEST row with that label. Globally de-duped (a `seen` set), so a label that
 * recurs non-contiguously — e.g. pinyin initials over a list the runtime collated
 * by Han codepoint rather than reading — still yields a single strip entry that
 * jumps to its first occurrence, instead of a repeated letter. For a list collated
 * consistently with `letterOf` (the common case), labels are already contiguous and
 * the result is the plain A→Z strip.
 */
/**
 * The bucket index under a pointer at `clientY`, given the letter strip's bounding
 * box. `rectTop`/`rectHeight` MUST be the tight letters block (evenly-sized rows),
 * not a taller padded container — otherwise the proportional map overshoots (a
 * finger on "B" lands on a later letter). Clamped to [0, count-1].
 */
export function bucketIndexAt(
  clientY: number,
  rectTop: number,
  rectHeight: number,
  bucketCount: number,
): number {
  if (bucketCount <= 0) return 0;
  const ratio = (clientY - rectTop) / Math.max(1, rectHeight);
  return Math.min(bucketCount - 1, Math.max(0, Math.floor(ratio * bucketCount)));
}

export function buildAlphabetIndex<T>(
  rows: readonly T[],
  letterOf: (row: T) => string,
): AlphabetBucket[] {
  const buckets: AlphabetBucket[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < rows.length; i += 1) {
    const label = letterOf(rows[i] as T) || "#";
    if (!seen.has(label)) {
      seen.add(label);
      buckets.push({ label, firstIndex: i });
    }
  }
  return buckets;
}
