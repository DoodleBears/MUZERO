# PRD: MUZERO NCM Import Memory Optimization

**Status:** Draft
**Created:** 2026-06-13
**Author:** Codex
**Module:** Local Files / Folder Import / NetEase NCM ingest performance

---

## Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | PRD + Import Path Audit | 🔄 In Progress | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | Electron NCM Persist Path | 🔲 Pending | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | Import Memory Budget + Backpressure | 🔲 Pending | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | Low-Priority Cover Palette Work | 🔲 Pending | [Phase 4 Checklist](#phase-4-checklist) |
| 5 | Verification + Profiling Notes | 🔲 Pending | [Phase 5 Checklist](#phase-5-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

Folder import performance currently varies sharply by file type. In Electron desktop folder sync:

- Plain audio/video files can use the local-file reference path: the app stores metadata and `sourcePath`, then streams from the original file on playback. This is fast and avoids duplicating media bytes.
- NetEase `.ncm` files cannot be played encrypted. MUZERO reads the whole encrypted container, decrypts it to plaintext audio, parses metadata/cover data, and stores the decoded media as a new local blob.
- The heavy worker currently owns the `.ncm` decode and DB write path. Inside a Web Worker, Electron preload APIs are unavailable, so large decoded media can fall back to browser storage semantics instead of Electron's app-managed `persistent-media` files.
- Fresh imported covers now generate thumbhash/palette metadata, but palette extraction still costs CPU/memory during import.

Users observe two symptoms:

1. Some folder imports are very fast while others are slow.
2. During Electron dev imports, memory can rise by roughly 1-1.5 GB, especially with many `.ncm` or large files.

This PRD optimizes the `.ncm` path without changing MUZERO's local-first model or introducing a backend.

### 1.2 Target Users

| Role | Description | Permissions |
|------|-------------|-------------|
| Desktop local-library owner | Imports large music folders, including NetEase `.ncm` collections. | Pick folders, sync remembered folders, play imported tracks. |
| Power user with large library | Imports thousands of files and watches disk/memory usage. | Use Storage & cache tools, repair metadata, inspect usage. |
| Developer/support user | Needs import behavior to be explainable and measurable. | Read diagnostics, run targeted tests, inspect PRD progress. |

### 1.3 Core Value

1. **Lower C-drive pressure:** `.ncm` decoded media should land in Electron's app-managed `persistent-media` storage when running in Electron, not accidentally in Chromium OPFS/File System.
2. **Lower peak memory risk:** The import loop should give large `.ncm` writes time to settle instead of piling expensive decode/write/palette work together.
3. **More predictable imports:** The app should clearly separate fast referenced imports from slow encrypted-container conversion.
4. **Safer visual metadata:** Cover preview metadata should exist, while expensive multi-color palette extraction can be deferred when needed.

---

## 2. System Architecture

### 2.1 Architecture Overview

```
Folder scan
  -> ScannedFile[]
  -> plaintext file in Electron
       -> createReferencedUploadedTrack(sourcePath)       # fast path, no media copy
  -> .ncm file
       -> read encrypted bytes
       -> heavy worker decode/parse only                  # no worker DB write in Electron path
       -> renderer createUploadedTrack(decoded Blob)
       -> Electron media storage provider writes file      # app-managed persistent-media
       -> optional remote cover download
```

Longer-term:

```
Import scheduler
  -> memory budget
  -> large-file backpressure/yield
  -> cover thumbhash now
  -> cover palette idle/background queue
```

### 2.2 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Folder import | `src/stores/player-store.ts` | Existing orchestration for remembered folders and progress. |
| Heavy decode | `src/workers/heavy-worker.ts`, `src/workers/ingest-core.ts` | Keeps `.ncm` CPU/decrypt work off the renderer. |
| Electron storage | `src/db/media-blob-storage.ts`, `src/lib/desktop/electron.ts` | Existing `electron-file` backend stores media outside Chromium OPFS. |
| Metadata parse | `music-metadata`, `src/lib/media-metadata.ts`, `src/lib/ncm-decode.ts` | Existing parser/decrypt contract. |
| Tests | Vitest + fake-indexeddb | Existing import and repository tests. |

### 2.3 Project Structure

```
src/
├── workers/
│   ├── ingest-core.ts        # add decode-only NCM payload helper
│   ├── heavy-client.ts       # request/response for decode-only worker calls
│   └── heavy-worker.ts       # worker dispatch for NCM decode-only path
├── stores/
│   └── player-store.ts       # Electron NCM persist path + backpressure hooks
├── db/
│   ├── repositories.ts       # existing createUploadedTrack storage behavior
│   └── media-blob-storage.ts # existing electron-file provider
└── lib/
    └── ncm-decode.ts         # pure decoder, unchanged contract
```

---

## 3. Data Model Design

### 3.1 Core Concepts

```
Track
  origin: uploaded
  sourcePath: original .ncm path
  blobId: decoded plaintext audio blob
  coverBlobId?: embedded/downloaded cover
  mediaMetadata.originalExtension: "ncm"

MediaBlob
  role: media
  storageBackend: electron-file in Electron renderer path
```

### 3.2 Database Schema

No schema change is required.

- `Track.sourcePath` continues to dedupe remembered folder sync.
- `Track.mediaMetadata.originalExtension = "ncm"` continues to preserve provenance.
- `MediaBlob.storageBackend` already supports `electron-file`, `opfs`, and `indexeddb`.
- Existing browser/Tauri behavior may keep using worker DB writes until an equivalent native storage path exists.

Privacy:

- Local source paths remain local-only.
- No telemetry or backend is introduced.
- `.ncm` conversion remains local format conversion of the user's own files.

---

## 4. API Design

### 4.1 Internal APIs

| Surface | Function / Message | Description |
|---------|--------------------|-------------|
| Worker core | `decodeNcmMediaBytes(input)` | Decode and parse one `.ncm` without writing DB rows. |
| Worker client | `decodeNcmViaWorker(input)` | Request decoded audio/cover/metadata from heavy worker, transfer buffers back. |
| Worker dispatch | `type: "decode-ncm"` | New worker message for decode-only path. |
| Player store | `ingestNcmScannedFileInRenderer(...)` | Electron folder import persists decoded media through renderer storage provider. |
| Import scheduler | `yieldAfterLargeImport(...)` | Gives the event loop/GC a chance after large decoded writes. |

### 4.2 Error Handling

- Decode failure counts as `decodeFailed` for `.ncm`, matching current behavior.
- If worker decode is unavailable, fall back to inline decode or the existing worker ingest path.
- If Electron media storage fails, `createUploadedTrack` already falls back to IndexedDB durability; the failure should not lose the import.
- The import loop must continue after one bad file.

---

## 5. Frontend Design

No new screen is required for v1.

Future UX improvements can add clearer import progress phases:

- scanning
- importing referenced files
- decoding `.ncm`
- writing decoded media
- downloading covers
- finishing metadata

The existing Storage & cache page remains the place to inspect disk usage.

---

## 6. Implementation Plan

### Phase 1: PRD + Import Path Audit

**Goal:** Document the observed performance issue and identify the current hot paths.

**Tasks:**
- [x] Audit plaintext local folder import, `.ncm` import, cover download, and media storage paths.
- [x] Document why `.ncm` is slower than referenced local files.
- [x] Define measurable acceptance criteria and implementation phases.

### Phase 1 Checklist

- [x] PRD explains Electron referenced-file fast path vs `.ncm` decode path.
- [x] PRD captures memory, OPFS, backpressure, and cover palette requirements.
- [x] PRD links to existing implementation files.

### Phase 2: Electron NCM Persist Path

**Goal:** In Electron, prevent `.ncm` decoded media from being written by the worker into browser storage.

**Tasks:**
- [ ] Add a decode-only `.ncm` worker request that returns decoded audio, metadata, and embedded cover without DB writes.
- [ ] Route Electron folder `.ncm` imports through renderer-side `createUploadedTrack`, so default media storage can select `electron-file`.
- [ ] Preserve `albumPicUrl`, embedded-cover priority, `sourcePath`, metadata, and decode failure behavior.
- [ ] Add tests for decode-only worker/client contract and Electron `.ncm` folder import persistence path.

### Phase 2 Checklist

- [ ] Electron `.ncm` imports create tracks with `blobId` and `sourcePath`.
- [ ] Decoded `.ncm` media rows use the renderer storage provider path when available.
- [ ] Worker no longer writes `.ncm` media DB rows for the Electron folder path.
- [ ] Existing browser/Tauri fallback continues to import `.ncm`.

### Phase 3: Import Memory Budget + Backpressure

**Goal:** Reduce import memory spikes by yielding after large decoded writes and avoiding stacked expensive tasks.

**Tasks:**
- [ ] Add size-aware backpressure after `.ncm` decode/write and large plaintext byte imports.
- [ ] Keep progress responsive while yielding.
- [ ] Add tests around import ordering and cancellation with backpressure hooks.

### Phase 3 Checklist

- [ ] Large `.ncm` imports yield between files.
- [ ] Cancel still stops between-file work.
- [ ] Normal referenced-file imports stay fast.

### Phase 4: Low-Priority Cover Palette Work

**Goal:** Keep instant cover previews while moving expensive palette work off the hottest import path.

**Tasks:**
- [ ] Keep thumbhash generation at cover-set/import time.
- [ ] Move multi-color palette extraction for imported covers to an idle/background queue when practical.
- [ ] Ensure Storage repair count does not grow for fresh imports.

### Phase 4 Checklist

- [ ] Fresh imported covers still have immediate blurred previews.
- [ ] Palette work does not block large import batches unnecessarily.
- [ ] Storage repair count remains stable for fresh imports.

### Phase 5: Verification + Profiling Notes

**Goal:** Validate behavior with tests and document how to measure real memory improvements.

**Tasks:**
- [ ] Run targeted Vitest suites for `.ncm`, folder sync, repositories, and storage.
- [ ] Run TypeScript typecheck.
- [ ] Document manual profiling guidance: compare dev vs production build, watch post-import memory settling, and distinguish `.ncm` from referenced-file imports.

### Phase 5 Checklist

- [ ] Relevant tests pass.
- [ ] Typecheck passes.
- [ ] PRD records completed phases and residual risks.

---

## 7. Out of Scope

- Rewriting the `.ncm` decoder in native Rust/Node in this phase.
- Supporting other encrypted formats such as QQ `.qmc*`, Kugou `.kgm`, or DRM caches.
- Adding a MUZERO backend or telemetry.
- Changing `Track` / `MediaBlob` schema.
- Claiming dev-mode memory numbers as production baseline without production profiling.

---

## 8. Security Considerations

- `.ncm` decoding stays local and uses no hidden service.
- No API keys, cookies, or local paths are logged.
- Source paths remain in local IndexedDB settings/track metadata only.
- Media bytes remain in local device storage.
- Rollback is `git revert`, not a hidden runtime flag.

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [Settings IA PRD](../20260613-muzero-settings-information-architecture-prd/20260613-muzero-settings-information-architecture-prd.md) | Storage & cache surface where import storage pressure is visible. |
| [Media Metadata Import Export PRD](../20260609-muzero-media-metadata-import-export-prd/20260609-muzero-media-metadata-import-export-prd.md) | Metadata and embedded cover import context. |
| [Progressive Bulk Import Playback PRD](../20260612-muzero-progressive-bulk-import-playback-prd/20260612-muzero-progressive-bulk-import-playback-prd.md) | Related large-library progressive import behavior. |
| `src/lib/ncm-decode.ts` | Pure `.ncm` decode logic. |
| `src/workers/ingest-core.ts` | Current worker ingest core. |
| `src/stores/player-store.ts` | Folder import orchestration. |
| `src/db/media-blob-storage.ts` | Media storage providers. |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | Should `.ncm` decode move fully into Electron main/Node worker? | Open | v1 uses browser worker decode-only + renderer persistence; native decode can be a later phase if memory remains high. |
| 2 | Should imported `.ncm` keep a reference to the original encrypted file after decoding? | Resolved | Yes, keep `sourcePath` for dedupe/provenance, but playback uses decoded `blobId`. |
| 3 | Should palette extraction be skipped entirely during import? | Open | Recommendation: keep thumbhash immediate; defer palette if memory pressure remains visible. |
| 4 | What memory number is acceptable? | Open | Need production build profiling; dev-mode 1-1.5 GB spikes are useful symptoms but not the final benchmark. |

---

## 11. Acceptance Criteria

1. Electron `.ncm` folder imports no longer rely on worker-side DB/media writes for the primary path.
2. Electron `.ncm` decoded media prefers app-managed `electron-file` storage.
3. `.ncm` metadata, embedded cover priority, remote `albumPicUrl`, `sourcePath`, and decode failure counts remain correct.
4. Large import batches yield between expensive files and remain cancelable.
5. Fresh imports do not grow the Storage cover repair count.
6. Tests cover the new decode-only path and existing fallback behavior.
7. Typecheck and targeted Vitest suites pass.

---

## 12. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-13 | Codex | Initial PRD for `.ncm` import memory/storage optimization. |

---

> Note: This PRD intentionally starts with a renderer-persistence optimization because it reuses existing Electron media storage and avoids a larger native decoder rewrite. A full Electron main/Node worker decode can follow if profiling still shows unacceptable peak memory.
