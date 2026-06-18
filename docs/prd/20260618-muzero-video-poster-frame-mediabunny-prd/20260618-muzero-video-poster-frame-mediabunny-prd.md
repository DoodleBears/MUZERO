# PRD: MUZERO Video Poster Frame Extraction with Mediabunny Fallback

**Status:** Draft
**Created:** 2026-06-18
**Author:** MUZERO
**Module:** Media Import - automatically save a useful cover for uploaded videos, skipping black frames and falling back to mediabunny for containers such as MKV.

---

## Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | Native video batch frame extraction + black-frame scoring | Pending | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | Mediabunny container/decode fallback | Pending | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | Upload ingest integration + cover persistence | Pending | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | Tests, diagnostics, and release polish | Pending | [Phase 4 Checklist](#phase-4-checklist) |

> Status Legend: Completed | In Progress | Pending

---

## 1. Overview

### 1.1 Background

MUZERO already supports uploaded audio/video tracks and displays each now-playing stage through the product rule in [`resolveStageContent`](../../../src/lib/track-display.ts): **video -> cover -> title**. Uploaded audio may get embedded cover art from [`parseUploadedMediaMetadata`](../../../src/lib/media-metadata.ts), and user-selected memory photos are stored with [`setTrackCover`](../../../src/db/repositories.ts). Uploaded videos, however, usually arrive without an embedded cover, so their library row and cover mode often fall back to a title card until the user manually chooses an image.

The naive fix is "grab the first frame." In practice, frame `0s` is often a black lead-in, an encoder delay artifact, or a fade from black. A better default is to sample a short candidate list such as `0.1s`, `0.5s`, `1s`, and `2s`, skip frames that are visually black, and persist the first useful frame as the track cover.

The second problem is container support. MUZERO currently probes uploads with a throwaway native `<video>` element in [`probeMediaFile`](../../../src/lib/media-probe.ts). That is fast and correctly matches the playback engine for MP4/WebM-like sources, but it can reject containers such as MKV before a cover extraction fallback ever runs. The product goal is not to replace playback with mediabunny; it is to use mediabunny as a local demux/decode helper for import-time metadata and poster extraction when native `<video>` cannot seek/decode the source.

Research reference from `D:\code\project\doodlekuma.com`:

| Source | Lesson for MUZERO |
|--------|-------------------|
| [`packages/clipcombo/src/lib/clip-mediabunny-formats.ts`](../../../../doodlekuma.com/packages/clipcombo/src/lib/clip-mediabunny-formats.ts) | Keep one `MEDIABUNNY_INPUT_FORMATS` registry for every `new Input({ formats, source })` call, including `MATROSKA`, `WEBM`, `MP4`, `QTFF`, `MP3`, `WAVE`, `FLAC`, `OGG`, `ADTS`, `MPEG_TS`. |
| [`packages/clipcombo/src/lib/clip-visual-keyframe-mediabunny-sampler.ts`](../../../../doodlekuma.com/packages/clipcombo/src/lib/clip-visual-keyframe-mediabunny-sampler.ts) | Use `BlobSource` with an 8 MiB cache, `Input`, `track.canDecode()`, and `CanvasSink`; return `null` on unsupported sources and rethrow aborts. |
| [`packages/djtype/src/lib/cover-image-processing.ts`](../../../../doodlekuma.com/packages/djtype/src/lib/cover-image-processing.ts) | For a player app, prefer native `<video>` first, then lazy-import mediabunny fallback. Reuse one video element for batch extraction instead of spinning up N elements. |
| [`packages/djtype/src/lib/media-mediabunny-frames.ts`](../../../../doodlekuma.com/packages/djtype/src/lib/media-mediabunny-frames.ts) | Keep the mediabunny bridge narrow: `extractVideoFrameViaMediabunny` / `extractVideoFramesBatchViaMediabunny`, `CanvasSink`, `poolSize: 2`, best-effort `input.dispose()`. |

### 1.2 Target Users

