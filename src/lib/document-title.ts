import type { Track } from "@/db/types";
import { trackAlbum, trackArtists } from "@/lib/track-display";

/**
 * The static brand title shown when nothing is playing. Mirrors the `<title>`
 * in index.html (static HTML can't import this) — keep the two in sync.
 */
export const DEFAULT_DOCUMENT_TITLE = "MUZERO — Your Private Music Museum";

/** Joins title / artist / album; " | MUZERO" marks the brand boundary. */
const PART_SEP = " · ";
const BRAND = "MUZERO";

/**
 * The browser tab title for the current track: `Title · Artist · Album | MUZERO`,
 * dropping whichever of artist / album are absent (generated briefs carry no
 * embedded metadata, uploads may lack an album). Falls back to the brand title
 * when nothing is playing. Pure — the applying hook lives in
 * src/hooks/use-document-title.ts.
 */
export function formatDocumentTitle(track: Track | undefined): string {
  if (!track) return DEFAULT_DOCUMENT_TITLE;
  const parts = [track.title?.trim(), trackArtists(track).join(", "), trackAlbum(track)].filter(
    (part): part is string => !!part && part.length > 0,
  );
  if (parts.length === 0) return DEFAULT_DOCUMENT_TITLE;
  return `${parts.join(PART_SEP)} | ${BRAND}`;
}
