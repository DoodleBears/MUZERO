import { useCallback } from "react";
import type { Track } from "@/db/types";
import { transliterateInitial } from "@/lib/search-transliterate";

/** A detail track list (one album/artist/set) earns the A–Z strip past this length. */
export const DETAIL_ALPHABET_MIN_TRACKS = 30;

/**
 * The `alphabetLetterOf` a track list passes to mount its A–Z fast-scroll strip,
 * or `undefined` to hide it. Shared by every name-sortable track surface (全部歌曲
 * + 歌单/专辑/歌手 detail lists) so they bucket identically: `transliterateInitial`
 * (reading-aware — pinyin/kana), the SAME key `sortTracks`'s name sort orders by,
 * so the strip aligns with the rows.
 *
 * `enabled` is the caller's gate (name sort + no query + not liked-filtered + over a
 * length threshold). `transliterationReady` re-creates the fn once the dictionaries
 * load so the labels refine from raw initials to pinyin/kana.
 */
export function useTrackAlphabetLetterOf(
  enabled: boolean,
  transliterationReady: boolean,
): ((track: Track) => string) | undefined {
  // biome-ignore lint/correctness/useExhaustiveDependencies: transliterationReady refreshes the labels after dictionaries load
  const letterOf = useCallback(
    (track: Track) => transliterateInitial(track.title),
    [transliterationReady],
  );
  return enabled ? letterOf : undefined;
}