| Role | Description | Need |
|------|-------------|------|
| Local MV collector | Imports MP4/WebM/MKV music videos into a mixed set | Videos should look like real library items immediately, without manual cover work. |
| Large-library owner | Drops many videos or syncs a local folder | Import should stay robust; one unsupported cover decode must not block the whole batch. |
| Cover-mode listener | Uses cover-first or audio-only viewing while videos play | Video tracks still need a meaningful cover fallback when the stage is not showing video. |
| Desktop-first user | Uses Tauri desktop as the primary surface | Import-time decode should be local-first, bounded, and not introduce a backend or telemetry. |

### 1.3 Core Value

1. **Better default video identity:** Uploaded videos get a real cover automatically, making queue/search/set views feel complete.
2. **Skip black lead-ins:** The selected poster avoids common black first frames by sampling multiple early timestamps and scoring visual usefulness.
3. **Container-aware import:** MKV/WebM-like files get a mediabunny fallback for probe and frame extraction instead of being discarded solely because native `<video>` could not read metadata.
4. **Preserve the current playback architecture:** Playback remains the existing [`MediaEngine`](../../../src/player/media-engine.ts) path. Mediabunny is an import-time helper, not a second player.

---

## 2. System Architecture

### 2.1 Architecture Overview

```
User drops video file
  |
  v
probeMediaFile(file)
  | native <video> metadata succeeds
  | OR mediabunny fallback gives duration/kind when native errors on a supported container
  v
parseUploadedMediaMetadata(file)
  | embeddedCover exists? -------------------- yes ---> createUploadedTrack(... embeddedCover)
  | no
  v
createUploadedTrack(... no cover)
  |
  v
extractUsefulVideoPosterFrame(file)
  |
  |-- native <video> batch seek: 0.1s / 0.5s / 1s / 2s / clamped duration
  |       draw frame -> score blackness -> choose first useful or best fallback
  |
  |-- if native fails or source is container-supported but undecodable natively:
          lazy import mediabunny -> CanvasSink -> same candidate timestamps -> same scoring
  |
  v
setTrackCover({ trackId, blob: posterBlob, mime, crop })
  |
  v
Track.coverBlobId -> MediaBlob(role:"cover")
```

### 2.2 Reused Building Blocks

| Need | Reuse / Rule |
|------|--------------|
| Upload ingestion | [`ingestMediaFile`](../../../src/stores/player-store.ts) remains the single drag/drop/file-picker path. |
| Media bytes | Keep original audio/video bytes in `mediaBlobs(role:"media")`; never put bytes on `tracks`. |
| Cover persistence | Use existing [`setTrackCover`](../../../src/db/repositories.ts), which derives thumbhash/palette and replaces prior cover safely. |
| Stage display | Keep [`resolveStageContent`](../../../src/lib/track-display.ts) unchanged: the new cover only improves the existing fallback. |
| Playback | Keep [`MediaEngine`](../../../src/player/media-engine.ts) native `<audio>` driver + muted `<video>` visual. No mediabunny playback. |
| Logging | Use [`src/lib/logger.ts`](../../../src/lib/logger.ts); no raw `console.*` in `src/**`. |
| Dependency loading | Lazy-import mediabunny bridge only on fallback paths so normal MP4 imports stay light. |

### 2.3 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Native fast path | `HTMLVideoElement`, one element reused for batch seeks | Matches the actual playback engine; fastest path for common MP4/WebM. |
| Fallback demux/decode | `mediabunny` `BlobSource` + `Input` + `CanvasSink` | Handles containers native `<video>` may reject, especially Matroska/MKV, while staying browser-local. |
| Candidate scoring | Small analysis canvas + luma statistics | Cheap, deterministic, unit-testable. Enough to reject black/fade-in frames without ClipCombo's full visual-keyframe feature extractor. |
| Cover encoding | Canvas `toBlob("image/webp", 0.85)` or existing image pipeline conventions | Produces compact local cover bytes; `setTrackCover` handles storage and metadata derivation. |
| Persistence | Dexie `muzero-db` existing `Track.coverBlobId` and `MediaBlob(role:"cover")` | No schema migration needed. |

