import { Fragment, type ReactNode } from "react";
import { AutoScrollText } from "@/components/ui/auto-scroll-text";
import type { Track } from "@/db/types";
import { trackAlbum, trackArtists, trackSubtitle } from "@/lib/track-display";
import { useNavStore } from "@/stores/nav-store";

/** Poweramp-style title + author pills shown directly below the stage cover. */
export function StageIdentity({ track }: { track: Track }) {
  return (
    <div className="relative z-[90] flex w-full min-w-0 flex-col items-start gap-1.5">
      <div className="w-fit min-w-0 max-w-full overflow-hidden rounded-full border border-white/10 bg-black/55 px-4 py-1.5 shadow-lg">
        <AutoScrollText className="text-2xl font-bold tracking-normal text-white">
          {track.title}
        </AutoScrollText>
      </div>
      <div className="w-fit min-w-0 max-w-full overflow-hidden rounded-full border border-white/10 bg-black/50 px-3 py-1 shadow-md">
        <AutoScrollText className="text-base font-semibold text-white/85" staticMode="clip">
          <StageSubtitle track={track} />
        </AutoScrollText>
      </div>
    </div>
  );
}

/**
 * Artist(s) · album subtitle with each entity clickable — opens it in the
 * library (tab 2). Falls back to the plain caption/note/title line for generated
 * or untagged tracks that carry no embedded artist/album metadata.
 */
function StageSubtitle({ track }: { track: Track }) {
  const artists = trackArtists(track);
  const album = trackAlbum(track);
  if (artists.length === 0 && !album) return <>{trackSubtitle(track)}</>;
  return (
    <>
      {artists.map((name, index) => (
        <Fragment key={name}>
          {index > 0 && ", "}
          <StageEntityLink onOpen={() => useNavStore.getState().openArtist(name)}>
            {name}
          </StageEntityLink>
        </Fragment>
      ))}
      {artists.length > 0 && album && <span aria-hidden> · </span>}
      {album && (
        <StageEntityLink onOpen={() => useNavStore.getState().openAlbumForTrack(track.id)}>
          {album}
        </StageEntityLink>
      )}
    </>
  );
}

/** A clickable artist/album segment inside the stage subtitle → library (tab 2). */
function StageEntityLink({ onOpen, children }: { onOpen: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      className="rounded outline-none transition-colors hover:text-primary focus-visible:text-primary"
    >
      {children}
    </button>
  );
}
