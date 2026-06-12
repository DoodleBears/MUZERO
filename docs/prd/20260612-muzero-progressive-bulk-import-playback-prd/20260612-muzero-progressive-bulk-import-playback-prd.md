# PRD: MUZERO Progressive Bulk Import Playback

**Status:** Final
**Created:** 2026-06-12
**Author:** Codex
**Module:** Player / Local Folder Import - Bulk media ingestion availability

---

## Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | PRD + Best Practice Grounding | ✅ Completed | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | TDD Coverage For Progressive Publishing | ✅ Completed | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | Progressive Import Flush Implementation | ✅ Completed | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | Verification + Completion | 🔲 Pending | [Phase 4 Checklist](#phase-4-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

When a user imports a very large library, for example 6000+ songs, MUZERO currently creates ready `Track` and `mediaBlobs` rows as each file is ingested, but does not attach those tracks to the visible set until the entire upload list or folder plan finishes. The already-ingested tracks are technically persisted and playable, but the player cannot see them because `session.trackIds` and the play queue are updated only at the end.

This makes a local-first music player feel blocked even though useful local data already exists.

### 1.2 Target Users

| Role | Description | Permissions |
|------|-------------|-------------|
| Local music collector | Imports thousands of audio/video files from disk | Pick folders/files, play imported media |
| Desktop-first MUZERO user | Keeps the app open during a long import | Continue browsing and playback while import continues |

### 1.3 Core Value

1. **Immediate usefulness:** Successfully imported songs become visible and playable within a small batch window.
2. **Large-library resilience:** A 6000+ song import no longer behaves like a single all-or-nothing UI publish.
3. **Local-first correctness:** Media bytes still land in local storage before a track enters the visible set.

---

## 2. Best Practice Grounding

### 2.1 Sources Checked

| Source | Relevant Guidance | MUZERO Decision |
|--------|-------------------|-----------------|
| Dexie `liveQuery()` docs: https://dexie.org/docs/liveQuery%28%29 | live queries re-run after committed database changes that affect the query result; cross-context changes can wake live queries. | Publish imported ids through committed `sessions` mutations so existing Dexie readers and queue watchers react naturally. |
| Dexie best practices: https://dexie.org/docs/Tutorial/Best-Practices | Do not wait on unrelated async APIs inside transactions; let errors propagate unless they are truly handled. | Keep file read, metadata parse, worker decode, cover fetch, and media storage outside the `prependTrackIds` transaction. The transaction only mutates set membership. |
| Dexie `bulkPut()` docs: https://dexie.org/docs/Table/Table.bulkPut%28%29 | Bulk mutations are faster than per-row loops for large object sets. | Do not publish every single imported track one-by-one; flush small batches to reduce transaction/liveQuery churn while still making tracks available quickly. |
| MDN Web Workers: https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers | Workers keep expensive work off the main thread. | Keep the existing `ingestViaWorker` path; this PRD only changes when successfully ingested ids become visible. |

### 2.2 Design Principle

Use **bounded progressive publishing**:

- Ingest remains per-file and failure-isolated.
- A track is published only after its media blob and track row exist.
- Published ids are flushed every small batch, not only at the end.
- Remaining ids are flushed in `finally`/end-of-plan paths before folder metadata is updated.
- Cover fetching stays non-blocking and after audio import.

---

## 3. System Architecture

### 3.1 Architecture Overview

```
file/folder input
  -> probe/read/decode/metadata parse
  -> createUploadedTrack writes tracks + mediaBlobs
  -> pending visible ids buffer
  -> flushImportedTrackIds(setId, ids)
  -> prependTrackIds updates session.trackIds
  -> Dexie liveQuery / playQueue append watcher exposes playable tracks
```

### 3.2 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Local DB | Dexie 4 / IndexedDB | Existing local-first source of truth |
| Reactive UI | Dexie `useLiveQuery` + play queue watcher | Existing set and queue propagation path |
| Heavy ingest | Web Worker client `ingestViaWorker` | Existing off-main-thread parsing/decode path |
| Tests | Vitest + fake-indexeddb | Existing deterministic local DB test setup |

### 3.3 Project Structure

```
src/
├── stores/
│   ├── player-store.ts        # addUploadsToSet + runFolderSync flushing
│   ├── player-store.test.ts   # file-picker upload behavior
│   └── folder-sync.test.ts    # local folder import behavior
└── db/
    └── repositories.ts        # existing prependTrackIds API
```

---

## 4. Data Model Design

### 4.1 Core Concepts

```
Track/mediaBlobs ready first
        |
        v
session.trackIds membership append/prepend
        |
        v
visible list + playable queue
```

### 4.2 Database Schema

- **Current Schema:** `src/db/muzero-db.ts`, `src/db/types.ts`
- **Required Changes:** None.
- **Data Migration:** None.
- **Integration Points:** Reuse `prependTrackIds(sessionId, ids)` in `src/db/repositories.ts`.
- **Constraints & Indexing:** No index changes.
- **Performance Impact:** More `sessions` writes than today, but bounded by batch size rather than number of files.
- **Rollback Plan:** `git revert` implementation commit. No schema rollback.
- **Privacy & Retention:** No new data leaves device.

---

## 5. API Design

No backend or external API changes. This is local orchestration only.

### 5.1 Internal Helper