> External dependency declaration: `mediabunny` is introduced as a local import-time media container helper. It must be dynamically imported from a narrow adapter module, not scattered through UI/store code. License and bundle delta must be confirmed in implementation before finalizing the PR; ClipCombo currently uses `mediabunny@1.45.4`.

### 2.4 Best-Practice Decisions

1. **Native `<video>` first for player products.** DJType intentionally inverts ClipCombo's editor-first pipeline: because MUZERO plays through native media elements, successful native extraction proves the file behaves like playback. Mediabunny is fallback, not the default path.
2. **Batch extraction, not one element per timestamp.** Reuse one native video element or one mediabunny `Input`/`CanvasSink` for all candidate times. This avoids repeated metadata parsing and avoids concurrent media element load contention.
3. **One mediabunny formats registry.** Every `new Input({ formats, source })` must use `MEDIABUNNY_INPUT_FORMATS`. Do not pass ad-hoc subsets in probe vs poster extraction.
4. **Return `null` on unsupported fallback.** Unsupported container, no video track, or `track.canDecode() === false` should not throw into import. The track can still enter the library without an auto cover.
5. **No hidden runtime flag.** Rollback is `git revert`; there is no `localStorage`, URL flag, or `window.*` kill switch.

---

## 3. Data Model Design

### 3.1 Core Concepts

```
Track(kind:"video", origin:"uploaded")
  |
  | blobId
  v
MediaBlob(role:"media")      original uploaded video bytes

Track.coverBlobId
  |
  v
MediaBlob(role:"cover")      auto-extracted poster frame, same path as manual cover
```

### 3.2 Database Schema

- **Current Schema:** [`src/db/types.ts`](../../../src/db/types.ts), [`src/db/muzero-db.ts`](../../../src/db/muzero-db.ts), [`src/db/repositories.ts`](../../../src/db/repositories.ts)
- **Required Changes:** No DB schema version bump. Use existing optional `Track.coverBlobId`, `Track.coverCrop`, `Track.coverThumbhash`, and cover palette fields.
- **Data Migration:** None. Existing video tracks remain coverless unless a later backfill feature is explicitly added.
- **Constraints & Indexing:** No new indexes. Poster extraction runs at write time, not list render time.
- **Performance Impact:** Each uploaded video without embedded cover samples a bounded candidate list. Cover bytes are small WebP/JPEG blobs and go through the existing size-aware cover path.
- **Privacy & Retention:** All decoding happens locally from the user's `File`/`Blob`. Do not log filenames, frame pixels, or media bytes. Diagnostic logs may include kind, MIME, candidate count, fallback path, and error name only.

### 3.3 Crop and Aspect Behavior

The stored poster should preserve the full video frame as image bytes. `setTrackCover` accepts an optional square `coverCrop`; the auto path should record a centered square crop:

```ts
const side = Math.min(width, height);
const crop = {
  x: Math.round((width - side) / 2),
  y: Math.round((height - side) / 2),
  width: side,
  height: side,
};
```

This keeps library square covers stable while preserving the full extracted image blob for future display variants. If the extracted image is already square, the crop covers the whole image.

---

## 4. API Design

No backend API is introduced. The API surface is local TypeScript helpers.

### 4.1 Proposed Local Modules

| Module | Responsibility |
|--------|----------------|
| `src/lib/video-poster-frame.ts` | Public `extractUsefulVideoPosterFrame(file, opts)`; candidate generation, native batch extraction, scoring, fallback orchestration. |
| `src/lib/video-frame-score.ts` | Pure frame scoring helpers: candidate timestamp generation, luma/non-black scoring, best-frame selection. |
| `src/lib/media-mediabunny-formats.ts` | Single mediabunny input format registry and content-type/extension support predicates. |
| `src/lib/media-mediabunny-frames.ts` | Narrow lazy-loaded bridge using `BlobSource`, `Input`, `CanvasSink`; no React/store imports. |
| `src/lib/media-mediabunny-probe.ts` | Optional probe fallback that returns duration/video dimensions when native probe rejects a supported container. |

