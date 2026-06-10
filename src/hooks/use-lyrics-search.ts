import { useMemo, useState } from "react";
import { setTrackLyrics } from "@/db/repositories";
import type { Track } from "@/db/types";
import { useSettings } from "@/hooks/use-app-data";
import { trackAlbum, trackArtists } from "@/lib/track-display";
import { lyricsRecordFromHit } from "@/lyrics/auto-fetch";
import type { LyricsHit } from "@/lyrics/provider";
import { resolveLyricsProviderForTrack } from "@/lyrics/registry";

export interface LyricsSearch {
  title: string;
  artist: string;
  results: LyricsHit[] | null;
  searching: boolean;
  error: boolean;
  setTitle: (v: string) => void;
  setArtist: (v: string) => void;
  runSearch: () => Promise<void>;
  /** Persist the picked candidate as the track's manual lyrics. */
  pick: (hit: LyricsHit) => Promise<void>;
}

/**
 * Shared LRCLIB lyric-search state for the inline empty-state panel and the
 * annotation-editor dialog. Title/artist are prefilled from the track; a pick is
 * stored as `source: "manual"` (wins merge, never auto-overwritten).
 */
export function useLyricsSearch(track: Track): LyricsSearch {
  const settings = useSettings();
  const provider = useMemo(() => resolveLyricsProviderForTrack(settings, track), [settings, track]);
  const [title, setTitle] = useState(track.title);
  const [artist, setArtist] = useState(() => trackArtists(track).join(", "));
  const [results, setResults] = useState<LyricsHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(false);

  async function runSearch() {
    setSearching(true);
    setError(false);
    try {
      const hits =
        (await provider.search?.({
          trackName: title.trim(),
          artistName: artist.trim(),
          albumName: trackAlbum(track),
          durationSec: track.durationSec,
        })) ?? [];
      setResults(hits);
    } catch {
      setError(true);
    } finally {
      setSearching(false);
    }
  }

  async function pick(hit: LyricsHit) {
    await setTrackLyrics({
      trackId: track.id,
      record: lyricsRecordFromHit(hit, "manual"),
      matched: hit.matched,
    });
  }

  return { title, artist, results, searching, error, setTitle, setArtist, runSearch, pick };
}
