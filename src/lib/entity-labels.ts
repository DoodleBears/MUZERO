/**
 * Localized display labels for derived artist/album entities. The library-index
 * projections ([`library-index`]) hold no copy (pure lib), so pseudo-buckets
 * ("unknown"/"generated"/compilations) carry only a marker and resolve to UI
 * strings here, at the `t()` call site. Shared by the gallery ([`search-page`])
 * and the ⌘F overlay ([`global-track-search`]) so both render entities identically.
 */

import type { TFunction } from "i18next";
import type { AlbumEntry, ArtistEntry } from "@/lib/library-index";

/** Localize a derived artist's label — pseudo-buckets resolve to UI copy. */
export function artistDisplayLabel(entry: ArtistEntry, t: TFunction): string {
  if (entry.bucket === "generated") return t("gallery.aiGenerated");
  if (entry.bucket === "unknown") return t("gallery.unknownArtist");
  return entry.name;
}

/** Localize a derived album's title — the unknown bucket resolves to UI copy. */
export function albumDisplayLabel(entry: AlbumEntry, t: TFunction): string {
  return entry.bucket === "unknown" ? t("gallery.unknownAlbum") : entry.name;
}

/** Localize a derived album's artist line — compilations resolve to "Various Artists". */
export function albumArtistDisplayLabel(entry: AlbumEntry, t: TFunction): string {
  if (entry.isCompilation) return t("gallery.variousArtists");
  return entry.artistName ?? t("gallery.unknownArtist");
}