### 4.2 Helper Contracts

```ts
export type ExtractedVideoPosterFrame = {
  blob: Blob;
  mime: string;
  width: number;
  height: number;
  atTimeSeconds: number;
  source: "native-video" | "mediabunny";
  score: VideoFrameScore;
};

export async function extractUsefulVideoPosterFrame(
  file: File,
  options?: {
    durationSec?: number;
    maxWidth?: number;
    maxHeight?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
  },
): Promise<ExtractedVideoPosterFrame | null>;
```

```ts
export type VideoFrameCandidate = {
  id: string;
  atTimeSeconds: number;
};

export function candidatePosterTimes(durationSec?: number): VideoFrameCandidate[];

export type VideoFrameScore = {
  lumaMean: number;
  lumaVariance: number;
  nonBlackRatio: number;
  black: boolean;
};
```

### 4.3 Candidate Time Rule

Default candidates:

```
0.1s, 0.5s, 1s, 2s, min(duration * 0.05, 3s)
```

Rules:

- Clamp every timestamp to `[0, duration - 0.01]` when finite duration is known.
- Deduplicate after clamping.
- For videos shorter than `0.1s`, fall back to `0s`.
- Stop at the first non-black frame; if every frame is black but at least one decoded, choose the highest-scoring frame rather than returning nothing.

### 4.4 Black-Frame Scoring

Use a small analysis canvas, for example `64x64`, to avoid scanning full-resolution frames.

Frame is considered black when all are true:

- `lumaMean < 0.035`
- `lumaVariance < 0.004`
- `nonBlackRatio < 0.02`

Where luma is Rec. 709:

```ts
luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
```

These thresholds are implementation defaults, not product-visible settings. They should be covered by pure unit tests with synthetic image data.

### 4.5 Error Handling

| Case | Behavior |
|------|----------|
| Native `<video>` metadata or seek times out | Try mediabunny fallback if the file looks container-supported; otherwise return `null`. |
| Native frame decodes but all candidates are black | Persist the best available candidate, but log `allCandidatesBlack: true` at debug/info level. |
| Mediabunny unsupported container | Return `null`, keep track coverless. |
| Mediabunny `track.canDecode() === false` | Return `null`; do not throw. |
| AbortSignal aborts | Stop work. If exposed to callers as abort, do not treat as unsupported media. |
| `setTrackCover` fails | Log via `logger.warn`; keep imported track and media blob. Cover extraction is best-effort. |

---

## 5. Frontend Design

### 5.1 User Experience

There is no new page or visible setting. The improvement is automatic:

- User imports a video.
- The track appears in the target set as today.
- If the video has no embedded cover, MUZERO extracts a useful early frame and stores it as the cover.
- Library rows, search cards, set covers, PlayerDock identity row, and cover display mode benefit through existing cover surfaces.

### 5.2 UI Copy

No user-facing copy is required for Phase 1-4. If import progress later shows per-file details, any strings must go through `src/i18n/locales/{en,zh,ja,ko}/common.json`.

### 5.3 State Management

- Do not add poster extraction state to Zustand.
- The import flow may await poster extraction for immediate cover availability, or perform it after `createUploadedTrack` and let Dexie live queries update UI when `setTrackCover` completes.
- Prefer post-create best-effort extraction:

```
track = await createUploadedTrack(...)
if (track.kind === "video" && !parsed.embeddedCover) {
  void extractAndStoreVideoPoster(track.id, file, probed.durationSec)
}
```

For folder import, keep bounded concurrency so many videos do not decode frames at once.

---

## 6. Implementation Plan

### Phase 1: Native Video Batch Extraction + Black-Frame Scoring

**Goal:** For common MP4/WebM sources that native `<video>` can decode, automatically choose a useful non-black poster frame.

