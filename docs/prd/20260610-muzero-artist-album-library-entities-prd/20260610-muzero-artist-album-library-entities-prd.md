# PRD: MUZERO Artist & Album Library Entities + Per-Artist/Album Listening Stats

**Status:** Draft
**Created:** 2026-06-10
**Author:** MUZERO
**Module:** Media Library — promote embedded artist/album metadata into first-class, browsable, searchable, statistical entities

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | Derived Artist/Album Index (pure lib) | ✅ Completed | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | Library Browse Tabs: 专辑 / 歌手 (+ basic detail) | ✅ Completed | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | Cross-Linking Click-Through + Artist Albums Strip | ✅ Completed | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | Faceted Search (title / artist / album) | 🔲 Pending | [Phase 4 Checklist](#phase-4-checklist) |
| 5 | Listening Stats by Artist & Album | 🔲 Pending | [Phase 5 Checklist](#phase-5-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

The just-completed [Media Metadata Import & Export PRD](../20260609-muzero-media-metadata-import-export-prd/20260609-muzero-media-metadata-import-export-prd.md) already does the hard part of **reading** embedded tags. On import — both the drag/paste/upload path ([`uploadOne` in `src/stores/player-store.ts:650`](../../../src/stores/player-store.ts) → [`parseUploadedMediaMetadata`](../../../src/lib/media-metadata.ts)) and the local-folder path ([`ingestMediaBytes` in `src/workers/ingest-core.ts`](../../../src/workers/ingest-core.ts) → [`metadataFromParsedAudio`](../../../src/lib/media-metadata.ts)) — MUZERO parses MP3/MP4/FLAC/Ogg tags via `music-metadata`, prefers the embedded title over the filename, extracts the embedded cover into `mediaBlobs`, and persists a normalized [`TrackMediaMetadata`](../../../src/db/types.ts) onto the track (`artists[]`, `albumArtists[]`, `album`, `genres[]`, `year`, `trackNo`, …).

**So the data is already there.** The problem the user reported — *"on macOS I can clearly see Title / Artist / Album, but after importing into MUZERO it doesn't feel handled well"* — is not a parsing bug. It is a **surfacing** gap:

- **Artist and Album are not entities.** They exist only as plain strings inside one track's `mediaMetadata`. There is no concept of "the artist DoubleJ 姜峰" that owns N tracks, or "the album 懒人的午后" that groups them.
- **They are buried in a subtitle.** A track row ([`track-row.tsx:197`](../../../src/components/library/track-row.tsx)) shows `track.title` plus a single fused subtitle from [`trackSubtitle`](../../../src/lib/track-display.ts) (`"artist - album"`). Album is glued onto artist; neither is clickable.
- **The library has no artist/album browse.** Tab 2 (the `search` nav tab, rendered by [`SearchPage`](../../../src/pages/search-page.tsx)) has exactly two modes — `歌单` (modeSets) and `全部歌曲` (modeTracks). There is no `专辑` (Albums) or `歌手` (Artists) view.
- **Search is flat.** [`trackSearchText`](../../../src/lib/track-search.ts) already folds artist/album into one lowercased haystack, so substring search *finds* them, but results are an undifferentiated flat track list — you cannot search *for an artist* and land on the artist, nor scope a query to album vs title.
- **Stats stop at the track.** [`recordPlaybackListen`](../../../src/sync/playback-stats.ts) accumulates `listenedSec`/`playCount` into `PlaybackAggregate` for scopes `track | track-in-set | set | track-in-share | share | drive`. There is **no `artist` or `album` scope**, so "how long have I listened to DoubleJ 姜峰?" cannot be answered.

This PRD closes that gap by promoting artist and album to **derived, first-class library entities** — browsable, navigable, faceted in search, and measurable in listening stats — **without** inventing new stored tables or breaking codename stability.

### 1.2 Target Users

| Role | Description | Key actions |
|------|-------------|-------------|
| **Local music collector** | Imported a 网易云/iTunes folder; thinks in terms of artists and albums, not "sets". | Browse by artist/album, click an artist to see all their songs, see which artists they play most. |
| **MV / video-set user** | Imported videos with sparse tags. | Still wants title to read correctly and to group by whatever artist/album exists. |
| **AI DJ user** | Mixes generated tracks (no artist/album, have `brief.caption`) with uploads. | Brief-only generated tracks bucket under a clear localized "AI Generated" pseudo-artist; excluded from albums. |

### 1.3 Core Value

1. **It feels like a real music library.** Title / Artist / Album render distinctly and correctly; artist and album are things you can *click into*, exactly like YouTube Music / Apple Music.
2. **Navigation by identity.** Click an artist → all of that artist's tracks in your library. Click an album → that album's tracks in track order.
3. **Faceted, intent-aware search.** Searching "DoubleJ" shows matching *artists* and *albums* as headers, not just a flat song list.
4. **Listening insight.** Per-artist and per-album listened-time and play-count, derived from existing per-track stats — answering "who do I actually listen to?"

---

## 2. System Architecture

### 2.1 Architecture Overview

```
                    Track.mediaMetadata (already populated on import)
                    { artists[], albumArtists[], album, genres[], year, trackNo }
                                   │
                                   ▼
        ┌──────────────────────────────────────────────────────────┐
        │  src/lib/library-index.ts  (NEW, pure, exhaustively tested)│
        │  tracks[] ──▶ buildArtistIndex() / buildAlbumIndex()       │
        │  • normalize name (trim/lowercase/collapse-space) = key    │
        │  • display name = most common original casing              │
        │  • multi-artist: a track joins EACH of its artists         │
        │  • album identity = album name (+ primary albumArtist)     │
        └──────────────────────────────────────────────────────────┘
              │                         │                       │
              ▼                         ▼                       ▼
   SearchPage browse tabs      Artist/Album detail      Per-artist/album stats
   (专辑 / 歌手 grids)          views (track lists)       (derive-on-read over
   src/pages/search-page.tsx   + click-through from      trackPlaybackStats ×
                               track-row / inspector      current metadata)
```

The spine: **artist and album are projections over `tracks`, computed by a pure function and fed to the UI via `useLiveQuery`.** No new Dexie table, no migration, no new codename-layer identifiers. Re-importing or editing tags re-projects automatically.

### 2.2 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **Entity derivation** | Pure TS module + Vitest | No persistence; identity is normalized metadata. Exhaustively unit-testable (hard rule #7 spirit). |
| **Reactive read** | Dexie `useLiveQuery` over `listAllTracks` | Already the library read path ([`search-page.tsx:91`](../../../src/pages/search-page.tsx)); auto-refreshes on import/edit. |
| **UI** | Existing COSS primitives + `VirtualTrackList` + `TrackInspectorPanel` | Reuse the album-wall / track-list surfaces already in [`search-page.tsx`](../../../src/pages/search-page.tsx). |
| **Stats** | Derive-on-read from `trackPlaybackStats` | Reflects *current* metadata (re-tag safe); no `PlaybackAggregate` schema bump. See §3.4. |
| **i18n** | i18next 4-locale catalog | All labels via `t()`; en is the type source, then zh/ja/ko (hard rule: no inline user-facing strings). |

### 2.3 Project Structure

```
src/
├── lib/
│   ├── library-index.ts            # NEW — buildArtistIndex / buildAlbumIndex (pure)
│   ├── library-index.test.ts       # NEW — exhaustive: multi-artist, casing, empties, generated tracks
│   ├── track-display.ts            # MODIFY — add normalizeArtistName + split artist/album display helpers
│   └── track-search.ts             # MODIFY — add searchLibraryEntities() faceted results (artists/albums/tracks)
├── stores/
│   └── library-stats.ts            # NEW — deriveArtistStats / deriveAlbumStats (join stats × metadata)
├── pages/
│   └── search-page.tsx             # MODIFY — add "albums" / "artists" GalleryMode tabs + detail routing
├── components/
│   └── library/
│       ├── entity-grid.tsx         # NEW — shared EntityGrid (artist round / album square cards)
│       ├── entity-detail.tsx       # NEW — shared EntityDetailView (header + track list + inspector)
│       └── track-row.tsx           # MODIFY — clickable artist/album in the subtitle line (Phase 3)
└── i18n/locales/{en,zh,ja,ko}/common.json   # MODIFY — library/artist/album/stats keys
```

No `src-tauri` / `electron` / Dexie schema changes. No new dependency.

---

## 3. Data Model Design

⚠️ Per template + hard rule #4 (codename stability): **no new stored entities.** Artist and album are *derived*. This section defines their in-memory shape and identity rules.

### 3.1 Core Concepts

```
Artist (derived)                     Album (derived)
  key:  normalized name               key:  normalized album (+ albumArtist)
  name: display (modal casing)        name: display album title
  trackIds: string[]                  artistName: primary album artist (display)
  albumKeys: string[]                 trackIds: string[]  (ordered by trackNo)
  coverTrackId?: string               coverTrackId?: string
  totalDurationSec                    year?, totalDurationSec

A track contributes to:
  • each artist in mediaMetadata.artists[]  (fallback: albumArtists[])
  • one album   in mediaMetadata.album      (namespaced by albumArtist; "Various Artists" aware)

Buckets for the long tail (standard music-app behavior — iTunes / Apple Music / YT Music):
  • tag-less uploads → "Unknown Artist" / "Unknown Album" pseudo-entities (localized)
  • generated AI-DJ tracks (origin "generated", brief-only) → "AI Generated"
    pseudo-artist (localized); excluded from the album index
All pseudo-entities are localized via i18n and sort to the end of their grid.
```

### 3.2 Identity & Normalization Rules

- **Normalization (the join key):** `name.trim().toLowerCase()` with internal whitespace collapsed (`/\s+/ → " "`). Reuse the same discipline as tag normalization in [`setTrackTags`](../../../src/db/repositories.ts). Unicode-safe; do **not** strip CJK.
- **Display name:** the most frequent original casing/spelling among contributing tracks (so "doublej" + "DoubleJ" → "DoubleJ"). Ties broken by first-seen.
- **Multi-artist:** `artists[]` is already split on import by [`splitArtistLike`](../../../src/lib/media-metadata.ts) (`;`, `,`, `/`, `feat.`, `ft.`). Each element is its own artist; a collaboration track appears under *each* collaborator. If `artists[]` is empty, fall back to `albumArtists[]`.
- **Album identity (MusicBrainz/Picard convention):** key = `normalize(album)` **namespaced by** the album-artist axis — `normalize(albumArtist || primary artist)` — so two different "Greatest Hits" merge only when they share an album artist. This is the long-term-correct grouping key because the album-artist tag exists precisely to (a) keep same-titled albums by different artists apart and (b) hold a multi-artist record together. **Compilation handling:** when `albumArtists` is "Various Artists" / "VA" / "群星" (or tracks under one album have differing track artists but a shared album title), group under a localized **"Various Artists"** album-artist bucket rather than splitting per-track-artist. Tracks with no `album` fall into the localized **"Unknown Album"** bucket (still visible under their artist and in 全部歌曲). Year is **not** part of the key (too brittle across re-rips/remasters); it is display-only.
- **Album track order:** sort by `(diskNo ?? 1, trackNo ?? ∞, title)` so an album reads in disc order, not import order.
- **Cover selection:** first contributing track with a `coverBlobId` (mirrors the existing set-cover fallback in [`search-page.tsx:139`](../../../src/pages/search-page.tsx)).

### 3.3 Required Changes (no schema migration)

- **No Dexie version bump.** `library-index.ts` reads `Track[]` from the existing [`listAllTracks`](../../../src/db/repositories.ts). The artist/album projection lives only in memory + React state.
- **`track-display.ts`:** add `normalizeArtistName()`, `trackArtists(track): string[]`, `trackAlbum(track): string | undefined` so every surface reads artist/album the *same* way (mirrors how `trackSubtitle` is the single subtitle authority).
- **Performance:** projection is `O(tracks × artistsPerTrack)`. For a local library (hundreds–low-thousands of tracks) this is sub-millisecond and recomputed only when the `tracks` liveQuery emits. Memoize with `useMemo` keyed on `allTracks`.

### 3.4 Stats: Artist/Album as a Derived Analytics Dimension

**Decision (long-term optimal): artist and album are a *derived analytics dimension*, not a new persisted/synced aggregate scope.** This deliberately reuses the data-warehouse split the [R2 sync PRD §3.8](../20260609-muzero-r2-cloud-drive-sync-prd/20260609-muzero-r2-cloud-drive-sync-prd.md) already established — **immutable event truth** (`PlaybackEvent`) vs. **rebuildable aggregate cache** — and treats artist/album as a *slowly-changing dimension* read at **current-truth** semantics.

Why not extend `PlaybackAggregate["scope"]` with `artist`/`album` (the "precompute it" option)?

- **Mutable keys don't belong in immutable-ish synced rows.** `PlaybackAggregate` ids are codename-stable (`set`/`drive`/`track` ids). Artist/album are mutable metadata strings; pinning them into synced aggregate rows makes the rows go **stale on re-tag** (the row keyed by the old artist name lingers forever) and couples the synced stats layer to high-cardinality free text — exactly what §3.8's "aggregate cache is rebuildable from events" rule is designed to avoid.
- **Product expectation is current-truth, not as-played.** "Hours listened to artist X" should follow a corrected/renamed tag. A derived dimension re-folds from *current* metadata every read; a snapshotted aggregate freezes the name at play time.

Design:

- `src/stores/library-stats.ts` exposes `deriveArtistStats(...)` / `deriveAlbumStats(...)` → `Map<entityKey, { listenedSec, playCount, lastPlayedAt }>`, folding the **already-existing, already-synced** per-track signal (`trackPlaybackStats` / `PlaybackEvent`) by entity key via `trackArtists` / `trackAlbum`. Computed via `useLiveQuery` over `db.trackPlaybackStats` + `allTracks`, memoized on inputs.
- **Cross-drive completeness (important):** a play of a *remote/shared* track arrives as a `PlaybackEvent` with `remoteTrackRef` and **no local `Track` row**. The derivation must therefore also resolve artist/album from the synced **`RemoteSearchTrack.mediaMetadata`** (and de-dup by `mediaSha256` where present) so "who do I listen to?" counts plays from other people's drives too — not just the local library. This is why §3.4.2 of the R2 PRD syncs full `mediaMetadata`, and is the cross-PRD tie-in.
- **Scale escape hatch (only if ever needed):** if a library ever grows large enough that the per-read fold matters, add a *device-local, rebuildable* derived cache invalidated on any metadata edit — **never** a new synced `PlaybackAggregate` scope. The source of truth stays the event log; the cache stays current-truth.

### 3.5 Data Relationship Diagram

```
DjSession(歌单) ──< trackIds >── Track ──┬── mediaMetadata.artists[] ─┐
                                         │                           ├─▶ ArtistIndex (derived)
                                         ├── mediaMetadata.album ─────┴─▶ AlbumIndex  (derived)
                                         └── id ──< trackId >── TrackPlaybackStats ──▶ deriveArtist/AlbumStats
                                                                  (existing, synced)     (derived)
```

---

## 4. API Design

No network API (local-first, hard rule #1). "API" here = the internal module surface.

### 4.1 Module Surface

| Symbol | File | Signature | Description |
|--------|------|-----------|-------------|
| `buildArtistIndex` | `lib/library-index.ts` | `(tracks: Track[]) => ArtistEntry[]` | Project tracks → sorted artist entries. |
| `buildAlbumIndex` | `lib/library-index.ts` | `(tracks: Track[]) => AlbumEntry[]` | Project tracks → sorted album entries. |
| `normalizeArtistName` | `lib/track-display.ts` | `(s: string) => string` | The single join-key normalizer. |
| `trackArtists` / `trackAlbum` | `lib/track-display.ts` | `(t: Track) => string[] / string?` | Single read authority for artist/album. |
| `searchLibraryEntities` | `lib/track-search.ts` | `(tracks, query) => { artists, albums, tracks }` | Faceted results; reuses `matchesQuery` for the track facet. Honors scoped field tokens (`artist:`/`album:`) + existing `#tag`. |
| `parseSearchTokens` | `lib/track-search.ts` | `(query) => { free, artist?, album?, tags[] }` | Split a query into field-scoped tokens (`artist:`/`album:`/`#tag`) + free text. |
| `deriveArtistStats` / `deriveAlbumStats` | `stores/library-stats.ts` | `(tracks, statsByTrackId, remoteTracks?) => Map<key, EntityStat>` | Fold per-track + remote-track stats by entity key (cross-drive). |

### 4.2 Type Examples

```typescript
export interface ArtistEntry {
  key: string;            // normalizeArtistName(displayName)
  name: string;           // modal original casing
  trackIds: string[];
  albumKeys: string[];
  coverTrackId?: string;
  totalDurationSec: number;
}

export interface AlbumEntry {
  key: string;            // `${normalize(albumArtist)}::${normalize(album)}`
  name: string;
  artistName?: string;
  artistKey?: string;
  year?: number;
  trackIds: string[];     // ordered by (diskNo, trackNo, title)
  coverTrackId?: string;
  totalDurationSec: number;
}

export interface LibraryEntitySearchResult {
  artists: ArtistEntry[];
  albums: AlbumEntry[];
  tracks: Track[];
}
```

### 4.3 Error Handling / Edge Cases

- **No metadata at all** (filename-only fallback import): track has no `artists`/`album` → grouped into the localized **"Unknown Artist"** / **"Unknown Album"** pseudo-entities (sorted to the end), still visible in 全部歌曲. (Standard iTunes/Apple Music/YT Music behavior.)
- **Generated tracks** (`origin: "generated"`, brief-only): excluded from the album index; grouped under the localized **"AI Generated"** pseudo-artist so generated music stays discoverable by-artist.
- **Empty/whitespace tag values:** already pruned by [`pruneMetadata`/`cleanStrings`](../../../src/lib/media-metadata.ts); the index trusts that and additionally guards `key !== ""`.
- **Telemetry:** none. Consistent with hard rules — no tag values, names, or counts leave the device.

---

## 5. Frontend Design

### 5.1 Page Structure

Tab 2 today (`search` tab → [`SearchPage`](../../../src/pages/search-page.tsx)) has a `GalleryMode = "sets" | "tracks"` toggle ([`search-page.tsx:41`](../../../src/pages/search-page.tsx)). Extend to:

```
GalleryMode = "sets" | "tracks" | "albums" | "artists"

ModeTab row:  [ 歌单 ][ 全部歌曲 ][ 专辑 ][ 歌手 ]      (gallery.modeSets / modeTracks / modeAlbums / modeArtists)

albums  → AlbumGrid  (cover + title + artist)        → tap → AlbumDetail  (ordered tracks + stats)
artists → ArtistGrid (cover mosaic + name + counts)  → tap → ArtistDetail (albums strip + all tracks + stats)
```

Routing reuses the existing level-1 ⇄ level-2 pattern (`selectedSetId` → `SetDetailView`). Add `selectedArtistKey` / `selectedAlbumKey` state with the same `transitionState()` view-transition wrapper.

### 5.2 UI Components

- **`track-row.tsx` (MODIFY):** split the subtitle line so **artist** and **album** are independently clickable (`button`/`role="link"`), each navigating to that entity's detail. Keep the non-clickable `trackSubtitle` fallback for generated tracks. Verify title renders `track.title` (already embedded-title-first from import) — Req 3.
- **[`entity-grid.tsx`](../../../src/components/library/entity-grid.tsx) (NEW, shared):** one DRY `EntityGrid` (artist + album, round vs square cover) mirroring `SetCard` grid/list affordances. Each card resolves its own cover via `useTrackCoverUrl`; labels are pre-localized at the call site so the component holds no copy. (Replaces the speculative `album-grid`/`artist-grid` split — one component is less duplication.)
- **[`entity-detail.tsx`](../../../src/components/library/entity-detail.tsx) (NEW, shared):** `EntityDetailView` reuses `VirtualTrackList` + `TrackInspectorPanel` (same split layout as `SetDetailView`); read-only header (artist/album are derived, not editable). Rows play via `playTrack` (cross-set safe). _Play-all-as-queue_ and the derived stat header land in later phases (the session-centric queue has no ad-hoc cross-set "play these" entry yet)._
- **`TrackInspectorPanel` / `TrackMetadataSummary` (MODIFY, [`track-inspector-panel.tsx:52`](../../../src/components/track/track-inspector-panel.tsx)):** make the artist and album facts clickable to their detail views.

### 5.3 State Management

- **Derivation:** `const allTracks = useLiveQuery(() => listAllTracks(db), [], [])` already exists; add `const artists = useMemo(() => buildArtistIndex(allTracks), [allTracks])` and the album equivalent. No Zustand — these are DB-derived (hard rule #6: don't push DB-derivable data into Zustand).
- **Stats:** `useLiveQuery(() => db.trackPlaybackStats.toArray())` → `useMemo` fold by entity. Read-only; never selected into the player store.
- **Selection persistence:** the active GalleryMode persists to `localStorage` like the existing `MODE_KEY` (this is a UI view preference, not a hidden behavior flag — allowed; cf. hard rule #3).

---

## 6. Implementation Plan

### Phase 1: Derived Artist/Album Index (pure lib)

**Goal:** A pure, exhaustively-tested projection from `Track[]` to artist/album entities + the shared read helpers.

**Tasks:**
- [x] Add `normalizeArtistName`, `trackArtists`, `trackAlbum` to [`src/lib/track-display.ts`](../../../src/lib/track-display.ts).
- [x] Create [`src/lib/library-index.ts`](../../../src/lib/library-index.ts) with `buildArtistIndex` / `buildAlbumIndex` (+ `ArtistEntry`/`AlbumEntry` types), two-pass compilation-aware album grouping.
- [x] Create [`src/lib/library-index.test.ts`](../../../src/lib/library-index.test.ts): multi-artist split, casing→modal display, album namespacing by albumArtist, trackNo ordering, Unknown/Generated buckets, compilation grouping, generated-track exclusion, cover fallback (18 cases).

#### Phase 1 Checklist
- [x] Same artist in 3 casings collapses to one entry with modal display name.
- [x] `A feat. B` track appears under both A and B.
- [x] Two same-named albums by different artists stay separate.
- [x] Album track order follows `(diskNo, trackNo, title)`.
- [x] Compilation (differing artists, no album artist) groups under one Various-Artists album.
- [x] `make check` green (typecheck + biome + the 18 new cases).

### Phase 2: Library Browse Tabs (专辑 / 歌手)

**Goal:** Add `albums` and `artists` modes to the tab-2 gallery with grid/list cards.

**Tasks:**
- [x] Extend `GalleryMode` + ModeTab row in [`search-page.tsx`](../../../src/pages/search-page.tsx) with `modeAlbums` / `modeArtists` (+ `~` cycle through all four).
- [x] Build the shared [`entity-grid.tsx`](../../../src/components/library/entity-grid.tsx) (`EntityGrid`, artist round / album square) + [`entity-detail.tsx`](../../../src/components/library/entity-detail.tsx) (`EntityDetailView`), routed via `selectedArtistKey`/`selectedAlbumKey` + `transitionState`.
- [x] Wire `buildArtistIndex` / `buildAlbumIndex` via `useMemo(allTracks)`; localize pseudo-bucket labels at the call site.
- [x] i18n: `gallery.modeAlbums`/`modeArtists`, `searchAlbums`/`searchArtists`, `albumsEmpty`/`artistsEmpty`, `unknownArtist`/`unknownAlbum`/`variousArtists`/`aiGenerated`/`albumCount`/`openEntity` (en→zh/ja/ko).

#### Phase 2 Checklist
- [x] Tab 2 shows four modes (歌单 / 全部歌曲 / 专辑 / 歌手); verified live in the preview (placeholders + localized empty states, no console errors).
- [x] Grid and list views both render; covers resolve from the entity's cover track.
- [x] Empty library shows localized empty state, no crash.
- [x] Tapping a card opens a read-only entity detail (header + virtualized track list); rows play via `playTrack`. (Populated-grid rendering covered by the Phase 1 unit tests.)

### Phase 3: Cross-Linking Click-Through + Artist Albums Strip

**Goal:** Artist/album are clickable everywhere a track shows them, and an artist's detail surfaces its albums.

**Tasks:**
- [x] Shared "navigate to entity" channel: ephemeral intent on [`nav-store.ts`](../../../src/stores/nav-store.ts) (`openArtist`/`openAlbumForTrack`/`consumeLibraryEntity`, persisted state limited to `tab`/`settingsItem`). Artist resolves by normalized name; album by track membership (compilation-safe) via tested `findArtistByName`/`findAlbumForTrack`/`albumsForArtist` (+3 cases).
- [x] Make artist/album clickable in [`track-row.tsx`](../../../src/components/library/track-row.tsx) subtitle (per-artist) and in `TrackMetadataSummary` ([`track-inspector-panel.tsx`](../../../src/components/track/track-inspector-panel.tsx)); `SearchPage` consumes the intent and opens the detail.
- [x] Artist detail: an "albums strip" (compilation-aware, via `albumsForArtist`) above the track list, tapping opens the album.
- [ ] (Stretch — deferred) A real cross-set "Play all" once an ad-hoc queue entry point exists.

#### Phase 3 Checklist
- [x] Click artist in a track row → artist detail with all their tracks (Req 1). _Verified live._
- [x] Click album (artist albums strip / inspector) → album detail in track order (Req 1). _Verified live._
- [x] Artist detail shows the artist's albums; tapping one opens the album. _Verified live (header "2 张专辑", strip)._
- [x] Back navigation returns to the correct mode.

### Phase 4: Faceted Search (title / artist / album)

**Goal:** Search returns grouped artists + albums + tracks; an artist/album hit navigates to its entity.

**Tasks:**
- [ ] `parseSearchTokens(query)` + `searchLibraryEntities(tracks, query)` in `track-search.ts` (reuse `matchesQuery` for tracks; match `ArtistEntry.name`/`AlbumEntry.name` for the facets).
- [ ] **Scoped field tokens**: extend the `#tag` convention with `artist:` / `album:` so `artist:doublej` scopes to the artist field — composes with free text and `#tag`. Mirror the same parser in `matchesRemoteSearchTrack` ([`r2-search-catalog.ts`](../../../src/sync/r2-search-catalog.ts)) so scoped search works across drives.
- [ ] Render grouped sections in the tracks/search surface (Artists ▸, Albums ▸, Songs ▸), spanning local + remote results.
- [ ] i18n facet headers + scoped-token hint.

#### Phase 4 Checklist
- [ ] Searching "DoubleJ" surfaces the artist as a header above song matches (Req 2).
- [ ] `artist:` / `album:` scoped tokens narrow to the right field; `#tag` still works.
- [ ] Searching an album title surfaces the album.
- [ ] Existing flat substring search behavior preserved as the Songs facet; remote tracks appear under the same facets.

### Phase 5: Listening Stats by Artist & Album

**Goal:** Per-artist and per-album listened-time + play-count, derived from existing per-track stats.

**Tasks:**
- [ ] `src/stores/library-stats.ts`: `deriveArtistStats` / `deriveAlbumStats` — fold `trackPlaybackStats` by entity key via `trackArtists`/`trackAlbum` (current-truth dimension over the event log).
- [ ] **Cross-drive coverage**: also resolve artist/album for `PlaybackEvent`s carrying `remoteTrackRef` (no local `Track`) from synced `RemoteSearchTrack.mediaMetadata`, de-duping by `mediaSha256` where present, so remote/shared plays credit the right artist/album.
- [ ] Show the stat on artist/album detail headers (e.g. "Listened 4h 12m · 87 plays") + a sorted "Top artists" affordance in the 歌手 grid (sort by listenedSec).
- [ ] Tests: multi-artist track credits *each* artist; re-tag re-buckets on next read; a remote-only play credits its artist.

#### Phase 5 Checklist
- [ ] Playing tracks accrues time to the right artist/album (Req 4).
- [ ] A collaboration play credits both artists.
- [ ] Re-tagging an artist name moves its accumulated time (current-truth derivation).
- [ ] A play of a remote/shared track credits its artist/album cross-drive.
- [ ] No `PlaybackAggregate` schema change / no new synced scope; `make check` green.

---

## 7. Out of Scope

- **Online enrichment** (MusicBrainz/Discogs/Spotify artist images, bios, canonical IDs). Entities stay derived from *embedded* tags only — consistent with the metadata PRD's out-of-scope.
- **Editing artist/album by typing in the UI** beyond what the existing annotation/metadata editor already allows. (Bulk re-tag / "merge these two artists" is a future PRD.)
- **Persisting artist/album as Dexie tables** or adding `artist`/`album` `PlaybackAggregate` scopes — **decided against** (§3.4): artist/album are a derived current-truth dimension, never a synced scope.
- **Cross-device artist/album stat sync as standalone rows.** Per-track + remote-track stats already sync (R2); artist/album rollups are re-derived per device from that synced signal.
- **Bulk re-tag / "merge these two artists" tooling.** Identity is normalization-only; an explicit artist-merge UI is a future PRD.
- **Decrypting DRM/store formats** to recover tags (still skipped per [folder-import](../../../src/lib/folder-import.ts)).
- **Hidden backend flags / runtime kill switches** (hard rule #3). Rollback = `git revert` + redeploy.

---

## 8. Security Considerations

- **Authentication / Authorization:** none — local device data only.
- **Data Protection:** artist/album entities and stats are in-memory derivations of IndexedDB data; nothing new is persisted or transmitted.
- **Privacy / Telemetry:** **no** artist names, album names, play counts, or listened-time ever leave the device. Logging stays technical-only via [`src/lib/logger.ts`](../../../src/lib/logger.ts) (hard rule #8); redact names/values.
- **Codename stability (hard rule #4):** no change to `muzero-db`, table names, or id prefixes. Artist/album carry no persisted ids.

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [20260609 Media Metadata Import & Export PRD](../20260609-muzero-media-metadata-import-export-prd/20260609-muzero-media-metadata-import-export-prd.md) | Upstream: parses & persists the `mediaMetadata` this PRD surfaces. |
| [20260609 R2 Cloud Drive Sync PRD](../20260609-muzero-r2-cloud-drive-sync-prd/20260609-muzero-r2-cloud-drive-sync-prd.md) | Cross-PRD tie-in: §3.4.2 syncs `mediaMetadata` (cross-drive entities/facets); §3.8 event-truth/aggregate-cache model (artist/album = derived dimension, not a synced scope). |
| [20260607 Set/PlayQueue/Memory Data Model PRD](../20260607-muzero-set-playqueue-memory-data-model-prd/) | The set/queue/memory model these entities sit alongside. |
| [20260607 Dock Nav / Gallery Redesign PRD](../20260607-muzero-dock-nav-gallery-redesign-prd/) | The tab-2 gallery surface being extended. |
| [`src/lib/track-search.ts`](../../../src/lib/track-search.ts) · [`track-display.ts`](../../../src/lib/track-display.ts) · [`sync/playback-stats.ts`](../../../src/sync/playback-stats.ts) | Primary code touchpoints. |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | Stats: derive-on-read or a new `artist`/`album` `PlaybackAggregate` scope? | ✅ Resolved | **Derived current-truth dimension** over the event log + per-track stats — *not* a synced aggregate scope (§3.4). Re-tag-safe, no migration, mutable strings stay out of codename-stable synced rows. Cross-drive coverage via synced `RemoteSearchTrack.mediaMetadata`. Scale escape hatch = a rebuildable device-local cache, never a synced scope. |
| 2 | Show an "Unknown artist/album" bucket for tag-less imports, or hide them? | ✅ Resolved | **Show** localized "Unknown Artist"/"Unknown Album" pseudo-entities (sorted to the end) — standard iTunes/Apple Music/YT Music behavior; better discoverability than hiding. |
| 3 | Generated AI-DJ tracks in the 歌手 view: hide, or bucket under a pseudo-artist? | ✅ Resolved | Bucket under a localized **"AI Generated"** pseudo-artist (user-confirmed); excluded from the album index. |
| 4 | Album identity namespacing: by `albumArtist` only, or also by `year`? | ✅ Resolved | **albumArtist** only (MusicBrainz/Picard convention) + explicit "Various Artists" compilation handling; year is display-only, never part of the key. |
| 5 | Scoped query tokens (`artist:` / `album:`), or grouped facets only? | ✅ Resolved | **Both** — grouped facets *and* scoped field tokens (`artist:`/`album:`) extending the existing `#tag` convention; mirrored in the remote-search matcher for cross-drive parity. |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-10 | MUZERO | Initial draft. Investigated import metadata handling (already parses tags into `Track.mediaMetadata`); scoped artist/album as derived entities + per-artist/album stats. |
| 2026-06-10 | MUZERO | Resolved all 5 open questions (long-term-optimal): (1) artist/album = derived current-truth analytics dimension over the event log, cross-drive via synced `RemoteSearchTrack.mediaMetadata`, never a synced `PlaybackAggregate` scope; (2) show "Unknown Artist/Album" buckets; (3) "AI Generated" pseudo-artist; (4) album identity = album + albumArtist (MusicBrainz convention) with Various-Artists handling, year excluded; (5) grouped facets **and** scoped `artist:`/`album:` tokens. Propagated into §3.1/§3.2/§3.4/§4/§6/§7. |
| 2026-06-10 | MUZERO | **Phase 1 completed (TDD).** Added `normalizeArtistName`/`trackArtists`/`trackAlbum` to `track-display.ts` and the pure `library-index.ts` (`buildArtistIndex`/`buildAlbumIndex`, two-pass compilation-aware grouping, Unknown/Generated/Various-Artists buckets). 18 unit cases, typecheck + biome clean. |
| 2026-06-10 | MUZERO | **Phase 2 completed.** Added 专辑/歌手 browse tabs to `search-page.tsx` + shared `entity-grid.tsx`/`entity-detail.tsx` (read-only detail, per-row `playTrack`), `~` cycles four modes, i18n across en/zh/ja/ko. Verified live in the browser preview (tabs/placeholders/empty states, no console errors). Consolidated the speculative artist-grid/album-grid/artist-detail/album-detail into two shared components; re-scoped Phase 3 to cross-linking click-through + an artist albums strip (detail views shipped in Phase 2). |
| 2026-06-10 | MUZERO | **Phase 3 completed.** Clickable artist/album in track-row subtitles + inspector facts, routed through an ephemeral `nav-store` intent (persists only tab/settingsItem) consumed by `SearchPage`; artist resolves by normalized name, album by membership (`findArtistByName`/`findAlbumForTrack`/`albumsForArtist`, +3 TDD cases). Artist detail gained a compilation-aware albums strip. Verified live with seeded tracks: row→artist detail, strip→album detail, no console errors. Cross-set "Play all" deferred (no ad-hoc queue entry point yet). |

---

> **Note:** Artist and album are **derived projections over `Track.mediaMetadata`**, not new stored tables — honoring "prefer modifying existing structures" and codename stability. The data already exists post-import; this PRD is entirely about surfacing it as navigable, faceted, measurable entities.
