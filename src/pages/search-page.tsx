import { useLiveQuery } from "dexie-react-hooks";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { VirtualTrackList } from "@/components/library/virtual-track-list";
import { Input } from "@/components/ui/input";
import { db } from "@/db/muzero-db";
import { getAllTags, listAllTracks } from "@/db/repositories";
import { searchTracks } from "@/lib/track-search";
import { usePlayerStore } from "@/stores/player-store";

/**
 * Search across every track by title, caption, note, and tags — the "music
 * carries memories" surface. Tapping a result plays it, switching sets as
 * needed. Tag chips are quick filters.
 */
export function SearchPage() {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const tracks = useLiveQuery(() => listAllTracks(db), [], []);
  const tags = useLiveQuery(() => getAllTags(db), [], []);
  const playTrack = usePlayerStore((s) => s.playTrack);

  const results = useMemo(() => searchTracks(tracks, query), [tracks, query]);

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col p-4 lg:p-6">
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("search.placeholder")}
          className="pl-9"
        />
      </div>

      {tags.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {tags.slice(0, 16).map(({ tag, count }) => (
            <button
              key={tag}
              type="button"
              onClick={() => setQuery((q) => (q.includes(`#${tag}`) ? q : `#${tag}`))}
              className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent"
            >
              #{tag} <span className="text-muted-foreground/60">{count}</span>
            </button>
          ))}
        </div>
      )}

      <div className="mb-2 text-xs text-muted-foreground">
        {query.trim()
          ? t("search.results", { count: results.length })
          : t("search.tracks", { count: tracks.length })}
      </div>
      <div className="min-h-0 flex-1">
        <VirtualTrackList
          tracks={results}
          onPlay={(track) => void playTrack(track)}
          emptyHint={t("search.empty")}
        />
      </div>
    </div>
  );
}