**Tasks:**
- [ ] Add pure candidate generation and frame scoring helpers.
- [ ] Add native `extractVideoFramesBatchViaVideoElement(file, requests, options)` that reuses one video element.
- [ ] Wait for `loadedmetadata`, seek serially, draw each candidate frame, and encode WebP output.
- [ ] Select first non-black frame; fallback to best decoded frame when all are black.
- [ ] Ensure object URLs are revoked and video `src` is cleared in `finally`.

### Phase 1 Checklist

- [ ] Unit tests cover timestamp clamping/dedup for short, normal, and unknown-duration videos.
- [ ] Unit tests cover black, near-black, bright, and high-variance synthetic frames.
- [ ] Native extraction uses one video element per file, not one per candidate.
- [ ] No raw `console.*`.

### Phase 2: Mediabunny Container/Decode Fallback

**Goal:** Let supported non-native containers, especially MKV/Matroska, still provide duration/probe data and poster frames when native `<video>` fails.

**Tasks:**
- [ ] Add `mediabunny` dependency after license/version confirmation.
- [ ] Add `media-mediabunny-formats.ts` with one `MEDIABUNNY_INPUT_FORMATS` registry.
- [ ] Add pure content-type/extension support predicate; `.mkv` and `application/octet-stream` with MKV extension must be handled.
- [ ] Add `extractVideoFramesBatchViaMediabunny` using `BlobSource({ maxCacheSize: 8 * 2 ** 20 })`, `Input`, `track.canDecode()`, and `CanvasSink({ poolSize: 2 })`.
- [ ] Add `probeMediaFile` fallback for native metadata errors on mediabunny-supported containers.
- [ ] Lazy-import mediabunny modules only from fallback paths.

### Phase 2 Checklist

- [ ] Every `new Input` call uses the shared `MEDIABUNNY_INPUT_FORMATS`.
- [ ] Unsupported container/no video track/cannot decode returns `null`, not import failure.
- [ ] `input.dispose()` is best-effort in `finally`.
- [ ] Common MP4 path does not import mediabunny eagerly.

### Phase 3: Upload Ingest Integration + Cover Persistence

**Goal:** Store the extracted poster frame as the uploaded video track's cover without disrupting existing import behavior.

**Tasks:**
- [ ] In [`ingestMediaFile`](../../../src/stores/player-store.ts), run poster extraction for `probed.kind === "video"` only when `parsed.embeddedCover` is absent.
- [ ] Persist via [`setTrackCover`](../../../src/db/repositories.ts), not a new cover storage path.
- [ ] Use a centered square crop based on extracted frame dimensions.
- [ ] Keep remote/embedded covers higher priority than auto poster frames.
- [ ] Add bounded concurrency for batch/folder imports if extraction is awaited or queued.

### Phase 3 Checklist

- [ ] Uploaded video with no embedded cover gets `coverBlobId`.
- [ ] Uploaded video with embedded cover keeps embedded cover and does not auto-overwrite it.
- [ ] Poster extraction failure still imports a playable/ready track.
- [ ] Track row/search/Now Playing cover fallback update through existing Dexie live queries.

### Phase 4: Tests, Diagnostics, and Release Polish

**Goal:** Make the behavior testable and observable without leaking user data or creating performance regressions.

**Tasks:**
- [ ] Add pure tests for support predicate, candidate times, and frame scoring.
- [ ] Add repository/store tests for "cover extraction failure does not fail import."
- [ ] Add a small mocked extraction integration test around `ingestMediaFile`/`setTrackCover`.
- [ ] Add structured diagnostics through `logger`: extraction source, candidate count, selected timestamp, fallback reason, error name.
- [ ] Run `make check` or equivalent `pnpm` typecheck/lint/test gate.

### Phase 4 Checklist

- [ ] No filenames, paths, frame pixels, media bytes, prompts, or tags in logs.
- [ ] Test coverage includes native success, native fail + mediabunny success, all-black fallback, and full extraction failure.
- [ ] Bundle impact is documented in implementation PR.
- [ ] Manual QA includes MP4 black intro, short video, MKV if codec-supported, and unsupported MKV codec.