```typescript
const IMPORT_VISIBILITY_FLUSH_SIZE = 25;

async function flushImportedTrackIds(
  setId: string,
  ids: string[],
  afterTrackId?: string,
): Promise<string | undefined>

async function insertTrackIdsAfter(
  sessionId: string,
  ids: string[],
  afterTrackId?: string,
): Promise<void>
```

`flushImportedTrackIds` is local to `player-store.ts` and clears the caller-owned buffer only after a successful DB write. `insertTrackIdsAfter` lives in `src/db/repositories.ts` so set membership order/rank invariants stay owned by the repository layer. The store passes the last published track id as the next chunk's anchor, preserving final import order while still making each chunk visible.

### 5.2 Error Handling

- A failed file remains isolated and does not abort the batch.
- A failed flush should surface through the existing top-level upload/sync error path.
- Do not hide behavior behind localStorage, URL flags, or globals.

---

## 6. Frontend Design

No new UI. Existing import progress remains authoritative.

### 6.1 State Management

- `isUploading` remains true for the full import.
- `folderImportProgress.imported` remains per successfully ingested file.
- Set membership updates incrementally, so existing `useLiveQuery` readers and queue append watchers can expose tracks during import.

---

## 7. Implementation Plan

### Phase 1: PRD + Best Practice Grounding

**Goal:** Document the issue, current architecture, and bounded progressive publishing approach.

**Tasks:**
- [x] Read `.cursor/commands/prd-create.md`.
- [x] Check Dexie/MDN guidance for live updates, transactions, bulk mutations, and workers.
- [x] Create this PRD.

### Phase 1 Checklist

- [x] PRD status set to Final.
- [x] Best-practice references recorded.
- [x] No implementation committed before PRD exists.

### Phase 2: TDD Coverage For Progressive Publishing

**Goal:** Add failing tests that prove imported tracks become visible before a whole large import completes.

**Tasks:**
- [x] Add a folder sync test that observes `session.trackIds` during the second file read and expects the first batch to be published.
- [x] Add a file upload test that imports more than one flush batch and expects mid-import set visibility.
- [x] Run targeted tests and confirm they fail before implementation.

### Phase 2 Checklist

- [x] Tests fail for the current end-only `prependTrackIds` behavior.
- [x] Tests do not rely on timers or network.
- [x] PRD updated before commit.

### Phase 3: Progressive Import Flush Implementation

**Goal:** Flush imported ids in bounded batches across file-picker/drop upload and folder sync.

**Tasks:**
- [x] Add `IMPORT_VISIBILITY_FLUSH_SIZE`.
- [x] Add local helper for flushing and clearing imported id buffers.
- [x] Add repository helper for order-preserving chunk insertion after an anchor.
- [x] Update `addUploadsToSet` to flush when the buffer reaches the threshold and once more at the end.
- [x] Update `runFolderSync` to flush during each folder plan and once more before folder metadata update.

### Phase 3 Checklist

- [x] Existing order semantics remain stable across flushed batches.
- [x] No media id is published before `createUploadedTrack` / `ingestViaWorker` resolves.
- [x] Failed files do not block earlier successful flushes.
- [x] PRD updated before commit.

### Phase 4: Verification + Completion

**Goal:** Prove the behavior and close the PRD.

**Tasks:**
- [ ] Run targeted Vitest files.
- [ ] Run broader check if practical.
- [ ] Update PRD status to Completed.
- [ ] Commit final implementation atomically.

### Phase 4 Checklist

- [ ] Targeted tests pass.
- [ ] PRD change log records implementation completion.
- [ ] Atomic commits contain only related files.

---

## 8. Out of Scope

- Parallelizing imports.
- New import UI.
- Changing `Track`, `MediaBlob`, or `DjSession` schema.
- Reworking OPFS/media storage provider behavior.
- Runtime flags or hidden settings.

---

## 9. Security Considerations

- **Authentication:** Not applicable; local-only app.
- **Authorization:** Existing user-picked file/folder permissions remain unchanged.
- **Data Protection:** No new data egress. Imported bytes remain local.
- **Audit Logging:** Existing logger paths only; no filenames or keys should be sent remotely.

---

## 10. Related Documents

| Document | Description |
|----------|-------------|
| [`src/stores/player-store.ts`](../../../src/stores/player-store.ts) | Upload and folder sync orchestration |
| [`src/db/repositories.ts`](../../../src/db/repositories.ts) | `prependTrackIds` set membership write |
| [`src/workers/heavy-client.ts`](../../../src/workers/heavy-client.ts) | Worker-backed ingest client |
| [`src/workers/ingest-core.ts`](../../../src/workers/ingest-core.ts) | Track/media blob creation core |

---

## 11. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | What flush size should v1 use? | Resolved | 25 tracks: small enough for perceived immediacy, large enough to avoid per-track liveQuery churn. |

---

## 12. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-12 | Codex | Initial Final PRD with best-practice grounding and phased TDD plan. |
| 2026-06-12 | Codex | Phase 2 completed: added red tests for folder sync and file upload progressive visibility; targeted tests fail with mid-import `trackIds` still empty. |
| 2026-06-12 | Codex | Phase 3 completed: added order-preserving progressive flush for upload and folder sync, plus repository tests for chunk insertion and ranked sets. |
