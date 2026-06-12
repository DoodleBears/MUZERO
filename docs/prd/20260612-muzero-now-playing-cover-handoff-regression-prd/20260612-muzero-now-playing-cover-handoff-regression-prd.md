# PRD: MUZERO Now Playing cover handoff regression

**Status:** In Progress - code fix implemented; manual playback verification pending
**Created:** 2026-06-12
**Author:** Codex
**Module:** Now Playing - swipeable media stage / local cover loading / playback handoff

---

## Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | Investigation and root-cause capture | Completed | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | Track-aware cover readiness fix | Completed | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | Regression tests and manual verification | In Progress | [Phase 3 Checklist](#phase-3-checklist) |

---

## 1. Overview

### 1.1 Background

On the Now Playing tab, switching local uploaded songs can visually flash in the sequence:

```
A current cover -> B incoming cover -> A old cover -> B final cover
```

The reported case is pressing previous from track A to track B while local song cover bytes are loaded from IndexedDB. The playback queue itself does not appear to move back to A. The visible regression is in the cover handoff between the coverflow overlay and the base `MediaStage`.

The issue is local-cover specific because local cover URLs are asynchronous:

```
Track row says coverBlobId exists
  -> Dexie liveQuery resolves mediaBlobs bytes later
  -> optional crop renders later
  -> object URL becomes available later
```

Remote covers are URL-backed and generated/no-cover tracks do not hit the same stale local-cover window.

### 1.2 Target Users

| Role | Description | Affected Scenario |
|------|-------------|-------------------|
| Desktop listener | Uses Now Playing as the primary playback surface | Previous / next / keyboard switches across local uploaded tracks |
| Large-library owner | Has many embedded covers stored in IndexedDB | Rapid switching before every nearby cover has a canonical object URL in cache |
| Visual-polish sensitive user | Notices coverflow and crossfade continuity | Incoming cover should never appear, regress to the outgoing cover, then appear again |

### 1.3 Core Value

1. **Single-direction visual truth:** A committed switch from A to B must never show A again after B has become the visible settled target.
2. **Preserve anti-flash behavior:** The existing "hold old cover while next local cover resolves" behavior remains useful for base images; the fix should make the handoff track-aware rather than globally removing it.
3. **No playback-state churn:** The fix should stay in cover readiness / animation handoff code unless new evidence shows queue state is actually reverting.

---

## 2. Investigation Findings

### 2.1 Queue state is not the primary suspect

Manual previous uses `skipPrev()` / `prev()` and then `playIndex()`:

- [`player-store.ts`](../../../src/stores/player-store.ts) `skipPrev()` resolves the previous index and calls `playIndex(pi)`.
- [`player-store.ts`](../../../src/stores/player-store.ts) `playIndex()` local/blob path immediately calls `set(cursorPatch(queue, clamped, true))`, persists the queue index, then loads the media.

For local blob playback, there is no deferred "keep A until B network fetch completes" branch. That deferred branch only exists for remote playback cache / fetch. So the visible A reappearance is not explained by `currentIndex` intentionally moving back to A.

### 2.2 Actual visual race

The race is between three mechanisms:

| Mechanism | File | Behavior |
|-----------|------|----------|
| Programmatic coverflow overlay | [`swipeable-media-stage.tsx`](../../../src/components/player/swipeable-media-stage.tsx) | Detects external switches through `switchSnapRef`, then animates outgoing A to incoming B. |
| Base stage cover URL | [`media-stage.tsx`](../../../src/components/player/media-stage.tsx) + [`use-media.ts`](../../../src/hooks/use-media.ts) | `MediaStage` renders the current track and asks `useTrackCoverUrl(current)` for its cover URL. |
| Stale-while-pending cover hold | [`use-media.ts`](../../../src/hooks/use-media.ts) | While a new local cover's blob is still `undefined`, `useTrackCoverUrl()` returns `lastCommittedUrl` so the UI avoids a blank placeholder. |

`SwipeableMediaStage` currently treats a truthy `stageCoverUrl` as "the base layer for the settled track is ready":

```ts
if (
  settleTarget.track.coverBlobId &&
  (!preloadedCoverUrls[settleTarget.track.id] ||
    !readyTrackIds[settleTarget.track.id] ||
    !stageCoverUrl)
) {
  return;
}
```

But `stageCoverUrl` can be truthy while still pointing at A. That happens by design in `useTrackCoverUrl()`:

```ts
const pendingLocalCover = Boolean(coverBlobId) && blob === undefined && !committedUrl;
return committedUrl ?? (pendingLocalCover ? lastCommittedUrl.current : null);
```

So the handoff condition can pass with the wrong image source.

### 2.3 Failure sequence

