# PRD: MUZERO System Playlists

**Status:** Implemented
**Created:** 2026-06-13
**Author:** Codex
**Module:** Library / Sets / Playback Stats - non-deletable default smart playlists

> Product request: In the playlist/set area, MUZERO should always provide three default playlists that cannot be deleted: Hearted tracks, Recently Played, and Most Played. Most Played must support All / Month / Week / Day ranges and show the play count for the selected range, such as the last week's play count.

---

## Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | PRD + Current-State Audit | Completed | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | System Playlist Model + Selectors | Completed | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | Gallery / Set Detail UI Integration | Completed | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | Playback Stats Range Aggregation | Completed | [Phase 4 Checklist](#phase-4-checklist) |
| 5 | i18n + Empty States + Tests | Completed | [Phase 5 Checklist](#phase-5-checklist) |
| 6 | Stats Columns + Sortable Queue Order | Completed | [Phase 6 Checklist](#phase-6-checklist) |

> Status Legend: Completed | In Progress | Pending

---

## 1. Overview

### 1.1 Background

MUZERO already has user-created mixed sets (`DjSession`) and a track library. It also already stores the two key signals this feature needs:

- `Track.liked` in `src/db/types.ts`, updated through `setTrackLiked` in `src/db/repositories.ts`.
- Playback stats in `trackPlaybackStats`, `playbackEvents`, and `playbackAggregates` from `src/sync/playback-stats.ts`.

Today, users can filter liked tracks inside some library surfaces, and can sort tracks by last played. However, these behaviors are not represented as first-class playlists. A listener expects a music app to always provide:

- a hearted/favorites collection;
- a quick route back to recently heard songs;
- a ranking of tracks they play the most, with useful time windows.

This PRD makes those three collections visible as default system playlists in the same mental model as "sets", while keeping them derived from current local data instead of duplicating membership.

### 1.2 Target Users

| Role | Description | Permissions |
|------|-------------|-------------|
| Everyday listener | Uses MUZERO like a local-first YouTube Music / Poweramp-style player. | Open default system playlists, play all, play track, search/sort inside the list. |
| Memory curator | Hearts meaningful songs and expects them to stay easy to find. | Toggle heart on tracks; system playlist updates automatically. |
| Power listener | Wants to see listening habits by all time, month, week, and day. | Change Most Played time range and inspect range play counts. |
| Library organizer | Manages user-created sets separately from app-provided smart playlists. | Can delete normal sets, but cannot delete system playlists. |

### 1.3 Core Value

1. **Music-app familiarity:** MUZERO ships with the three default collections users expect.
2. **No duplicate truth:** System playlists are derived from `Track.liked` and playback stats, not copied into `DjSession.trackIds`.
3. **Deletion safety:** Default playlists cannot be deleted because there is no destructive set row to remove.
4. **Useful personal stats:** Most Played answers "what am I playing most this week/month/today?" with visible play counts.
5. **Local-first compliance:** All ranking and filtering reads IndexedDB; no MUZERO backend or telemetry is introduced.

---

## 2. System Architecture

### 2.1 Architecture Overview

```
IndexedDB muzero-db
  -> tracks
       -> liked
       -> title / cover / media metadata
  -> trackPlaybackStats
       -> all-time per-track playCount / listenedSec / lastPlayedAt
  -> playbackEvents
       -> timestamped listened segments for day/week/month windows

Pure derived selectors
  -> system:liked
       tracks where liked === true
  -> system:recent
       tracks sorted by max(lastPlayedAt) desc
  -> system:most
       range = all | month | week | day
       aggregate counted playback events or all-time stats

Gallery / Sets UI
  -> System playlist cards pinned above user sets
  -> Opening card renders the existing virtualized track-list detail surface
  -> Delete / rename / cover edit actions hidden or disabled for system playlists

Queue UI
  -> System playlists appear as pinned playable sources
  -> Selecting one replaces the queue with the current derived order
  -> It is a playlist source, not a persisted DjSession row

Player store
  -> playSystemPlaylist(id, range?)
  -> loads derived track ids into PlayQueue
  -> records a virtual queue source label separately from DjSession context
```

### 2.2 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Data source | Dexie 4 / IndexedDB `muzero-db` | Existing local-first persistence layer. |
| Reactive reads | Dexie `useLiveQuery` | System playlists should update when a track is liked or playback stats are flushed. |
| Derived logic | Pure TypeScript selectors | Keeps ranking/filtering unit-testable and avoids coupling UI to Dexie details. |
| List rendering | Existing Gallery / `VirtualTrackList` / TanStack Virtual | System playlists can reuse large-library rendering patterns. |
| Playback | Existing `playQueueSet` / player store | Derived track ids can be loaded into the decoupled queue like normal set ids. |
| UI | React 19 + COSS/shadcn primitives + lucide icons | Matches current library surface and uses `Heart`, `History`, `Trophy`/`Chart` style icons. |
| i18n | `src/i18n/locales/{en,zh,ja,ko}/common.json` | All visible labels, ranges, counts, and empty states must be localized. |

### 2.3 Project Structure

```
src/
├── lib/
│   ├── system-playlists.ts             # new pure model/selectors for default smart playlists
│   └── system-playlists.test.ts        # range aggregation + ordering tests
├── pages/
│   └── search-page.tsx                 # Gallery/Sets mode renders pinned system cards + detail views
├── components/
│   ├── player/
│   │   └── queue-panel.tsx             # shows system playlists as pinned playable queue sources
│   └── library/
│       └── virtual-track-list.tsx      # reused for system detail lists
├── stores/
│   └── player-store.ts                 # optional playSystemPlaylist helper, or reuse playQueueSet
├── db/
│   ├── types.ts                        # no required schema change
│   └── repositories.ts                 # optional list helpers over playbackEvents/stats
└── i18n/locales/{en,zh,ja,ko}/common.json
```

---

## 3. Data Model Design

### 3.1 Core Concepts

```
SystemPlaylist
  id: system:liked | system:recent | system:most
  kind: derived
  deletable: false
  editableMetadata: false
  trackIds: derived at read time

MostPlayedRange
  all   -> all-time stats from trackPlaybackStats
  month -> playbackEvents within rolling 30 days
  week  -> playbackEvents within rolling 7 days
  day   -> playbackEvents within local today
```

### 3.2 Database Schema

Current source of truth:

- `src/db/types.ts` `Track.liked`
- `src/db/types.ts` `TrackPlaybackStats`
- `src/db/types.ts` `PlaybackEvent`
- `src/db/types.ts` `PlaybackAggregate`
- `src/db/types.ts` `RemoteSearchTrack`
- `src/db/repositories.ts` `listAllTracks`
- `src/db/repositories.ts` `listTrackPlaybackStats`
- `src/sync/playback-stats.ts` `recordPlaybackListen`

Required schema changes:

- No required Dexie version bump for v1 of this feature.
- Do not create three `DjSession` rows for these playlists.
- Do not add `trackIds` snapshots to settings.
- Do not store localized names in IndexedDB.

Recommended in-code types:

```ts
export type SystemPlaylistId = "system:liked" | "system:recent" | "system:most";
export type MostPlayedRange = "all" | "month" | "week" | "day";

export interface SystemPlaylistDefinition {
  id: SystemPlaylistId;
  icon: "heart" | "history" | "chart";
  deletable: false;
  editableMetadata: false;
}

export interface SystemPlaylistTrackMetric {
  trackId: string;
  remoteTrackId?: string;
  playCount: number;
  listenedSec: number;
  lastPlayedAt?: number;
}

export type SystemPlaylistPlayable =
  | { kind: "local-track"; track: Track; metric?: SystemPlaylistTrackMetric }
  | { kind: "remote-track"; remote: RemoteSearchTrack; metric: SystemPlaylistTrackMetric };
```

Playable item scope:

- System playlists should include every playable item the local device can identify and render, not only tracks with local media bytes.
- Local `Track` rows are included when they match the playlist rule.
- Streamed tracks represented as local `Track` rows are included exactly like uploaded/generated tracks.
- Remote/shared tracks without a local `Track` row may appear in Recently Played and Most Played when a `PlaybackEvent.remoteTrackRef` can be joined to local remote-search/share metadata such as `RemoteSearchTrack`.
- Hearted requires an explicit local liked/hearted state. Remote-only tracks appear in Hearted only after MUZERO has a local liked state for that remote identity; do not infer hearted status from playback history.

### 3.3 Data Relationship Diagram

```
Track
  id
  liked
  playCount (legacy/all-time mirror)
        ^
        |
TrackPlaybackStats
  trackId
  devicePublicId
  playCount
  listenedSec
  lastPlayedAt
        ^
        |
PlaybackEvent
  trackId
  remoteTrackRef
  startedAt / endedAt
  listenedSec
  countedAsPlay
```

### 3.4 Derivation Rules

Hearted:

- Include tracks where `track.liked === true`.
- Default order: most recently updated/hearted first using `track.updatedAt ?? track.createdAt`, then title.
- Empty state: explain that hearting a song will place it here.

Recently Played:

- Include tracks with a playback stat `lastPlayedAt`.
- Fold multiple `TrackPlaybackStats` rows by `trackId` and use the max `lastPlayedAt`.
- Include remote-only playable items when `PlaybackEvent.remoteTrackRef` can be resolved to display metadata.
- Default order: `lastPlayedAt desc`, then title.
- Rows should show a relative/absolute last-played timestamp and optionally total listened time.

Most Played:

- Range `all`: use folded `trackPlaybackStats` by `trackId` for cheap all-time totals.
- Range `month`: include `playbackEvents` whose effective timestamp is inside the last 30 days.
- Range `week`: include `playbackEvents` inside the last 7 days.
- Range `day`: include `playbackEvents` since local start of day.
- Count only events where `countedAsPlay === true` for `playCount`.
- Sum `listenedSec` for all events in the range, including sub-threshold listens, so the subtitle can show meaningful listening time.
- Include remote-only playable items when the event has a resolvable `remoteTrackRef`.
- Sort by `playCount desc`, then `listenedSec desc`, then `lastPlayedAt desc`, then title.
- Row metric must show the selected range count, for example "12 plays this week".

Time window semantics:

- `day` is local calendar day, from local midnight to now.
- `week` is rolling last 7 * 24 hours, not ISO week.
- `month` is rolling last 30 days for v1.
- `all` is all recorded local/synced stats currently present in IndexedDB.

### 3.5 Performance and Indexing

- `trackPlaybackStats` has indexes on `trackId`, `devicePublicId`, and `[trackId+devicePublicId]`; all-time folding is acceptable for local libraries.
- `playbackEvents` has `[devicePublicId+startedAt]` but not a plain `startedAt` index. V1 can query per local device for windowed stats; if cross-device range queries become slow, add a future Dexie version with `playbackEvents: "id, devicePublicId, startedAt, trackId, [devicePublicId+startedAt]"`.
- UI must debounce or memoize derived ranking so live playback stat flushes do not rescan large arrays every animation frame.
- Use `useLiveQuery` for table-level reads and pure memoized transforms in React; do not store derived playlist arrays in Zustand.

---

## 4. API Design

### 4.1 API Endpoints

No backend API endpoints. MUZERO remains local-first.

### 4.2 Internal Selector API

```ts
export function getSystemPlaylistDefinitions(): SystemPlaylistDefinition[];

export function deriveHeartedPlaylist(tracks: Track[]): Track[];

export function deriveRecentlyPlayedPlaylist(
  tracks: Track[],
  input: {
    stats: TrackPlaybackStats[];
    events: PlaybackEvent[];
    remoteTracks?: RemoteSearchTrack[];
  },
): SystemPlaylistPlayable[];

export function deriveMostPlayedPlaylist(
  tracks: Track[],
  input: {
    range: MostPlayedRange;
    now: number;
    stats: TrackPlaybackStats[];
    events: PlaybackEvent[];
    remoteTracks?: RemoteSearchTrack[];
  },
): SystemPlaylistPlayable[];
```

### 4.3 Error Handling

- Missing stats tables: return empty derived lists; do not throw in UI.
- Stats rows for deleted tracks: ignore by joining against the current `tracks` map.
- Events without `trackId` and only remote references: include them when the remote identity can be resolved to a playable/displayable remote item; otherwise ignore defensively.
- Tracks not `ready`: v1 should hide `pending/generating/failed` from system playlist playback by default, but may show failed rows only if existing library detail views already support them cleanly.
- Logging: if unexpected stats shape is encountered, use `src/lib/logger.ts`; never call `console.*` in `src/**`.

---

## 5. Frontend Design

### 5.1 Page Structure

Primary integration point:

```
Search / Gallery page
  mode = sets
    System playlist rail/cards pinned at top
      Hearted
      Recently Played
      Most Played
    User sets grid below
  selected entity detail
    if system playlist -> derived virtual list detail
    if user set -> existing set detail

Queue panel
  pinned sources
    Hearted
    Recently Played
    Most Played
  current queue
    unchanged PlayQueue entries
```

### 5.2 UI Components

System playlist cards:

- Appear before user-created sets in the Sets/Gallery surface.
- Use distinctive icons:
  - Hearted: filled heart when non-empty.
  - Recently Played: history/clock.
  - Most Played: chart/trophy.
- Show a count:
  - Hearted: number of liked tracks.
  - Recently Played: number of tracks with `lastPlayedAt`.
  - Most Played: number of tracks with `playCount > 0` for active/default range.
- Use generated/derived cover treatment:
  - Hearted can use the newest liked track cover fallback.
  - Recently Played can use the latest played track cover fallback.
  - Most Played can use the top track cover fallback.
  - No custom cover editing in v1.

Detail view:

- Reuse the existing virtualized track list and track row actions.
- Hide set-only actions: rename set, delete set, edit set cover, drag reorder, remove from set.
- Keep valid track actions: play, play next, add to queue, heart/unheart, tags/memories/cover edits on the track itself.
- Most Played detail includes a segmented control: All / Month / Week / Day.
- Most Played row metadata shows selected-range play count and listened time.
- Recently Played row metadata shows last played timestamp.
- Hearted row metadata can show artist/album plus heart state.

Queue integration:

- The Queue surface should show the three system playlists as pinned source shortcuts above or near the current queue controls.
- Activating a system playlist from Queue replaces the current queue with that playlist's current derived order, same as "play all" from the Gallery detail.
- The Queue label should be able to say it is playing from Hearted / Recently Played / Most Played without requiring a backing `DjSession`.
- Queue actions must not offer delete/rename/reorder for the system playlist itself.

Deletion behavior:

- System playlists do not show a delete menu item.
- If a generic delete action is triggered programmatically with a system id, it must no-op and log a warning through `logger.warn`.
- User-created sets remain deletable through the existing delete flow.

### 5.3 State Management

- Do not put derived playlist tracks into Zustand.
- Most Played range can be local component state and optionally persisted as a small UI preference if a visible Settings/control requirement appears later.
- `activeSessionId` should remain a real `DjSession` id. Opening a system playlist detail should not pretend it is a `DjSession`.
- Queue playback should introduce a separate non-persisted queue source label/ref for system playlists, for example `{ kind: "system-playlist", id }`. It must not write `system:*` ids into `DjSession`-specific code paths that expect a DB row.

---

## 6. Implementation Plan

### Phase 1: PRD + Current-State Audit

**Goal:** Capture product requirement and align it to existing local data.

**Tasks:**
- [x] Confirm `Track.liked` exists.
- [x] Confirm playback stats/events tables exist.
- [x] Confirm user sets are `DjSession` rows and deletion is destructive for set rows only.
- [x] Decide system playlists should be derived virtual playlists, not seeded rows.

### Phase 1 Checklist

- [x] PRD created under `docs/prd/20260613-muzero-system-playlists-prd/`.
- [x] Existing data model references included.

### Phase 2: System Playlist Model + Selectors

**Goal:** Build pure, testable derivation logic.

**Tasks:**
- [x] Add `src/lib/system-playlists.ts` with stable system ids and range types.
- [x] Implement Hearted derivation from `Track.liked`.
- [x] Implement Recently Played derivation from folded `TrackPlaybackStats`.
- [x] Implement Most Played derivation from `TrackPlaybackStats` and `PlaybackEvent`.
- [x] Resolve remote-only playback events into displayable/playable remote entries when local remote metadata exists.
- [x] Add range boundary helpers for all/month/week/day.

### Phase 2 Checklist

- [x] Unit tests cover empty library, deleted-track stats, multi-device folded stats, tie-breaking, and non-ready tracks.
- [x] Week/month/day windows use deterministic injected `now`.
- [x] Selectors do not mutate input arrays.

### Phase 3: Gallery / Set Detail UI Integration

**Goal:** Make the three default playlists visible and non-deletable.

**Tasks:**
- [x] Add pinned system playlist cards to the Sets/Gallery surface.
- [x] Add pinned system playlist source shortcuts to the Queue surface.
- [x] Route system playlist selection to a virtual detail view.
- [x] Reuse virtualized track list for system details.
- [x] Hide/disable set-only actions for system playlists.
- [x] Add play-all behavior for derived track id order.
- [x] Add a non-DjSession queue source label for "playing from" system playlists.

### Phase 3 Checklist

- [x] System playlist cards appear even when there are no user-created sets.
- [x] System playlist shortcuts appear in Queue as playable sources.
- [x] Delete UI is absent for system playlists.
- [x] Normal user set deletion remains unchanged.
- [x] Playing a system playlist loads the current derived order into the play queue.

### Phase 4: Playback Stats Range Aggregation

**Goal:** Make Most Played range counts correct and clear.

**Tasks:**
- [x] Query `playbackEvents` for day/week/month windows.
- [x] Use `trackPlaybackStats` for all-time totals.
- [x] Display selected-range play count on each Most Played row.
- [x] Display listened time as secondary metadata when available.
- [x] Coalesce live stat updates to avoid library UI churn while playback is running.

### Phase 4 Checklist

- [x] "Week" shows only plays in the rolling last 7 days.
- [x] "Day" resets at local midnight.
- [x] Rows with listens but zero counted plays are excluded from Most Played by default.
- [x] Tie-breaking is deterministic.

### Phase 5: i18n + Empty States + Tests

**Goal:** Ship polished, localized, regression-covered behavior.

**Tasks:**
- [x] Add i18n keys for all four locales: en, zh, ja, ko.
- [x] Add empty states for each system playlist.
- [x] Add component tests for card presence, delete absence, range switching, and row metric rendering.
- [x] Run `make test` or targeted Vitest suites.
- [x] Attempt `make check` and document local toolchain / unrelated-test blockers.

### Phase 5 Checklist

- [x] No user-visible string is hardcoded in components.
- [x] Tests prove system playlists cannot call the destructive delete flow.
- [x] Tests prove toggling a track heart updates Hearted from the latest live track rows.
- [x] Tests prove playback stat events update Most Played range metrics.

### Phase 5 Verification Notes

- `node node_modules/vitest/vitest.mjs run src/pages/library-empty-states.test.tsx src/components/library/system-playlist-cards.test.tsx src/components/library/system-playlist-detail.test.tsx src/components/player/queue-panel.test.tsx src/lib/system-playlists.test.ts` passes: 5 files, 18 tests.
- `node node_modules/@biomejs/biome/bin/biome check --formatter-enabled=false ...` passes for the touched implementation and test files.
- `make check` was attempted on 2026-06-13 but the local shell cannot find `pnpm`.
- Direct `tsc --noEmit` is currently blocked by an unrelated existing fixture error in `src/components/settings/listening-stats-summary.test.ts(31,5)` (`DjConfig` fixture missing `refillThreshold`, `batchSize`, `targetDurationSec`, `allowVocals`).
- Full Biome formatter check is noisy on CRLF line endings in pre-existing TSX files touched by this phase; line-ending normalization was intentionally not bundled into this feature commit.

### Phase 6: Stats Columns + Sortable Queue Order

**Goal:** Make playback stats scannable in the list and let the user choose the play queue order from the system playlist detail.

**Tasks:**
- [x] Move play count out of subtitle text into a dedicated right-side column.
- [x] Add a dedicated "Last played" column next to play count.
- [x] Add top-level sort options for default order, play count, and last played time.
- [x] Ensure "Play all" sends tracks to the queue in the currently selected sort order.
- [x] Keep the row-column extension optional so regular library/set rows are unchanged.

### Phase 6 Checklist

- [x] Play count and last played time render as separate columns on system playlist detail rows.
- [x] Sorting by play count orders rows and queue playback by highest play count first.
- [x] Sorting by last played orders rows and queue playback by most recent first.
- [x] Hearted rows can use folded playback stats for sorting instead of zero-only metrics.
- [x] Four-locale labels cover column headers, "never played", and sort controls.

### Phase 6 Verification Notes

- `node node_modules/vitest/vitest.mjs run src/pages/library-empty-states.test.tsx src/components/library/system-playlist-cards.test.tsx src/components/library/system-playlist-detail.test.tsx src/components/player/queue-panel.test.tsx src/lib/system-playlists.test.ts` passes: 5 files, 20 tests.
- `node node_modules/@biomejs/biome/bin/biome check --formatter-enabled=false src/lib/system-playlists.ts src/lib/system-playlists.test.ts src/components/library/system-playlist-detail.tsx src/components/library/system-playlist-detail.test.tsx src/components/library/track-row.tsx src/components/library/virtual-track-list.tsx src/components/library/track-list-section.tsx` passes.
- Direct `tsc --noEmit` is currently blocked by unrelated chat/settings dynamic i18n key typing errors in `src/components/chat/dj-chat-entry.tsx` and `src/components/settings/dj-tool-capabilities.tsx`.

---

## 7. Out of Scope

- Creating editable smart playlist rules beyond the three default playlists.
- Syncing system playlist membership as remote set manifests.
- Custom covers/names/descriptions for system playlists.
- Calendar-week/month-to-date modes; v1 uses rolling week/month.
- Cloud-side/global ranking that requires a MUZERO backend. Cross-device or remote/shared items may appear only when their stats and metadata are already present in local IndexedDB.
- Telemetry or backend analytics.
- DJ auto-extension from system playlists.

---

## 8. Security Considerations

- **Authentication:** None. This is a local library feature.
- **Authorization:** No account permissions. System playlists are visible to the local app user.
- **Data Protection:** Reads local track metadata, heart state, and playback history already stored in IndexedDB. No new outbound request.
- **Audit Logging:** No audit log required. Do not add telemetry.
- **Deletion Safety:** System ids must never reach `deleteSession` as if they were real `DjSession.id` values.
- **Privacy:** Playback history can reveal user habits; keep all derivation on device and avoid logging track titles or listening history.

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [PRD Template](../prd-template.md) | Project PRD structure. |
| [Set Detail Page PRD](../20260607-muzero-set-detail-page-prd/20260607-muzero-set-detail-page-prd.md) | Existing set detail/list behavior. |
| [Set / PlayQueue / Memory Data Model PRD](../20260607-muzero-set-playqueue-memory-data-model-prd/20260607-muzero-set-playqueue-memory-data-model-prd.md) | Set and queue separation. |
| [Settings Information Architecture PRD](../20260613-muzero-settings-information-architecture-prd/20260613-muzero-settings-information-architecture-prd.md) | Existing listening stats surface context. |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | Should "Month" mean rolling 30 days or calendar month-to-date? | Resolved for v1 | Use rolling 30 days; calendar buckets can be a later enhancement. |
| 2 | Should Recently Played show repeated entries for repeated listens, or unique tracks? | Resolved for v1 | Unique tracks, sorted by latest listen. |
| 3 | Should system playlists appear in the Queue nav as well as Gallery/Sets? | Resolved for v1 | Yes. Pin them in Gallery/Sets and expose them in Queue as playable virtual playlist sources. They are product-level playlists, but not persisted `DjSession` rows. |
| 4 | Should all-time Most Played use `Track.playCount` or `trackPlaybackStats`? | Resolved for v1 | Use folded `trackPlaybackStats` as source of truth. `Track.playCount` remains a compatibility/display mirror only. |
| 5 | Should remote-only shared tracks appear in system playlists? | Resolved for v1 | Yes, when local IndexedDB has enough remote metadata and playback identity to render and play them. Do not require local media bytes. |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-13 | Codex | Initial draft for three non-deletable default system playlists. |
| 2026-06-13 | Codex | Resolved product questions: rolling 30 days, unique recently played, Queue pinned sources, folded stats as source of truth, and remote/shared item inclusion. |
| 2026-06-13 | Codex | Completed Phase 2 pure system playlist selectors with TDD coverage for local and remote playback rows. |
| 2026-06-13 | Codex | Completed Phases 3-5: Gallery and Queue pinned sources, virtual detail view, Most Played range metrics, four-locale copy, and targeted TDD verification. |
| 2026-06-13 | Codex | Completed Phase 6: dedicated play-count and last-played columns plus sort controls that feed the selected queue order. |

---

## 12. Acceptance Criteria

- The Sets/Gallery surface always shows Hearted, Recently Played, and Most Played before user-created sets.
- The Queue surface exposes Hearted, Recently Played, and Most Played as pinned playable sources.
- The three system playlists cannot be deleted, renamed, reordered, or assigned custom set covers.
- Hearted updates when a user hearts/unhearts a track.
- Recently Played orders tracks by latest counted playback time.
- Most Played supports All / Month / Week / Day range switching.
- Most Played row metadata includes the selected range play count, including weekly counts.
- System playlist detail rows show play count and last played time as separate columns.
- System playlist detail can sort rows and queue playback by play count or last played time.
- Playing a system playlist loads the currently visible derived order into the play queue.
- Remote/shared tracks appear in Recently Played and Most Played when their local playback identity and display/playback metadata can be resolved.
- No new backend, account system, telemetry, or cloud dependency is introduced.
- All visible strings are localized in en / zh / ja / ko.
- Unit/component tests cover selector behavior, range aggregation, and delete protection.
