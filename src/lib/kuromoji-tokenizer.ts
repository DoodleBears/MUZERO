/**
 * Bridge to @sglkc/kuromoji — the Japanese morphological tokenizer that gives kanji their
 * readings (the piece `wanakana` can't do). Lives behind {@link ./search-transliterate}'s
 * injectable `setKanjiTokenizer`, loaded lazily in the search worker (the IPADIC dict is ~17MB).
 *
 * Build/runtime split: `buildKanjiTokenizer` is the async IO (load dict + build), while
 * {@link toReadingTokens} is a pure shape-map that's unit-tested without the dictionary.
 * In a worker/browser, @sglkc/kuromoji's `browser` field swaps in the fetch-based loader, so
 * it pulls `${dicPath}/<file>.dat.gz` over fetch (served by the Vite kuromoji-dict plugin /
 * the packaged assets).
 */
import { builder, type IpadicFeatures } from "@sglkc/kuromoji";
import type { ReadingToken } from "@/lib/kanji-romaji";

/** URL base the dict files are served from (Vite dev middleware + emitted build assets). */
export const KUROMOJI_DICT_PATH = "/kuromoji-dict";

/** Keep only the reading field search needs — pure, so it's testable without the dictionary. */
export function toReadingTokens(features: readonly IpadicFeatures[]): ReadingToken[] {
  return features.map((f) => ({ reading: f.reading }));
}

/**
 * Build a kanji tokenizer: resolves to a `tokenize(text) → ReadingToken[]` once the dictionary
 * loads, or rejects if it can't (caller degrades to pinyin-only). `dicPath` defaults to the
 * served dict location.
 */
export function buildKanjiTokenizer(
  dicPath: string = KUROMOJI_DICT_PATH,
): Promise<(text: string) => ReadingToken[]> {
  return new Promise((resolve, reject) => {
    builder({ dicPath }).build((err, tokenizer) => {
      if (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      resolve((text) => toReadingTokens(tokenizer.tokenize(text)));
    });
  });
}