```
Initial:
  current = A
  useTrackCoverUrl(A) -> blob:a
  lastCommittedUrl = blob:a

User presses Previous:
  player-store sets currentIndex to B
  SwipeableMediaStage detects A -> B as an external switch
  preloadedCoverUrls[B] already exists, so overlay animates B in

During overlay settle:
  MediaStage now renders current = B
  useTrackCoverUrl(B) liveQuery is still undefined
  useTrackCoverUrl(B) returns lastCommittedUrl = blob:a

Bug:
  handoff checks only !!stageCoverUrl
  blob:a is truthy, so handoff starts
  base layer becomes visible while it still paints A

Later:
  B cover blob/crop resolves
  CoverImage decodes blob:b
  base crossfades A -> B
```

This exactly matches the observed visual sequence: B appears, then A flashes back, then B appears again.

### 2.4 Why B can appear first

`SwipeableMediaStage` has a separate local preloader (`usePreloadedCoverUrls`) that can already have B's object URL for the coverflow overlay. The base `MediaStage` uses the shared `useTrackCoverUrl()` path and may still be stale. Two cover readiness pipelines can therefore disagree:

```
Overlay pipeline: B URL ready
Base pipeline: current track is B, but returned URL is stale A
```

This disagreement is the core of the regression.

---

## 3. System Architecture

### 3.1 Current visual handoff

```
Transport / shortcut / auto-advance
  -> player-store currentIndex changes
  -> SwipeableMediaStage external-switch effect
      -> outgoing = previous snapshot A
      -> incoming = current B
      -> playProgrammaticSwitch(A -> B)
          -> overlay animates B
          -> settleTarget = B
          -> wait for preloaded B + readyTrackIds[B] + truthy stageCoverUrl
          -> handoffFading = true
              -> base MediaStage becomes visible
```

### 3.2 Required architecture change

The handoff must wait for the base layer to be ready for the same cover identity as the settled track, not just for any URL.

Expected shape:

```
cover identity = coverBlobId + crop signature + remoteCoverUrl

useTrackCoverResource(track)
  -> url
  -> cacheKey / sourceKey
  -> staleWhilePending boolean
  -> readyForTrack boolean

SwipeableMediaStage handoff
  -> require readyForTrack(settleTarget.track)
  -> or keep overlay pinned until base key matches target key
```

The implementation can be smaller than a new exported hook if the same guarantees are met locally, but the acceptance criteria should be key-based rather than truthiness-based.

---

## 4. Data Model Design

No IndexedDB schema change is required.

The relevant identity already exists on `Track`:

| Field | Purpose |
|-------|---------|
| `coverBlobId` | Local cover blob identity |
| `coverCrop` | Crop identity for the displayed URL |
| `remoteCoverUrl` | Remote cover identity for streamed / imported online tracks |

The fix should derive a stable cover key from these row fields, reusing the existing `trackCoverCacheKey()` logic where possible.

---

## 5. Frontend Design

### 5.1 Expected behavior

When the user switches A -> B:

- The coverflow overlay may animate A out and B in.
- Once B is visible as the settled target, A must not be shown again inside the stage.
- If B's base cover is not ready, the overlay should remain pinned / fade later, or the base should remain hidden until it is rendering B's cover identity.
- Reduced-motion users should get the same identity guarantee without the animated travel.

### 5.2 Animation regression guard

The fix must not regress the existing previous / next cover transition. The bug is in the final overlay-to-base handoff, not in the coverflow interaction itself. Therefore all fixes and future refactors must preserve:

- **Direction:** previous still travels in the previous direction and next still travels in the next direction, including button, keyboard, wheel, and drag paths.
- **Coverflow feel:** the outgoing/current/incoming card stack, side-card scale/tilt, settle card, and handoff fade should remain visually continuous.
- **No title-card regression:** a track that has cover art should not show a bare `StageTitleFallback` during a normal previous / next transition unless the cover truly failed or does not exist.
- **No stale-cover regression:** after the incoming cover is visible as the settled card, the outgoing cover must not reappear during the handoff.
- **Gesture behavior:** drag / wheel initiated switches must continue using `selfSwitchRef` so the store update does not trigger a second programmatic animation.

Tests should keep the existing external-switch coverflow case green and add focused coverage for the stale-base-cover handoff. Manual verification should include both previous and next switches across local uploaded tracks with covers.

### 5.3 Non-goals

- Do not remove swipe / wheel coverflow.
- Do not replace the local-first cover cache with hidden flags or runtime kill switches.
- Do not change playlist ordering, queue persistence, or playback transport unless future evidence shows an actual queue rollback.
- Do not force all covers to eagerly decode synchronously on track switch.

---

## 6. Implementation Plan

### Phase 1: Investigation and root-cause capture

**Goal:** Record the concrete cause and the affected code paths.

**Tasks:**
- [x] Trace previous-track flow through `skipPrev()` -> `playIndex()`.
- [x] Trace coverflow programmatic switch detection through `switchSnapRef`.
- [x] Trace `useTrackCoverUrl()` stale-while-pending behavior.
- [x] Identify the faulty readiness check: `!!stageCoverUrl` is not track-aware.
- [x] Record the A -> B -> A -> B failure sequence in this PRD.