---

## 7. Out of Scope

- Replacing MUZERO playback with mediabunny or WebCodecs.
- Extracting audio tracks from video for separate waveform/audio-only storage.
- Building a visual keyframe chooser UI.
- Backfilling poster covers for all existing video tracks.
- Full ClipCombo-style visual keyframe clustering, perceptual hashes, or scene-change detection.
- Any backend, cloud processing, telemetry, account system, or server-side thumbnail generation.
- Runtime settings or hidden flags for the feature.

---

## 8. Security, Privacy, and Local-First Considerations

- **Local-first:** All decoding happens from local `File`/`Blob` bytes in the WebView. No MUZERO server and no external upload.
- **BYOK discipline:** No API keys are involved.
- **Data protection:** Extracted poster frames are local cover images in IndexedDB/OPFS through the existing media blob storage path.
- **Logging:** Use structured logger only. Redact names/paths. Log error names and media category, not user media content.
- **Resource safety:** Always revoke native object URLs. Always dispose mediabunny `Input`. Keep candidate count small and bounded.
- **Rollback:** Revert the adapter/integration commit. Do not add hidden runtime toggles.

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [MUZERO Media Metadata Import and Export](../20260609-muzero-media-metadata-import-export-prd/20260609-muzero-media-metadata-import-export-prd.md) | Existing upload metadata and embedded cover extraction path. |
| [MUZERO Instant Cover Thumbnails](../20260610-muzero-instant-cover-thumbnails-prd/20260610-muzero-instant-cover-thumbnails-prd.md) | Existing cover/thumbhash/cache pipeline that auto poster frames will feed. |
| [MUZERO Cover Quality and Scroll](../20260614-muzero-cover-quality-and-scroll-prd/20260614-muzero-cover-quality-and-scroll-prd.md) | Cover decode failure and quality constraints. |
| [`D:\code\project\doodlekuma.com\packages\djtype\src\lib\cover-image-processing.ts`](../../../../doodlekuma.com/packages/djtype/src/lib/cover-image-processing.ts) | DJType native-first video frame extraction reference. |
| [`D:\code\project\doodlekuma.com\packages\djtype\src\lib\media-mediabunny-frames.ts`](../../../../doodlekuma.com/packages/djtype/src/lib/media-mediabunny-frames.ts) | DJType mediabunny CanvasSink fallback reference. |
| [`D:\code\project\doodlekuma.com\packages\clipcombo\src\lib\clip-mediabunny-formats.ts`](../../../../doodlekuma.com/packages/clipcombo/src/lib/clip-mediabunny-formats.ts) | ClipCombo single-source mediabunny formats registry. |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | Should poster extraction block `addUploadsToSet` completion or run after track creation in the background? | Resolved | Use post-create best-effort extraction so import stays responsive; Dexie live queries reveal the cover when ready. |
| 2 | Should auto poster frames use WebP or JPEG? | Resolved | Use WebP by default for compact local cover bytes; fall back to JPEG only if a target WebView cannot encode WebP. |
| 3 | Should MKV files that mediabunny can probe but native playback cannot play be imported? | Resolved | Yes. Import must accept mediabunny-supported containers following the DJ Type pattern. Playback remains native `MediaEngine`; if the current platform cannot play the file, existing playback-error UX handles it after import rather than rejecting the library item up front. |
| 4 | What exact black-frame thresholds should ship? | Resolved | Follow the best-practice scoring in this PRD: luma mean + variance + non-black ratio, with conservative defaults and real-sample tuning only if QA shows false positives/negatives. |
| 5 | Should existing coverless video tracks get a manual "Generate cover from video" action later? | Resolved | Not for v1. This PRD only covers import-time automatic poster extraction. |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-18 | MUZERO | Initial draft based on MUZERO upload/playback audit and doodlekuma ClipCombo/DJType mediabunny research. |
