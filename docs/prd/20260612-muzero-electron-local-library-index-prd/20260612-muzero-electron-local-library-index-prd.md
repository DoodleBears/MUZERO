# PRD: MUZERO Electron Local Library Index

**Status:** Final
**Created:** 2026-06-12
**Author:** Codex
**Module:** Electron / Local Library Import / Playback / R2 Sync - native indexed local-file library

> This PRD records the Electron-specific follow-up to the progressive bulk import work. The product decision is to stop treating every desktop import as "copy all bytes into MUZERO storage first". Electron desktop should index user-picked local files, play them by reference, and upload/copy bytes only when the user explicitly needs cloud sync, local cache, conversion, or repair.

---

## Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | PRD + LyciaMusic Reference Grounding | ✅ Completed | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | TDD Contract Coverage | 🔲 Pending | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | Electron SQLite Library Index | 🔲 Pending | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | Local-File Track Import Path | 🔲 Pending | [Phase 4 Checklist](#phase-4-checklist) |
| 5 | Local-File Playback Protocol | 🔲 Pending | [Phase 5 Checklist](#phase-5-checklist) |
| 6 | R2 Upload-On-Demand From Local File | 🔲 Pending | [Phase 6 Checklist](#phase-6-checklist) |
| 7 | Lazy Cover Cache + Repair UX | 🔲 Pending | [Phase 7 Checklist](#phase-7-checklist) |
| 8 | Verification + Completion | 🔲 Pending | [Phase 8 Checklist](#phase-8-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

The first fix for 6000+ imports made successfully ingested tracks visible in bounded batches. That solves "already imported songs cannot be played until the whole batch ends", but it does not solve the bigger desktop bottleneck: Electron currently reads each source file into memory, sends the bytes across IPC, parses metadata in the renderer worker, writes a persistent `mediaBlobs` row, and only then considers the track playable.

For a large existing library this is unnecessary work. A local desktop music player can keep the user's file where it already is, store only metadata and a verified path/fingerprint, and stream the original file at playback time. R2 sync can upload the file later from the same source path when the user chooses to publish or sync.

### 1.2 User-Confirmed Decisions

| # | Decision | Product Requirement |
|---|----------|---------------------|
| 1 | Reference local files first; sync to R2 only when upload is needed. | Plaintext local audio/video imports on Electron should not copy bytes into `mediaBlobs` by default. |
| 2 | Keep progressive publishing reasonable. | Tracks discovered/imported by the native scanner should appear in the set in batches while the scan continues. |
| 3 | Keep expensive work off the initial critical path. | Metadata parsing, hashing, and cover extraction must be bounded, parallelized, and resumable; first visible/playable rows should not wait for embedded artwork. |
| 4 | Use an Electron-native approach; SQLite is acceptable. | Add an Electron main-process SQLite library index for high-volume path/metadata/diff state. Dexie remains MUZERO's app state. |
| 5 | Keep lazy cache behavior. | Covers, R2 uploads, and optional local byte copies happen only on demand or in bounded background jobs. |

### 1.3 Target Users

| Role | Description | Permissions |
|------|-------------|-------------|
| Desktop music collector | Has thousands of local audio/video files already organized on disk. | Pick folders/files, play referenced media, rescan libraries. |
| Cloud-drive owner | Publishes selected local sets to their own R2 bucket. | Upload from local source files only when sync is requested. |
| Offline-first listener | Wants local playback without hidden backend work. | Play available local files without cloud or full-byte duplication. |

### 1.4 Core Value

1. **Fast library adoption:** A 6000+ song folder can become browsable/playable from metadata and path references instead of waiting for full media-byte duplication.
2. **Lower disk and memory pressure:** MUZERO avoids storing a second copy of files that already live on the user's disk.
3. **Better sync economics:** R2 uploads are explicit and on demand; the first local import does not trigger cloud writes.
4. **Electron-appropriate architecture:** Main process owns filesystem, SQLite, local streaming, and upload streams; renderer owns UI, Dexie app state, and player orchestration.
5. **Local-first remains true:** Absolute source paths, SQLite indexes, and credentials remain device-local and are never exported into public R2 manifests.

---

## 2. Best Practice Grounding

### 2.1 LyciaMusic Reference

The reference project is fast because it treats import as native library indexing, not byte ingestion.

| Source | Observed Pattern | MUZERO Decision |
|--------|------------------|-----------------|
| [LyciaMusic `playerLibraryManager.ts`](https://github.com/Billy636/LyciaMusic/blob/main/src/composables/playerLibraryManager.ts) | Frontend adds a folder and calls native scan, rather than reading every file into the web layer. | Electron renderer should call a native scan API and receive batches of metadata rows. |
| [LyciaMusic scanner orchestrator](https://github.com/Billy636/LyciaMusic/blob/main/src-tauri/src/music/scanner/orchestrator.rs) | Scan work is moved off the UI path with native blocking/parallel work. | MUZERO Electron scanner should run in main process or Worker Thread, not the renderer. |
| [LyciaMusic scanner diff](https://github.com/Billy636/LyciaMusic/blob/main/src-tauri/src/music/scanner/diff.rs) | Diffing uses path, extension, modified time, and size before deeper parsing. | SQLite should store path + size + mtime fingerprints and skip unchanged files. |
| [LyciaMusic scanner repository](https://github.com/Billy636/LyciaMusic/blob/main/src-tauri/src/music/scanner/repository.rs) | Database writes are batched and progress is emitted in chunks. | MUZERO should batch SQLite upserts and Dexie set membership updates. |
| [LyciaMusic cover cache](https://github.com/Billy636/LyciaMusic/blob/main/src-tauri/src/music/covers.rs) | Cover extraction/cache is lazy and separate from first scan. | MUZERO should not block initial import on embedded cover bytes. |
| [LyciaMusic player library batch](https://github.com/Billy636/LyciaMusic/blob/main/src/composables/playerLibraryBatch.ts) | UI batches library events instead of rerendering per file. | MUZERO should emit scan/import batches, not one UI mutation per discovered path. |

### 2.2 Current MUZERO Bottlenecks

| Current Code | Behavior | Required Change |
|--------------|----------|-----------------|
| `electron/ipc.cjs` `muzero:readFile` | Reads a full file into a `Buffer`, returns an `ArrayBuffer` through IPC. | Keep only as compatibility fallback; do not use for Electron plaintext library indexing. |
| `src/lib/folder-import.ts` `FolderFs.readFile` | Folder import API requires whole-file bytes. | Add a native scan/index path that does not require `readFile` for every file. |
| `src/stores/player-store.ts` folder import loop | Reads bytes, calls `ingestViaWorker`, writes media bytes, then publishes. | For Electron plaintext files, create ready tracks from indexed metadata and `sourcePath`. |
| `src/streamsrc/source-detect.ts` | Playback source priority is `blob -> remote -> stream -> none`. | Add `local-file` as a first-class source between `blob` and `remote`. |
| `src/sync/r2-export-plan.ts` | Export media objects only from `Track.blobId` / `mediaBlobs`. | Add a binary resolver that can stream from a validated local source path on Electron. |
| `src/sync/r2-s3.ts` | SigV4 signing hashes `BodyInit` by materializing bytes. | Add precomputed/streaming payload hash support for local-file uploads. |

### 2.3 Design Principle

Use **index first, bytes later**:

- Initial Electron import stores path identity, file fingerprint, basic metadata, and set membership.
- Playback streams the original local file through an allowlisted Electron protocol.
- `mediaBlobs` remains for generated tracks, converted files, user-authored covers/memories, explicit offline copies, remote cache, and fallback web/Tauri imports.
- R2 sync resolves media bytes from `blobId` first, then from `sourcePath` when the local file is still available and upload is requested.
- Covers and hashes are derived artifacts and can be computed lazily.

---

## 3. System Architecture

### 3.1 Architecture Overview

```
user picks folder/file
  -> Electron main process validates/grants real path
  -> native scanner walks files and diffs path + size + mtime
  -> SQLite library index stores filesystem metadata + parsed tags
  -> renderer receives scan batches
  -> Dexie creates Track rows with sourcePath/local fingerprint and set membership
  -> player resolves sourceKind "local-file"
  -> Electron local-media protocol streams original file with Range support
  -> R2 publish, when requested, streams the same local file to the user's bucket
```

### 3.2 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Electron native shell | Existing Electron main/preload/bridge | Current desktop target; main process already owns filesystem allowlists and privileged protocols. |
| Local app state | Dexie / IndexedDB `muzero-db` | Continues to own tracks, sets, annotations, memories, settings, sync state. |
| Native library index | SQLite in Electron user data | High-volume path metadata, diffing, scan checkpoints, and lazy derived artifacts belong close to the filesystem. |
| Scanner execution | Electron main process Worker Thread or dedicated module | Avoid renderer IPC byte transfer and UI jank. |
| Metadata parser | `music-metadata` in Electron context where practical | Existing parser, but run against file paths/streams instead of renderer `Blob`s for plaintext files. |
| Local playback | Electron custom protocol or `muzfetch://local-media` handler | Lets media elements stream local files with Range/206 and no renderer path access. |
| R2 upload | Existing R2 sync engine plus Electron local-file body resolver | Preserve manifest protocol while avoiding full local file materialization. |
| Tests | Vitest + fake-indexeddb + mocked Electron scanner/SQLite repos | TDD coverage before implementation. |

### 3.3 SQLite Scope Decision

SQLite is approved for Electron, but it must be scoped carefully:

- **SQLite owns derived filesystem facts:** source path, root folder, size, mtime, scan status, parse status, parsed tags, optional content hash, lazy cover cache path, last seen time.
- **Dexie owns user-authored app state:** `Track`, `DjSession`, tags, liked state, memories, manual cover, sync mutations, settings, playback stats.
- **No dual ownership of annotations:** tags, notes, memories, cover choices, likes, ranks, and set membership do not move to SQLite.
- **No R2 export of absolute paths:** SQLite path data is local-only and never appears in remote manifests or share links.

SQLite package decision:

| Option | Decision |
|--------|----------|
| `node:sqlite` | Evaluate first only if the Electron-bundled Node runtime exposes a stable API in the packaged app. |
| `better-sqlite3` | Default fallback if `node:sqlite` is unavailable or unstable. Run DB access in a Worker Thread or bounded main-process jobs to avoid blocking UI-facing IPC. |
| Renderer IndexedDB only | Rejected for the high-volume scanner index because it would keep large scan/diff traffic in the renderer. |

### 3.4 Project Structure

```
electron/
├── ipc.cjs                         # add library scan, local-media URL, local-file upload IPC
├── main.cjs                        # register local-media protocol
├── library-index.cjs               # SQLite repository, schema, migrations
├── library-scanner.cjs             # native filesystem walk + metadata parse orchestration
└── local-media-protocol.cjs        # validated Range streaming from sourcePath

src/
├── lib/
│   ├── desktop/
│   │   ├── bridge.ts               # add Electron library/local-file capabilities
│   │   └── electron.ts             # renderer bridge methods
│   └── folder-import.ts            # fallback byte-ingest path remains
├── streamsrc/
│   └── source-detect.ts            # add playback source kind "local-file"
├── stores/
│   └── player-store.ts             # load local-file source into MediaEngine
├── sync/
│   ├── r2-export-plan.ts           # binary object resolver: blobId or local file
│   ├── r2-publish.ts               # publish local-file bodies without full buffering
│   └── r2-s3.ts                    # precomputed payload hash support
└── db/
    ├── types.ts                    # additive local-file fingerprint fields if needed
    └── repositories.ts             # create referenced uploaded tracks
```

---

## 4. Data Model Design

### 4.1 Core Concepts

```
SQLite local_library_files.path
  -> Dexie Track.sourcePath
  -> playback source "local-file"
  -> Electron local-media token/protocol
  -> optional R2 object upload
```

### 4.2 Dexie Track Changes

Current `Track.sourcePath` already stores the absolute on-disk path and is used as a folder-sync dedupe key. This PRD should reuse it before adding schema churn.

Required additive fields, only if implementation needs stale-file detection beyond SQLite:

```typescript
interface Track {
  sourcePath?: string;
  localFile?: {
    size: number;
    mtimeMs: number;
    indexedAt: number;
    missingAt?: number;
  };
}
```

Rules:

- Electron plaintext local imports may be `status: "ready"` with `sourcePath` and no `blobId`.
- `blobId` still wins when present because it represents an app-managed local copy/cache.
- Generated tracks continue to require `blobId`.
- `.ncm` and other containers that must be converted/decrypted before native playback continue through the byte-ingest path and produce `blobId`.
- Web/Tauri imports continue using the existing `mediaBlobs` path until they get a separate native-file-reference design.

### 4.3 SQLite Schema

SQLite database path: Electron `app.getPath("userData")/library-index.sqlite`.

```sql
CREATE TABLE local_library_files (
  path TEXT PRIMARY KEY,
  root_path TEXT NOT NULL,
  name TEXT NOT NULL,
  ext TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('audio', 'video')),
  size INTEGER NOT NULL,
  mtime_ms INTEGER NOT NULL,
  inode_key TEXT,
  title TEXT,
  artist TEXT,
  album TEXT,
  album_artist TEXT,
  duration_sec REAL,
  genre_json TEXT,
  year INTEGER,
  track_no INTEGER,
  disc_no INTEGER,
  bitrate INTEGER,
  sample_rate INTEGER,
  channels INTEGER,
  parser TEXT,
  parsed_at INTEGER,
  parse_error TEXT,
  sha256 TEXT,
  sha256_at INTEGER,
  cover_cache_key TEXT,
  cover_cached_at INTEGER,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  missing_at INTEGER
);

CREATE INDEX idx_local_library_root_last_seen
  ON local_library_files(root_path, last_seen_at);

CREATE INDEX idx_local_library_fingerprint
  ON local_library_files(root_path, size, mtime_ms);
```

Notes:

- `sha256` is nullable and lazy. It is not required for first import or playback.
- `cover_cache_key` points to an Electron user-data cache file, not a user-authored MUZERO cover.
- `missing_at` supports repair/rescan UX without deleting user annotations in Dexie.

### 4.4 Relationship Diagram

```
Dexie importFolders.path ─────────┐
                                  ▼
SQLite local_library_files.root_path
                                  │
                                  ▼
Dexie Track.sourcePath ── optional Track.localFile fingerprint
      │
      ├── Track.blobId present      -> mediaBlobs / media storage provider
      ├── Track.sourcePath present  -> Electron local-file protocol
      └── Track.remoteMediaUrl      -> R2/shared remote playback
```

### 4.5 Migration Strategy

- Existing tracks with `blobId` remain unchanged.
- Existing folder-imported tracks that already have `sourcePath` can be backfilled into SQLite during a rescan without deleting their `blobId`.
- New Electron plaintext imports use referenced local files by default.
- If the original source file is missing, the track remains in Dexie with annotations intact and is surfaced as "needs file repair" rather than deleted.
- Rollback is `git revert`; no hidden runtime flag. If schema fields were added to Dexie, they are additive and readers must tolerate absence.

---

## 5. Native API Design

### 5.1 DesktopBridge Additions

```typescript
interface LocalLibraryScanRequest {
  rootPath: string;
  setId: string;
  batchSize?: number;
}

interface LocalLibraryFileRow {
  path: string;
  name: string;
  kind: "audio" | "video";
  size: number;
  mtimeMs: number;
  durationSec?: number;
  mediaMetadata?: TrackMediaMetadata;
  parseError?: string;
}

interface LocalMediaUrlRequest {
  path: string;
  trackId: string;
  mime: string;
}

interface DesktopBridge {
  scanLocalLibraryFolder?: (
    input: LocalLibraryScanRequest,
    onBatch: (rows: LocalLibraryFileRow[]) => void,
  ) => Promise<LocalLibraryScanSummary>;
  cancelLocalLibraryScan?: (scanId: string) => Promise<void>;
  localMediaUrl?: (input: LocalMediaUrlRequest) => Promise<string>;
  statLocalFile?: (path: string) => Promise<{ size: number; mtimeMs: number } | null>;
}
```

### 5.2 Electron IPC / Protocol

| IPC / Protocol | Direction | Description |
|----------------|-----------|-------------|
| `muzero:library:scanFolder` | renderer -> main | Starts or resumes a native scan for a granted folder. |
| `muzero:library:cancelScan` | renderer -> main | Cancels a scan job. |
| `muzero:library:scanBatch` | main -> renderer | Emits bounded batches of indexed files. |
| `muzero:localMediaUrl` | renderer -> main | Returns a short-lived tokenized URL for an allowlisted local file. |
| `muzlocal://media/<token>` or `muzfetch://local-media/<token>` | media element -> main | Streams the local file with Range support. |
| `muzero:r2:putLocalFileObject` | renderer -> main | Optional Electron-only uploader for streaming local files to R2. |

Security requirements:

- Renderer never receives arbitrary filesystem read power.
- Local media URLs must be short-lived tokens mapped in main process to real paths.
- Main process validates `realpath` against granted roots before scanning, playback, hashing, or upload.
- Token URLs must not include raw absolute paths.
- Logs use path hashes/basenames only when possible; no secrets or full user paths in diagnostics.

### 5.3 Error Handling

| Error | Behavior |
|-------|----------|
| File missing at playback | Mark the track as unavailable/repair-needed in UI; keep metadata and annotations. |
| File changed since scan | Re-stat; if size/mtime differs, rescan metadata before playback/upload when practical. |
| Scanner parse error | Create a playable row if extension/kind is supported and file exists; store parse error for diagnostics. |
| R2 upload source missing | Skip the media object, show sync item as "needs local file", and do not publish a manifest entry pointing to a missing object. |
| SQLite unavailable | Fall back to existing byte-ingest path with a visible warning in diagnostics; do not silently discard imports. |

---

## 6. Frontend Design

### 6.1 Import UX

No new import surface is required for v1. Existing folder/file import UI should use the Electron fast path automatically when:

- runtime is Electron,
- source has a stable local path,
- file type is plaintext audio/video and playable by Chromium/Electron,
- source path is inside a user-granted root or explicitly selected file.

Fallback to current byte-ingest path when:

- runtime is web/Tauri,
- the source file has no stable path,
- file requires local conversion/decryption,
- local-file protocol cannot play the container,
- SQLite/native scanner initialization fails.

### 6.2 Track Row / Playback UX

Existing rows should remain visually simple. Required states:

- Ready local file: playable like any local track.
- Local file missing: show a repair/unavailable affordance and keep annotations visible.
- Sync pending: if R2 upload needs the local file, show it in the sync progress/error surface.

Do not add hidden settings. If a runtime toggle is needed for users, expose it in Settings as an explicit "Local file references" desktop behavior with clear consequences.

### 6.3 State Management

- Dexie `useLiveQuery` continues to drive visible library and set rows.
- SQLite scan events are batched before Dexie writes.
- Zustand must not store large scan result arrays or native singletons.
- Search should consume Dexie track metadata; SQLite remains implementation detail unless a future search PRD explicitly moves high-volume search indexing native.

---

## 7. R2 Sync Design

### 7.1 Binary Resolution Order

For each track media object during export:

1. If `track.blobId` exists, resolve through `resolveMediaBlob` and upload app-managed bytes.
2. Else if Electron runtime has `track.sourcePath`, validate and stream the local source file.
3. Else if the track is streamed/external and has enough source identity, publish metadata without media bytes according to the existing streamed-source rules.
4. Else skip the track media object and surface a sync error.

This preserves local-first priority:

```
blob/cache -> local-file -> remoteMediaUrl -> external stream -> none
```

### 7.2 Local-File Upload Body

Extend the export/publish pipeline to represent local file bodies without materializing them:

```typescript
type R2ExportBody =
  | string
  | Blob
  | {
      kind: "local-file";
      path: string;
      bytes: number;
      mime: string;
      sha256?: string;
    };
```

Implementation requirements:

- `sha256` may be computed lazily in a streaming pass and cached in SQLite.
- `r2-s3` signing must accept a precomputed payload hash so signing does not call `arrayBuffer()` on a whole local file.
- Electron upload should stream from disk in main process or an Electron-safe streaming bridge.
- Do not upload source paths or local fingerprints into the R2 manifest.
- After a successful upload, the remote manifest carries only the content-addressed object key, MIME, bytes, and hash, same as existing media objects.

### 7.3 Sync Semantics

- Importing local files does not auto-upload to R2.
- Existing user-controlled sync mode decides when publish runs.
- If a local-file track was already uploaded and the `sha256` matches a known R2 object, skip re-upload.
- If the file changed, treat it as a new content-addressed media object and publish updated metadata only when the user syncs.
- A read-only subscriber never sees the publisher's absolute path.

---

## 8. Implementation Plan

### Phase 1: PRD + LyciaMusic Reference Grounding

**Goal:** Record the Electron-local-file architecture and the confirmed product decisions.

**Tasks:**
- [x] Review current Electron bridge, IPC, playback source, folder import, and R2 export paths.
- [x] Record LyciaMusic implementation patterns that explain the performance difference.
- [x] Create this PRD.

### Phase 1 Checklist

- [x] PRD status set to Final.
- [x] Local-file reference, R2 upload-on-demand, and SQLite decisions recorded.
- [x] No implementation changes mixed into the PRD commit.

### Phase 2: TDD Contract Coverage

**Goal:** Add failing tests for the new behavior before implementation.

**Tasks:**
- [ ] Add source selection tests for `blob -> local-file -> remote -> stream -> none`.
- [ ] Add repository tests for creating uploaded tracks with `sourcePath` and no `blobId`.
- [ ] Add R2 export-plan tests for local-file media resolution and missing source skip/error behavior.
- [ ] Add Electron bridge unit tests for local media URL token shape and path redaction.

### Phase 2 Checklist

- [ ] Tests fail against current implementation.
- [ ] Tests do not require real user files, real R2, or a GUI Electron window.
- [ ] PRD is updated before the test commit.

### Phase 3: Electron SQLite Library Index

**Goal:** Add the native index and scanner foundation.

**Tasks:**
- [ ] Add SQLite library index module with migrations and batched upserts.
- [ ] Add scanner diff by path, extension, size, mtime, and missing files.
- [ ] Add metadata parsing from file path/stream without embedded cover extraction on the fast path.
- [ ] Add cancellation and bounded batch events.

### Phase 3 Checklist

- [ ] Scanner can index a mocked 6000-file tree without full-byte IPC.
- [ ] Unchanged files are skipped by fingerprint.
- [ ] SQLite errors are surfaced through diagnostics and import UI.
- [ ] PRD is updated before commit.

### Phase 4: Local-File Track Import Path

**Goal:** Create ready Dexie tracks from SQLite batches without copying media bytes.

**Tasks:**
- [ ] Add repository helper for referenced uploaded tracks.
- [ ] Route Electron plaintext imports through native scan batches.
- [ ] Keep `.ncm`/conversion-required files on the existing byte-ingest path.
- [ ] Preserve progressive set membership publishing.

### Phase 4 Checklist

- [ ] New Electron plaintext tracks have `sourcePath` and no `blobId` by default.
- [ ] Existing web/Tauri import behavior remains unchanged.
- [ ] Folder sync dedupe still uses source path correctly.
- [ ] PRD is updated before commit.

### Phase 5: Local-File Playback Protocol

**Goal:** Make referenced local files playable through Electron without exposing arbitrary paths.

**Tasks:**
- [ ] Add playback source kind `local-file`.
- [ ] Add Electron tokenized local media protocol with Range/206 support.
- [ ] Update `MediaEngine` loading path to accept local media URLs.
- [ ] Surface missing/changed file states.

### Phase 5 Checklist

- [ ] Audio and video local-file tracks play without `mediaBlobs`.
- [ ] Seeking works for large files.
- [ ] Raw absolute paths are not present in media element URLs.
- [ ] PRD is updated before commit.

### Phase 6: R2 Upload-On-Demand From Local File

**Goal:** Publish referenced local-file tracks to R2 only when sync is requested.

**Tasks:**
- [ ] Extend R2 export body model for local files.
- [ ] Add streaming sha256 computation and SQLite hash cache.
- [ ] Add precomputed payload hash support to R2 signing.
- [ ] Add Electron local-file uploader or streaming bridge.
- [ ] Add sync errors for missing local sources.

### Phase 6 Checklist

- [ ] R2 publish can upload a local-file track without first creating `mediaBlobs`.
- [ ] Public manifests do not contain absolute paths.
- [ ] Existing blob-backed generated/uploaded tracks still publish.
- [ ] PRD is updated before commit.

### Phase 7: Lazy Cover Cache + Repair UX

**Goal:** Keep initial import fast while giving users artwork and repair tools after the fact.

**Tasks:**
- [ ] Add lazy embedded cover extraction into Electron cache.
- [ ] Store derived cover cache refs separately from user-authored `coverBlobId`.
- [ ] Add repair/rescan affordance for missing local files.
- [ ] Ensure manual cover/memory photos still use `mediaBlobs` and sync normally.

### Phase 7 Checklist

- [ ] Initial scan does not block on embedded artwork.
- [ ] Cover extraction is bounded and cancellable.
- [ ] Missing-file repair preserves tags, memories, likes, and set ranks.
- [ ] PRD is updated before commit.

### Phase 8: Verification + Completion

**Goal:** Prove the feature against performance, correctness, and sync requirements.

**Tasks:**
- [ ] Run targeted unit/integration tests.
- [ ] Run full `pnpm test` and `pnpm build`.
- [ ] Measure a synthetic 6000-file import in Electron.
- [ ] Update PRD status to Completed after implementation.

### Phase 8 Checklist

- [ ] 6000-file import shows playable rows within 5 seconds on a normal desktop SSD-class machine, with full metadata/backfill allowed to continue.
- [ ] Initial import does not copy all media bytes into `mediaBlobs`.
- [ ] Peak renderer memory does not scale with total imported media bytes.
- [ ] R2 publish uploads referenced local files on demand.
- [ ] Final PRD update is committed after verification.

---

## 9. Out of Scope

- Replacing Dexie with SQLite for all MUZERO app state.
- Mobile/Tauri local-file reference parity.
- A hosted MUZERO backend or hidden cloud worker.
- Automatically uploading every imported song to R2.
- Exposing absolute local paths in public manifests/share links.
- Decrypting DRM/encrypted store formats beyond the already-supported `.ncm` path.
- Moving user annotations, memories, set ranks, or settings into SQLite.

---

## 10. Security Considerations

- **Authentication:** No account system is introduced.
- **Authorization:** Files are accessible only after user selection or persisted import-folder re-grant. Main process validates `realpath` against the granted roots.
- **Data Protection:** Absolute paths and SQLite scan metadata stay device-local. R2 manifests never include source paths.
- **Credential Discipline:** R2 keys remain in local settings and are not logged, embedded in URLs, or sent to any MUZERO server.
- **Protocol Safety:** Local media URLs are tokenized, short-lived, and pathless.
- **Logging:** Diagnostics may include track ids, byte counts, MIME, status, and path hashes; avoid raw absolute paths.
- **Rollback:** Use `git revert`; do not hide this behind `localStorage`, URL flags, or `window.*` toggles.

---

## 11. Related Documents

| Document | Description |
|----------|-------------|
| [Progressive Bulk Import Playback PRD](../20260612-muzero-progressive-bulk-import-playback-prd/20260612-muzero-progressive-bulk-import-playback-prd.md) | Immediate visibility for imported batches; this PRD builds on it with local-file references. |
| [OPFS Persistent Media Storage PRD](../20260612-muzero-opfs-persistent-media-storage-prd/20260612-muzero-opfs-persistent-media-storage-prd.md) | Existing app-managed media-byte storage abstraction. |
| [R2 Cloud Drive Sync PRD](../20260609-muzero-r2-cloud-drive-sync-prd/20260609-muzero-r2-cloud-drive-sync-prd.md) | Existing R2 manifest/export/publish protocol that needs local-file body resolution. |
| [LyciaMusic](https://github.com/Billy636/LyciaMusic) | Reference project for fast native library indexing. |

---

## 12. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | Should SQLite use `node:sqlite` or `better-sqlite3`? | Open | Evaluate Electron packaged runtime first; default to `better-sqlite3` if built-in SQLite is unavailable or unstable. |
| 2 | Should local-file source outrank `blobId`? | Resolved | No. `blobId` remains highest priority because it is app-managed and repairable by MUZERO. Local-file comes next. |
| 3 | Should plaintext imports ever copy bytes automatically? | Resolved | No by default. Copy only for explicit local cache/export/conversion flows or fallback runtimes. |
| 4 | Should embedded cover bytes be stored as `coverBlobId` automatically? | Resolved | Not on the fast path. Lazy extracted artwork is a derived cache; user-selected memory/cover photos still use `mediaBlobs`. |
| 5 | Can R2 upload read the whole local file into memory if streaming is hard? | Resolved | No for the Electron fast path. The feature goal requires streaming or bounded chunking. |

---

## 13. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-12 | Codex | Created PRD documenting Electron local-file references, SQLite index, local playback protocol, and R2 upload-on-demand. |
