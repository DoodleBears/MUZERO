# PRD: MUZERO Instant Cover Thumbnails (cache + thumbhash, no placeholder-icon flicker)

**Status:** Draft
**Created:** 2026-06-10
**Author:** MUZERO
**Module:** Media Library — make every cover/avatar/thumbnail feel instant: persist object URLs across mounts (zero flash on revisit), show a **thumbhash** preview the very first time (locally and for not-yet-downloaded remote covers), and fade the real image in instead of snapping from a blank icon.

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | Module-scoped object-URL cache (hook-level) | ✅ Completed | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | Shared `<CoverImage>` (fade + static placeholder) + rollout to all surfaces | 🔄 In Progress | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | Thumbhash data infra — owner-row field + generate-on-save + lazy backfill + R2 carry | 🔄 In Progress | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | `<CoverImage>` thumbhash placeholder layer | 🔲 Pending | [Phase 4 Checklist](#phase-4-checklist) |
| 5 | Tests + leak audit + polish | 🔲 Pending | [Phase 5 Checklist](#phase-5-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

In the 歌单 gallery ([`SearchPage`](../../../src/pages/search-page.tsx)), switching between the four tabs — **歌单 / 全部歌曲 / 专辑 / 歌手** (`sets` / `tracks` / `albums` / `artists`) — every cover first shows the no-cover placeholder icon (`Disc3` / `User`), then the real cover pops in a beat later. The same flicker happens when entering/backing out of a set/artist/album detail, and any time a grid re-mounts. It reads as jank on an otherwise-instant local-first app.

This is **not** a tab bug — it is how local-Blob covers are loaded, made visible by the tab's mount/unmount. Two things compound:

1. **Tab switch = full unmount → remount.** The gallery renders each mode with `{mode === "albums" && (…)}` conditionals ([search-page.tsx](../../../src/pages/search-page.tsx)). There is **no keep-alive**: leaving a tab destroys its grid; returning builds a fresh one.

2. **Each cover is fetched async from IndexedDB on every mount, with no cross-mount cache.** [`useTrackCoverUrl`](../../../src/hooks/use-media.ts) (and wrappers `useSetCoverUrl`, [`useEntityCoverUrl`](../../../src/hooks/use-media.ts)) run this chain on mount:

```
frame 0:  useLiveQuery(db.mediaBlobs.get(coverBlobId)) → undefined   →  url = null  →  Placeholder icon shows
async:    liveQuery resolves → Blob
effect:   URL.createObjectURL(blob)           → re-render → <img> appears   (revoked on unmount!)
(crop):   getCroppedBlob(blob, crop) canvas   → +1 async hop → createObjectURL   ← imported covers default to cropped
```

Every hop holds `url === null`, and the placeholder icon lives in that window. Because the object URL is created in an effect and **revoked on unmount**, returning to a tab re-runs the whole chain — the "already seen it once" cover is **not** persisted in any form. Cropped covers (the common case — `coverCropped` defaults on) pay an extra canvas round-trip, so they flicker the longest.

**Why a PRD, not a one-line patch:** the obvious fix ("just keep all tabs mounted") is the wrong one — heavy, wide side effects, and it still flickers on first load. The right shape is three layers, each touching shared infrastructure used by every cover surface: (a) a small cross-mount **object-URL cache** so a seen cover is instant forever; (b) a **thumbhash** preview so even a *cold* (or remote-only) cover shows a natural colored blur on frame 0 instead of a blank icon; (c) one **`<CoverImage>`** primitive that fades the real image in. Getting the cache lifecycle and the thumbhash storage location right is exactly the part worth specifying before coding.

### 1.2 Target Users

| Role | Description | Need |
|------|-------------|------|
| **Local listener** | Flips 歌单 / 全部歌曲 / 专辑 / 歌手, opens & backs out of details | Covers feel instant on revisit; a calm blurred preview on first sight, never a blank-icon flash |
| **Large-library owner** | Hundreds of imported tracks with embedded art | Smooth browsing without unbounded memory growth from cached object URLs |
| **Multi-device owner** | R2 drive connected; sees remote covers not yet downloaded | A remote-only cover shows its thumbhash immediately — the preview travels in the manifest, so browsing another device's library is silky before any byte downloads |
| **Reduced-motion / a11y user** | `prefers-reduced-motion: reduce` | No fade animation; the (static) thumbhash and final image simply appear |

### 1.3 Core Value

1. **Instant on revisit** — a cover shown once renders on the **first frame** of every later mount (tab switch, detail back-out, scroll re-use). Zero placeholder flash.
2. **Natural on cold/remote load** — the genuinely-first paint shows a **thumbhash** preview (the cover's own colors + true aspect ratio, blurred) and the sharp image fades over it. No blank-icon → image snap, even for covers whose bytes aren't downloaded yet.
3. **Bounded & leak-free** — caching is capped (LRU) and revoke-before-replace discipline is preserved; no Blob-URL leak, no runaway memory.
4. **One chokepoint, everywhere** — cache + thumbhash + fade live in the shared cover hook and one `<CoverImage>` primitive, so **every** image surface (track, set, artist, album, avatar, memory photo) benefits without per-call-site logic.

### 1.4 Scope

- **In scope:** all cover / avatar / thumbnail images that flow (or will flow) through [`useTrackCoverUrl`](../../../src/hooks/use-media.ts) & wrappers — gallery grids, set/artist/album detail headers, track rows, player dock cover, now-playing stage cover fallback, **device avatars**. Object-URL cache (all of them) + thumbhash preview (all owners with an owner row to store it on) + thumbhash carried in the **R2 manifest** so remote-only covers preview instantly.
- **Out of scope (this PRD):**
  - **Keep-alive tab mounting** — explicitly rejected (§2.4); the cache makes it unnecessary.
  - **Media-byte URLs** ([`useTrackMediaUrl`](../../../src/hooks/use-media.ts) — audio/video) — large, single-active, already lifecycle-managed by [`AudioEngine`](../../../src/player/audio-engine.ts) / [`MediaEngine`](../../../src/player/media-engine.ts). Different problem.
  - **Now-Playing full-bleed background renderers** (blur/pixel/ascii/crt…) — own pipeline; they gain the URL cache for free but do **not** use the thumbhash placeholder.
  - **Memory-photo thumbnails** — get the cache + `<CoverImage>`, but thumbhash for them is a Phase 4 *stretch* (split out if it bloats the cluster).
  - **Thumbnail downscaling** of huge covers (decode-cost win) — **deferred, not needed now** (Open Q8).
  - **shadcn `Skeleton`** — not introduced; thumbhash-over-static-surface replaces it (§5.2).

---

## 2. System Architecture

### 2.1 Where it plugs in

```
          WRITE PATH (Phase 3)                          READ PATH (Phase 1/2/4)
setTrackCover / setSessionCover / setEntityCover     EntityCard / SetCard / detail headers /
   │  bytes → mediaBlobs (role "cover")               track-row / dock / avatar
   │  thumbhash = rgbaToThumbHash(displayed pixels) ─ worker      │  calls
   │  → owner row: Track.coverThumbhash /                         ▼
   │    DjSession.coverThumbhash / EntityCover.thumbhash   useTrackCoverUrl(track)  (+ wrappers)
   │  → R2 manifest cover ref (Phase 3 §3.4)                      │  cacheKey from row fields (sync)
   ▼                                                              ▼
(owner row now carries thumbhash, available SYNC)        coverUrlCache.get(key) ? ──► HIT: url frame 0  ◄─ Phase 1
                                                                  │ MISS
                                                                  ▼  async: liveQuery → createObjectURL → (crop)
                                                                  │  on ready: cache.set + LRU evict/revoke
                                                                  ▼
                                                          <CoverImage url thumbhash fromCache placeholder>  ◄─ Phase 2/4
                                                            cache hit → instant (no fade, no decode)
                                                            cold + thumbhash → thumbHashToDataURL → fade <img> over it
                                                            cold + no thumbhash → bg-secondary → fade <img>
                                                            no cover at all → icon
                                                            reduced-motion → no fade (preview/img just appear)
```

### 2.2 Reused building blocks (do **not** reinvent)

| Need | Reuse |
|------|-------|
| Blob resolve + non-destructive square crop + URL lifecycle | [`useTrackCoverUrl`](../../../src/hooks/use-media.ts) — cache slots **inside** it; wrappers inherit it |
| Stable crop signature by value | Existing scalar-memo of `crop` in `useTrackCoverUrl` — reuse for the cache key |
| Canvas crop render (also feeds thumbhash encode) | [`getCroppedBlob`](../../../src/lib/image-crop.ts) |
| Owner-keyed cover write path (where thumbhash is generated) | [`setTrackCover` / `setSessionCover` / `setEntityCover` / `setTrackCoverFromMemory`](../../../src/db/repositories.ts) |
| Off-main-thread heavy work | [`src/workers/`](../../../src/workers/) — image decode + thumbhash encode (CLAUDE.md 规则 10) |
| Manifest cover refs (where thumbhash rides to R2) | [`r2-manifest-schema.ts`](../../../src/sync/r2-manifest-schema.ts) + the [entity-cover-sync PRD](../20260610-muzero-entity-cover-sync-prd/20260610-muzero-entity-cover-sync-prd.md) lane |
| Module-scoped non-reactive singleton | CLAUDE.md 规则 6 (AudioEngine/DjEngine pattern) — the cache `Map` is the same shape |
| Logging | [`src/lib/logger.ts`](../../../src/lib/logger.ts) (规则 8) — never raw `console.*` |

### 2.3 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **Cache** | Module-scoped `Map` + small LRU (in-memory) | Non-reactive singleton (规则 6); no DB, no store, no re-render churn |
| **Preview hash** | [`thumbhash`](https://github.com/evanw/thumbhash) — **vendored** MIT source ([`thumbhash.ts`](../../../src/lib/thumbhash.ts)), not the npm package | **Embeds aspect ratio + alpha** (no separate w/h to store, unlike blurhash); smaller, better perceptual quality. Vendored (see note) so the concurrently-edited lockfile stays untouched. `rgbaToThumbHash` at save, `thumbHashToRGBA`→canvas at display |
| **Encode work** | Web Worker ([`src/workers/`](../../../src/workers/)) | Image decode + `rgbaToThumbHash` off the main thread (规则 10) |
| **Decode → preview** | `thumbHashToDataURL(hash)` | Returns a ready data URL — no manual canvas; drop straight into the placeholder layer |
| **Presentation** | Tailwind v4 `opacity` transition on `<img onLoad>` | CSS transition (not rAF) — survives the Preview hidden-tab rAF freeze; honors `prefers-reduced-motion` |

> **External-dependency declaration (per PRD guide §3):** `thumbhash` — `license.spdx: MIT`, `source: clean-room vendored (evanw/thumbhash, MIT, attribution header in [`thumbhash.ts`](../../../src/lib/thumbhash.ts))`, ship-friendly. **Vendored rather than `pnpm add`** because this shared branch had a large in-flight electron-builder change sitting uncommitted in `package.json` / `pnpm-lock.yaml` (~2000 lock lines); adding the dep would have forced bundling that WIP into this commit (or a broken partial lockfile). Vendoring keeps the manifest untouched and matches the guide's "prefer home-grown, don't add a runtime owner" rule. The codec is ~150 pure lines, exhaustively unit-tested; trimmed to `rgbaToThumbHash` / `thumbHashToRGBA` / aspect-ratio (the UI renders decoded RGBA via canvas, so upstream's PNG/data-URL helper is dropped). Chosen over `blurhash` because the hash encodes its own aspect ratio.

### 2.4 Rejected alternative — keep-alive tab mounting

Keeping all four mode panels mounted (`hidden` instead of unmounted) would avoid the re-fetch, **but**: N grids + hundreds of `<img>`/liveQuery subscriptions/object URLs alive at once; the gallery's roving focus, scroll-restore, and `mode`-gated key listeners ([search-page.tsx](../../../src/pages/search-page.tsx)) all assume one live surface (large, bug-prone to make visibility-aware); **and it doesn't fix first load**. The object-URL cache delivers the "persisted after first view" outcome at the data layer, without holding DOM hostage. **Decision: cache, not keep-alive.**

---

## 3. Data Model Design

### 3.1 Thumbhash lives on the OWNER row, not the blob row

The whole value of a preview hash is showing it **synchronously on frame 0**, before the cover blob resolves. `coverBlobId` and `coverCrop` already live on the owner row (`Track` / `DjSession` / `EntityCover`) and are available at render time; only the blob **bytes** were ever async. Therefore the thumbhash string must sit next to them on the owner row — **not** on the [`MediaBlob`](../../../src/db/types.ts) row, because reading the MediaBlob row is the very async hop we're trying to beat.

```
Track       { …, coverBlobId, coverCrop, coverThumbhash?: string }   ← NEW
DjSession   { …, coverBlobId, coverCrop, coverThumbhash?: string }   ← NEW
EntityCover { …, coverBlobId, crop,      thumbhash?:      string }   ← NEW
DeviceRecord/profile avatar  { …, avatarThumbhash?: string }         ← NEW (Q7: avatars in scope)
(memory photo: Memory.photoThumbhash? — Phase 4 stretch)
```

The value is a base64 thumbhash (~25–30 chars) **derived from our cover bytes**, not from the file's embedded tags, so it is a top-level field — **not** inside [`TrackMediaMetadata`](../../../src/db/types.ts) (which holds parsed native tag frames). Because thumbhash self-describes aspect ratio, no companion width/height column is needed.

### 3.2 No migration required (additive non-indexed field)

Dexie declares only **indexes** in `.stores()`; non-indexed properties are schemaless and can be added freely — exactly like the [`MediaBlob`](../../../src/db/types.ts) note "New roles are additive… no schema bump." `coverThumbhash` is never indexed, so:

- **No DB version bump.** Current schema stays at **v19** ([muzero-db.ts](../../../src/db/muzero-db.ts)); no `.upgrade()`.
- **Old rows simply lack the field.** They render the plain `bg-secondary` placeholder until backfilled.

### 3.3 Generation (write path) & backfill

- **Generate at cover-set.** In `setTrackCover` / `setSessionCover` / `setEntityCover` / `setTrackCoverFromMemory` ([repositories.ts](../../../src/db/repositories.ts)): after writing the blob, encode a thumbhash and write the string onto the owner row in the **same transaction**.
- **Encode from the displayed framing.** Encode from the **crop-applied** RGBA (reuse `getCroppedBlob`) so the preview matches what the user sees. `setTrackCoverCrop` (crop-only edit, no new blob) **also** regenerates the thumbhash (cheap; keeps the preview aligned with framing).
- **Off-thread.** Decode → resize to thumbhash's ≤100 px max edge → `rgbaToThumbHash` runs in a Web Worker ([`src/workers/`](../../../src/workers/)); the cover-set call is already async, so awaiting the round-trip is fine.
- **Lazy backfill (self-healing).** When `useTrackCoverUrl` resolves a cover blob whose owner row has no thumbhash, enqueue a one-time worker encode and persist it. Dedupe/throttle by owner id so a grid of 50 legacy covers doesn't stampede the worker.
- **Immutability holds.** Editing a cover already writes a **new** `coverBlobId` ([repositories.ts](../../../src/db/repositories.ts) `setSessionCover`/`setEntityCover` delete-then-add); the new thumbhash is written alongside, so preview and bytes never drift.

### 3.4 R2 sync (in scope — silky remote browsing)

Resolved (Open Q6): **carry the thumbhash in the manifest cover refs.** It's ~30 chars and rides the same manifest the cover already travels in (`r2SetTrackSchema.cover`, set-cover, entity-cover json — [r2-manifest-schema.ts](../../../src/sync/r2-manifest-schema.ts), extending the [entity-cover-sync PRD](../20260610-muzero-entity-cover-sync-prd/20260610-muzero-entity-cover-sync-prd.md) lane). On import, the thumbhash lands on the owner row alongside `remoteCoverUrl` / `remoteCover`. For a **remote-only** cover (bytes not downloaded) this is the *only* possible preview, so it's where the "丝滑" payoff is largest — browsing another device's library shows colored previews before a single image byte arrives.

---

## 4. API Design

No network/server API beyond the manifest field. "API" = the hook + component surface. Phase 1 (cache) is **source-compatible → zero call-site changes**; thumbhash adds one optional prop.

### 4.1 Hook surface

| Symbol | Signature | Change |
|--------|-----------|--------|
| [`useTrackCoverUrl`](../../../src/hooks/use-media.ts) | `(track) → string \| null` | **Internal** — consults `coverUrlCache` first; cache hit returns synchronously; populates on miss. Same return type. |
| `useSetCoverUrl` / [`useEntityCoverUrl`](../../../src/hooks/use-media.ts) | unchanged | Inherit caching via `useTrackCoverUrl`. |
| `useCoverThumb` (optional new) | `(owner) → { url, thumbhash, fromCache }` | Bundles url + owner-row thumbhash + cache-hit flag for `<CoverImage>`. Avoids each call site re-reading the field. |

### 4.2 New presentation primitive

```tsx
// src/components/ui/cover-image.tsx (new — shared primitive that REMOVES ~6 duplicated ternaries)
<CoverImage
  url={coverUrl}            // from useTrackCoverUrl / useSetCoverUrl / useEntityCoverUrl
  thumbhash={owner.coverThumbhash}  // optional; thumbHashToDataURL → blurred placeholder layer
  fromCache={…}             // skip fade + skip thumbhash decode when instant
  placeholder={<Disc3 …/>}  // shown only when there is NO cover at all
  rounded                   // artist/avatar = round; album/set/track = square
  className="size-full object-cover"
/>
```

Layering: a static surface holds (thumbhash data-URL `<img>` if present, else `bg-secondary`, else `placeholder` icon); the real `<img>` is layered above and transitions `opacity 0→1` on `onLoad` (cold) or starts at `1` (cache hit / reduced-motion).

### 4.3 Error / edge handling

- **Missing blob** (id present, row gone) → liveQuery `undefined` → thumbhash (if any) stays visible → fall back to `remoteCoverUrl ?? null`.
- **Eviction of a still-mounted URL** → prevented by ref-counting (§ Phase 1).
- **Thumbhash decode/encode failure** → log via `logger`, treat as "no thumbhash" → plain `bg-secondary`. Never throw into render.

---

## 5. Frontend Design

### 5.1 Affected surfaces (Q5/Q7 — everywhere a cover/avatar/thumbnail shows)

| Surface | File | Phase 1 cache | Phase 2 `<CoverImage>` | Phase 4 thumbhash |
|---------|------|:---:|:---:|:---:|
| Album/Artist grid cards | [`EntityCard`](../../../src/components/library/entity-grid.tsx) | auto | ✔ | ✔ |
| Set cards (grid + list) | [`SetCard`](../../../src/pages/search-page.tsx) | auto | ✔ | ✔ |
| Set detail header | [`SetDetailView`](../../../src/pages/search-page.tsx) | auto | ✔ | ✔ |
| Artist/Album detail header | [`EntityDetailView`](../../../src/components/library/entity-detail.tsx) | auto | ✔ | ✔ |
| Track rows | [`track-row.tsx`](../../../src/components/library/track-row.tsx) | auto | ✔ | ✔ |
| Player dock cover | dock cover surface | auto | ✔ (verify no double-animate) | ✔ |
| Device avatars | profile/avatar surfaces | auto | ✔ | ✔ (avatar owner row) |
| Memory-photo thumbnails | memory timeline | auto | ✔ | ◯ stretch |

Phase 1 is **call-site-free** (cache lives in the hook). Phase 2 replaces the repeated `coverUrl ? <img/> : <Icon/>` ternary with `<CoverImage>`.

### 5.2 UI / interaction — placeholder ladder

Resolved placeholder behavior (Q3 + Q4 unified):

1. **Cache hit** → final cover on first paint. No icon, no preview, no fade.
2. **Cold/remote load, thumbhash present** → decoded blurred preview on frame 0; sharp `<img>` fades in over it (~150 ms ease-out).
3. **Cold load, no thumbhash** (legacy / generation failed) → plain `bg-secondary` block; `<img>` fades in. (Backfill gives it a thumbhash next time.)
4. **No cover at all** → the kind icon (`Disc3` / `User`).
5. **Reduced motion** → no fade; preview and final image just appear.

**Skeleton deliberately NOT used:** a sub-200 ms shimmer looks worse than a calm preview/fade, and thumbhash is a strictly better cold-load affordance. (Repo has no `Skeleton` component anyway.)

### 5.3 State management

No Zustand/store involvement (规则 6 — non-reactive singleton stays in module scope, never store state, so cover loads never re-render the tree). The cache is a plain module `Map`/LRU; thumbhash is plain row data read synchronously.

---

## 6. Implementation Plan

### Phase 1: Module-scoped object-URL cache (hook-level)

**Goal:** Kill flicker on every **re-mount** (tab switch, detail back-out, scroll re-use). A cover seen once renders on frame 0 forever after. Zero call-site changes.

**Best-practice decisions baked in (resolved Open Qs):**
- **Eviction = ref-count + warm LRU (Q2).** Each mounted hook `acquire`s its key (`refs++`) and `release`s on unmount (`refs--`). A URL is revoked **only** when evicted from the LRU while `refs === 0`. Mounted covers are never revoked. Cap ≈ 256 entries (tune in Phase 5).
- **Key by codename-stable id + crop sig (规则 4):** `blb_…` + `:x,y,w,h`.

**Tasks:**
- [x] Add `ObjectUrlCache` (ref-counted LRU `Map`) in [`object-url-cache.ts`](../../../src/lib/object-url-cache.ts): `peek` / `get` / `acquire` / `store` / `release` / `evict(+revoke)`; singleton `coverUrlCache`. (Lifted into its own module so the policy is pure-unit-testable with an injected `revoke`.)
- [x] Compute `cacheKey` synchronously in [`useTrackCoverUrl`](../../../src/hooks/use-media.ts); `peek` hit → return URL on frame 0; miss → existing async path (blob → optional crop) then `store`. Ref-count via mount `acquire` / unmount `release`; **never revoke on unmount** (cache owns the URL).
- [x] Verified cover edits allocate a **new** `blb_…` id (`setTrackCover` / `setSessionCover` / `setEntityCover` delete-then-add) → new key → automatic invalidation.

### Phase 1 Checklist
- [x] No placeholder flash on re-mount for a cover seen once — proven by [use-media.test.tsx](../../../src/hooks/use-media.test.tsx) "created once, returned synchronously across re-mounts". (Covers 歌单⇄专辑⇄歌手 tab cycling and detail enter/back — both are the same unmount→remount path.)
- [x] Editing a cover shows new art immediately (new blob id → new key → cache miss; no stale cache).
- [x] Object-URL count stays bounded while browsing a large library — LRU eviction + revoke proven in [object-url-cache.test.ts](../../../src/lib/object-url-cache.ts).
- [x] URL not revoked on unmount (cache lifetime) — asserted in the hook test.

> **Tests:** 13 passing (10 cache-policy + 3 hook integration). `make check` typecheck + biome clean on the changed files.

### Phase 2: Shared `<CoverImage>` + rollout to all surfaces

**Goal:** Smooth cold first paint; centralize the cover render; cover **every** surface (Q5/Q7).

**Decisions:** **skip fade on cache hit (Q3)** via `fromCache`; **cold placeholder = `bg-secondary` block** (Q4, pre-thumbhash).

**Tasks:**
- [x] Create [`cover-image.tsx`](../../../src/components/ui/cover-image.tsx): static surface + layered `<img>` `onLoad` opacity fade, reduced-motion guard (`motion-reduce:transition-none`), `rounded` prop (square radius via `className`), overlay `children`, and skip-fade-on-instant via `img.complete` on mount (no hook change needed for the cache-hit case).
- [x] Roll out to clean read-only surfaces: `SetCard` (歌单 grid + list) and the artist/album detail headers + album strip ([entity-detail.tsx](../../../src/components/library/entity-detail.tsx)).
- [ ] **Deferred — files under concurrent edit on this branch:** `EntityCard` ([entity-grid.tsx](../../../src/components/library/entity-grid.tsx)) and `track-row` ([track-row.tsx](../../../src/components/library/track-row.tsx)) carry other agents' uncommitted changes; rolling `<CoverImage>` into them now would bundle that WIP into this commit (violates the shared-branch isolation rule). Their **flicker is already gone via Phase 1's cache**; the `<CoverImage>` fade is cosmetic polish to apply once those land.
- [ ] **Deferred — interactive cover surfaces:** the set-detail header button, [`EntityCoverButton`](../../../src/components/library/entity-cover-button.tsx), dock cover, and avatars embed the cover surface inside an interactive element with drop/paste/crop overlays; converting them needs `<CoverImage>` to compose with those affordances — follow-up.

### Phase 2 Checklist
- [x] Cold load fades in over a calm `bg-secondary` surface; an already-decoded (cached) cover starts loaded and skips the fade — proven in [cover-image.test.tsx](../../../src/components/ui/cover-image.test.tsx).
- [x] `prefers-reduced-motion` disables the transition (asserted in the component test).
- [x] No-cover shows the icon; the brief load window shows the calm block, not the icon (PRD Q4).
- [ ] All cover surfaces migrated (partial — see deferred rollout above).

> **Tests:** 5 passing (CoverImage placeholder/fade/reset/reduced-motion/overlay). biome + tsc clean on the changed surfaces.

### Phase 3: Thumbhash data infra

**Goal:** Generate + persist a thumbhash for every cover (Q1/Q4), without a migration, and carry it to R2 (Q6).

**Tasks:**
- [x] Vendor the `thumbhash` MIT codec ([`thumbhash.ts`](../../../src/lib/thumbhash.ts)) instead of adding the npm dep (see §2.3 note) — `rgbaToThumbHash` / `thumbHashToRGBA` / `thumbHashToApproximateAspectRatio`, attribution header. Exhaustively unit-tested ([thumbhash.test.ts](../../../src/lib/thumbhash.test.ts)): solid-color round-trip, aspect-ratio sign, left/right structure, alpha flag + split.
- [ ] Add `coverThumbhash?` to `Track` / `DjSession`, `thumbhash?` to `EntityCover`, `avatarThumbhash?` to the avatar owner ([types.ts](../../../src/db/types.ts)) — **no `.stores()` change** (§3.2).
- [ ] Encode helper (decode cropped pixels via `createImageBitmap`/canvas → resize ≤100 px → `rgbaToThumbHash` → base64). Main-thread at cover-set (cheap, user action); guarded → `undefined` on failure.
- [ ] Generate-on-save in `setTrackCover` / `setSessionCover` / `setEntityCover` / `setTrackCoverFromMemory` (+ avatar set); regenerate in `setTrackCoverCrop`.
- [ ] Lazy backfill in `useTrackCoverUrl` (one-time, deduped per owner id).
- [ ] Carry thumbhash in R2 manifest cover refs + land it on import next to `remoteCoverUrl` / `remoteCover` (§3.4).

### Phase 3 Checklist
- [x] Vendored codec is correct (encode/decode round-trip, aspect ratio, alpha) — 4 tests green.
- [ ] Setting a new cover stores a thumbhash on the owner row, same transaction.
- [ ] Crop-only edit refreshes the thumbhash.
- [ ] Browsing legacy covers backfills their thumbhash exactly once each.
- [ ] Export→import round-trip preserves the thumbhash on the remote owner row.

### Phase 4: `<CoverImage>` thumbhash placeholder layer

**Goal:** Cold/remote loads show the cover's own blurred colors, not a blank surface.

**Tasks:**
- [ ] `thumbHashToDataURL(hash)` → placeholder layer; skip decode entirely when `fromCache`.
- [ ] Placeholder ladder per §5.2 (thumbhash → `bg-secondary` → icon); reduced-motion shows preview+image without fade.
- [ ] (Stretch) memory-photo thumbnails.

### Phase 4 Checklist
- [ ] First-ever view of a cover shows its thumbhash, then the sharp image fades in.
- [ ] Remote-only covers (manifest thumbhash, no local bytes) show the preview.
- [ ] No decode work on cache hits.

### Phase 5: Tests + leak audit + polish

**Tasks:**
- [ ] Vitest + `fake-indexeddb`: cache **hit** returns URL synchronously on re-mount; **invalidation** (changed blobId); **LRU eviction** revokes; **mounted never revoked**.
- [ ] Thumbhash: generate-on-save writes owner row; crop edit regenerates; backfill runs once; import lands the hash.
- [ ] Pure-unit the cacheKey builder + LRU math (规则 7).
- [ ] Leak audit: mount/unmount a grid N times → object-URL count bounded.
- [ ] `make check` green.

### Phase 5 Checklist
- [ ] All cache + thumbhash + leak tests green.
- [ ] `make check` (typecheck + lint + test) passes.

---

## 7. Out of Scope

- **Keep-alive tab mounting** — rejected for the cache (§2.4).
- **Caching media bytes** (audio/video via `useTrackMediaUrl`) — managed by AudioEngine/MediaEngine.
- **Now-Playing full-bleed background** thumbhash — keeps its own renderer pipeline (gets the URL cache only).
- **Memory-photo thumbhash** — cache + `<CoverImage>` yes; thumbhash is a Phase 4 stretch.
- **Thumbnail downscaling** for very large covers — **deferred, not needed now** (Open Q8 resolved).
- **shadcn `Skeleton`** — superseded by thumbhash (§5.2).
- **DB migration** — none required (additive non-indexed field, §3.2).

---

## 8. Security Considerations

- **Local-first, no backend (规则 1):** cache is in-memory; thumbhash is derived on-device. The only outbound is the existing user-configured R2, where the tiny string rides the manifest the cover already travels in.
- **No PII / no bytes leak:** the cache holds only ephemeral `blob:` URLs; thumbhash is a ~30-char lossy color summary of an image the user already chose to store/share. Nothing leaves the device that wasn't already syncing.
- **No hidden flags (规则 3):** cache cap, fade duration, thumbhash size are code constants; any runtime toggle goes in visible Settings. Rollback = `git revert` (+ the thumbhash field harmlessly lingers on rows; readers ignore it).
- **Codename stability (规则 4):** cache keyed on stable `blb_…`; new fields don't touch DB names, id prefixes, blob roles, or any index.
- **No Blob-URL leak:** revoke-before-replace preserved; LRU is the sole revoker of cached URLs.

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [Custom Artist/Album Covers (R2 Sync) PRD](../20260610-muzero-entity-cover-sync-prd/20260610-muzero-entity-cover-sync-prd.md) | `useEntityCoverUrl` / `EntityCover` / manifest cover refs — direct consumer; §3.4 extends its sync lane with thumbhash |
| [Artist & Album Library Entities PRD](../20260610-muzero-artist-album-library-entities-prd/20260610-muzero-artist-album-library-entities-prd.md) | The derived 专辑 / 歌手 grids that flicker today |
| [`src/hooks/use-media.ts`](../../../src/hooks/use-media.ts) | Cover/media URL hooks — primary edit surface |
| [`src/db/repositories.ts`](../../../src/db/repositories.ts) | `setTrackCover` / `setSessionCover` / `setEntityCover` — thumbhash generation hooks |
| [`src/sync/r2-manifest-schema.ts`](../../../src/sync/r2-manifest-schema.ts) | Manifest cover refs that carry the thumbhash to R2 |
| [`CLAUDE.md`](../../../CLAUDE.md) | 规则 1/3/4/6/7/8/10 invoked above |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | Preview hash: `blurhash` vs `thumbhash`? | Resolved | **`thumbhash`, vendored** (MIT source inlined, not npm) — embeds aspect ratio + alpha, smaller; vendored to avoid touching the concurrently-edited lockfile (~2000 in-flight lines). `blurhash` kept as a fallback option. |
| 2 | LRU eviction policy & cap? | Resolved | **Ref-count + warm released-LRU**, cap ≈256, revoke on eviction (Phase 1). Tune cap in Phase 5. |
| 3 | Skip fade on cache hit? | Resolved | **Yes** — `fromCache` skips both the fade and the thumbhash decode. |
| 4 | Cold placeholder when no thumbhash? | Resolved | Plain **`bg-secondary`** block (no dim icon); the kind icon only when there's no cover at all. |
| 5 | Apply to all cover surfaces? | Resolved | **Yes** — track, set, artist, album, avatar route through `<CoverImage>` + cache (+ thumbhash where an owner row exists); memory-photo cache+component now, thumbhash stretch. |
| 6 | Carry the preview hash in the R2 manifest? | Resolved | **Yes, in scope (Phase 3)** — it's the only preview for remote-only covers; makes cross-device browsing silky. |
| 7 | Avatars / memory photos in scope? | Resolved | **Avatars: yes.** Memory-photo thumbhash: Phase 4 stretch (cache + component still apply now). |
| 8 | Downscaled thumbnail derivatives for very large covers? | Resolved | **Deferred — not needed now.** Revisit only if decode shows up in `longtask`. |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-10 | MUZERO | Initial draft — object-URL cache (Phase 1) + `<CoverImage>` fade (Phase 2) + tests; rejected keep-alive |
| 2026-06-10 | MUZERO | Resolved Open Qs 1–5; added a preview-hash placeholder (Phases 3–4): owner-row field (no migration), generate-on-save in a worker, lazy backfill; expanded surfaces to avatars + memory thumbnails |
| 2026-06-10 | MUZERO | **Switched preview hash blurhash → `thumbhash`** (embeds aspect ratio/alpha, smaller); brought **R2 manifest carry into scope** (Q6); confirmed avatars in scope (Q7); deferred thumbnail downscaling (Q8). All Open Qs resolved. |
| 2026-06-10 | MUZERO | **Phase 1 ✅, Phase 2 🔄** (CoverImage + set/entity rollout; entity-grid/track-row deferred under concurrent edits). **Phase 3 🔄**: vendored the thumbhash MIT codec (not npm `pnpm add`) to avoid bundling a large in-flight electron-builder lockfile change on this shared branch; codec unit-tested. |

---

> **Note:** Phase 1 modifies the existing shared hook ([`use-media.ts`](../../../src/hooks/use-media.ts)) with **no call-site changes**. Phase 2 adds one net-new file ([`cover-image.tsx`](../../../src/components/ui/cover-image.tsx)) — a shared primitive that *removes* duplicated ternaries. Phase 3 adds one third-party lib (`thumbhash`, MIT) and optional owner-row fields with **no DB migration**, following "infrastructure before presentation": data lands (Phase 3) before `<CoverImage>` renders it (Phase 4).
