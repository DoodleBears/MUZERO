/**
 * Turn a Japanese morphological analyzer's tokens into romaji search variants — the JP
 * counterpart to pinyin for pure-kanji titles. A tokenizer (kuromoji) tags each token with a
 * katakana `reading`; here we keep this a PURE step (reading → romaji via an injected
 * converter, i.e. wanakana) so the variant logic is unit-testable without loading the ~大
 * dictionary. The bridge that supplies real kuromoji tokens lives in
 * {@link ./search-transliterate} (lazy-loaded in the search worker).
 *
 * Why a separate step from wanakana directly: `wanakana.toRomaji("桜")` returns "桜"
 * unchanged — it only transliterates kana, not kanji. kuromoji resolves 桜 → reading サクラ,
 * then wanakana turns サクラ → "sakura".
 */

/** The single field this module needs from an analyzer token. */
export interface ReadingToken {
  /** Katakana reading of the surface form (kuromoji uses "*" when it has none). */
  reading?: string;
}

/**
 * Romaji variants (spaced + compact) built from the tokens' katakana readings, romanized via
 * `toRomaji` (wanakana). Returns `[]` when no token carries a usable reading — so a pure-kanji
 * string the analyzer can't read adds nothing (and the caller keeps its pinyin variants).
 */
export function readingRomajiVariants(
  tokens: readonly ReadingToken[],
  toRomaji: (kana: string) => string,
): string[] {
  const romaji = tokens
    .map((t) => t.reading)
    .filter((r): r is string => typeof r === "string" && r.length > 0 && r !== "*")
    .map((r) => toRomaji(r).trim())
    .filter(Boolean);
  if (romaji.length === 0) return [];
  const spaced = romaji.join(" ").trim();
  const compact = romaji.join("").trim();
  if (!spaced) return [];
  return compact && compact !== spaced ? [spaced, compact] : [spaced];
}
