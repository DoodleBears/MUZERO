# PRD: Runtime Persistent Media Storage

**Status:** Draft
**Created:** 2026-06-12
**Author:** MUZERO
**Module:** Storage / Player / Sync — abstract permanent media byte storage so Browser can use OPFS and Electron can use a real local-disk media directory while preserving `Track.blobId` semantics.

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | Storage Adapter + Dual-Read Contract | ✅ Completed | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | Permanent Media Write Path | ✅ Completed | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | Playback, Export, and Import Consumers | ✅ Completed | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | Migration, Repair, and Cleanup | ✅ Completed | [Phase 4 Checklist](#phase-4-checklist) |
| 5 | Settings Visibility + Storage Health | 🔲 Pending | [Phase 5 Checklist](#phase-5-checklist) |
| 6 | Large Image Asset Storage | 🔲 Pending | [Phase 6 Checklist](#phase-6-checklist) |
| 7 | Cover + Memory Photo Provider Storage | 🔲 Pending | [Phase 7 Checklist](#phase-7-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

MUZERO keeps hot list data in `tracks` / `sessions` and stores binary payloads separately in `mediaBlobs`. Today `MediaBlob` is a Dexie / IndexedDB row with a `blob: Blob` field:

- `Track.blobId` points to a `mediaBlobs` row for playable audio/video bytes.
- `Track.coverBlobId`, `DjSession.coverBlobId`, `Memory.photoBlobId`, `DeviceRecord.avatarBlobId`, and gallery/background rows also point to `mediaBlobs`.
- Player local-first playback resolves `Track.blobId` via `getTrackBlob()` and calls `mediaEngine.loadBlob(...)`.
- R2 sync export reads `mediaBlob.blob` to hash and upload binary objects.

Recent R2/cloud playback work introduced an OPFS-first LRU cache for remote playback. That cache is intentionally evictable. Permanent user media remains in IndexedDB Blob rows. For large uploaded/generated/downloaded audio/video, IndexedDB Blob storage can increase deserialization cost, memory pressure, and quota fragility.

The right product boundary is not "always OPFS". It is a permanent media storage abstraction:

- **Browser:** use OPFS as the managed private byte store, with IndexedDB Blob fallback.
- **Electron desktop:** use a real local-disk media directory, either app-managed by default or user-selected, with metadata in Dexie and file bytes on disk.
- **Fallback:** keep IndexedDB Blob for unsupported environments and legacy rows.

The lifecycle must preserve MUZERO's local-first behavior: permanent media must never be evicted by the playback-cache LRU.

### 1.2 Target Users

| Role | Description | Permissions |
|------|-------------|-------------|
| **Offline listener** | Imports, generates, or downloads songs and expects them to play without network access. | Can keep/delete local media explicitly. |
| **Large-library user** | Stores many audio/video files in MUZERO. | Needs stable playback without IndexedDB Blob bloat. |
| **Cloud sync user** | Publishes local media to R2 and imports cloud-backed sets across devices. | Needs export/import to work whether bytes live in IndexedDB or OPFS. |
| **Maintainer** | Evolves storage, player, and sync code. | Needs a single binary access abstraction instead of scattered `row.blob` reads. |

### 1.3 Core Value

1. **Better large-media storage fit**: audio/video and large image bytes are stored in the best available backend for the runtime: local disk on Electron, OPFS in Browser, IndexedDB as fallback.
2. **Clear storage semantics**: playback cache remains LRU-evictable; permanent media remains user-controlled and referenced by `Track.blobId`.
3. **Safer refactors**: one resolver API loads binary bytes for player, hooks, metadata, and R2 export.
4. **No data cliff**: existing IndexedDB Blob rows continue to read, and migrate lazily or through a visible maintenance flow.

---

## 2. System Architecture

### 2.1 Architecture Overview

```
Track.blobId / coverBlobId / Memory.photoBlobId
                 │
                 ▼
        Dexie mediaBlobs metadata
        id · trackId · role · mime · bytes
        storageBackend · storageKey · blob(fallback/legacy)
                 │
        ┌───────────────┬──────────────────┬──────────────┐
        ▼               ▼                  ▼              ▼
  Electron disk      Browser OPFS      IndexedDB Blob   Future native
  user/app folder    private files     legacy/fallback  Tauri/mobile
        │               │                  │
        └───────────────┴────────┬─────────┘
                 ▼
        media blob resolver API
                 │
   ┌─────────────┼──────────────┐
   ▼             ▼              ▼
 Player      R2 export       UI hooks
 loadBlob    hash/body       object URL
```

Remote playback cache remains a separate namespace:

```
playbackCache metadata + OPFS muzero-playback-cache/*
  └─ LRU, clearable, never writes Track.blobId

mediaBlobs metadata + MediaStorageProvider
  └─ user-controlled permanent/offline media, referenced by blob ids
```

### 2.2 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **Metadata DB** | Dexie / IndexedDB `mediaBlobs` | Existing local-first store, stable ids and indexes. |
| **Storage abstraction** | `MediaStorageProvider` | Hides runtime-specific byte storage behind one read/write/delete contract. |
| **Electron byte store** | Managed local-disk directory via Electron IPC | Lets desktop users keep media bytes as real files on disk, outside IndexedDB Blob cloning. |
| **Browser byte store** | OPFS via `navigator.storage.getDirectory()` | Origin-private file-like storage for browser/PWA usage. |
| **Fallback byte store** | IndexedDB Blob in `mediaBlobs.blob` | Keeps legacy rows readable and supports environments where OPFS is unavailable. |
| **Player** | Existing `MediaEngine.loadBlob()` | No media-engine rewrite; resolver still returns a Blob/File. |
| **Sync** | Existing R2 export/import pipeline | Binary object creation reads through resolver instead of directly from `MediaBlob.blob`. |

### 2.3 Project Structure

```
src/
├── db/
│   ├── types.ts                  # MediaBlob gains storage metadata
│   ├── muzero-db.ts              # no index change unless explicitly needed
│   ├── repositories.ts           # create/read/delete media through helpers
│   ├── media-blob-storage.ts     # resolver + provider selection
│   └── media-storage-provider.ts # provider contract + backend implementations
├── lib/
│   └── desktop/bridge.ts         # Electron adds managed media-file IPC
├── player/
│   └── playback-cache.ts         # reuses low-level OPFS helpers where possible
├── stores/
│   └── player-store.ts           # local blob playback remains first priority
├── streamsrc/
│   └── streamed-track-repo.ts    # streamed offline cache writes permanent media
├── sync/
│   ├── r2-export-plan.ts         # hash/body resolved through storage helper
│   └── r2-cache.ts               # imported remote media writes permanent media
└── hooks/
    └── use-media.ts              # object URLs resolved through storage helper
```

---

## 3. Data Model Design

### 3.1 Core Concepts

```
Permanent media object
  = MediaBlob row (stable id, role, owner, mime, bytes)
  + bytes in Electron disk / OPFS / legacy IndexedDB Blob

Playback cache object
  = PlaybackCacheEntry row
  + bytes in OPFS/IndexedDB fallback
  + LRU policy
```

The important product distinction is ownership, not the physical API:

- **Permanent media**: referenced by `Track.blobId` or other durable fields; never evicted by cache limits.
- **Playback cache**: derived from remote playback URLs; may be cleared or pruned without mutating tracks.
- **Large image assets**: still permanent media. `background`, `gallery`, full-size `cover`, and full-size `memory` photos can reach thousands of files and multiple GB, so they should move to provider-backed storage after the media resolver is stable.
- **Lightweight derivatives**: thumbhash, crop rects, dominant colors, palette summaries, and future tiny thumbnails remain in IndexedDB because they are small and useful for fast list rendering.

### 3.2 Database Schema

Current schema references:

- `MediaBlob` type: `src/db/types.ts`
- Dexie `mediaBlobs` table: `src/db/muzero-db.ts`
- Primary write paths: `createUploadedTrack`, `markTrackReady`, `setTrackCover`, `addMemory`, `addTrackBackground`, `cacheStreamedTrackBlob`
- Primary read paths: `getTrackBlob`, `getTrackCover`, `useTrackCoverUrl`, `useTrackMediaUrl`, `r2-export-plan`

Required additive shape:

```ts
export interface MediaBlob {
  id: string;
  trackId: string;
  role: "media" | "cover" | "background" | "gallery" | "memory" | "avatar";
  mime: string;
  bytes: number;
  storageBackend?: "indexeddb" | "opfs" | "electron-file";
  storageKey?: string;
  blob?: Blob; // present for legacy/fallback IndexedDB rows
}
```

Migration strategy:

- No index change is required for Phase 1 because current queries use `id`, `trackId`, and `role`.
- Existing rows without `storageBackend` are treated as `indexeddb` legacy rows.
- New `role: "media"` rows write to the preferred provider for the runtime:
  - Electron: `electron-file`
  - Browser: `opfs`
  - Unsupported/failure: `indexeddb`
- Image roles stay IndexedDB in the initial media rollout, then migrate in later phases:
  - `background` / `gallery`: provider-backed by default after Phase 6 because they are usually large and numerous.
  - `cover` / `memory`: provider-backed for full-size originals after Phase 7 when they are `>= 512 KB`.
  - `avatar`: IndexedDB by default; provider-backed only if it is `>= 512 KB` or if a future all-image migration makes it effectively free.
  - Thumbnail/preview derivatives stay IndexedDB.

Constraints and invariants:

- `Track.blobId` must only point to a committed `mediaBlobs` row.
- File-backed rows must have `storageBackend !== "indexeddb"`, `storageKey`, `bytes`, and no required inline `blob`.
- IndexedDB-backed rows must have `storageBackend === "indexeddb"` or missing legacy `storageBackend`, and a readable `blob`.
- Permanent-media deletion must delete both metadata and physical bytes best-effort.
- File deletion must not run inside a long Dexie transaction that depends on external async file operations. Capture file refs during the transaction, then remove files after commit; add an orphan sweeper for failures.
- File writes use a staged commit pattern: write to a temporary key in the same backend/root, verify byte size, finalize to the readable final key using atomic rename/move when the backend supports it, then commit Dexie metadata only after the final key is readable. Cleanup temp/final files best-effort on failure.
- Electron final filenames should be human-readable but stable: use a sanitized title/original filename prefix plus the `blb_...` id suffix, e.g. `media/Artist - Song__blb_abc123.mp3`. The id suffix prevents collisions; metadata edits do not automatically rename files unless a future explicit "organize filenames" maintenance action is added.

Performance impact:

- Hot list queries stay unchanged because `tracks` still carries only ids/metadata.
- `mediaBlobs.get(id)` becomes cheaper for file-backed large media because the DB row no longer carries the media bytes.
- Playback still receives a Blob/File, so media-engine behavior remains stable.
- R2 export hashing must call the resolver once per binary object. It should not call `row.blob` directly.

Rollback plan:

- Keep dual-read support for IndexedDB Blob rows.
- If file-backed writes fail in production, fallback writes keep the app functional.
- If the feature needs rollback, revert new write paths; existing file-backed rows remain readable through the resolver until a follow-up maintenance migration moves them back or deletes them with user approval.

Privacy and retention:

- Browser OPFS is origin-private storage. It is not a user-visible file export location.
- Electron local-disk media directories may be user-visible; MUZERO should use readable filenames, avoid leaking secrets/signed URLs into names, and write only into the configured media root.
- Clearing browser/app site storage deletes IndexedDB and OPFS data. Electron disk media may remain if the user chooses an external media folder, so metadata repair must handle missing DB or orphan files.
- MUZERO should not log file names, source paths, blob bytes, signed URLs, or media contents.

### 3.3 Data Relationship Diagram

```
tracks.blobId ───────┐
tracks.coverBlobId ──┤
sessions.coverBlobId ├──▶ mediaBlobs.id ──▶ resolver ──▶ Blob/File
memories.photoBlobId ┤          │              │
devices.avatarBlobId ┘          │              ├── Electron disk file
                                │              ├── Browser OPFS file
                                │              └── IndexedDB Blob fallback
                                │
                                └── role/runtime determines backend policy
```

---

## 4. API Design

### 4.1 Internal APIs

MUZERO has no backend API for this refactor. Required internal APIs:

| API | Location | Description |
|-----|----------|-------------|
| `defaultMediaStorageProvider()` | `src/db/media-storage-provider.ts` | Selects Electron disk / OPFS / IndexedDB fallback by runtime and Settings. |
| `putMediaBlob(input, db)` | `src/db/media-blob-storage.ts` | Writes metadata + bytes. `role:"media"` uses the selected provider; fallback to IndexedDB. |
| `resolveMediaBlob(rowOrId, db)` | `src/db/media-blob-storage.ts` | Returns `{ id, role, mime, bytes, blob }` regardless of storage backend. |
| `deleteMediaBlob(id, db)` | `src/db/media-blob-storage.ts` | Deletes metadata and schedules/removes provider-backed bytes. |
| `deleteMediaBlobsByTrackIds(ids, db)` | `src/db/media-blob-storage.ts` | Replaces scattered `where("trackId").anyOf(ids).delete()` where provider-byte cleanup is needed. |
| `copyMediaBlob(sourceId, target)` | `src/db/media-blob-storage.ts` | Copies memory photo → track cover without assuming `source.blob` is inline. |
| `validatePersistentMediaStorage()` | `src/db/media-blob-storage.ts` | Optional repair/diagnostic pass for missing files and orphan files. |

Provider contract:

```ts
export interface MediaStorageProvider {
  id: "electron-file" | "opfs" | "indexeddb";
  userVisible: boolean;
  put(input: {
    id: string;
    blob: Blob;
    mime: string;
    suggestedName?: string;
  }): Promise<{ storageKey?: string }>;
  get(input: { storageKey?: string; blob?: Blob }): Promise<Blob | null>;
  delete(input: { storageKey?: string }): Promise<void>;
  estimate?(): Promise<{ bytesUsed?: number; quotaBytes?: number }>;
}
```

Naming rules:

- Electron `storageKey` uses readable relative paths under the managed media root, never absolute paths in Dexie.
- Use sanitized title/original filename prefixes and keep a stable blob id suffix for uniqueness.
- Browser OPFS may use the same readable key shape, but user visibility is not guaranteed; the naming requirement is primarily for Electron disk folders.
- Never include API keys, signed URLs, full source paths, or user note text in storage keys.

Electron bridge additions:

| Bridge Method | Description |
|---------------|-------------|
| `writeMediaStorageFile({ storageKey, bytes, expectedBytes })` | Writes only under the app-managed media root. |
| `readMediaStorageFile({ storageKey })` | Reads only under the app-managed media root. |
| `deleteMediaStorageFile({ storageKey })` | Deletes only under the app-managed media root. |
| `statMediaStorageFile({ storageKey })` | Verifies existence and byte size. |
| `pickMediaStorageFolder()` | Deferred to Phase 5 Settings visibility/move flow so the first rollout defaults to app-managed storage. |

### 4.2 Request/Response Examples

```ts
const media = await putMediaBlob({
  trackId: track.id,
  role: "media",
  mime: input.mime,
  blob: input.blob,
});

await db.tracks.update(track.id, { blobId: media.id });

const resolved = await resolveMediaBlob(track.blobId);
await mediaEngine.loadBlob(resolved.blob, track.kind);
```

### 4.3 Error Handling

- **No desktop media folder configured:** Electron uses an app-managed default media root, or falls back to OPFS/IndexedDB until the user chooses a folder.
- **OPFS unavailable:** Browser fallback writes IndexedDB Blob and records `storageBackend:"indexeddb"`.
- **Disk/OPFS write interrupted:** staged writes do not commit metadata until the finalized file size matches expected `bytes`.
- **Dexie commit fails after file write:** delete the newly written file best-effort.
- **File missing for permanent uploaded/generated media:** do not silently clear the track. Surface a local-media-missing error and keep metadata for repair/export diagnostics.
- **File missing for streamed offline cache:** may clear `Track.blobId` and allow re-resolve/re-download, because the source can be reacquired.
- **Delete cleanup fails:** metadata deletion still succeeds; orphan sweeper removes unreferenced provider files later.

Logging:

- Use `src/lib/logger.ts`.
- Log only ids, role, storage backend, byte counts, and error class/message.
- Never log raw paths, media bytes, user notes, signed URLs, API keys, or source file names.

---

## 5. Frontend Design

### 5.1 Page Structure

No new top-level page is required. Settings should reuse the existing storage/cache area:

```
Settings
└── Cloud / Streaming / Storage
    ├── Stream offline cache summary
    ├── Cloud playback LRU cache summary
    └── Permanent local media summary / repair action
```

### 5.2 UI Components

Required UI changes:

- Add a summary row for permanent local media usage:
  - generated/uploaded media count
  - streamed offline media count
  - total permanent media bytes
  - Electron disk vs OPFS vs legacy IndexedDB breakdown
- Add Electron-only media folder controls:
  - current storage location
  - choose/move media folder
  - warning when a folder is missing or unplugged
- Add a safe maintenance action:
  - "Migrate media storage" when legacy large media exists
  - progress: migrated count / total bytes
  - result: migrated, skipped, fallback, missing
- Add image-role storage insight once Phase 6/7 ships:
  - background/gallery image count and bytes
  - cover/memory full-size count and bytes
  - small-derivative count is optional and should not dominate the UI
- Do not add a hidden runtime flag. If migration is user-triggered, expose it visibly in Settings.

### 5.3 State Management

- Durable storage metadata remains in Dexie.
- Migration progress is ephemeral UI/store state unless a resumable migration run is added.
- Playback state remains in Zustand; Blob resolution is async and should not store large Blobs in Zustand.
- `useLiveQuery` can still read metadata rows; object URL hooks must resolve bytes through `resolveMediaBlob`.

---

## 6. Implementation Plan

### Phase 1: Storage Provider Abstraction + Dual-Read Contract

**Goal:** introduce a single binary resolver that can read legacy IndexedDB Blob rows, Browser OPFS rows, and Electron disk-file rows without changing playback behavior.

**Status (2026-06-12):** Completed. Phase 1 introduced `MediaStorageProvider`, readable provider storage keys, OPFS/IndexedDB/Electron-file backend identities, and DB-facing helpers for put/resolve/copy/delete. Player and sync consumers are not switched yet; that remains Phase 3.

**Tasks:**
- [x] Add `MediaBlob.storageBackend?`, `MediaBlob.storageKey?`, and optional `MediaBlob.blob?` type fields.
- [x] Add `MediaStorageProvider` with `electron-file`, `opfs`, and `indexeddb` implementations.
- [x] Add shared OPFS helpers with a distinct persistent directory, e.g. `muzero-persistent-media`.
- [x] Add `putMediaBlob`, `resolveMediaBlob`, `deleteMediaBlob`, and `copyMediaBlob` helpers.
- [x] Keep permanent-media and playback-cache policies separate while aligning the OPFS + fallback pattern.
- [x] Keep legacy rows readable as `storageBackend:"indexeddb"`.

### Phase 1 Checklist

- [x] Existing `getTrackBlob()` behavior is preserved because consumers are not switched in this phase.
- [x] Resolver returns a Blob/File for IndexedDB, OPFS, and Electron disk rows.
- [x] File-backed writes verify file size before metadata commit.
- [x] OPFS and Electron provider fallback to IndexedDB is covered by tests.
- [x] No player UI behavior changes in this phase.

### Phase 2: Permanent Media Write Path + Runtime Selection

**Goal:** write new large audio/video rows (`role:"media"`) to the best backend for the runtime while keeping small image roles in IndexedDB for the first rollout.

**Status (2026-06-12):** Completed. New uploaded/generated/streamed/R2-cached `role:"media"` rows write through `putMediaBlob`, Electron now has an app-managed media-file IPC backend with staged writes and path validation, Browser can select OPFS, and provider failures still fall back to IndexedDB. User-selected Electron media folders remain a Phase 5 Settings flow.

**Tasks:**
- [x] Extend `DesktopBridge` and Electron IPC/preload with managed media-file read/write/delete/stat methods.
- [x] Add default Electron media root resolution with an app-managed root; keep user-selected folder/move UI for Phase 5.
- [x] Update `createUploadedTrack` to write the primary media through `putMediaBlob`.
- [x] Update `markTrackReady` for generated audio.
- [x] Update `cacheStreamedTrackBlob` for streamed offline downloads.
- [x] Update `r2-cache.ts` imported remote-media downloads.
- [x] Preserve embedded covers as IndexedDB rows in this phase.

### Phase 2 Checklist

- [x] Uploaded audio/video gets `Track.blobId` only after bytes are durably written.
- [x] Generated tracks become ready only after provider/IndexedDB fallback write succeeds.
- [x] Streamed offline cache replacement deletes the previous byte object after commit.
- [x] Electron disk backend validates paths against the configured media root and rejects traversal/symlink escape.
- [x] Tests cover upload, generated ready, streamed cache, fallback, and replacement cleanup.
- [x] Manual downloads remain outside the playback-cache LRU.

### Phase 3: Playback, Export, and Import Consumers

**Goal:** remove direct assumptions that `MediaBlob.blob` is inline.

**Status (2026-06-12):** Completed. Playback/download, cover URL hooks, dynamic cover-color extraction, coverflow preloading, memory-photo-to-cover copy, thumbhash backfill, avatar display, metadata export, and R2 export now resolve bytes through the storage helper instead of assuming `MediaBlob.blob` is inline. Background/gallery image-role migration remains Phase 6; cover/memory/avatar writes remain Phase 7.

**Tasks:**
- [x] Update `getTrackBlob` and `useTrackMediaUrl` to resolve provider-backed primary media bytes safely.
- [x] Update `getTrackCover`, `getSessionCover`, `getEntityCover`, and `getMemoryPhoto` to use resolver or role-specific wrappers.
- [x] Update `useTrackCoverUrl` to resolve provider-backed cover bytes once cover roles migrate.
- [x] Update `setTrackCoverFromMemory`, `setTrackCoverCrop`, and thumbhash backfill to resolve source blobs.
- [x] Update R2 export `createBinaryObject` / `sha256Blob` to resolve provider-backed media before hashing/uploading.
- [x] Update remaining metadata export code for future provider-backed cover/memory/avatar/entity-cover bytes.

### Phase 3 Checklist

- [x] Player local-first path still uses `Track.blobId` before remote/cache sources.
- [x] R2 export produces identical binary object keys for unchanged media bytes.
- [x] Cover color extraction and thumbhash backfill still work for IndexedDB image rows.
- [x] No direct `mediaBlob.blob` reads remain outside the storage helper, except transitional tests.
- [x] Tests cover sync export hashing/body for provider-backed media.

### Phase 4: Migration, Repair, and Cleanup

**Goal:** migrate existing large media rows safely and provide recovery for partial failures.

**Status (2026-06-12):** Completed at the storage layer. `resolveMediaBlob` can lazily migrate legacy `role:"media"` rows when requested, `migrateLegacyMediaBlobs` provides an explicit batch function for the Phase 5 Settings action, validation reports missing provider-backed files, and orphan cleanup deletes unreferenced provider files when the provider supports listing.

**Tasks:**
- [x] Add a lazy migration path: when resolving any legacy `role:"media"` row, optionally copy it to the selected provider and update metadata.
- [x] Add an explicit batch migration function for all legacy `role:"media"` rows; Phase 5 wires it to visible Settings UI.
- [x] Add orphan cleanup: list provider files and remove files not referenced by `mediaBlobs.storageKey`.
- [x] Add missing-file validation: provider-backed metadata row without a file is reported, not silently ignored for uploaded/generated tracks.
- [x] Add transaction-safe replacement/delete helpers that capture provider refs and remove files after Dexie commit.

### Phase 4 Checklist

- [x] Migration is resumable/idempotent.
- [x] Killing the app mid-migration cannot point a track at missing bytes.
- [x] Missing uploaded/generated media is reported by validation for Settings/repair surfacing.
- [x] Missing streamed offline media can be diagnosed and re-downloaded by the existing streamed cache flow.
- [x] Orphan sweeper never deletes files referenced by current metadata.

### Phase 5: Settings Visibility + Storage Health

**Goal:** make storage understandable to users before expanding the migration to high-volume image roles.

**Tasks:**
- [ ] Add Settings summary for permanent local media usage, backend split, and Electron media-folder location.
- [ ] Add Electron-only "Choose media folder" and "Move media folder" flows.
- [ ] Add a visible repair/migrate action with progress and localized copy.
- [ ] Add image-role estimates so users can see whether covers/backgrounds/memories are driving storage growth.
- [ ] Keep image migration controls hidden until Phase 6/7 implementation exists as visible, tested actions.

### Phase 5 Checklist

- [ ] UI distinguishes playback cache from permanent local media.
- [ ] Clearing playback cache cannot delete permanent provider-backed media.
- [ ] Clearing streamed offline cache deletes only streamed permanent media and updates `Track.blobId`.
- [ ] Electron users can see where permanent media is stored and recover if the folder is missing.
- [ ] Settings differentiates audio/video media, large image assets, and lightweight derivatives.
- [ ] i18n strings are added for en/zh/ja/ko.

### Phase 6: Large Image Asset Storage

**Goal:** migrate high-volume, large image assets (`background` and `gallery`) to provider-backed storage after the media resolver is stable.

**Why this phase exists:** these roles can reach 1w images. At 100–300 KB each they become 1–3 GB; at phone-photo size they become 10–40 GB. Keeping those full-size Blobs in IndexedDB is likely to cause storage pressure and expensive deserialization. They are also less latency-sensitive than list covers, so provider-backed reads are a good fit.

**Tasks:**
- [ ] Route `addTrackBackground` and `addGalleryImage` through `putMediaBlob`.
- [ ] Update `listTrackBackgrounds` and `listGalleryImages` callers to resolve bytes through the storage helper before creating object URLs.
- [ ] Add migration for existing `role:"background"` and `role:"gallery"` rows.
- [ ] Add delete helpers so removing gallery/background images also removes provider files.
- [ ] Keep any future small preview/thumbhash metadata in IndexedDB.

### Phase 6 Checklist

- [ ] New background/gallery images write to Electron disk or Browser OPFS by default.
- [ ] Existing background/gallery IndexedDB Blob rows remain readable.
- [ ] Migration is resumable and reports migrated/skipped/missing counts.
- [ ] Background slideshow and global gallery continue to render after migration.
- [ ] Removing an image deletes both metadata and provider bytes best-effort.

### Phase 7: Cover + Memory Photo Provider Storage

**Goal:** move full-size cover and memory-photo originals to provider-backed storage while preserving fast UI metadata in IndexedDB.

**Why this phase exists:** album/song covers and memory photos can also reach 1w+ items. Covers are read frequently in lists, Dock, Now Playing, palette extraction, R2 sync, and crop/thumbnail logic, so this migration must keep lightweight derivatives local and avoid repeatedly resolving full-size images for list rendering.

**Storage policy:**

- `cover` full-size original: provider-backed when `>= 512 KB`.
- `memory` photo full-size original: provider-backed when `>= 512 KB`.
- `avatar`: keep IndexedDB by default unless `>= 512 KB`.
- `coverThumbhash`, crop rects, dominant color, palette summaries, and optional tiny thumbnails: keep IndexedDB.

**Tasks:**
- [ ] Update `setTrackCover`, `setSessionCover`, `setEntityCover`, and embedded-cover import to use size-aware provider storage.
- [ ] Update `addMemory` for large memory photos.
- [ ] Update `setTrackCoverFromMemory`, `setTrackCoverCrop`, thumbhash backfill, and palette extraction to resolve source bytes through the helper.
- [ ] Add optional thumbnail/cache strategy for list covers if full-size provider reads become visible in performance traces.
- [ ] Add migration for existing large `cover` and `memory` rows, gated by the 512 KB threshold.
- [ ] Keep R2 export hashes stable by resolving full-size bytes before hashing.

### Phase 7 Checklist

- [ ] List rendering does not synchronously load full-size provider images for every row.
- [ ] Dock/Now Playing cover, crop, palette, and thumbhash behavior remains correct.
- [ ] Memory timeline and memory photo "set as cover" continue to work.
- [ ] R2 export/import still includes cover and memory-photo binaries.
- [ ] 1w cover/memory-photo rows are represented by lightweight DB metadata plus provider-backed originals.
- [ ] i18n strings are added for en/zh/ja/ko.

---

## 7. Out of Scope

- No arbitrary user-visible filesystem writes outside the configured Electron media root.
- No "export original files to any folder" flow; Electron media-folder selection is only the app's managed storage root.
- No encryption-at-rest layer beyond browser/app storage guarantees.
- No backend service, account system, or server-side storage migration.
- No replacement of the player media engine.
- No automatic LRU eviction for permanent media.
- No broad image-role migration in Phase 1–4. Image roles are handled by Phase 6/7.

---

## 8. Security Considerations

- **Authentication:** unchanged. MUZERO remains local-first; R2 credentials stay local.
- **Authorization:** OPFS is origin-private; Electron file access is restricted to a configured media root and must reject traversal/symlink escape.
- **Data Protection:** media bytes remain local. Logs must not include bytes, source file paths, signed URLs, or user text.
- **Retention:** Browser permanent media lives until the user deletes tracks/media or clears app/site storage. Electron external media folders may survive app data deletion, so Settings repair must explain and reconcile that state. Playback cache retention remains bounded by its own LRU settings.
- **Failure Safety:** write bytes first, verify size, then commit metadata. Deleting metadata and bytes should be idempotent.

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [R2 Cloud Drive Sync PRD](../20260609-muzero-r2-cloud-drive-sync-prd/20260609-muzero-r2-cloud-drive-sync-prd.md) | Remote playback cache and R2 sync context. |
| [External Streaming Sources PRD](../20260610-muzero-external-streaming-sources-prd/20260610-muzero-external-streaming-sources-prd.md) | Streamed track offline cache uses `Track.blobId`. |
| [Media Metadata Import/Export PRD](../20260609-muzero-media-metadata-import-export-prd/20260609-muzero-media-metadata-import-export-prd.md) | Metadata export must resolve media/cover bytes. |
| [Set / PlayQueue / Memory Data Model PRD](../20260607-muzero-set-playqueue-memory-data-model-prd/20260607-muzero-set-playqueue-memory-data-model-prd.md) | Memory photos and blob-role model. |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | Should provider-backed permanent media write to a temporary file and then copy/move to final name, or write final name and verify size before metadata commit? | Resolved | Use the staged-write best practice: write temp in the same backend/root, verify byte size, finalize to the readable final key with atomic rename/move when supported, then commit metadata only after the final key is readable. |
| 2 | Should covers/memory photos move to provider-backed storage in the same PRD? | Resolved | Yes, but as later phases. Keep image roles in IndexedDB during Phase 1–4, then migrate background/gallery in Phase 6 and full-size cover/memory originals in Phase 7. |
| 3 | What size threshold triggers lazy migration? | Resolved | For `role:"media"` audio/video, no size threshold: all legacy rows migrate to the selected provider. For images, Phase 6 migrates all `background`/`gallery`; Phase 7 migrates `cover`/`memory`/`avatar` at `>= 512 KB`. |
| 4 | Should missing uploaded/generated provider-backed media clear `Track.blobId`? | Resolved | No. Preserve metadata and surface repair/error because original bytes may not be reacquirable. |
| 5 | Should streamed offline cache be considered permanent? | Resolved | It is user/device-controlled local media, not LRU playback cache; however it may be cleared by the explicit streamed-cache clear action. |
| 6 | Should Electron default to app-managed storage or ask for a folder on first large media import? | Resolved | Default to an app-managed media root for zero-friction setup. Settings exposes choose/move folder so users can place media in a new local folder when they want direct disk visibility/control. |
| 7 | Should Electron use path-like storage keys or content-addressed filenames? | Resolved | Use readable relative filenames with a stable blob-id suffix, e.g. `media/Artist - Song__blb_abc123.mp3`. This keeps local files understandable while avoiding collisions; content-addressing/dedupe can be added later. |
| 8 | What image size threshold should trigger provider storage for cover/memory/avatar? | Resolved | 512 KB. Full-size `cover`, `memory`, and exceptional `avatar` images at or above 512 KB move to provider-backed storage; lightweight derivatives stay in IndexedDB. |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-12 | MUZERO | Initial draft after code audit of `mediaBlobs`, player local playback, streamed offline cache, and R2 export paths. |
| 2026-06-12 | MUZERO | Revised scope from OPFS-only to a runtime storage abstraction: Electron disk files, Browser OPFS, IndexedDB fallback. |
| 2026-06-12 | MUZERO | Added later image-storage phases: background/gallery provider-backed by default, full-size cover/memory photos provider-backed by threshold, lightweight derivatives stay in IndexedDB. |
| 2026-06-12 | MUZERO | Resolved storage open questions: staged writes, app-managed Electron default with user-selectable folder, readable local filenames with blob-id suffix, all media rows migrate, and image threshold is 512 KB. |
| 2026-06-12 | MUZERO | Phase 1 completed: added storage provider abstractions, readable storage key generation, OPFS/IndexedDB/Electron-file backend identities, DB-facing put/resolve/copy/delete helpers, and regression tests for legacy reads, provider-backed rows, fallback, copy, and delete cleanup. |
| 2026-06-12 | MUZERO | Phase 2 completed: routed uploaded/generated/streamed/R2-cached primary media through provider-backed writes, added Electron app-managed media-file IPC with staged writes and path validation, kept embedded covers IndexedDB-backed, and added regression tests for durable writes, fallback, replacement cleanup, and provider-backed R2 export reads. |
| 2026-06-12 | MUZERO | Phase 3 completed: switched playback/download, cover hooks, dynamic color extraction, coverflow preloading, memory-photo cover copy, thumbhash backfill, avatar display, metadata export, and R2 export to resolver-backed byte reads, with provider-backed cover/memory regression tests. |
| 2026-06-12 | MUZERO | Phase 4 completed: added lazy and batch legacy media migration, missing provider-file validation, provider orphan cleanup, provider listing contract, and tests for idempotent migration plus referenced-file-safe cleanup. |

---

## Code Audit Notes

- `MediaBlob` currently requires `blob: Blob` and stores every role in IndexedDB (`src/db/types.ts`).
- `createUploadedTrack` and `markTrackReady` construct `role:"media"` rows directly with inline Blobs (`src/db/repositories.ts`).
- `cacheStreamedTrackBlob` treats streamed offline downloads as local media by writing `mediaBlobs` and setting `Track.blobId` (`src/streamsrc/streamed-track-repo.ts`).
- Player playback prioritizes `Track.blobId` and loads the resolved Blob before remote playback (`src/stores/player-store.ts`).
- R2 export reads `mediaBlob.blob` directly for hashing and upload body (`src/sync/r2-export-plan.ts`).
- Existing OPFS playback cache code proves the OPFS + IndexedDB fallback pattern, but its LRU policy must remain separate from permanent media (`src/player/playback-cache.ts`).