### Phase 1 Checklist

- [x] Root cause documented with file references.
- [x] Queue-state rollback ruled out as the primary explanation for local blob playback.
- [x] Fix scope narrowed to cover readiness / handoff.

### Phase 2: Track-aware cover readiness fix

**Goal:** Prevent the overlay-to-base handoff until the base stage is ready for the settled track's cover identity.

**Tasks:**
- [x] Add or derive a stable cover identity key for the current base stage URL.
- [x] Distinguish "stale previous URL held for anti-flash" from "current track cover is ready".
- [x] Update `SwipeableMediaStage` handoff logic to compare settled target identity, not `!!stageCoverUrl`.
- [x] Keep the existing overlay preloader, but route the base-layer decision through the canonical `useTrackCoverResource()` readiness signal.
- [x] Preserve `CoverImage` behavior that keeps the prior image visible while a genuinely pending cover resolves.
- [x] Preserve existing previous / next coverflow direction, gesture behavior, and remote-cover title-card safeguards.

**Implementation note (2026-06-12):**
`useTrackCoverResource()` now returns the same anti-flash `url` as `useTrackCoverUrl()`, plus `targetKey`, `urlKey`, `staleWhilePending`, and `readyForTrack`. Existing call sites keep using `useTrackCoverUrl()` unchanged. `SwipeableMediaStage` uses `readyForTrack` for overlay handoff, so a truthy stale previous URL no longer releases the base layer.

### Phase 2 Checklist

- [x] A programmatic A -> B local-cover switch never reveals A after B's settle card is visible.
- [x] A drag / wheel-initiated switch still suppresses duplicate external-switch animation through `selfSwitchRef`.
- [x] Remote-cover switches still avoid bare title-card flashes.
- [x] Existing programmatic previous / next coverflow animation remains covered; the fix only delays handoff when the base cover is stale.
- [x] No new Zustand store fields or hidden runtime toggles are introduced.

### Phase 3: Regression tests and manual verification

**Goal:** Lock the race down with deterministic tests and a short manual checklist.

**Tasks:**
- [x] Add a test that simulates a local-cover switch where overlay preload has B but base `useTrackCoverUrl()` is still stale with A; assert handoff does not expose base A.
- [x] Add or update a hook/resource test that can identify stale-while-pending output separately from ready-for-current-track output.
- [x] Keep the existing external-switch coverflow test green.
- [x] Run the relevant Vitest slice.
- [ ] Manually verify previous / next on Now Playing with local uploaded tracks that have embedded covers.

### Phase 3 Checklist

- [x] `src/components/player/swipeable-media-stage.test.tsx` covers the A -> B -> stale A race.
- [x] `src/components/player/swipeable-media-stage.test.tsx` keeps the external-switch coverflow behavior covered.
- [x] `src/hooks/use-media.test.tsx` or a new focused test covers current-key readiness.
- [ ] Manual previous and next across local covers show a single visual direction and preserve the expected transition feel.

---

## 7. Out of Scope

- Reworking the entire media engine or playback loading model.
- Changing Dexie schema or media blob storage.
- Replacing Motion animations.
- Solving unrelated background visualizer / palette transition timing.
- Adding a user-facing setting for this behavior.

---

## 8. Security Considerations

- No new outbound requests.
- No API keys, filenames, or media bytes are logged.
- Any diagnostic logging added for this fix must use `src/lib/logger.ts` and avoid user media content.
- The change remains local-first and uses existing IndexedDB cover metadata only.

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [PRD create workflow](../../../.cursor/commands/prd-create.md) | PRD workflow used for this investigation |
| [Instant Cover Thumbnails PRD](../20260610-muzero-instant-cover-thumbnails-prd/20260610-muzero-instant-cover-thumbnails-prd.md) | Introduced the shared object URL cache and anti-flicker cover behavior |
| [Playback Trace Performance Optimization PRD](../20260612-muzero-playback-trace-performance-optimization-prd/20260612-muzero-playback-trace-performance-optimization-prd.md) | Recent playback trace methodology and player-store performance context |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | Should `useTrackCoverUrl()` expose metadata, or should a new `useTrackCoverResource()` be introduced? | Open | Prefer the smallest API that makes stale-vs-ready explicit without breaking existing call sites. |
| 2 | Should `SwipeableMediaStage.usePreloadedCoverUrls()` reuse `coverUrlCache` instead of owning/revoking separate object URLs? | Open | Likely yes, but only if it preserves drag-swipe readiness and mounted URL lifetime. |
| 3 | Should base `MediaStage` opt out of stale-while-pending while the coverflow overlay owns the handoff? | Open | Viable, but must not reintroduce placeholder flashes on non-overlay switches. |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-12 | Codex | Initial investigation PRD with root cause and fix plan |
| 2026-06-12 | Codex | Implemented track-aware cover resource handoff and automated regressions |
