# PRD: MUZERO Cover Render Pipeline Performance

**Status:** Draft
**Created:** 2026-06-13
**Author:** Codex
**Module:** Player / Library / Settings - cover rendering, palette extraction, thumbnails, backlight, and diagnostics

---

## Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 0 | Baseline and Observability | In Progress | [Phase 0 Checklist](#phase-0-checklist) |
| 1 | Workerized Cover Metadata Extraction | In Progress | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | Persistent Thumbnail Derivatives | In Progress | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | Precomputed Backlight Derivatives | In Progress | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | Hot-Table Decoupling and Repair UX | In Progress | [Phase 4 Checklist](#phase-4-checklist) |

> Status Legend: Completed | In Progress | Pending

---

## 1. Overview

### 1.1 Background

QA and trace logs show two related performance problems:

1. **Now Playing switches are smooth when the next track has no cover, but jank when the next track has a cover.**
   - During a single covered switch, playback can stay at 120 FPS before the switch.
   - The jank window starts after `playIndex()` and cover update, with frame max spikes around 50-216 ms.
   - `cover.palette.track-metadata` is cheap when present, but missing metadata triggers local palette extraction and DB writes during the switch.

2. **Tab 2 "All Songs" virtual list loses FPS while scrolling through covered tracks.**
   - The log shows `blobsCreated` rising from 138 to 325 while `blobsLive` stays near 66.
   - This indicates no object URL leak, but continuous object URL creation and full cover image decode as virtual rows mount.
   - FPS drops continue after object URL creation bursts, consistent with browser image decode, canvas work, compositor uploads, and GC tail latency.

Recent mitigations improved the symptoms but do not solve the root pipeline problem:

- Playback cursor writes were debounced so DB cursor-only writes no longer replay stale `currentIndex` through the full play queue liveQuery.
- Virtual list row covers can be deferred while scrolling and use thumbhash previews.
- Live palette extraction was delayed to idle instead of immediately running in the first 220 ms after a switch.

The remaining product problem is that full cover images and derived cover data are generated on demand by multiple UI surfaces. The app needs a single cover derivative pipeline that precomputes small assets off the main thread and lets UI surfaces render by reference.

### 1.2 Target Users

| Role | Description | Permissions |
|------|-------------|-------------|
| Desktop listener | Plays local/cloud music with album art, Now Playing backlight, visualizer, and large library lists | Can browse, play, edit covers, repair storage metadata |
| Power library user | Has thousands of tracks and scrolls large virtual lists while music plays | Can use Settings repair and performance HUD |
| QA / developer | Uses trace logs and perf HUD to reproduce FPS drops and verify fixes | Can enable visible perf HUD and export trace logs |

### 1.3 Core Value

1. **Smooth playback transitions:** Switching to a covered track should not block the release animation, audio load, or first second of playback.
2. **Smooth large library browsing:** Scrolling thousands of tracks should not decode full-size album art for 40 px thumbnails.
3. **Single source of truth for cover derivatives:** Palette, thumbhash, thumbnails, cropped display image, and backlight should be derived once, cached, and reused across Player, Library, Settings repair, and future surfaces.
4. **Visible and measurable performance:** Each optimization must have before/after frame cadence, long-task, object URL, and worker timing metrics.

---

## 2. System Architecture

### 2.1 Current Architecture

```
Track row / Now Playing / Background / Settings repair
          |
          v
useTrackCoverUrl(track)
          |
          +-- Dexie liveQuery -> resolveMediaBlob(coverBlobId)
          +-- optional getCroppedBlob(blob, crop) on main thread canvas
          +-- URL.createObjectURL(full/cropped image)
          +-- <img> decode in browser compositor

visualizer-dynamic-color / repositories / Settings repair
          |
          v
extractCoverPalette(blob, crop)
          |
          +-- getCroppedBlob(...) on main thread
          +-- extractImagePalette(...) via DOM Image + canvas + getImageData
          +-- db.tracks.update({ coverPalette, coverPaletteSource })

Now Playing backlight
          |
          v
full-size <img> + CSS blur/saturate/scale filter
```

### 2.2 Target Architecture

```
CoverDerivativeClient (main thread)
          |
          +-- in-flight request dedupe by coverSourceKey
          +-- priority queue: now-playing > visible list idle > Settings repair
          +-- trace + perf counters
          |
          v
Cover Worker
          |
          +-- decode image via createImageBitmap / OffscreenCanvas
          +-- apply crop once
          +-- produce:
              - thumbhash
              - palette
              - small thumbnail blob
              - optional stage-sized cropped blob
              - optional low-res backlight blob
          |
          v
CoverDerivativeRepository
          |
          +-- persist metadata and derivative blobs
          +-- batch DB writes
          +-- avoid hot full-table requery churn where possible
          |
          v
UI surfaces render small purpose-built assets:
          - Track rows: thumbnail derivative + thumbhash preview
          - Now Playing cover: warmed stage cover
          - Now Playing backlight: precomputed low-res glow image
          - Visualizers: stored palette, no switch-time extraction
          - Settings repair: same worker queue, progress + cancel
```

### 2.3 Technology Stack

| Component | Current | Target |
|-----------|---------|--------|
| Worker runtime | `src/workers/heavy-worker.ts`, `src/workers/search-worker.ts` | Add cover derivative worker/client using the same fallback pattern |
| Image decode | DOM `Image`, `<img>`, canvas on main thread | `createImageBitmap` + `OffscreenCanvas` in worker when available; idle main-thread fallback |
| Palette extraction | `src/lib/image-palette.ts` main-thread canvas | Reuse pure quantization; move pixel sampling into worker |
| Thumbnail/backlight | Not persisted; full image decoded per surface | Persist small derivative blobs and reuse object URLs |
| Storage | `tracks.coverThumbhash`, `tracks.coverPalette`, `mediaBlobs` | Add derivative storage with minimal schema churn; keep snapshots for compatibility |
| Observability | `DevPerfPanel`, `notePerfWork`, `traceEvent` | Add cover worker queue/timing/cache metrics |

### 2.4 Relevant Current Files

```
src/
├── hooks/use-media.ts                         # useTrackCoverUrl / cover object URL cache integration
├── lib/object-url-cache.ts                    # LRU/refcount object URL cache
├── lib/image-crop.ts                          # main-thread canvas crop
├── lib/image-palette.ts                       # main-thread image decode + palette sampling
├── lib/cover-palette.ts                       # cover palette wrapper + track fields
├── player/playback-preload.ts                 # current/prev/next cover warmup
├── components/player/media-stage.tsx          # Now Playing cover + backlight
├── components/player/swipeable-media-stage.tsx# coverflow preloading / overlay
├── components/player/visualizer-dynamic-color.tsx # live palette fallback/extraction
├── components/library/virtual-track-list.tsx  # virtual row mounting
├── components/library/track-row.tsx           # 40 px cover thumbnails
├── components/ui/cover-image.tsx              # shared thumbhash + image renderer
├── components/settings/persistent-storage-settings.tsx # repair cover metadata button
├── db/repositories.ts                         # createUploadedTrack + cover metadata backfill
├── db/types.ts                                # Track cover metadata fields
└── workers/
    ├── heavy-client.ts / heavy-worker.ts      # existing worker client pattern
    └── search-client.ts / search-worker.ts    # existing search worker pattern
```

---

## 3. Findings and Performance Risks

### 3.1 Findings From Logs

| Symptom | Evidence | Likely Cause |
|---------|----------|--------------|
| Covered switch janks; coverless switch is smooth | Playback is 120 FPS before switch; covered switch frame max reaches 50-216 ms | Full cover decode/composite, CSS backlight filter, palette extraction, DB writes |
| Tab 2 list scroll worsens over time | `blobsCreated` rises rapidly while `blobsLive` stays stable | Object URL churn and full image decode for virtualized thumbnails, not a leak |
| Missing palette worsens switch | `cover.palette.start` appears after switch; success ~300 ms later; long task spikes | Main-thread image decode/canvas/getImageData and track update during hot playback |
| Full-table requery can amplify jank | `listAllTracks`, `trackPlaybackStats`, `memoryNotesByTrack` requery after DB writes | Derived metadata stored on hot `tracks` rows can trigger O(N) recomputation |
| Backlight remains a candidate, but palette is the stronger proven cause | Runtime backlight duplicates the full cover image, but Settings cover-palette repair also drops 120 FPS to ~100 FPS without a Now Playing transition | Treat palette/decode/canvas work as Phase 1 priority; validate CSS blur/backlight separately before optimizing it |

### 3.2 Current Hot Paths

1. **`useTrackCoverUrl()` resolves full cover blobs for surfaces that often only need 40 px thumbnails.**
   - `TrackRow` historically called `useTrackCoverUrl(track)` for every visible row.
   - `ObjectUrlCache` prevents leaks but does not prevent decode/compositor work.
   - Cache capacity around 64 keeps live URLs bounded but increases churn when scrolling large lists.

2. **`getCroppedBlob()` and palette extraction use DOM canvas on the main thread.**
   - Crop happens before display URL creation and before palette extraction.
   - Palette extraction draws to a 96 px canvas and reads pixels with `getImageData`.
   - This is not huge per image, but it lands in the same main thread window as switching, list scrolling, or Settings repair.

3. **`visualizer-dynamic-color` can still trigger live palette work.**
   - Stored metadata is fast.
   - Missing metadata falls back to thumbhash and schedules extraction.
   - Even after idle delay, the actual decode/canvas work remains on the main thread.

4. **Settings repair uses the same main-thread extraction path.**
   - `PersistentStorageSettings.repairCoverMetadata()` loops over `backfillCoverMetadata`.
   - `backfillCoverMetadata` ultimately calls `extractCoverPalette` and thumbhash generation on the main thread.
   - It yields between batches, but each batch still competes with UI work.

5. **`db.tracks.update()` for derived cover metadata is expensive for Tab 2.**
   - `search-page.tsx` reads `listAllTracks(db)` and builds artist/album/search indexes.
   - Updating palette/thumbhash on `tracks` can retrigger full-table readers and downstream O(N) projections.
   - Coalescing helps, but repair of thousands of covers still creates repeated full-table invalidations.

6. **Backlight is rendered from the same full-size cover URL at runtime, but is not yet proven as the primary root cause.**
   - `MediaStage` and `TrackVisual` use a duplicate `<img>` with `filter: blur(...) saturate(...)`.
   - During coverflow and switch handoff this can mean multiple large filtered images exist at once.
   - However, Settings palette repair can lower FPS without the backlight path, so palette/image decode must be fixed first.

### 3.3 Non-Root Causes Already Reduced

- Playback cursor DB writes should not continuously drive `currentIndex` bounce.
- Lyrics cascade frame work is small in the recent logs when not intentionally stressing lyrics.
- `cover.preload.batch` can report near-zero work when object URL cache is warm; the expensive work may still be browser image decode/compositor outside that span.

---

## 4. Data Model Design

### 4.1 Existing Concepts

```
Track
  ├─ coverBlobId?        -> MediaBlob(role="cover")
  ├─ remoteCoverUrl?
  ├─ coverCrop?
  ├─ coverThumbhash?     # stored preview snapshot
  ├─ coverPalette?       # stored visualizer palette snapshot
  └─ coverPaletteSource?

MediaBlob
  ├─ role: media | cover | background | gallery | memory | avatar
  └─ blob/storageBackend/storageKey
```

### 4.2 Required Changes

Use additive fields/tables only. Avoid changing `muzero-db` name, existing IDs, or existing table semantics.

Recommended model:

```
CoverDerivative
  id/sourceKey: string        # contentHash/sourceIdentity + crop signature + algorithm version
  trackIds?: string[]         # optional owners; the derivative is cover-source scoped, not track-scoped
  sourceKind: "local-cover" | "remote-cover"
  sourceRef: string           # local blob id, remote URL hash, ETag, or content hash lookup hint
  contentHash?: string        # preferred long-term identity once bytes are available
  cropSig?: string
  thumbhash?: string
  palette?: CoverPaletteRgb[]
  paletteSource?: string
  thumbnailBlobId?: string    # MediaBlob role TBD
  backlightBlobId?: string    # MediaBlob role TBD
  stageBlobId?: string        # optional cropped display image
  generatedAt: number
  version: number             # derivative algorithm version
  error?: string
```

Storage options to evaluate:

| Option | Pros | Cons | Recommendation |
|--------|------|------|----------------|
| Add `coverDerivatives` table + derivative `MediaBlob` roles | Keeps hot `tracks` table quiet; central metadata for repair progress | Requires Dexie schema bump and repository work | Preferred for Phase 2+ |
| Store all metadata back on `Track` | Minimal code churn; current readers already work | Repair writes invalidate `listAllTracks` and large projections | Keep only compatibility snapshots; not ideal for bulk repair |
| Store thumbnails in `mediaBlobs` with new roles only | No new metadata table if derived by role scan | Harder to map crop/version/source and repair status efficiently | Acceptable only as a transitional step |

### 4.3 Migration Strategy

- Phase 1 can avoid schema change by workerizing palette/thumbhash and continuing to write current `Track` fields.
- Phase 2 should introduce the derivative table or equivalent metadata registry scoped to the cover source, crop signature, and derivative algorithm version.
- Existing `Track.coverThumbhash` and `Track.coverPalette` stay as read-compatible snapshots.
- New repair should batch writes and prefer derivative table updates; writing back to `tracks` should be optional, coalesced, and limited to compatibility snapshots.
- Rollback is `git revert`; no hidden localStorage or URL flags.

### 4.4 Privacy and Retention

- Derived thumbnails/backlight images are local artifacts from user cover art; they stay local in IndexedDB/OPFS/Electron storage.
- Trace logs must not include raw remote cover URLs or local paths. Use existing sanitizers (`sanitizeUrlForTrace`, `describeTrackCoverSource`).
- No telemetry or cloud upload is introduced.

---

## 5. API / Internal Interface Design

### 5.1 Worker Client

Add a cover worker client following the current `heavy-client.ts` pattern:

```ts
type CoverDerivativeRequest = {
  sourceKey: string;
  trackId?: string;
  blobBytes?: ArrayBuffer;
  remoteBytes?: ArrayBuffer;
  mime: string;
  crop?: CropRect;
  targets: Array<"thumbhash" | "palette" | "thumbnail" | "backlight" | "stage">;
  version: number;
};

type CoverDerivativeResult = {
  sourceKey: string;
  thumbhash?: string;
  palette?: Rgb[];
  thumbnail?: { bytes: ArrayBuffer; mime: string; width: number; height: number };
  backlight?: { bytes: ArrayBuffer; mime: string; width: number; height: number };
  stage?: { bytes: ArrayBuffer; mime: string; width: number; height: number };
  timings: {
    decodeMs: number;
    cropMs: number;
    paletteMs: number;
    thumbnailMs: number;
    backlightMs: number;
    totalMs: number;
  };
};
```

### 5.2 Main Thread Repository

The main thread should own persistence to keep storage decisions centralized:

- Resolve local cover bytes with `resolveMediaBlob`.
- Fetch remote cover bytes through existing app fetch/proxy path if needed.
- Transfer raw bytes to worker.
- Persist derivative blobs with existing media storage helpers.
- Update derivative metadata in one transaction.

### 5.3 Queue and Priority

| Priority | Source | Behavior |
|----------|--------|----------|
| High | Current / next / previous Now Playing covers | Start immediately, cancel stale requests on track change |
| Medium | Visible rows after scrolling settles | Batch with requestIdleCallback, dedupe by sourceKey |
| Low | Settings repair / legacy backfill | Background queue with progress and cancel |

### 5.4 Error Handling

- Worker unavailable: fallback to existing idle main-thread extraction, but record `cover.worker.unavailable`.
- Unsupported image format: store failure status for this derivative version so repair does not loop forever.
- Remote fetch fails: keep thumbhash/palette fallback when available; do not block playback.
- Crop decode fails: fallback to original full cover derivative or skip derivative.

---

## 6. Frontend Design

### 6.1 UI Components and Required Changes

| Surface | Current | Target |
|---------|---------|--------|
| Track row thumbnails | Full cover URL via `useTrackCoverUrl` | `useCoverDerivativeUrl(track, "thumbnail")`, thumbhash while pending |
| Virtual list | Mounting visible rows may trigger full cover decode | Scroll-time defer; settled rows request thumbnail derivatives |
| Now Playing cover | Full cover object URL | Full/stage cover warmed ahead; avoid duplicate decode where possible |
| Now Playing backlight | Full cover + runtime CSS blur/saturate | Precomputed low-res backlight image; CSS only opacity/transform |
| Visualizer color | Stored palette or live main-thread extraction | Stored palette from worker; no switch-time extraction except fallback |
| Settings repair | Main-thread batch loop | Worker queue with progress/cancel, repair counts by derivative target |

### 6.2 Settings UX

Extend the existing storage repair area in `persistent-storage-settings.tsx`.

Visible controls:

- **Repair cover metadata**: generate missing/outdated thumbhash and palette.
- **Optimize cover thumbnails**: generate missing/outdated row thumbnails.
- **Optimize cover backlight**: generate missing/outdated Now Playing backlight assets.
- **Cancel**: stop the background worker queue.

Progress details:

- Total candidates.
- Processed / updated / failed.
- Current phase: metadata, thumbnail, backlight.
- Worker status: active, idle, fallback.

No hidden runtime flags. Any optional runtime behavior must be exposed in Settings.

### 6.3 State Management

- Keep worker queue state outside Zustand unless UI needs it.
- Settings repair progress can live in local component state or a small store if multiple Settings panels need it.
- Player components should subscribe to minimal selectors and only request derivatives for current/nearby tracks.
- List rows should not subscribe to global queue state beyond `isCurrent` passed by parent.

---

## 7. Measurement Methodology

Performance acceptance must be based on Electron/Tauri desktop app runs, not only pure-browser dev-server impressions. The current priority target is the Electron app QA path.

### 7.1 Required Scenarios

1. **Covered single switch**
   - Start on a track with stable 120 FPS.
   - Switch to a track with local cover and missing derivatives.
   - Repeat after derivatives are warm.

2. **Coverless switch control**
   - Same playlist, switch to a track with no cover.
   - Confirms transport/media load baseline.

3. **Tab 2 large list scroll**
   - 5,000+ tracks.
   - Scroll continuously through covered rows.
   - Repeat after thumbnail repair is complete.

4. **Settings repair under playback**
   - Play music while repair runs.
   - Ensure repair does not create user-visible playback jank.

5. **Backlight on/off comparison**
   - Same covered switch with backlight mode off, shadow mode, and backlight mode.
   - Determines whether backlight contributes after palette/decode work is workerized; do not assume blur is the primary cause.

### 7.2 Metrics

Use existing `DevPerfPanel` / trace fields plus new cover-worker metrics.

| Metric | Target |
|--------|--------|
| `fpsAvg` during steady playback | 118-120 on 120 Hz display |
| Covered switch warm derivative `frameP99Ms` | <= 25 ms |
| Covered switch warm derivative `frameMaxMs` | <= 50 ms |
| Covered switch warm derivative `longTaskMaxMs` | < 50 ms |
| Tab 2 continuous scroll `frameP99Ms` | <= 33 ms |
| Tab 2 scroll `blobsCreated` delta per 100 rows after warm thumbnails | Near zero for thumbnails already cached |
| Settings repair | No repeated >50 ms long tasks during playback |
| Worker extraction | Trace timing by phase, no raw path/URL leakage |

### 7.3 New Trace Events

All logs go through `createDiagnosticLogger` / trace infrastructure.

- `cover.worker.enqueue`
- `cover.worker.start`
- `cover.worker.success`
- `cover.worker.failed`
- `cover.worker.cache-hit`
- `cover.derivative.persist`
- `cover.derivative.repair.batch`
- `cover.render.cache-miss`
- `cover.render.cache-hit`

Include:

- `trackId`
- `sourceKind`
- sanitized host/path hash for remote
- `targets`
- `queueDepth`
- `decodeMs`, `paletteMs`, `thumbnailMs`, `backlightMs`, `totalMs`
- `bytesIn`, `bytesOut` where useful

Do not include:

- raw URL
- local file path
- user note text
- image bytes

### 7.4 Electron QA Runbook

Run these scenarios in the Electron/Tauri desktop app with the visible perf HUD enabled, then copy the full trace from the HUD.

1. Covered single switch:
   - Start playback on a covered track.
   - Wait until `performance.frame` reports stable 118-120 FPS.
   - Switch once to a covered track with missing palette/derivatives.
   - Save the trace window around `cover.render.cache-miss`, `cover.palette.extract`, and any `longTaskMaxMs >= 50`.
2. Covered warm switch:
   - Repeat the same switch after metadata/derivatives are warm.
   - Confirm `cover.render.cache-hit` replaces cache misses where expected.
3. Coverless switch control:
   - Switch between tracks with no cover and compare frame cadence.
4. Tab 2 large-list scroll:
   - Scroll continuously through covered rows.
   - Compare `blobsCreatedByKind.image`, `cover.render.row.cache-miss`, and `cover.render.row.cache-hit`.
5. Settings repair under playback:
   - Run cover metadata repair while playback continues.
   - Capture `cover.palette.extract`, `cover.crop.canvas`, and `performance.frame`.

---

## 8. Implementation Plan

### Phase 0: Baseline and Observability

**Goal:** Make cover-related work visible enough to prove before/after changes.

**Tasks:**
- [x] Add trace counters for cover URL cache hits/misses by surface (`row`, `now-playing`, `background`, `coverflow`).
- [x] Add work spans around `getCroppedBlob`, `extractCoverPalette`, and `useTrackCoverResource` cache misses.
- [x] Add a trace summary that groups object URL creation by image/audio/video/other kind when the perf HUD is enabled.
- [x] Add a reproducible QA script for the five scenarios in section 7.1.
- [ ] Capture baseline logs in Electron/Tauri desktop app, not only dev server.

### Phase 0 Checklist

- [ ] Baseline trace is captured from the Electron/Tauri desktop app and includes frame cadence, long tasks, blob URL stats, DB requery stats, and cover work timings.
- [ ] Baseline includes covered switch, coverless switch, Tab 2 scroll, Settings repair.
- [x] No new hidden flags.

### Phase 1: Workerized Cover Metadata Extraction

**Goal:** Move palette/thumbhash extraction out of the main UI thread and make Settings repair use the same worker queue.

**Tasks:**
- [x] Add `src/workers/cover-worker.ts` and `src/workers/cover-client.ts`.
- [x] Move pixel sampling for palette into worker using `createImageBitmap` + `OffscreenCanvas`.
- [x] Move thumbhash generation into worker where browser support allows.
- [x] Keep `selectImagePalette` pure and shared/tested.
- [x] Replace live `visualizer-dynamic-color` extraction with worker queue request.
- [x] Replace `backfillCoverMetadata` direct extraction path or wrap it through the cover worker client.
- [x] Preserve fallback to inline extraction in the same scheduled caller context when Worker/OffscreenCanvas is unavailable.

### Phase 1 Checklist

- [x] Switching to a cover with missing palette does not run canvas/getImageData on main thread in the Electron worker path.
- [ ] Settings repair can run while music plays without repeated long tasks.
- [x] Existing `Track.coverThumbhash` / `Track.coverPalette` readers continue to work.
- [x] Unit tests cover worker fallback, in-flight dedupe, and result normalization.

### Phase 2: Persistent Thumbnail Derivatives

**Goal:** Stop list rows and small cards from decoding full-size cover images.

**Tasks:**
- [x] Define derivative identity: `coverBlobId + cropSig + algorithmVersion` or remote cover identity.
- [x] Persist 96-160 px thumbnail blobs for row/list/grid use.
- [x] Add `useCoverDerivativeUrl(track, "thumbnail")`.
- [x] Update `TrackRow` to request thumbnails instead of full covers.
- [x] Update set/album/artist cards and reorder lists to request thumbnails where visually appropriate.
- [x] Keep thumbhash preview visible while derivative is missing.
- [x] Add repair count for missing thumbnails.

### Phase 2 Checklist

- [x] Tab 2 row rendering no longer requests full-cover object URLs; it requests thumbnail derivatives after scroll defer settles.
- [ ] Warm-thumbnail scroll keeps `blobsCreated` nearly flat.
- [x] Cold-thumbnail scroll shows thumbhash previews and schedules thumbnails without blocking scroll.
- [ ] Thumbnail storage has a size budget and cleanup path.

### Phase 3: Precomputed Backlight Derivatives

**Goal:** Replace runtime large-image CSS blur with a small precomputed backlight asset.

**Tasks:**
- [ ] First validate whether CSS blur/backlight remains a measurable jank source after Phase 1 palette workerization.
- [x] Define backlight derivative size and format.
- [x] Generate low-res backlight image in worker.
- [x] Add `useCoverDerivativeUrl(track, "backlight")`.
- [x] Update `MediaStage` and coverflow `TrackVisual` to use the backlight derivative.
- [x] Avoid full-cover CSS backlight fallback while derivative is missing; let the derivative fade in when ready.
- [x] Preload current/prev/next backlight derivatives through playback warmup.

### Phase 3 Checklist

- [ ] Backlight visual matches current look within acceptable QA tolerance.
- [ ] Drag start/release no longer causes backlight disappearance or extra decode.
- [ ] Covered switch with warm backlight has no >50 ms long task.
- [x] Backlight settings still control opacity/range/blur feel, but do not require runtime full-image blur.

### Phase 4: Hot-Table Decoupling and Repair UX

**Goal:** Prevent bulk derived metadata writes from invalidating `listAllTracks` and re-running Tab 2 projections.

**Tasks:**
- [x] Add a derivative metadata table or equivalent registry if Phase 1/2 writes still cause large requery churn.
- [x] Make `listAllTracks` avoid joining derived binary/repair-only metadata.
- [x] Keep compatibility snapshots on `Track` where needed; thumbnail/backlight/palette derivatives do not write hot Track rows.
- [x] Update Settings repair UI to show per-target counts and progress.
- [x] Add cleanup for stale derivative blobs when cover/crop changes or track is deleted.

### Phase 4 Checklist

- [x] Repairing thousands of cover color metadata records does not cause repeated full `listAllTracks` recomputation.
- [x] Repairing thumbnail/backlight derivatives writes `coverDerivatives` / `mediaBlobs`, not Track rows.
- [x] Deleting/replacing covers cleans obsolete derivative blobs.
- [x] Settings repair can be cancelled and resumed.
- [x] Storage summary accounts for derivative blobs.

---

## 9. Out of Scope

- Replacing IndexedDB/Dexie as the local storage layer.
- Introducing any MUZERO backend, telemetry upload, or cloud-side image processing.
- Changing the stable DB name `muzero-db` or existing track/blob id prefixes.
- Replacing the entire virtual list implementation.
- Removing album cover/backlight customization from Appearance settings.
- Solving unrelated visualizer shader performance unless a trace proves it is part of the cover pipeline.

---

## 10. Security Considerations

- **Authentication:** Not applicable; all work is local-first.
- **Authorization:** Settings repair and local derivatives operate only on local IndexedDB/media storage.
- **Data Protection:** Cover art can be personal. Derived images remain local and are not logged or uploaded.
- **Audit Logging:** Logs record sanitized source kind, hashes, timings, and counts only.
- **BYOK discipline:** No API keys are involved.

---

## 11. Test Plan

### Unit Tests

- Worker client fallback when `Worker` is unavailable.
- Worker result normalization for invalid MIME, crop failure, transparent image, grayscale image.
- Derivative key stability for crop/no-crop and local/remote covers.
- Cache hit/miss behavior for `useCoverDerivativeUrl`.
- Cleanup of derivative blobs after cover replacement/deletion.

### Integration Tests

- Import track with embedded cover -> worker creates thumbhash/palette/thumbnail.
- Settings repair processes missing derivatives in batches and reports progress.
- `visualizer-dynamic-color` uses stored palette and does not schedule main-thread extraction when worker is available.
- Virtual list scrolling defers full cover loads and keeps thumbhash previews.

### Manual QA

- Covered switch, coverless switch, and covered switch with warm derivatives.
- Tab 2 scroll through 5,000+ covered tracks.
- Toggle backlight/shadow/off modes.
- Change cover crop and verify derivative regeneration.
- Delete track/cover and verify derivative cleanup.
- Run Settings repair while playback continues.

---

## 12. Related Documents

| Document | Description |
|----------|-------------|
| `.cursor/commands/prd-create.md` | PRD creation workflow and performance PRD requirements |
| `docs/prd/prd-template.md` | Base PRD template |
| `src/components/dev/dev-perf-panel.tsx` | FPS, long-task, heap, blob URL, DB requery diagnostics |
| `src/hooks/use-media.ts` | Current cover object URL pipeline |
| `src/components/player/visualizer-dynamic-color.tsx` | Current palette resolution and extraction path |
| `src/components/settings/persistent-storage-settings.tsx` | Current cover metadata repair UI |
| `src/workers/heavy-client.ts` | Existing worker client/fallback pattern |

---

## 13. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | Should thumbnails be JPEG/WebP/PNG? | Resolved | Follow Electron/WebView best practice: prefer WebP derivatives when runtime encode/decode support is available; use JPEG fallback for opaque thumbnails/backlight; use PNG/WebP only when alpha is required. |
| 2 | Should derivative metadata live in a new table or on `Track` snapshots only? | Resolved | Long-term best practice is cover-source scoped metadata: key by cover source/content hash + crop signature + derivative version, not by track. `Track` keeps lightweight compatibility snapshots only. |
| 3 | What is the storage budget for thumbnails/backlight derivatives? | Resolved | No hard product limit for v1, but Settings must show derivative storage usage and cleanup stale derivatives. Implementation should still avoid unbounded orphan growth. |
| 4 | Should backlight derivative encode blur/saturation exactly, or keep some CSS blur? | Resolved | Do not treat blur as the proven root cause. Palette/image decode is the higher-priority bottleneck because Settings palette repair also drops FPS. Backlight derivative work proceeds only after Phase 1 metrics show remaining backlight cost. |
| 5 | Can worker use OPFS/media storage directly, or should main thread persist results? | Resolved | Keep v1 persistence in the main-thread repository. The worker computes and returns transferable bytes/metadata; the main thread owns Dexie/media storage writes. |
| 6 | How should remote covers be keyed when URL changes but content is same? | Resolved | Long-term best practice is content-addressed derivative identity when bytes are available: content hash + crop signature + derivative version. Before fetch, use sanitized remote URL hash/ETag/Last-Modified only as lookup hints. |

---

## 14. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-13 | Codex | Initial draft based on covered-switch and Tab 2 scroll performance investigation |
| 2026-06-13 | Codex | Resolved open questions from product feedback; clarified Electron app as primary QA target and palette workerization as top priority |
| 2026-06-13 | Codex | Phase 0 instrumentation: cover render cache hit/miss trace, crop/palette/object-url work spans, blob URL kind grouping, and Electron QA runbook |
| 2026-06-13 | Codex | Phase 1 workerized cover metadata extraction: shared cover worker client/core, visualizer palette fallback through worker, and Settings repair/repository defaults through worker pipeline |
| 2026-06-13 | Codex | Phase 2 partial: added `coverDerivatives` table, `cover-derivative` media role, persistent thumbnail derivative repository, thumbnail worker target, and TrackRow thumbnail derivative hook |
| 2026-06-13 | Codex | Phase 3 partial: added worker backlight target, persistent backlight derivative reuse, and switched MediaStage/coverflow backlight rendering to derivative URLs |
| 2026-06-13 | Codex | Phase 4 partial: added Settings counts/actions for thumbnail/backlight derivative repair and cleanup of stale derivatives on cover replace, crop change, and track delete |
| 2026-06-13 | Codex | Phase 4 hot-table decoupling: persisted local cover palette metadata in `coverDerivatives`, stopped local visualizer palette extraction from updating Track rows, and added cancellable/resumable repair UX |
| 2026-06-13 | Codex | Phase 2/3 follow-up: switched set/artist/album cards, global search rows, and reorder rows to thumbnail derivatives; warmed current/prev/next backlight derivatives from playback preload when backlight mode is active |
