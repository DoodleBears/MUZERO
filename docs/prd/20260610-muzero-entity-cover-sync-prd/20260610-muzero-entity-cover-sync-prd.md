# PRD: MUZERO Custom Artist / Album Covers (with R2 Sync)

**Status:** Draft
**Created:** 2026-06-10
**Author:** MUZERO
**Module:** Media Library — let users set a memorable cover/avatar per artist & album, persisted locally and synced across devices via R2

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | Local entity-cover store + resolution | ✅ Completed | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | Entity-detail header set/clear UX | ✅ Completed | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | R2 sync: library-scoped object namespace | 🔲 Pending | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | R2 sync: mutations, pull/import, conflict | 🔲 Pending | [Phase 4 Checklist](#phase-4-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

The [Artist & Album Library Entities PRD](../20260610-muzero-artist-album-library-entities-prd/20260610-muzero-artist-album-library-entities-prd.md) promoted artist/album from buried subtitle strings into **derived, browsable entities** — pure projections over `Track.mediaMetadata` ([`buildArtistIndex` / `buildAlbumIndex`](../../../src/lib/library-index.ts)), rendered by the read-only [`EntityDetailView`](../../../src/components/library/entity-detail.tsx). The header there shows a cover **only** by falling back to the first member track that has one (`coverTrack` → [`useTrackCoverUrl`](../../../src/hooks/use-media.ts)); there is no way to set a deliberate artist photo or album art.

Users want to set a **memorable cover** per artist ("music carries memories") and per album, the same way they already can for a **track** ([`setTrackCover`](../../../src/db/repositories.ts)) and a **set / 歌单** ([`setSessionCover`](../../../src/db/repositories.ts)). And because the library is now multi-device via the [R2 Cloud Drive Sync PRD](../20260609-muzero-r2-cloud-drive-sync-prd/20260609-muzero-r2-cloud-drive-sync-prd.md), a custom cover set on the laptop should appear on the phone.

**Two things make this non-trivial — and are exactly why this is a PRD, not a quick patch:**

1. **Entities are derived, not stored.** There is no `artists` / `albums` row to hang a `coverBlobId` on. Identity is a *computed key*: `normalizeArtistName(name)` for an artist, and `AlbumEntry.key` = `` `${albumArtistKey}::${normalizedAlbum}` `` for an album ([library-index.ts](../../../src/lib/library-index.ts)). A custom cover must be keyed by that derived key and survive re-projection on re-import.
2. **The sync protocol is set-scoped.** Today every synced object lives under `sets/<id>/…` ([r2-export-plan.ts](../../../src/sync/r2-export-plan.ts)), and **even set-level covers are not synced** — only per-track covers ride along inside a set's track payload (`r2SetTrackSchema.cover` in [r2-manifest-schema.ts](../../../src/sync/r2-manifest-schema.ts)). Artist/album covers are **library-global** (an artist spans many sets), so they need a brand-new **library-scoped object namespace** — the first of its kind.

### 1.2 Target Users

| Role | Description | Need |
|------|-------------|------|
| **Local listener** | Browses 专辑 / 歌手 tabs, curates memories | Set a real artist photo / album art that replaces the auto-picked track cover |
| **Multi-device owner** | Has the R2 drive connected on ≥2 devices | A cover set on one device appears on the others, last-write-wins on conflict |

### 1.3 Core Value

1. **Deliberate identity** — an artist/album shows the picture *you* chose, not whichever member track happened to have art.
2. **Consistent affordance** — set/replace/clear a cover the same way as tracks and sets (drop / paste / click → crop), reusing [`CoverCropDialog`](../../../src/components/track/cover-crop-dialog.tsx).
3. **Travels with you** — covers sync through the existing R2 drive, establishing the reusable *library-scoped* sync lane for future library-global data.

### 1.4 Scope

- **In scope:** real named artists and albums; set / replace / clear; local persistence; R2 export + pull/import + conflict.
- **Out of scope (this PRD):** the long-tail pseudo-entities — Unknown Artist, Generated, Various-Artists compilations, Unknown Album (`ArtistEntry.bucket` / `AlbumEntry.bucket` / `isCompilation` in [library-index.ts](../../../src/lib/library-index.ts)). They keep the placeholder icon; their sentinel keys are never written.

---

## 2. System Architecture

### 2.1 Where it plugs in

```
EntityDetailView header (artist/album)
   │  drop / paste / click  →  CoverCropDialog (reused)
   ▼
setEntityCover(entityKey, kind, blob, mime, crop)         ┐  Phase 1–2
   │   bytes → mediaBlobs (role "cover", trackId = entityKey)
   │   row   → entityCovers { id: entityKey, kind, coverBlobId, updatedAt }
   │   log   → syncMutations { scope: "entity-cover", entityId: entityKey }
   ▼
useEntityCoverUrl(entityKey, fallbackTrack)  →  override ?? coverTrack
   ▼ (sync, Phase 3–4)
r2-export-plan  →  library/entities/<kind>/<keyHash>/cover.json  +  objects/covers/sha256-…
   ▲                                   ▼
r2-pull-diff / r2-import-stream  ◄──  manifest entityCovers section
```

### 2.2 Reused building blocks (do **not** reinvent)

| Need | Reuse |
|------|-------|
| Owner-keyed cover blob | [`setSessionCover`](../../../src/db/repositories.ts) pattern — `mediaBlobs.add({ trackId: <ownerId>, role: "cover", … })`; here ownerId = entityKey |
| Crop UX | [`CoverCropDialog`](../../../src/components/track/cover-crop-dialog.tsx) (`onConfirm(rect: CropRect)`) |
| Cover URL hook | `useSetCoverUrl` shape in [search-page.tsx](../../../src/pages/search-page.tsx) → new `useEntityCoverUrl` |
| Entity keys | [`normalizeArtistName`, `AlbumEntry.key`](../../../src/lib/library-index.ts) |
| Drop/paste routing | image cover-target store from the prior task ([cover-target-store.ts](../../../src/stores/cover-target-store.ts)) — extend with an entity target |
| Content-addressed blob upload | [`loadOptionalBinaryObject` + `objects/covers/sha256-…`](../../../src/sync/r2-export-plan.ts) |
| Mutation log + LWW | [`syncMutations`](../../../src/db/types.ts) + [`r2-conflict-resolution.ts`](../../../src/sync/r2-conflict-resolution.ts) |
| Heavy hashing off main thread | [`src/workers`](../../../src/workers/) (R2 hash/sign already there) |

---

## 3. Data Model

### 3.1 New table `entityCovers` (schema **v19**, additive)

Add to [`muzero-db.ts`](../../../src/db/muzero-db.ts) (`this.version(19).stores({ … })`, no `.upgrade()` backfill — purely additive):

```ts
// db/types.ts
export interface EntityCover {
  id: string;            // = entityKey (artist: normalizeArtistName; album: AlbumEntry.key)
  kind: "artist" | "album";
  coverBlobId: string;   // FK → mediaBlobs (role "cover", trackId = id)
  crop?: CropRect;       // square crop, same shape as Track.coverCrop
  updatedAt: number;     // LWW clock for sync
}
```

```
entityCovers: "id, kind, updatedAt"
```

- **Blob bytes** go in `mediaBlobs` with `role: "cover"`, `trackId = entityKey` — identical to how `setSessionCover` keys a set cover by `sessionId`. No new `MediaBlob.role` value needed.
- **Codename stability (Hard Rule #4):** the entity key format becomes a *persisted, frozen* value. `normalizeArtistName` and `AlbumEntry.key` must not change their output, or covers orphan. Document this alongside the existing codename invariants.

### 3.2 Resolution order

`useEntityCoverUrl(entityKey, fallbackTrack)`:
1. `entityCovers.get(entityKey)?.coverBlobId` → that blob (the **override**).
2. else `fallbackTrack` cover (current behavior — first member track with art).
3. else placeholder icon (`User` / `Disc3`).

Live via Dexie `useLiveQuery` so a newly set or pulled cover repaints the header, the entity grid tiles, and the artist "albums strip" without a reload.

---

## 4. Local Feature (Phases 1–2)

### 4.1 Repository ([repositories.ts](../../../src/db/repositories.ts))

```ts
setEntityCover(input: { entityKey: string; kind: "artist"|"album"; blob: Blob; mime: string; crop?: CropRect }): Promise<void>
getEntityCover(entityKey: string): Promise<Blob | undefined>
clearEntityCover(entityKey: string): Promise<void>
```
Each mirrors `setSessionCover`'s transaction (delete prior blob → add new → upsert row → bump `updatedAt`). Real-entity guard: callers must not pass a `bucket`/compilation sentinel key (enforce at the UI by hiding the affordance for pseudo-entities).

### 4.2 Entity-detail header UX ([entity-detail.tsx](../../../src/components/library/entity-detail.tsx))

Turn the header cover `<span>` into the same click / drop / paste target the set-detail cover button already is ([SetDetailView in search-page.tsx](../../../src/pages/search-page.tsx)):
- **Click** → file picker → `CoverCropDialog` → `setEntityCover`.
- **Drop image** on the header → crop → set.
- **Paste image** while on an entity page → set (extend the existing image cover-target so a published *entity* target routes through `GlobalDropZone` straight to crop, exactly like the track path added previously).
- **Clear** → small "remove custom cover" affordance when an override exists → `clearEntityCover` (falls back to the track cover).
- Skip all of the above when the entity is a pseudo-bucket.

i18n: new `gallery.*` keys (set/replace/clear/hint) added to **en** first, then zh/ja/ko.

---

## 5. R2 Sync — the new library-scoped lane (Phases 3–4)

> This is the bulk of the work and the reason for a PRD. Today sync is **set-scoped**; entity covers are **library-global**.

### 5.1 Remote key space

- **Mapping object (per entity):** `library/entities/<kind>/<keyHash>/cover.json` — small JSON `{ entityKey, kind, object: R2RemoteObject, crop?, updatedAt, author }`. `<keyHash>` = sha256 of the entityKey (keys contain `::`, spaces, unicode — must be path-safe; hash in the [worker](../../../src/workers/)).
- **Bytes:** reuse the existing content-addressed `objects/covers/sha256-…` directory (`binaryDirectory("cover")` in [r2-export-plan.ts](../../../src/sync/r2-export-plan.ts)). Bytes are deduped across tracks/sets/entities for free.
- **Index:** add an `entityCovers` array to the drive **manifest** (new `r2EntityCoverSchema` in [r2-manifest-schema.ts](../../../src/sync/r2-manifest-schema.ts)) listing each entity's mapping object so pull can diff the whole set without listing the prefix.

### 5.2 Export ([r2-export-plan.ts](../../../src/sync/r2-export-plan.ts))

- Add `R2ExportObjectKind` member `"entity-cover"`; `binaryDirectory` stays `objects/covers` for the bytes; the mapping JSON is a new `createJsonObject("entity-cover", \`library/entities/…/cover.json\`, …)`.
- Plan entries are produced from **`syncMutations` of scope `"entity-cover"`** (mirrors how set/track/memory mutations drive the plan), not by diffing every entity each run.

### 5.3 Mutations & conflict

- Extend `SyncMutation.scope` union ([db/types.ts](../../../src/db/types.ts):623) → add `"entity-cover"`; `entityId = entityKey`. `setEntityCover` / `clearEntityCover` write a mutation like the existing repos do.
- Conflict = **last-write-wins by `updatedAt`** with device attribution, reusing [`r2-conflict-resolution.ts`](../../../src/sync/r2-conflict-resolution.ts) (add `entityType: "entity-cover"`). A clear is a tombstone mutation (cover removed) resolved by the same clock.

### 5.4 Pull / import ([r2-pull-diff.ts](../../../src/sync/r2-pull-diff.ts), [r2-import-stream.ts](../../../src/sync/r2-import-stream.ts))

- Pull diff reads the manifest `entityCovers` section, compares remote `updatedAt` to the local `entityCovers` row, and downloads changed mapping objects + their `objects/covers/sha256-…` bytes.
- Import writes `mediaBlobs` (role `cover`, `trackId = entityKey`) + upserts the `entityCovers` row (respecting LWW). A tombstone deletes the local override.

---

## 6. Edge Cases & Limitations

1. **Key drift orphans covers (accepted for v1).** Album key depends on album-artist + album title; artist key on the normalized name. Editing those tags re-projects to a *new* key, so the custom cover detaches (the row remains, unreferenced). Document it; a future "re-key on rename" migration is out of scope. A periodic GC can prune `entityCovers` rows whose key no longer exists in the derived indexes.
2. **Pseudo-entities excluded.** Unknown / Generated / Various-Artists never get the affordance and never sync.
3. **Cross-shell isolation unchanged.** Electron vs Tauri keep separate IndexedDB (known limitation); R2 is the bridge.
4. **No MUZERO backend (Hard Rule #1).** Covers live in IndexedDB + the user's own R2 bucket only.

---

## 7. Phases & Checklists

### Phase 1 Checklist — Local store + resolution
- [x] `EntityCover` type + `entityCovers` store at db **v19** (additive, no upgrade) — [types.ts](../../../src/db/types.ts), [muzero-db.ts](../../../src/db/muzero-db.ts)
- [x] `setEntityCover` / `getEntityCover` / `clearEntityCover` (mirror `setSessionCover`) — [repositories.ts](../../../src/db/repositories.ts)
- [x] `useEntityCoverUrl(entityKey, fallbackTrack)` (override → fallback) — [use-media.ts](../../../src/hooks/use-media.ts), reuses `useTrackCoverUrl` crop pipeline
- [x] Unit tests: repo round-trip + replace + clear ([entity-cover-repo.test.ts](../../../src/db/entity-cover-repo.test.ts)) + hook fallback precedence ([use-media.test.ts](../../../src/hooks/use-media.test.ts))

### Phase 2 Checklist — Entity-detail UX
- [x] Header becomes click/drop/paste cover target (reuse `CoverCropDialog`); clear affordance — new [entity-cover-button.tsx](../../../src/components/library/entity-cover-button.tsx)
- [x] Page-wide paste on an entity page → crop → entity cover (own document listener, `stopPropagation` past GlobalDropZone). Supersedes Part-1's track cover-target on entity pages.
- [x] Hide the affordance for pseudo-entities — [entity-detail.tsx](../../../src/components/library/entity-detail.tsx) renders the button only when `entityKey` is passed; [search-page.tsx](../../../src/pages/search-page.tsx) omits it for `bucket` / `isCompilation`
- [x] `gallery.removeCover` in en→zh/ja/ko; component test for drop→set + clear ([entity-cover-button.test.tsx](../../../src/components/library/entity-cover-button.test.tsx))

> Note: the entity header uses `useEntityCoverUrl` (override → fallback track cover); the read-only placeholder span remains for pseudo-buckets.

### Phase 3 Checklist — Library-scoped object namespace
- [ ] `r2EntityCoverSchema` + manifest `entityCovers` section ([r2-manifest-schema.ts](../../../src/sync/r2-manifest-schema.ts))
- [ ] `R2ExportObjectKind: "entity-cover"`; `library/entities/<kind>/<keyHash>/cover.json` mapping; reuse `objects/covers` bytes
- [ ] entityKey → keyHash hashing in the worker
- [ ] Manifest schema tests

### Phase 4 Checklist — Mutations, pull/import, conflict
- [ ] `SyncMutation.scope: "entity-cover"`; write mutations from set/clear
- [ ] Export plan emits entity-cover objects from those mutations
- [ ] Pull diff + import write-back (LWW, tombstone on clear)
- [ ] Conflict resolution `entityType: "entity-cover"`
- [ ] Round-trip sync test (export → pull → import) + conflict test

---

## 8. Testing Strategy

- **Pure/repo:** `entityCovers` round-trip, resolution precedence, real-entity guard, key-hash stability — `fake-indexeddb` + Vitest.
- **Sync:** manifest schema (Zod), export-plan emits correct keys from mutations, pull-diff selects changed entities, import LWW + tombstone, conflict resolution — extend the existing `src/sync/*.test.ts` deterministic-clock pattern (inject `now`).
- **UI:** entity-detail set/clear (component test), pseudo-entity hides affordance.
- **Manual:** set an album cover on device A with the R2 drive connected → run sync → confirm it appears on device B; edit the album tag → confirm the documented orphan behavior.

---

## 9. Open Questions

1. **Manifest growth** — inline every entity cover in the drive manifest, or a separate `library/entities/index.json` the manifest points to? (Lean: separate index, mirrors `sets/<id>/index.json`.)
2. **GC cadence** — prune orphaned `entityCovers` on import, on library re-projection, or never (let them lie dormant)?
3. **Share scope** — do entity covers belong in *shared* drives/links too, or owner-drive only for v1? (Lean: owner drive only; shares are read projections.)
4. **Reuse a track cover** — offer "use this track's cover as the artist cover" (no new bytes, just point at an existing blob), like `setTrackCoverFromMemory`?

---

## 10. Out of Scope

- Re-keying covers when an artist/album is renamed via tag edits.
- Covers for pseudo-entities (Unknown / Generated / Various Artists).
- Cross-shell (Electron↔Tauri) local migration.
- Any MUZERO-hosted backend or asset CDN.
