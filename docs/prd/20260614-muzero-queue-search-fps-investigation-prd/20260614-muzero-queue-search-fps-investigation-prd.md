# PRD: MUZERO Queue/Search FPS Investigation

**Status:** Draft
**Created:** 2026-06-14
**Author:** Codex
**Module:** Player / Queue Drawer / Search Library - FPS drop investigation and trace coverage

---

## Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | QueuePanel system playlist work hotfix | ✅ Completed | [Phase 1](#phase-1-queuepanel-system-playlist-work-hotfix) |
| 2 | Gesture disambiguation + transition/mode observability | 🔲 Pending | [Phase 2](#phase-2-gesture-disambiguation--transitionmode-observability) |
| 3 | SearchPage mount model + cross-mount work reduction | 🔲 Pending | [Phase 3](#phase-3-searchpage-mount-model--cross-mount-work-reduction) |
| 4 | QA profiling protocol and regression guard | 🔲 Pending | [Phase 4](#phase-4-qa-profiling-protocol-and-regression-guard) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

QA observed two related desktop FPS regressions:

1. In the all-playlists / queue drawer flow, switching songs drops from ~120 FPS to ~70 FPS, with `fpsLow` around 5.
2. Switching from Now Playing tab 1 to tab 2 song list drops from ~120 FPS to ~90 FPS, with `fpsLow` around 9.

The strongest confirmed suspect was [`QueuePanel`](../../../src/components/player/queue-panel.tsx). The drawer looks like an "Up next / playlist list" surface, but its header buttons previously subscribed to the whole tracks table, playback stats, and playback events so it could show pinned system playlist actions. On every render it directly derived three system playlists:

- liked / hearted playlist
- recently played playlist
- most played playlist

This work was not independently traced before this investigation. The absence of trace spans made the frame drop look like "unknown tab or song-switch jank" even when the real work could be full-library derivation outside the visible list.

### 1.2 Investigation Conclusion

The QueuePanel suspicion is valid. The issue is not only "missing `useMemo`":

- The old component did full-library `useLiveQuery` subscriptions inside the drawer.
- The system playlist arrays were derived directly during render.
- Even if wrapped in `useMemo`, Dexie liveQuery emissions and playback-stat writes can produce fresh arrays/objects, invalidating the memo.
- The better boundary is lazy work: derive a system playlist only when the user clicks that pinned system playlist.

Phase 1 has already landed this change and added a new local perf span, `queuePanel.systemPlaylist.derive`, for the click-time derivation path.

Additional validation: the song-switch path updates cursor state without replacing the queue array. After Phase 1, QueuePanel's main selectors (`queue`, `activeSessionId`, `queueSource`) should stay stable during a plain song switch, so the component should not re-render for cursor-only changes.

The second symptom, "Now Playing tab 1 -> tab 2 song list", is not pinned down enough yet. It has two plausible interpretations:

- Main navigation: Now Playing -> Search.
- SearchPage internal gallery mode: sets -> tracks, where "tab 2" is the song list mode.

These two gestures hit different layers. The first goes through `transitionState(...)` and may involve native ViewTransition snapshots. The second stays inside SearchPage and should be measured as mode-switch derivation work. Phase 2 must resolve this before optimizing.

If the real gesture is main navigation, the likely cost is a combination of:

- [`SearchPage`](../../../src/pages/search-page.tsx) fresh mount doing multiple all-library reads and O(N) projections.
- Native View Transition snapshot/update around tab navigation.
- Missing trace spans around nav transition, ViewTransition lifecycle, React page mount cost, and SearchPage derived indexes.

Important correction: because [`App.tsx`](../../../src/App.tsx) conditionally renders pages (`tab === "search" && <SearchPage />`), SearchPage unmounts when leaving the tab. In the current architecture, "warm SearchPage tab switch" does not exist; component-local `useMemo`, `useDeferredValue`, and throttled values are lost on every unmount. Phase 3 must decide the mount/cache model before it can promise warm behavior.

### 1.3 Target Users

| Role | Description |
|------|-------------|
| Desktop listeners | Users switching songs or moving between Now Playing, Queue, and Search while expecting a stable 120 FPS feel |
| QA | Needs reproducible, attributable trace output instead of only aggregate FPS lows |
| Developers | Need precise spans to distinguish render-time derivation, IndexedDB emissions, ViewTransition snapshots, and page mount work |

### 1.4 Core Value

1. **Keep player interactions smooth**: song switching and tab switching should not trigger invisible full-library work.
2. **Make jank attributable**: every known heavy path should leave a local trace/perf span.
3. **Preserve local-first architecture**: no backend, no telemetry upload, no hidden runtime flags.
4. **Reduce blast radius**: optimize existing QueuePanel and SearchPage paths instead of introducing a second library/indexing architecture prematurely.

---

## 2. Findings

### 2.1 Confirmed: QueuePanel Render-Time Full-Library Work

Previous shape:

```
QueuePanel render
  ├─ useLiveQuery(listAllTracks)
  ├─ useLiveQuery(listTrackPlaybackStats)
  ├─ useLiveQuery(playbackEvents.toArray)
  └─ render derives:
       ├─ deriveHeartedPlaylist(allTracks)
       ├─ deriveRecentlyPlayedPlaylist(allTracks, events, stats)
       └─ deriveMostPlayedPlaylist(allTracks, events, stats, now)
```

Why this hurts:

- It runs on a drawer surface whose primary job is the current playback queue.
- The queue drawer can be open while the user switches songs.
- Playback stats/events are exactly the data that can change around song switching.
- The work was not separately recorded, so trace logs could show frame drops without naming this cause.

Why Phase 1 is expected to be effective:

- Plain song switching uses cursor-style player state updates and keeps the queue array reference stable.
- QueuePanel now selects only `queue`, `activeSessionId`, and `queueSource` for its normal render path.
- Therefore cursor-only changes should not re-render QueuePanel after the full-library liveQueries are removed.

Phase 1 target shape:

```
QueuePanel render
  └─ renders current queue + pinned buttons only

User clicks pinned system playlist
  └─ loadSystemPlaylistTracks(playlistId)
       ├─ listAllTracks(db)
       ├─ if needed: listTrackPlaybackStats(db) + playbackEvents.toArray()
       ├─ derive one selected playlist
       └─ notePerfWork("queuePanel.systemPlaylist.derive", ...)
```

### 2.2 Confirmed: SearchPage Remount O(N) Cluster

If the tab 1 -> tab 2 drop is main navigation into [`SearchPage`](../../../src/pages/search-page.tsx), it maps to several legitimate but clustered mount-time paths:

- `listSessions(db)`
- `listAllTracks(db)`
- memory-note projection from all tracks
- `trackById` map construction
- artist / album index construction
- playback stats and playback events reads
- entity stats/items and system playlist rows in sets mode
- filtering, sorting, and search result derivation for all tracks

Some of this work is memoized, throttled, mode-gated, or deferred. However, [`App.tsx`](../../../src/App.tsx) currently conditionally renders the page:

```
{tab === "search" && (
  <AmbientPageOverlay active={ambientActive}>
    <SearchPage />
  </AmbientPageOverlay>
)}
```

So leaving Search unmounts it. The next navigation back to Search is a fresh mount and all component-local caches are gone. This changes the product diagnosis:

- The O(N) cluster is not just a first-run cost.
- "Warm SearchPage" is not reachable with component-local `useMemo`.
- Phase 3 must decide whether SearchPage should stay mounted, whether expensive indexes should live outside the component, or whether a shared liveQuery snapshot/cache layer should own the data.

### 2.3 Ambiguous: "Tab 1 -> Tab 2 Song List" Could Be SearchPage Mode Switching

The QA phrase could also mean SearchPage's internal gallery mode tabs, where sets is tab 1 and tracks is tab 2. That gesture does not go through global navigation or ViewTransition. It goes through SearchPage mode state and can trigger `shownTracks`, alphabet/facet, and list/detail derivations.

This must be disambiguated before Phase 2 instrumentation is considered complete:

```
Gesture A: Now Playing -> Search
  └─ nav-fab / shortcut / dock entry
       └─ transitionState(...)
            └─ ViewTransition + SearchPage mount

Gesture B: SearchPage sets -> tracks
  └─ setModePref(...)
       └─ SearchPage mode switch + track derivations
```

### 2.4 Likely: ViewTransition Snapshot Cost During Main Tab Switch

Navigation entry points use `transitionState(...)`, including:

- [`nav-fab.tsx`](../../../src/components/nav/nav-fab.tsx)
- [`shortcuts/actions.ts`](../../../src/shortcuts/actions.ts)
- [`track-identity-row.tsx`](../../../src/components/player/track-identity-row.tsx)
- [`entity-detail.tsx`](../../../src/components/library/entity-detail.tsx)
- [`view-transition.ts`](../../../src/lib/view-transition.ts)
- [`view-transition-react.ts`](../../../src/lib/view-transition-react.ts)

Current concern:

```
Now Playing visible
  └─ native document.startViewTransition
       ├─ browser snapshots current view, including fixed NowPlayingBackground
       ├─ flushSync(update) forces the target tab mount into the transition update
       ├─ SearchPage mounts and runs fresh derived work
       └─ browser animates transition
```

Two details make this more serious than a generic transition cost:

- The outgoing Now Playing view includes a fixed full-screen [`NowPlayingBackground`](../../../src/App.tsx), which can contain WebGL/canvas/video/blurred background work. Chromium snapshots that full viewport layer for the transition.
- `transitionState` wraps the update in `flushSync`. That is correct for ViewTransition snapshot timing, but it means SearchPage's first commit is synchronous. It can fight against the intended benefit of `useDeferredValue`/`useThrottledValue`, which only help after the initial synchronous commit boundary.

The ViewTransition itself may still be correct UX, but it needs spans for:

- transition request
- update callback duration
- ready / skipped / failed, including `skipped: engine` for WebKit shells where `canViewTransition()` returns false
- finished duration
- target tab and source tab

Without those spans, a SearchPage mount cost can be misread as a player or queue cost.

### 2.5 Trace Blind Spots

Current trace coverage is strong around media playback, but weak around this specific UI work:

| Area | Current State | Gap |
|------|---------------|-----|
| QueuePanel system playlist derivation | Added in Phase 1 | Previously invisible; now visible only on click-time path |
| Tab navigation | Mostly state changes, not span-based | No start/update/finish duration for tab switch |
| Native ViewTransition | Used by `transitionState` on Chromium; skipped on WebKit | No trace for snapshot/update/finished/skipped lifecycle |
| SearchPage mode switching | Local state update inside SearchPage | No span to distinguish sets->tracks from Now Playing->Search |
| SearchPage derivations | Mostly React memo/useLiveQuery work | No spans for all-tracks read, index building, sort/filter, system playlist row derivation |
| React render/commit | Not independently recorded | Aggregate FPS/longtask cannot name the React subtree |
| Perf counters | `DevPerfPanel` and `ProdPerfHud` enable counters behind visible `perfHudEnabled` | The real requirement is to mount the visible HUD in dev/prod; this is not a hidden flag blocker |

### 2.6 Symptom 1 Needs Queue vs Cover-Pipeline Separation

The queue-drawer FPS low can be a stack of two costs:

- QueuePanel's old full-library system playlist liveQueries and render-time derivation.
- The independent song-switch cover/background decode and texture pipeline.

Phase 1 removes the first cost, but it does not prove the entire `fpsLow ~5` symptom is gone. The measurement plan must compare song switching with the drawer closed and open. If drawer-open and drawer-closed converge after Phase 1, QueuePanel is no longer the differentiating factor even if cover decode still causes some jank.

---

## 3. System Architecture

### 3.1 Current Jank-Relevant Flow

```
Song switch while QueuePanel is open
        │
        ├─ player-store updates queue/current playback state
        ├─ playback listen/stat writes may emit later
        ├─ queue rows re-render visible items
        └─ OLD QueuePanel also had full-library system playlist liveQueries
             └─ render-time liked/recent/most-played derivation
```

```
Now Playing -> Search tab
        │
        ├─ transitionState()
        │    └─ document.startViewTransition(...)
        ├─ SearchPage mounts fresh each time
        │    ├─ all tracks liveQuery
        │    ├─ sessions liveQuery
        │    ├─ stats/events liveQueries
        │    ├─ artist/album/search projections
        │    └─ virtual list first paint
        └─ aggregate frame/longtask metrics catch the symptom
             but current traces do not name each cluster
```
SearchPage -> another tab -> SearchPage again
        │
        └─ current App conditional rendering unmounts SearchPage
             └─ component-local memo/deferred/throttled caches are lost
```

```
SearchPage sets mode -> tracks mode
        │
        ├─ no global ViewTransition required
        ├─ mode state changes inside SearchPage
        └─ track list projections become visible / selected
```


### 3.2 Target Flow

```
Song switch while QueuePanel is open
        │
        ├─ queue-only render work
        ├─ no full-library system playlist derivation
        └─ if user clicks a pinned system playlist:
              └─ derive exactly one system playlist + emit span
```

```
Now Playing -> Search tab
        │
        ├─ exact gesture identified: main nav vs SearchPage mode switch
        ├─ nav transition span
        ├─ ViewTransition lifecycle spans
        ├─ SearchPage mount/projection spans
        ├─ SearchPage mode-switch spans
        ├─ explicit SearchPage mount/cache model decision
        └─ optimization decisions based on named costs
```

### 3.3 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| UI | React 19 + Vite | Existing app stack |
| Local DB | Dexie 4 + `useLiveQuery` | Required for local-first IndexedDB reads |
| Local state | Zustand selectors | Must preserve small selector discipline |
| Lists | TanStack Virtual | Keep visible row mount bounded |
| Perf logging | `notePerfWork`, `DevPerfPanel`, trace logger | Reuse local diagnostics; no telemetry upload |

### 3.4 Project Structure

```
src/
├── App.tsx                                  # conditional page mounting model
├── components/player/queue-panel.tsx        # Phase 1 hotfix and new span
├── components/player/queue-panel.test.tsx   # Phase 1 regression tests
├── pages/search-page.tsx                    # Phase 2/3 observation + optimization target
├── components/nav/nav-fab.tsx               # nav transition entry point
├── components/player/track-identity-row.tsx # now-playing open transition entry point
├── components/library/entity-detail.tsx     # detail/list transition entry point
├── shortcuts/actions.ts                     # keyboard nav transition entry point
├── lib/view-transition.ts                   # native ViewTransition wrapper
├── lib/view-transition-react.ts             # flushSync transition wrapper
├── lib/perf-counters.ts                     # local perf work spans
└── components/dev/dev-perf-panel.tsx        # frame/longtask surface
```

---

## 4. Data Model Design

### 4.1 Core Concepts

This PRD does not introduce a new persistent data model.

```
tracks + playbackStats + playbackEvents
        │
        ├─ QueuePanel pinned playlist action
        │    └─ lazy read/derive on click only
        │
        └─ SearchPage library views
             └─ read/derive/index for visible mode
```

### 4.2 Database Schema

- **Current Schema:** [`muzero-db.ts`](../../../src/db/muzero-db.ts), [`types.ts`](../../../src/db/types.ts)
- **Required Changes:** None for Phase 1-4.
- **Data Migration:** None.
- **Constraints & Indexing:** No new indexes proposed until SearchPage spans prove a specific query bottleneck.
- **Performance Impact:** The main issue is frontend main-thread derivation and IndexedDB result materialization, not schema correctness.
- **Privacy & Retention:** No new telemetry, no network upload, no PII collection.

### 4.3 Data Relationship Diagram

```
Track[]
  │
  ├─ liked fields / tags / note / cover metadata
  ├─ PlaybackStats[]
  └─ PlaybackEvent[]
       │
       ├─ system playlist derivation
       └─ SearchPage library projections
```

---

## 5. API Design

This work is local frontend only. There are no HTTP endpoints and no backend changes.

### 5.1 Local Diagnostic Events

| Span / Event | Source | Description |
|--------------|--------|-------------|
| `queuePanel.systemPlaylist.derive` | Phase 1 | Duration and selected playlist id for lazy system playlist derivation |
| `nav.tabSwitch` | Phase 2 | Source tab, target tab, and total transition duration |
| `nav.viewTransition.update` | Phase 2 | Duration of the state update callback inside native ViewTransition |
| `nav.viewTransition.finished` | Phase 2 | Total native ViewTransition duration, including skipped/failed state |
| `nav.viewTransition.skipped` | Phase 2 | Explicit fallback reason, especially `engine` for WebKit shells |
| `searchPage.modeSwitch` | Phase 2 | Source mode, target mode, and visible derivation duration |
| `searchPage.derive.*` | Phase 2 | Named durations for all-tracks projection, artist/album index, stats/events rows, filter/sort/search |

### 5.2 Error Handling

- Diagnostic spans must be best-effort and never block interaction.
- Failures in tracing should use [`logger.ts`](../../../src/lib/logger.ts), not `console.*`.
- No hidden `localStorage`, URL, or `window.*` debug flags. QA collection should use existing visible diagnostics surfaces or explicit dev tooling.

---

## 6. Frontend Design

### 6.1 QueuePanel

Current Phase 1 behavior:

- The drawer renders current queue rows and pinned playlist buttons.
- It does not subscribe to all tracks, playback stats, or playback events just to render the header.
- Clicking a pinned system playlist lazily loads only the data needed for that selected playlist.
- The click path records `queuePanel.systemPlaylist.derive`.

This keeps the drawer cheap during song switching.

### 6.2 SearchPage

Phase 2 should first instrument, then Phase 3 should reduce work. Before any "warm SearchPage" target is accepted, Phase 3 must choose one of the mount/cache models:

- **Keep mounted:** render SearchPage persistently and hide inactive pages with CSS/visibility semantics that do not break accessibility or background work budgets.
- **Lift indexes:** move expensive `trackById`, artist index, album index, or related projections into a module-level cache or store that survives unmount.
- **Shared liveQuery snapshot:** centralize the all-tracks/stats/events snapshots outside SearchPage so remounts reuse the latest materialized data.

Candidate reductions after that decision:

- Gate set/system playlist derivations by active mode instead of preparing all modes when entering tracks.
- Build artist/album indexes only when the corresponding surface is visible or about to be visible.
- Defer non-visible derived collections to idle time or after ViewTransition finished.
- Keep list virtualization intact; do not replace it with custom scrolling.
- Avoid introducing a persistent database index unless spans prove in-memory mount/cache fixes are insufficient.

### 6.3 Navigation / ViewTransition

The UX can keep native ViewTransition, but the transition wrapper needs trace coverage. If spans show the snapshot/update cost is too high for Now Playing -> Search, options include:

- Skip native ViewTransition for heavy target pages.
- Use a lighter page-local transition for Search.
- Defer SearchPage secondary projections until after transition finished.

The first-frame conflict must be visible in the trace: `flushSync` is necessary for native ViewTransition correctness, but it can force SearchPage's initial mount/projection work into the same synchronous update window. These should be product decisions backed by trace data, not hidden flags.

---

## 7. Measurement Methodology

Performance changes must be verified on a production-like desktop build, not only Vite dev mode. Dev mode can exaggerate React/HMR/sourcemap overhead.

Counters and frame summaries are available in dev and prod when the visible performance HUD setting is enabled. In dev, [`App.tsx`](../../../src/App.tsx) mounts `DevPerfPanel`; in prod, [`ProdPerfHud`](../../../src/components/dev/dev-perf-panel.tsx) mounts the same panel behind `settings.perfHudEnabled`. The requirement is to enable and mount that visible HUD, not to add a hidden diagnostic flag.

### 7.1 Metrics

| Metric | Why |
|--------|-----|
| `fpsAvg` | Captures overall smoothness |
| `fpsLow` | Captures user-visible worst moments; primary QA symptom |
| `frame p99` / `frame max` | Shows cadence stalls outside explicit render spans |
| `longtask max` / count | Names main-thread pauses >=50ms |
| `queuePanel.systemPlaylist.derive` | Confirms QueuePanel system playlist work does not run during song switching |
| `nav.viewTransition.*` | Distinguishes transition cost from page mount cost |
| `searchPage.modeSwitch` | Distinguishes SearchPage internal tabs from global navigation |
| `searchPage.derive.*` | Names SearchPage O(N) projections |
| IndexedDB query durations / emission count | Distinguishes DB materialization from pure JS projection |

### 7.2 QA Scenarios

1. Queue drawer closed, switch songs repeatedly. This isolates the cover/background/player switch baseline.
2. Queue drawer open, switch songs repeatedly, without clicking pinned system playlists.
3. Compare drawer-open vs drawer-closed FPS lows. Phase 1 succeeds when the delta shrinks materially, not merely when a span is absent.
4. Queue drawer open, click liked / recent / most-played pinned playlists. This should be the only scenario that emits `queuePanel.systemPlaylist.derive`.
5. Gesture A: Now Playing -> Search main navigation. In the current mount model, every repeat after leaving Search is cold again.
6. Gesture B: SearchPage internal sets -> tracks mode switch. This must be measured separately from navigation.
7. Other transition entries: dock cover/title into Now Playing, Search detail/list transitions, and keyboard nav shortcuts.

### 7.3 Baseline and Target

Use the QA baseline as relative truth:

- Queue drawer symptom: ~120 FPS -> ~70 FPS, `fpsLow` ~5.
- Now Playing -> Search symptom: ~120 FPS -> ~90 FPS, `fpsLow` ~9.

Target:

- Queue drawer song switching should not emit `queuePanel.systemPlaylist.derive`; this is necessary but not sufficient.
- Queue drawer song switching should have no unexplained full-library work in trace.
- Drawer-open and drawer-closed song-switch FPS lows should converge after Phase 1, with remaining jank attributed to cover/background/player paths.
- Now Playing -> Search should have named spans for every >16ms UI work cluster and every long task.
- SearchPage sets -> tracks should have named mode-switch and projection spans if that is the real QA gesture.
- After Phase 3, `fpsLow` should improve materially from the reported 5/9 lows on the same QA fixture, with no unattributed >50ms long tasks in the relevant interaction window.

---

## 8. Implementation Plan

### Phase 1: QueuePanel System Playlist Work Hotfix

**Goal:** Remove full-library system playlist subscriptions and render-time derivation from QueuePanel.

**Tasks:**

- [x] Remove `useLiveQuery(listAllTracks)`, `useLiveQuery(listTrackPlaybackStats)`, and `playbackEvents.toArray()` from QueuePanel render path.
- [x] Add lazy `loadSystemPlaylistTracks(playlistId)` for pinned playlist clicks.
- [x] Derive only the selected system playlist on click.
- [x] Add `notePerfWork("queuePanel.systemPlaylist.derive", ...)`.
- [x] Update QueuePanel tests for async pinned playlist playback.

**Verification:**

- [x] `node_modules\.bin\vitest.CMD run src/components/player/queue-panel.test.tsx`
- [x] `node_modules\.bin\tsc.CMD --noEmit --pretty false`
- [x] `node_modules\.bin\biome.CMD check src/components/player/queue-panel.tsx src/components/player/queue-panel.test.tsx`

### Phase 2: Gesture Disambiguation + Transition/Mode Observability

**Goal:** Make the reported "tab 1 -> tab 2 song list" FPS drop attributable to the correct layer before optimizing.

**Tasks:**

- [ ] Confirm the exact QA gesture: Now Playing -> Search main navigation, SearchPage sets -> tracks mode switch, or both.
- [ ] Add nav tab switch span around source tab, target tab, requested timestamp, completed timestamp, and entry point (`nav-fab`, shortcut, dock identity, detail row).
- [ ] Add ViewTransition lifecycle spans in [`view-transition.ts`](../../../src/lib/view-transition.ts): update callback, ready/skipped/fail, finished, and explicit `skipped: engine` for WebKit shells.
- [ ] Add a SearchPage mode-switch span around `setModePref(...)` for sets/tracks/albums/artists/online.
- [ ] Add SearchPage named local spans for fresh all-tracks emission, memory-note projection, track map creation, artist index, album index, stats/events system rows, filter/sort/search.
- [ ] Document that QA must enable the visible performance HUD (`perfHudEnabled`) in dev/prod to collect frame counters and perf work spans.
- [ ] Keep trace payloads redacted: ids/counts/durations are OK; note text, prompts, filenames, and media bytes are not.

**Checklist:**

- [ ] A Now Playing -> Search trace can explain the low-FPS window without guessing when the gesture is main navigation.
- [ ] A SearchPage sets -> tracks trace can explain the low-FPS window without navigation spans when the gesture is internal mode switching.
- [ ] ViewTransition skipped/failure paths are logged without throwing.
- [ ] Spans add negligible overhead and do not run in tight per-frame loops.

### Phase 3: SearchPage Mount Model + Cross-Mount Work Reduction

**Goal:** Reduce the clustered all-library work that currently repeats whenever SearchPage remounts or switches into tracks mode.

**Tasks:**

- [ ] Decide the SearchPage mount/cache model first: persistent hidden page, lifted in-memory indexes/store, shared liveQuery snapshot cache, or a measured combination.
- [ ] Use Phase 2 data to rank SearchPage derivations by duration and emission count.
- [ ] If SearchPage remains conditionally mounted, move selected stable projections outside component-local memo so they survive unmount.
- [ ] Gate inactive modes so tracks view does not eagerly build all sets/artists/albums/system playlist rows unless needed.
- [ ] Defer non-visible secondary projections to idle time or to `viewTransition.finished` when the source gesture is main navigation.
- [ ] Avoid recomputing stable maps/indexes when inputs have not semantically changed across remounts.
- [ ] Preserve Dexie liveQuery correctness and TanStack Virtual behavior.

**Checklist:**

- [ ] Cold SearchPage mount has fewer named >16ms clusters.
- [ ] Warm behavior is either enabled by the chosen mount/cache model or explicitly declared unavailable.
- [ ] Repeated Now Playing -> Search no longer rebuilds all indexes unless inputs changed.
- [ ] Search, library rows, sets, artists, and albums remain functionally correct.

### Phase 4: QA Profiling Protocol and Regression Guard

**Goal:** Make future FPS reports repeatable and comparable.

**Tasks:**

- [ ] Document the exact QA library fixture size: track count, cover density, playback event count, stats count.
- [ ] Capture before/after traces for the scenarios in §7.2.
- [ ] Add a short manual profiling checklist near existing performance PRDs or QA docs.
- [ ] Consider a focused test/helper that asserts QueuePanel render does not call system playlist repositories.

**Checklist:**

- [ ] QA can hand developers one trace bundle with spans, FPS summary, and fixture scale.
- [ ] Regression review can tell whether a future drop comes from QueuePanel, SearchPage, ViewTransition, media/cover, or another path.

---

## 9. Out of Scope

- Now Playing cover/background decoding fixes. Those belong to [now-playing-switch-background-perf PRD](../20260613-muzero-now-playing-switch-background-perf-prd/20260613-muzero-now-playing-switch-background-perf-prd.md) and [cover-render-pipeline-performance PRD](../20260613-muzero-cover-render-pipeline-performance-prd/20260613-muzero-cover-render-pipeline-performance-prd.md). This PRD still must measure drawer-closed song switching so QueuePanel cost is separated from cover-pipeline cost.
- A new backend, telemetry service, account system, or cloud analytics.
- Hidden feature flags or localStorage kill switches.
- Full rewrite of SearchPage or a persistent database indexing subsystem before Phase 2 measurements. A small in-memory cache/store may be considered in Phase 3 if it is the chosen mount-model fix.
- Audio fade / transport behavior changes.

---

## 10. Security Considerations

- **Authentication:** No authentication changes.
- **Authorization:** No permission model changes.
- **Data Protection:** All data remains local IndexedDB data.
- **Audit Logging:** Diagnostic spans are local developer/QA diagnostics only; no upload.
- **Secret Safety:** No API keys or provider credentials are touched.
- **Console Discipline:** New logs/spans must use [`logger.ts`](../../../src/lib/logger.ts) or existing perf/trace helpers, not direct `console.*`.

---

## 11. Related Documents

| Document | Description |
|----------|-------------|
| [system-playlists PRD](../20260613-muzero-system-playlists-prd/20260613-muzero-system-playlists-prd.md) | Feature source for liked/recent/most-played system playlists |
| [playback trace performance optimization PRD](../20260612-muzero-playback-trace-performance-optimization-prd/20260612-muzero-playback-trace-performance-optimization-prd.md) | Existing playback trace/perf work |
| [now-playing switch background perf PRD](../20260613-muzero-now-playing-switch-background-perf-prd/20260613-muzero-now-playing-switch-background-perf-prd.md) | Related but separate Now Playing cover/background switching work |
| [cover render pipeline performance PRD](../20260613-muzero-cover-render-pipeline-performance-prd/20260613-muzero-cover-render-pipeline-performance-prd.md) | Related cover decode/render pipeline work |
| [`queue-panel.tsx`](../../../src/components/player/queue-panel.tsx) | Phase 1 implementation |
| [`queue-panel.test.tsx`](../../../src/components/player/queue-panel.test.tsx) | Phase 1 regression tests |
| [`search-page.tsx`](../../../src/pages/search-page.tsx) | Phase 2/3 primary target |

---

## 12. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | Which exact QA gesture produced "tab 1 -> tab 2 song list": main navigation or SearchPage mode switch? | Open | Must answer before Phase 2 is considered complete |
| 2 | What SearchPage mount/cache model should support warm behavior? | Open | Options: persistent hidden mount, lifted in-memory indexes/store, shared liveQuery snapshot cache |
| 3 | Should Now Playing -> Search skip native ViewTransition for heavy target pages? | Open | Decide after spans show snapshot/update cost and `flushSync` mount cost |
| 4 | What QA fixture size should define the desktop performance budget? | Open | Need track count, event count, stats count, cover density |
| 5 | Should SearchPage build artist/album/system playlist projections lazily by active mode? | Open | Likely yes, but rank with Phase 2 timings first |
| 6 | Is a persistent local library index needed? | Open | Out of scope until in-memory mount/cache fixes prove insufficient |

---

## 13. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-14 | Codex | Initial draft: recorded QueuePanel root cause, Phase 1 hotfix, SearchPage/ViewTransition hypotheses, trace blind spots, and follow-up plan |
| 2026-06-14 | Codex | Incorporated architecture review: SearchPage remounts on every tab return, symptom 2 gesture is ambiguous, ViewTransition `flushSync` can fight first-frame deferral, ProdPerfHud already supports prod counters, and QueuePanel verification needs drawer-open vs drawer-closed comparison |
