# PRD: MUZERO Media Metadata Import and Export

**Status:** Draft
**Created:** 2026-06-09
**Author:** MUZERO
**Module:** Media Library - Import metadata, cover extraction, and metadata-correct export

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 0 | Raw Media Download Button | ✅ Completed | [Phase 0 Checklist](#phase-0-checklist) |
| 1 | Import-Time Metadata Parser | 🔄 In Progress | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | Library Metadata Surface Area | 🔄 In Progress | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | Metadata-Correct Export Pipeline | 🔲 Pending | [Phase 3 Checklist](#phase-3-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

MUZERO currently imports uploaded audio/video by probing a temporary `<video>` element in [`src/lib/media-probe.ts`](../../../src/lib/media-probe.ts). That is useful for `kind` and `durationSec`, but it does not parse embedded music tags such as title, artist, album, track number, genre, year, or cover art. The current fallback title is derived from the filename, which makes imported music feel less like a real YouTube Music-style local library.

The download button added in Phase 0 exports the stored media bytes as-is. That is correct for preserving original media bytes, but it does not yet answer the deeper product requirement: when the user has imported metadata, edited cover/tags/memories, or downloaded AI-generated music, the exported file should carry correct embedded metadata and cover art when the container supports it.

Research notes:

- MDN documents `loadedmetadata` as the point where media duration/dimensions/tracks are known; it is not a rich tag parser. Source: <https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/loadedmetadata_event>
- ID3 has explicit frames for MP3-style metadata: `TIT2` title, `TPE1` performer, `TALB` album, `TRCK` track number, `APIC` attached picture, etc. Source: <https://id3.org/id3v2.4.0-frames>
- Container/tag coupling differs by format: Mutagen notes MP4 tags are inseparable from the container, while MP3 metadata is loosely attached to the file. Source: <https://mutagen.readthedocs.io/en/latest/user/classes.html>
- `music-metadata` supports browser `parseBlob(file)`, common normalized tags, duration/format info, and cover art via `metadata.common.picture`. Source: <https://github.com/Borewit/music-metadata> and <https://borewit.github.io/music-metadata/doc/common_metadata.html>
- Tauri v2 provides native save dialogs and `fs.writeFile`, which is the right desktop path for writing downloaded/exported bytes. Sources: <https://v2.tauri.app/reference/javascript/dialog/> and <https://tauri.app/reference/javascript/fs/>
- Rust `lofty` can parse, convert, and write metadata across MP3, MP4/M4A, FLAC, Ogg Vorbis/Opus, WAV, AIFF, etc.; it also warns that format-specific quirks matter. Source: <https://docs.rs/lofty/latest/lofty/>
- Media Session metadata exposes title, artist, album, and artwork to platform playback UI, but browser support is not fully baseline. Source: <https://developer.mozilla.org/en-US/docs/Web/API/MediaMetadata>

### 1.2 Target Users

| Role | Description | Permissions |
|------|-------------|-------------|
| **Local music collector** | Imports existing audio files and expects MUZERO to show artist/album/cover correctly. | Import, edit metadata in MUZERO, download/export files. |
| **MV / video set user** | Imports videos and wants title/cover/search to be useful even when full audio tags are sparse. | Import media, set covers, download original video bytes. |
| **AI DJ user** | Generates tracks and expects downloads to have title, artist-like provenance, lyrics/caption, and cover where possible. | Generate, annotate, download/export generated tracks. |

### 1.3 Core Value

1. **Correct library identity**: Imported music should use embedded title/artist/album/cover before filename fallback.
2. **Round-trip trust**: Downloading a track should preserve original bytes by default and offer metadata-correct export when requested.
3. **DJ context quality**: Artist/album/genre/year metadata becomes searchable and can feed DJ continuity without leaking provider details.

---

## 2. System Architecture

### 2.1 Architecture Overview

```
File upload
  │
  ├─▶ probeMediaFile(file) ───────────────▶ kind + duration fallback
  │
  ├─▶ parseEmbeddedMediaMetadata(file) ───▶ normalized metadata + embedded cover
  │                                           │
  │                                           ├─▶ tracks.mediaMetadata
  │                                           └─▶ mediaBlobs(role:"cover")
  │
  └─▶ createUploadedTrack ─────────────────▶ original media Blob in mediaBlobs(role:"media")

Download / Export
  │
  ├─▶ Export Original ───────▶ stored Blob bytes unchanged
  │
  └─▶ Export With Metadata ──▶ container-aware tag writer
                               MP3/ID3 · MP4 ilst · FLAC/Vorbis · Ogg/Vorbis · WAV/RIFF
```

### 2.2 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **Import parser** | `music-metadata` `parseBlob(file)` | Browser-compatible, normalized common tags, cover extraction, broad read support. |
| **Playback duration probe** | Existing `<video preload="metadata">` path | Keep as codec/playability check and fallback duration source. |
| **Metadata writer** | Tauri Rust command using `lofty` | Safer for binary tag writing across desktop platforms; avoids fragile hand-written JS byte surgery. |
| **Browser fallback export** | Raw Blob download only | Browser can reliably export original bytes; full tag rewriting is deferred to desktop path unless a WASM writer is approved. |
| **Persistence** | Dexie `muzero-db` | Local-first; metadata remains device-local with media bytes. |

### 2.3 Project Structure

```
src/
├── lib/
│   ├── media-probe.ts              # keep duration/playability probe
│   ├── media-metadata.ts           # new import parser bridge
│   └── download-track.ts           # raw download, then export mode entry
├── db/
│   ├── types.ts                    # Track mediaMetadata optional fields
│   ├── muzero-db.ts                # Dexie version bump + backfill
│   └── repositories.ts             # createUploadedTrack accepts parsed metadata
└── components/library/
    └── track-row.tsx               # hover action download/export entry

src-tauri/
└── src/
    └── lib.rs                      # metadata export command, only if Phase 3 chooses Rust writer
```

---

## 3. Data Model Design

### 3.1 Core Concepts

```
Track
  ├─ title                    # display title, initialized from metadata.common.title
  ├─ mediaMetadata            # normalized imported / generated / user-edited metadata
  ├─ blobId ────────────────▶ MediaBlob(role:"media") original bytes
  └─ coverBlobId ───────────▶ MediaBlob(role:"cover") embedded/user cover bytes
```

### 3.2 Database Schema

⚠️ **Important:** Add optional fields only; keep codename-layer table names and id prefixes stable.

- **Current Schema:** [`src/db/types.ts`](../../../src/db/types.ts), [`src/db/muzero-db.ts`](../../../src/db/muzero-db.ts), [`src/db/repositories.ts`](../../../src/db/repositories.ts)
- **Required Changes:**
  - Add optional `Track.mediaMetadata`:

```typescript
interface TrackMediaMetadata {
  title?: string;
  artists?: string[];
  album?: string;
  albumArtist?: string;
  genres?: string[];
  year?: number;
  date?: string;
  trackNo?: number;
  trackOf?: number;
  diskNo?: number;
  diskOf?: number;
  composer?: string[];
  bpm?: number;
  key?: string;
  isrc?: string[];
  originalFileName?: string;
  originalMime?: string;
  originalExtension?: string;
  container?: string;
  codec?: string;
  bitrate?: number;
  sampleRate?: number;
  numberOfChannels?: number;
  parser: "music-metadata" | "track-brief" | "manual";
  parsedAt: number;
}
```

  - Store extracted embedded cover art as `mediaBlobs(role:"cover")` and set `track.coverBlobId` only when the track has no user-selected cover yet.
  - Preserve the original uploaded media bytes unchanged in `mediaBlobs(role:"media")`; do not rewrite imported bytes during import.
  - Generated tracks initialize `mediaMetadata` from `TrackBrief` where available (`title`, `lyrics` in future export mapping, provider provenance).
- **Data Migration:** Bump Dexie version. Backfill existing tracks with minimal metadata:
  - `title: track.title`
  - `originalMime`: existing media blob MIME when available
  - `parser: "manual"` for user-edited/import-legacy fallback
- **Constraints & Indexing:** No new index for Phase 1. Search joins are in-memory today; if metadata search becomes hot, add a derived lowercased search index table later.
- **Performance Impact:** Parser runs once per uploaded file, not in list render. Cover bytes remain out of `tracks` rows.
- **Privacy & Retention:** Embedded metadata can contain personal strings in home recordings. Store locally only; never log raw tag values, filenames, comments, lyrics, or cover bytes.

### 3.3 Data Relationship Diagram

```
DjSession.trackIds[] ─▶ Track.id
Track.blobId ─────────▶ MediaBlob(role:"media")
Track.coverBlobId ───▶ MediaBlob(role:"cover")
Track.mediaMetadata ─▶ normalized, small JSON payload on Track
```

---

## 4. API Design

### 4.1 API Endpoints

No MUZERO backend endpoints. This remains local-first.

| Endpoint | Method | Description |
|----------|--------|-------------|
| Tauri command `export_track_with_metadata` | IPC | Desktop-only: receive media bytes/metadata/cover, return rewritten bytes or write directly to chosen path. |

### 4.2 Request/Response Examples

```typescript
interface ExportTrackWithMetadataInput {
  mediaBytes: Uint8Array;
  mime: string;
  fileName: string;
  metadata: TrackMediaMetadata;
  cover?: { bytes: Uint8Array; mime: string };
  mode: "original" | "withMetadata";
}
```

### 4.3 Error Handling

- Parser unsupported format: import still succeeds using filename/duration fallback; show a non-blocking warning only when the file is playable but tag parsing failed unexpectedly.
- Corrupt embedded cover: ignore cover, keep textual metadata, log only technical error class.
- Multiple tag sources: prefer normalized `common` tags; retain native tags only in dev diagnostics if explicitly needed, not by default.
- Export writer unsupported container: fall back to "Export Original" and explain that metadata embedding is not supported for this format yet.
- Save permission failure: show notification with copyable error details; do not delete or mutate stored media.

---

## 5. Frontend Design

### 5.1 Page Structure

No new page. The feature touches existing upload, list rows, Now Playing, and search surfaces.

### 5.2 UI Components

- **Track hover actions** (`src/components/library/track-row.tsx`):
  - Keep absolute hover action layer.
  - Show download action.
  - Phase 3 may convert the download icon into a small menu:
    - "Download original"
    - "Export with metadata"
- **Upload flow** (`src/stores/player-store.ts`):
  - Import parser should run alongside `probeMediaFile(file)`.
  - Use metadata title/artist/album for initial display; filename remains fallback.
- **Now Playing / dock identity**:
  - Subtitle should prefer `artist - album` for uploaded tracks when present.
  - Media Session metadata should use parsed title/artist/album/artwork when available.
- **Search/Gallery**:
  - `searchTracks` should match title, artists, album, albumArtist, genre, year, tags, memory notes.

### 5.3 State Management

- Do not put parsed metadata in Zustand. Store it in Dexie and read via `useLiveQuery`.
- Upload progress remains existing `isUploading`.
- Export progress can be local component state or notification loading state; no global hidden flags.

---

## 6. Implementation Plan

### Phase 0: Raw Media Download Button

**Goal:** Users can download the stored media file without metadata rewriting.

**Tasks:**
- [x] Add hover-row download action.
- [x] Add platform helper that uses Tauri save dialog + fs writeFile on desktop.
- [x] Browser fallback uses object URL download.
- [x] Preserve original media bytes; no container rewriting in this phase.

### Phase 0 Checklist

- [x] Typecheck passes.
- [x] Row hover actions remain absolute and do not consume row layout width.
- [x] Download failure shows an in-app notification.

### Phase 1: Import-Time Metadata Parser

**Goal:** Uploaded audio/video files populate MUZERO track metadata from embedded file tags.

**Tasks:**
- [x] Add `music-metadata` dependency.
- [x] Create `src/lib/media-metadata.ts` with `parseUploadedMediaMetadata(file)`.
- [x] Map normalized fields from `metadata.common` and `metadata.format` into `TrackMediaMetadata`.
- [x] Extract first suitable embedded cover image into `mediaBlobs(role:"cover")`.
- [x] Update `createUploadedTrack` input to accept `mediaMetadata` and optional cover blob.
- [x] Keep filename-derived title fallback.
- [ ] Add fake-indexeddb integration tests for MP3/M4A/FLAC fixture imports.

### Phase 1 Checklist

- [ ] MP3 ID3 title/artist/album/cover import correctly.
- [ ] M4A/MP4 title/artist/album/cover import correctly.
- [ ] FLAC Vorbis title/artist/album/cover import correctly.
- [x] Unsupported/corrupt tags do not block playable file import.
- [ ] No raw tag values are logged.

### Phase 2: Library Metadata Surface Area

**Goal:** Parsed metadata improves display, search, and platform playback UI.

**Tasks:**
- [x] Update `trackSubtitle` to prefer artist/album for uploaded tracks.
- [x] Update search to include artist, album, albumArtist, genre, year.
- [x] Feed recent track artist/album/genre into DJ context without provider leakage.
- [x] Set `navigator.mediaSession.metadata` when available using title/artist/album/artwork.
- [ ] Add metadata fields to annotation editor only if users need manual correction.
- [x] Round-trip normalized `Track.mediaMetadata` through R2 set indexes and remote search catalog rows.

### Phase 2 Checklist

- [x] Imported track with `artist` shows artist in dock/list subtitle.
- [x] Search by artist/album/genre returns expected tracks.
- [x] Platform media controls show title/artist/album/artwork where supported.
- [x] DJ context tests cover imported metadata.

### Phase 3: Metadata-Correct Export Pipeline

**Goal:** Users can choose between byte-perfect original download and metadata-correct export.

**Tasks:**
- [ ] Define export modes:
  - `original`: raw stored Blob bytes, unchanged.
  - `withMetadata`: write current MUZERO title/artist/album/cover/tags into the media container.
- [ ] Add Tauri Rust command using `lofty` or an equivalent audited writer.
- [ ] Implement container mapping:
  - MP3: ID3v2.3/2.4 frames (`TIT2`, `TPE1`, `TALB`, `TRCK`, `TCON`, `APIC`).
  - M4A/MP4: iTunes-style `ilst` atoms.
  - FLAC/Ogg/Opus: Vorbis comments + picture block where supported.
  - WAV/AIFF: RIFF/ID3 path only if writer support is reliable; otherwise original-only.
- [ ] Generated tracks export with `TrackBrief.title`, caption/lyrics where supported, and MUZERO cover.
- [ ] Add validation tests: export then re-parse with parser and compare expected fields.

### Phase 3 Checklist

- [ ] "Download original" byte size/hash matches stored `mediaBlobs` bytes.
- [ ] "Export with metadata" round-trips title/artist/album/cover for MP3.
- [ ] "Export with metadata" round-trips title/artist/album/cover for M4A/MP4.
- [ ] "Export with metadata" round-trips title/artist/album/cover for FLAC.
- [ ] Unsupported container fallback is explicit and non-destructive.

---

## 7. Out of Scope

- Online metadata lookup from MusicBrainz/Discogs/Apple/Spotify. This PRD only reads/writes embedded file metadata.
- Automatic acoustic fingerprinting.
- Re-encoding/transcoding media.
- Hidden backend flags or remote metadata services.
- Writing metadata into read-only remote stream imports unless the user caches/imports them locally first.

---

## 8. Security Considerations

- **Authentication:** None; local device data only.
- **Authorization:** Tauri file writes must be user-initiated through save dialog.
- **Data Protection:** Metadata and covers stay in IndexedDB and exported files only.
- **Audit Logging:** Log parser/export technical failures only; redact tag values, filenames, lyrics, comments, cover bytes.
- **Dependency Risk:** `music-metadata` is now a runtime import dependency for browser-side tag parsing; Phase 3 metadata writers such as `lofty` still require explicit license and binary-size review before implementation.

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [AI DJ Foundation PRD](../20260606-muzero-ai-dj-foundation-prd/20260606-muzero-ai-dj-foundation-prd.md) | Original media/download future phase context. |
| [Set Playqueue Memory Data Model PRD](../20260607-muzero-set-playqueue-memory-data-model-prd/20260607-muzero-set-playqueue-memory-data-model-prd.md) | Track/blob/cover/memory data model. |
| [R2 Cloud Drive Sync PRD](../20260609-muzero-r2-cloud-drive-sync-prd/20260609-muzero-r2-cloud-drive-sync-prd.md) | Remote metadata and media sync context. |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | Should `artist` be first-class on `Track` or only inside `mediaMetadata`? | Open | Prefer `mediaMetadata` initially to avoid table churn; derive display/search from it. |
| 2 | Do user memory tags (`Track.tags`) get embedded into exported genre/comment fields? | Open | Likely export `tags` to genre only when user opts into "with metadata". |
| 3 | Should browser builds support metadata rewriting through WASM TagLib? | Open | Desktop first; consider only after bundle/license/perf review. |
| 4 | Which ID3 version should MUZERO write by default? | Open | Need compatibility matrix; ID3v2.3 may be more widely tolerated, ID3v2.4 is the newer spec. |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-09 | MUZERO | Initial draft from hover download + metadata import/export architecture review. |
| 2026-06-09 | MUZERO | Phase 1 implementation started: `music-metadata` parser bridge, `Track.mediaMetadata`, embedded-cover import, subtitle/search use, and R2 metadata round-trip added. |
| 2026-06-09 | MUZERO | Phase 2 DJ context completed: recent imported artist/album/genre/year metadata is passed into DJ prompts without provider leakage. |
| 2026-06-09 | MUZERO | Phase 2 Media Session completed: platform playback metadata now uses imported title/artist/album and local or remote artwork. |
