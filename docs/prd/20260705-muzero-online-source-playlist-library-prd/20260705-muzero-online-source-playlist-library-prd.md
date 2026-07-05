# PRD: MUZERO 在线音源歌单进 Library + Settings 歌单列表过滤

**Status:** Completed
**Created:** 2026-07-05
**Author:** Codex
**Module:** Library / Online Sources / Settings - external playlist browsing without mandatory import

---

## Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | 本地在线歌单目录缓存 | ✅ Completed | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | Library 展示同步歌单并自动刷新 | ✅ Completed | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | Settings 歌单列表限高 + filter | ✅ Completed | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | i18n / 测试 / 视觉收尾 | ✅ Completed | [Phase 4 Checklist](#phase-4-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

当前 Settings -> 在线音源里，登录后点击“同步我的歌单”会把该 source 的所有歌单一次性展开在 Settings 面板中。歌单多时列表非常长，截图里的设置页会被歌单列表拖得很深；用户也无法在歌单名里搜索，只能滚动寻找。

另一方面，MUZERO 已经具备在线歌单详情页能力：Settings 的歌单行可以打开 [`OnlinePlaylistDetail`](../../../src/components/discover/online-playlist-detail.tsx)，详情页会按需拉取歌单曲目、支持曲目 filter、并通过 `playOnlinePlaylist` 在线播放，用户不必先导入为本地 set。产品经理希望把这条能力前移到 Library tab：每次打开 Library 时同步一次账号歌单目录，之后在 Library 里持久显示这些在线歌单；用户可以直接点进在线播放，也可以手动刷新或导入。

本 PRD 解决两个问题：

1. **Library 里显示在线音源歌单**：用户不再必须去 Settings 找歌单，也不必导入后才能听。
2. **Settings 歌单列表变成可控工具面板**：列表有最大高度、文字过滤、细滚动条且滚动条不带背景。

### 1.2 Target Users

| Role | Description | Permissions |
|------|-------------|-------------|
| **已登录在线音源用户** | 已在 Settings 登录网易云 / Bilibili / QQ 音乐等 source，拥有大量收藏夹或歌单。 | 在 Library 浏览同步歌单、点进在线听、导入到本地 set、手动刷新歌单目录 |
| **只想在线听的用户** | 想像 YouTube Music 一样直接播放在线歌单，但不想立刻把歌单导入本地库。 | 点击在线歌单详情并播放，曲目播放时按现有 streamed track 路径懒落库/缓存 |
| **Settings 管理用户** | 只在 Settings 做登录、音质、缓存、下载策略等配置。 | 在有界列表中搜索歌单，触发刷新、导入、同步下载 |

### 1.3 Core Value

1. **Library 成为真实入口**：同步歌单属于“听歌/找歌单”的任务，应在 Library 出现，而不是藏在 Settings 的配置流里。
2. **无需导入即可播放**：在线歌单目录只持久化 metadata；点进详情才拉曲目，播放走既有 `playOnlinePlaylist`，不强迫创建本地 set。
3. **大账号可用**：上百/上千歌单时，Settings 和 Library 都必须可搜索、可滚动、不卡顿。
4. **本地优先不变**：同步目录存在 IndexedDB settings 行；无 MUZERO 后端、无遥测、无隐藏 flag。

---

## 2. System Architecture

### 2.1 Architecture Overview

```
Library tab active / manual refresh
        │
        ▼
syncOnlinePlaylistCatalog(settings)
        │
        ├─ createStreamSource(sourceId).getUserPlaylists()
        │      只取歌单 metadata：id/name/coverUrl/trackCount/source
        │
        ▼
AppSettings.onlinePlaylistCatalog
        │
        ├─ sourceId -> playlists[]
        ├─ syncedAt / error / loading state copy
        └─ persisted in IndexedDB `settings`
        │
        ▼
Library Gallery sets wall
        │
        ├─ local DjSession cards
        └─ online playlist cards (not DjSession)
              │
              ├─ click -> useNavStore.openOnlinePlaylist(playlist)
              ├─ play -> OnlinePlaylistDetail -> importPlaylist() -> playOnlinePlaylist()
              └─ import -> PlaylistImportDialog -> existing importStreamedPlaylist()
```

### 2.2 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **Online source calls** | Existing `StreamSourceProvider.getUserPlaylists` | 已有 source 边界；不要在 UI 中写 provider 分支 |
| **Persistent catalog** | Dexie `AppSettings` optional field | 歌单目录是本机账号的轻量 metadata；适合随 settings 本地持久化 |
| **Reactive read** | `useSettings()` / existing app-data hooks | Library 和 Settings 都从同一目录读，避免双份状态 |
| **Playback** | Existing `OnlinePlaylistDetail` + `playOnlinePlaylist` | 在线听不导入的现成路径 |
| **Import** | Existing `PlaylistImportDialog` | 需要本地 set 时复用现有增量/新建/下载流程 |
| **Search/filter** | Existing `search-core` helpers | 中英文/音译相关搜索尽量复用现有匹配能力 |
| **UI** | React + Tailwind v4 + existing card/list primitives | 不新增 UI 框架 |

### 2.3 Project Structure

```
src/
├── db/
│   ├── types.ts                         # [改] AppSettings.onlinePlaylistCatalog?
│   └── repositories.ts                  # [改] save/merge catalog helper
├── streamsrc/
│   └── playlist-catalog.ts              # [新] 同步编排纯/薄模块：source loop + merge + filtering helpers
├── hooks/
│   └── use-online-playlist-catalog.ts   # [新] Library/Settings 共用的 reactive sync hook
├── components/
│   ├── discover/
│   │   └── online-playlist-detail.tsx   # [改] 保持曲目详情/播放路径，必要时接 anchor
│   ├── library/
│   │   └── online-playlist-section.tsx  # [新] Library 的在线歌单分区/卡片
│   └── settings/
│       └── stream-sources-settings.tsx  # [改] SourcePlaylists 限高、filter、复用 catalog
├── pages/
│   └── search-page.tsx                  # [改] sets wall 合并/分区展示 online playlists
└── i18n/locales/{en,zh,ja,ko}/common.json
```

> 新文件只承担“在线歌单目录”这个小边界；播放、导入、详情页继续复用已有模块。

---

## 3. Data Model Design

### 3.1 Core Concepts

```
OnlinePlaylistCatalogEntry
  source: StreamSourceId
  id: source playlist/favlist id
  name
  coverUrl?
  trackCount
  syncedAt

AppSettings.onlinePlaylistCatalog
  sources[sourceId]
    playlists: OnlinePlaylistCatalogEntry[]
    syncedAt: number
    error?: string
```

### 3.2 Database Schema

Current source of truth:

- [`src/db/types.ts`](../../../src/db/types.ts) `AppSettings.streamSources`
- [`src/streamsrc/provider.ts`](../../../src/streamsrc/provider.ts) `StreamPlaylist`
- [`src/components/settings/stream-sources-settings.tsx`](../../../src/components/settings/stream-sources-settings.tsx) `SourcePlaylists`
- [`src/stores/nav-store.ts`](../../../src/stores/nav-store.ts) `openOnlinePlaylist`

Required additive field:

```ts
export interface OnlinePlaylistCatalogSource {
  playlists: StreamPlaylist[];
  syncedAt: number;
  error?: string;
}

export interface AppSettings {
  // existing fields...
  onlinePlaylistCatalog?: Partial<Record<StreamSourceId, OnlinePlaylistCatalogSource>>;
}
```

Migration:

- Optional, non-indexed field only. No Dexie version bump required.
- Legacy users simply have `undefined` and see an empty/needs-sync Library state until the first sync succeeds.
- If a source logs out, its cached catalog should either be hidden or cleared with `streamSourcesAfterLogout`; recommendation: clear that source's catalog to avoid showing account-private playlist names after logout.

Data quality:

- Deduplicate by `(source, id)` during sync.
- Preserve source order when provider returns it; no automatic import or track detail fetch.
- Store only metadata needed for Library cards: id/name/coverUrl/trackCount/source/syncedAt.
- Do not store cookies, signed URLs, resolved media URLs, or track lists in this catalog.

Privacy:

- Playlist names and covers are account data. They remain local in IndexedDB.
- No telemetry is introduced.
- Logs must not include raw cookie or full playlist payload.

### 3.3 Data Relationship Diagram

```
AppSettings.streamSources[sourceId].cookie
        │ auth for getUserPlaylists()
        ▼
AppSettings.onlinePlaylistCatalog[sourceId].playlists[]
        │ metadata-only persisted directory
        ├─ Library card -> OnlinePlaylistDetail(playlist)
        │                    └─ importPlaylist(playlist.id) only when opened
        └─ Import dialog -> DjSession(streamPlaylistRef) only when user imports
```

---

## 4. API Design

### 4.1 Internal APIs

| Function | Description |
|----------|-------------|
| `syncOnlinePlaylistCatalog(opts)` | Iterate enabled/authed sources with `getUserPlaylists`, persist metadata catalog per source. |
| `syncOnlinePlaylistCatalogSource(sourceId, opts)` | Refresh one source for Settings row/manual refresh. |
| `clearOnlinePlaylistCatalogSource(sourceId)` | Clear a source catalog on logout or explicit reset. |
| `filterOnlinePlaylists(playlists, query)` | Pure filter helper shared by Library/Settings tests. |
| `useOnlinePlaylistCatalog({ autoSync })` | Hook that reads settings catalog and triggers “sync once when Library opens”. |

### 4.2 Request/Response Examples

```ts
await syncOnlinePlaylistCatalogSource("netease", {
  settings,
  save: saveSettings,
  createSource: createStreamSource,
});

// AppSettings patch
{
  onlinePlaylistCatalog: {
    netease: {
      syncedAt: 1783248000000,
      playlists: [
        { source: "netease", id: "123", name: "只熊喜欢的音乐", trackCount: 6083, coverUrl: "..." }
      ]
    }
  }
}
```

### 4.3 Error Handling

- Source missing `getUserPlaylists`: skip and store no error.
- Not logged in / expired login: do not call provider when auth cookie is missing; if provider throws auth error, persist an error state and show “需要重新登录”.
- Network failure: keep the last successful catalog visible, show stale timestamp + retry action.
- Partial failure: one source failure must not clear other source catalogs.
- Manual refresh disabled while that source refresh is in flight.
- Library auto-sync should be best-effort and quiet: visible stale/error affordance in the online section, but no toast spam on every tab open.

---

## 5. Frontend Design

### 5.1 Library Tab

The Library tab currently has Gallery modes (`sets`, `tracks`, `albums`, `artists`, `online`, `downloads`) in [`search-page.tsx`](../../../src/pages/search-page.tsx). This PRD treats synced online playlists as part of the **sets wall**, not as the existing Discover tab:

- `sets` mode shows local `DjSession` cards as today.
- Below or alongside local sets, render an **Online playlists** section when the catalog has playlists.
- Opening the Library/Search tab triggers one best-effort catalog sync per app session or per stale interval.
- Manual refresh button appears in the Online playlists section.
- Cards show cover, name, track count, source chip, last synced source state if useful.
- Online playlist cards must carry clear source identity chips (e.g. Bilibili / 网易云 / QQ 音乐) so online content is visually distinguishable from local `DjSession` cards.
- Card click calls `openOnlinePlaylist(playlist)` and reuses `OnlinePlaylistDetail`.
- Card play affordance may either open detail then play, or fetch hits and call `playOnlinePlaylist`; v1 recommendation: open detail first for clear loading/error/filter behavior.
- Import action opens `PlaylistImportDialog` for users who want a local set.

Search behavior:

- The existing sets search should search both local set names and online playlist names.
- Online cards should remain in original source order when no query is present.
- Query filters online playlist `name`, `source`, and optional aliases (`网易`, `bili`, `qq`) via shared helper.
- The sets wall toolbar should include online-source filter chips when online playlists are present:
  - `All sources` shows every online playlist.
  - one chip per available source filters to a specific platform, e.g. Bilibili / 网易云 / QQ 音乐.
  - chips compose with the text query rather than replacing it.
  - local sets remain visible unless the user selects an online-source-only filter mode; v1 recommendation: source chips affect only the Online playlists section, keeping local set filtering unchanged.
- If no online playlist matches, show no online section rather than a large empty block.

Auto-sync behavior:

- Trigger when `navStore.tab === "search"` and `mode === "sets"` or when SearchPage mounts with Library active.
- Refresh once per source if `syncedAt` is missing or older than 15 minutes; manual refresh always bypasses stale window.
- Do not fetch every playlist's tracks during this catalog sync.

### 5.2 Settings Online Sources

Settings remains the place for login, quality, cache, download, and import/sync management. It should no longer expand an unbounded playlist list.

Required changes inside `SourcePlaylists`:

- After login, show a compact toolbar:
  - sync/refresh button;
  - last synced time;
  - text filter input.
- Playlist list is inside a bounded scroll container:
  - max height: desktop around `min(42vh, 420px)`;
  - mobile around `min(50vh, 360px)`;
  - `overflow-y-auto`;
  - thin scrollbar;
  - transparent scrollbar track/background.
- Filter runs on playlist name and source id.
- Empty filter state says “没有匹配的歌单”.
- Existing per-row actions stay:
  - open online playlist;
  - import;
  - `PlaylistSyncControls` for incremental sync/download.
- The list should read from the persisted catalog after a sync, so closing/reopening Settings does not require another click just to see the last known list.

Scrollbar requirement:

- Add or reuse a utility class such as `scrollbar-thin scrollbar-track-transparent`.
- Do not use a filled scrollbar background that creates a visible gutter on the dark card.
- Keep keyboard and wheel scrolling accessible.

### 5.3 State Management

- Catalog metadata lives in Dexie settings.
- Hook/module in-flight state can be component-local or module-scope; do not put non-reactive provider instances into Zustand.
- Components use minimal selectors:
  - `useNavStore((s) => s.openOnlinePlaylist)`
  - `usePlayerStore((s) => s.playOnlinePlaylist)` only in detail/play surfaces.
- Do not duplicate catalog into `player-store`.

---

## 6. Implementation Plan

### Phase 1: 本地在线歌单目录缓存

**Goal:** 同步账号歌单 metadata 并持久化到 settings，可供 Library/Settings 共读。

**Tasks:**
- [x] Add optional `AppSettings.onlinePlaylistCatalog` type.
- [x] Add catalog merge/clear helpers in repository or a dedicated `streamsrc/playlist-catalog.ts`.
- [x] Implement source sync using `createStreamSource(id).getUserPlaylists`.
- [x] Clear source catalog on logout.
- [x] Add pure filter/dedupe helpers.

### Phase 1 Checklist

- [x] No Dexie version bump; legacy settings work.
- [x] Dedupes duplicate playlist ids.
- [x] Partial source failure keeps other source catalogs and last successful data.
- [x] Logout clears or hides the source's cached playlist names.
- [x] Tests cover dedupe, merge, stale retention, logout clear.

**Phase 1 Verification:**
- `node_modules\.bin\vitest.CMD run src\streamsrc\playlist-catalog.test.ts`

**Phase 1 Implementation Notes:**
- Added metadata-only `AppSettings.onlinePlaylistCatalog` plus `OnlinePlaylistCatalogEntry` / `OnlinePlaylistCatalogSource` in [`types.ts`](../../../src/db/types.ts).
- Added [`playlist-catalog.ts`](../../../src/streamsrc/playlist-catalog.ts) for dedupe, stale checks, source-alias filtering, sync merge, error retention, and source clear.
- Wired Settings logout to clear the logged-out source catalog.

### Phase 2: Library 展示同步歌单并自动刷新

**Goal:** Library sets wall 显示在线歌单，打开 Library 自动同步一次，用户可直接在线播放。

**Tasks:**
- [x] Add `useOnlinePlaylistCatalog` hook with stale-window auto-sync.
- [x] Add online playlist section/cards in sets wall.
- [x] Wire card click to `openOnlinePlaylist`.
- [x] Wire import action to `PlaylistImportDialog`.
- [x] Include online playlists in sets search/filter behavior.
- [x] Add source identity chips on online playlist cards.
- [x] Add source filter chips in the sets wall toolbar for available online platforms.
- [x] Add manual refresh button and stale/error copy.

### Phase 2 Checklist

- [x] Opening Library triggers metadata-only sync, not track-detail fetch.
- [x] Auto-sync uses a 15-minute stale window; manual refresh always forces refresh.
- [x] Previously synced playlists render immediately before refresh completes.
- [x] Clicking a playlist opens `OnlinePlaylistDetail`.
- [x] Playing from detail works without importing a local set.
- [x] Search filters local sets and online playlists.
- [x] Source chips identify each online playlist's platform.
- [x] Source filter chips filter online playlists by platform and compose with the text query.
- [x] Large catalogs do not render unbounded DOM; cards reuse existing `VirtualCardGrid` / current gallery virtualization architecture where needed.

**Phase 2 Verification:**
- `node_modules\.bin\vitest.CMD run src\streamsrc\playlist-catalog.test.ts src\components\library\online-playlist-section.test.tsx`
- `node_modules\.bin\biome.CMD check src\streamsrc\playlist-catalog.ts src\streamsrc\playlist-catalog.test.ts src\components\library\online-playlist-section.tsx src\components\library\online-playlist-section.test.tsx src\hooks\use-online-playlist-catalog.ts src\pages\search-page.tsx src\i18n\locales\en\common.json src\i18n\locales\zh\common.json src\i18n\locales\ja\common.json src\i18n\locales\ko\common.json`
- `node_modules\.bin\tsc.CMD --noEmit --pretty false`

**Phase 2 Implementation Notes:**
- Added [`use-online-playlist-catalog.ts`](../../../src/hooks/use-online-playlist-catalog.ts), which auto-syncs enabled online sources only when the Library sets wall is active and the source catalog is missing/stale (15 minutes).
- Added [`online-playlist-section.tsx`](../../../src/components/library/online-playlist-section.tsx), including source chips, platform filter chips, manual refresh, import/open actions, and `VirtualCardGrid` when mounted in the real Library wall scroller.
- Wired the section into [`search-page.tsx`](../../../src/pages/search-page.tsx) under the `sets` wall, reusing `OnlinePlaylistDetail` and `PlaylistImportDialog`.

### Phase 3: Settings 歌单列表限高 + filter

**Goal:** Settings 在线音源不再撑出超长页面，并能搜索歌单。

**Tasks:**
- [x] Refactor `SourcePlaylists` to read/write the shared catalog.
- [x] Add filter input with localized placeholder.
- [x] Wrap rows in bounded scroll container.
- [x] Add thin transparent scrollbar style.
- [x] Preserve open/import/sync row actions.
- [x] Show last synced time + refresh action.

### Phase 3 Checklist

- [x] 100+ playlists stay inside bounded container.
- [x] Filter matches playlist name and source aliases.
- [x] No match state is visible.
- [x] Scrollbar is thin and has no filled background/gutter.
- [x] Keyboard focus order remains sensible: refresh -> filter -> rows/actions.
- [x] Existing `PlaylistSyncControls` still works per row.

**Phase 3 Verification:**
- `node_modules\.bin\vitest.CMD run src\components\settings\stream-sources-settings.test.tsx src\streamsrc\playlist-catalog.test.ts`
- `node_modules\.bin\biome.CMD check src\components\settings\stream-sources-settings.tsx src\components\settings\stream-sources-settings.test.tsx src\i18n\locales\en\common.json src\i18n\locales\zh\common.json src\i18n\locales\ja\common.json src\i18n\locales\ko\common.json`
- `node_modules\.bin\tsc.CMD --noEmit --pretty false`

**Phase 3 Implementation Notes:**
- Refactored Settings `SourcePlaylists` to read the persisted online playlist catalog, show last synced time, and refresh the current source through `useOnlinePlaylistCatalog`.
- Added exported `SourcePlaylistList` with a search input, no-match state, bounded `max-h-[min(42vh,420px)]` scroll region, and existing `thin-transparent-scrollbar` utility.
- Preserved row-level open, import, and `PlaylistSyncControls` actions.

### Phase 4: i18n / 测试 / 视觉收尾

**Goal:** 4 语言文案完整，核心 flows 有测试，桌面/mobile 无布局溢出。

**Tasks:**
- [x] Add i18n keys under `streamSources.*` / `gallery.*` for catalog sync, filter, stale/error/no-match.
- [x] Add component tests for Settings bounded list/filter.
- [x] Add Library component tests for persisted catalog render + manual refresh.
- [x] Add hook/pure tests for auto-sync stale window and no-track-fetch guarantee via mocked provider.
- [x] Add E2E-style harness covering metadata sync -> Library section -> Settings list.
- [x] Run targeted Vitest + typecheck.
- [x] Visual/layout risk covered by component-level class assertions for bounded Settings list and VirtualCardGrid wiring for Library.

### Phase 4 Checklist

- [x] en/zh/ja/ko keys complete.
- [x] `src/**` has no direct `console.*`.
- [x] No hidden localStorage/URL/window flag gates behavior.
- [x] Targeted Vitest suites pass.
- [x] `node_modules\.bin\tsc.CMD --noEmit --pretty false` passes.

**Phase 4 Verification:**
- `node_modules\.bin\vitest.CMD run src\streamsrc\playlist-catalog.test.ts src\components\library\online-playlist-section.test.tsx src\components\settings\stream-sources-settings.test.tsx src\streamsrc\online-playlist-catalog.e2e.test.tsx`
- `node_modules\.bin\biome.CMD check src\streamsrc\online-playlist-catalog.e2e.test.tsx`
- `node_modules\.bin\tsc.CMD --noEmit --pretty false`

**Phase 4 Implementation Notes:**
- Added [`online-playlist-catalog.e2e.test.tsx`](../../../src/streamsrc/online-playlist-catalog.e2e.test.tsx), a local E2E-style harness that uses an injected fake provider to verify metadata-only sync, no bulk `importPlaylist` track fetch, Library open/filter behavior, and Settings filter/import behavior.
- Final feature coverage is split across pure catalog tests, Library component tests, Settings component tests, and the E2E harness.

---

## Regression Follow-up: NetEase Refresh Storm

**Date:** 2026-07-05  
**Status:** Fixed

**Symptom:** NetEase online playlist catalog sync could appear broken after the Library auto-sync change because a failing metadata refresh was persisted with `syncedAt: 0`. The Library auto-sync stale check then considered the same source immediately stale again, so every settings write from the failure retriggered another refresh attempt.

**Root Cause:** The catalog model only tracked the last successful sync timestamp. Failure retention kept old playlist rows, but first-time failures had no timestamp that could throttle automatic retry. In a live `useSettings()` flow, saving the error caused another render, and the source stayed eligible for immediate auto-sync.

**Fix:**
- Add `OnlinePlaylistCatalogSource.attemptedAt` for both successful and failed metadata refresh attempts.
- Make stale checks use `attemptedAt ?? syncedAt`, so failures are retried after the 15-minute stale window instead of immediately.
- Keep `syncedAt` as the last successful sync time, so Settings does not display a failure as a successful sync.
- Add a hook-level in-flight ref to prevent duplicate requests for the same source while a refresh is already running.

**Verification:**
- `node_modules\.bin\vitest.CMD run src\streamsrc\playlist-catalog.test.ts src\streamsrc\netease\netease-source.test.ts src\streamsrc\online-playlist-catalog.e2e.test.tsx src\components\library\online-playlist-section.test.tsx src\components\settings\stream-sources-settings.test.tsx`
- `node_modules\.bin\biome.CMD check src\db\types.ts src\streamsrc\playlist-catalog.ts src\streamsrc\playlist-catalog.test.ts src\hooks\use-online-playlist-catalog.ts`
- `node_modules\.bin\tsc.CMD --noEmit --pretty false`

---

## Follow-up: Unified Sets Source Filter

**Date:** 2026-07-05  
**Status:** Completed

**Product Adjustment:** The Library sets wall source filter is a wall-level preference, not an online-section-only filter. Users can choose:
- all playlists: local sets, local system playlists, and online playlists.
- local only: local sets and local system playlists.
- online only: all online playlists.
- one online platform: only playlists from that source, such as NetEase, Bilibili, or QQ Music.

**Implementation Notes:**
- Added a persisted sets-wall source filter preference (`all` / `local` / `online` / specific `StreamSourceId`) using the same local UI preference pattern as gallery mode, view, and sort.
- Moved source filtering into the sets wall toolbar so it controls local/system/online playlist visibility together.
- In `all` mode, preserved the wall hierarchy as system playlists first, local playlists in the middle, and online playlists below local content.
- Kept origin chips visible only when local playlists are part of the current source filter.
- Reworked online playlist cards to match the existing set gallery style: square cover-first grid cards, list cards with 48px cover, same hover/focus affordances, and source chip as metadata.
- Updated roving gallery key order so keyboard navigation only includes cards visible under the current source/text filters.

**Verification:**
- `node_modules\.bin\vitest.CMD run src\components\library\online-playlist-section.test.tsx src\components\library\system-playlist-cards.test.tsx src\streamsrc\online-playlist-catalog.e2e.test.tsx src\components\settings\stream-sources-settings.test.tsx src\streamsrc\playlist-catalog.test.ts`
- `node_modules\.bin\biome.CMD check src\pages\search-page.tsx src\components\library\online-playlist-section.tsx src\components\library\online-playlist-section.test.tsx src\streamsrc\online-playlist-catalog.e2e.test.tsx src\i18n\locales\en\common.json src\i18n\locales\zh\common.json src\i18n\locales\ja\common.json src\i18n\locales\ko\common.json`
- `node_modules\.bin\tsc.CMD --noEmit --pretty false`

---

## Follow-up: Collapsible Playlist Sections

**Date:** 2026-07-05  
**Status:** Completed

**Problem:** With both local and online playlists visible, multiple card grids in the same sets wall could visually overlap. The online section was using the ancestor-scroller `VirtualCardGrid` after the local virtualized grid, but that component is tuned for one primary wall grid per scroll container.

**Product Adjustment:** When online playlists are present, the sets wall should read as separate collapsible sections instead of one undifferentiated stack.

**Implementation Notes:**
- Split the sets wall into collapsible sections for smart/system playlists, local playlists, and online playlists.
- Persist section collapse state locally with the same UI-preference discipline as view/sort/source filter.
- Keep the order as smart/system playlists first, local playlists in the middle, and online playlists underneath local content.
- Disable online `VirtualCardGrid` when local playlists are also visible, preventing multiple ancestor-scroller virtual grids from overlapping. Online-only views can still use the virtual grid.
- Update roving keyboard navigation to skip cards in collapsed sections.

**Verification:**
- `node_modules\.bin\vitest.CMD run src\components\library\online-playlist-section.test.tsx src\streamsrc\online-playlist-catalog.e2e.test.tsx src\components\library\system-playlist-cards.test.tsx`
- `node_modules\.bin\biome.CMD check --write src\pages\search-page.tsx src\components\library\online-playlist-section.tsx src\i18n\locales\en\common.json src\i18n\locales\zh\common.json src\i18n\locales\ja\common.json src\i18n\locales\ko\common.json`
- `node_modules\.bin\tsc.CMD --noEmit --pretty false`

---

## Follow-up: Online Playlist Track Cache

**Date:** 2026-07-05  
**Status:** Completed

**Problem:** 打开某个在线歌单详情时，网易云等 source 可能一次返回 6000+ 首曲目。当前详情页每次 mount 都直接调用 `importPlaylist(playlist.id)`，导致用户返回/再次打开同一个歌单时重复拉全量曲目，耗时且浪费网络。

**Product Decision:** 在线歌单曲目详情应缓存到请求层。除非用户主动点击详情页刷新/重试/每日推荐换一批，否则重新打开同一个在线歌单不应重新请求完整曲目列表。

**Implementation Notes:**
- `OnlinePlaylistDetail` 的曲目加载改为 TanStack Query，query key 由 source、playlist id、类型（普通歌单/每日推荐）和 `lastAuthAt` 组成。
- 普通在线歌单使用 `staleTime: Infinity`、`gcTime: Infinity`，并关闭 mount/window focus/reconnect 自动 refetch。
- 手动刷新按钮对普通歌单执行 `refetch()`，是唯一会重新拉全量曲目的入口。
- 每日推荐保留原来的 reroll 语义：初次请求 `afresh: false`，点击换一批后使用新的 query key 并传 `afresh: true`。
- query key 使用 `lastAuthAt` 区分账号切换，不把 cookie 写进 key 或日志可见结构。

**Verification:**
- `node_modules\.bin\vitest.CMD run src\components\discover\online-playlist-detail.test.tsx`

---

## Follow-up: Played Online Track Visibility

**Date:** 2026-07-05  
**Status:** Completed

**Problem:** 在线歌单详情为了保持整张歌单的播放上下文，会把歌单曲目 metadata materialize 成 streamed Track rows。对于 6000+ 曲目的网易云歌单，如果这些 context-only rows 直接出现在 `listAllTracks` / 全局搜索里，用户点播一首就像把整张在线歌单导入了本地库。

**Product Decision:** 在线歌单“听歌”不是“导入歌单”。点击在线歌单里的某一首时，播放队列仍保持整张在线歌单上下文；但 Library / 全局搜索只显示用户实际播放并进入 online cache set 的曲目。未播放的在线歌单曲目只是队列上下文，不作为本地库内容展示。

**Implementation Notes:**
- `playOnlinePlaylist` 保留完整 online-playlist queue context，但只把被点击的 track id 加入专用 online cache set membership。
- 播放期继续走 streamed resolve -> download-before-play -> `cacheStreamedTrackBlob`，所以被点击播放的曲目会在播放后本地缓存媒体 blob。
- 在线歌单点播不再对整张歌单批量缓存封面；仅缓存被点击曲目的封面。批量封面缓存仍留给显式导入 / 同步路径。
- `listAllTracks` 和 `listGlobalSearchTracks` 过滤 streamed context-only rows：只有已属于某个 `DjSession.trackIds` membership 的 streamed tracks 才进入 Library / 搜索。

**Verification:**
- `node_modules\.bin\vitest.CMD run src\db\repositories.test.ts -t "listAllTracks library membership filtering|listGlobalSearchTracks"`
- `node_modules\.bin\vitest.CMD run src\stores\player-store.test.ts -t "online playlist"`

---

## Follow-up: Tab Switch Performance Guardrails

**Date:** 2026-07-05  
**Status:** Completed

**Problem:** 在线歌单进入 Library 后，切换 Gallery tabs 可能掉帧。排查发现三个叠加因素：
- 本地和在线 playlists 同时显示时，online section 为避免多 `VirtualCardGrid` 共用同一 wall scroller 重叠，退回了非虚拟化渲染；在线歌单一多会一次挂载大量卡片和封面。
- `listAllTracks` / `listGlobalSearchTracks` 仍从 `tracks.toArray()` 开始，即使 context-only streamed rows 已被 UI 过滤，历史打开过的 6000+ 在线歌单 rows 仍会在切 tab 时被全表读取。
- 在线歌单播放上下文 rows 没有清理策略，用户连续打开不同大歌单后隐藏 rows 会累积，增加内存和 IndexedDB 读取压力。

**Implementation Notes:**
- Library sets wall 中的 `OnlinePlaylistSection` 统一使用外层 wall scroller 的 `VirtualCardGrid`，避免本地/在线 sections 之间产生嵌套滚动；没有外层 scroller 的孤立渲染场景才保留内部 fallback。
- `listAllTracks` / `listGlobalSearchTracks` 仅对 `origin: "streamed"` 的 context-only rows 施加 membership 可见性过滤；本地 uploaded/generated 散曲保持可见，避免 DJ tree / 直播点歌 / 全局搜索误判为空。
- `playOnlinePlaylist` 在进入新的在线歌单播放前调用 streamed repo 清理，删除专用 online cache set 里未加入任何 set membership 的旧 streamed context rows 和对应 media blobs。
- 保持显式导入 / 同步路径不变：导入的大歌单仍会作为本地 set membership 出现在 Library。

**Verification:**
- `node_modules\.bin\vitest.CMD run src\components\library\online-playlist-section.test.tsx`
- `node_modules\.bin\vitest.CMD run src\db\repositories.test.ts -t "listAllTracks library membership filtering|listGlobalSearchTracks"`
- `node_modules\.bin\vitest.CMD run src\streamsrc\streamed-track-repo.test.ts -t "materializeHitsToTracks"`
- `node_modules\.bin\vitest.CMD run src\stores\player-store.test.ts -t "online playlist"`
- `node_modules\.bin\vitest.CMD run src\chat\dj-chat-library-tree.test.ts src\chat\dj-chat-phase4.test.ts src\live-requests\live-request-controller.play-routing.test.ts src\live-requests\audience-request-runtime.test.ts src\db\repositories.test.ts src\pages\library-empty-states.test.tsx`

---

## 7. Out of Scope

- Importing every synced playlist automatically as `DjSession`.
- Fetching every playlist's full track list during Library open.
- Adding a MUZERO backend, account system, telemetry, or server-side playlist cache.
- Changing provider-specific playlist APIs beyond `getUserPlaylists`.
- Replacing the existing Discover tab or daily recommendations UI.
- Full cross-source playlist editing; v1 only browses, plays, imports, and refreshes.
- New runtime hidden flags for enabling/disabling this behavior.

---

## 8. Security Considerations

- **Authentication:** Reuse existing per-source cookie login in `AppSettings.streamSources`.
- **Authorization:** Only authed sources with `getUserPlaylists` are synced.
- **Data Protection:** Cookie remains local-only. Playlist catalog metadata is local IndexedDB only.
- **Network Discipline:** All source HTTP continues through `getAppFetch()` via `createStreamHttp`; no direct `window.fetch` for external APIs.
- **Logging:** Use `src/lib/logger.ts`; do not log cookies, signed URLs, or full raw responses.
- **No Hidden Flags:** Auto-sync/manual refresh are visible behavior, not hidden `localStorage` / URL / `window.*` controls.
- **Rollback:** `git revert` code changes; optional settings field is harmless if left behind.

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [External Streaming Sources PRD](../20260610-muzero-external-streaming-sources-prd/20260610-muzero-external-streaming-sources-prd.md) | Source provider, streamed track, playlist import foundation |
| [NetEase Online Recommendations PRD](../20260614-muzero-netease-online-recommendations-prd/20260614-muzero-netease-online-recommendations-prd.md) | Existing Discover tab and online playlist detail direction |
| [Settings IA PRD](../20260613-muzero-settings-information-architecture-prd/20260613-muzero-settings-information-architecture-prd.md) | Places Online sources under Files and keeps Settings as configuration surface |
| [`stream-sources-settings.tsx`](../../../src/components/settings/stream-sources-settings.tsx) | Current unbounded source playlist list |
| [`online-playlist-detail.tsx`](../../../src/components/discover/online-playlist-detail.tsx) | Existing online playlist detail, filter, virtualized tracks, play/import actions |
| [`search-page.tsx`](../../../src/pages/search-page.tsx) | Library Gallery sets wall and online playlist navigation |
| [`provider.ts`](../../../src/streamsrc/provider.ts) | `StreamPlaylist` and `getUserPlaylists` contract |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | Library 里在线歌单放在 `sets` wall 还是现有 `online/Discover` tab？ | ✅ Resolved | 放在 `sets` wall，因为这是“我的同步歌单”；Discover 保持推荐/发现内容。Library 增加来源标识 chip，并在顶部/toolbar 提供在线来源 filter，可按 Bilibili / 网易云 / QQ 音乐等平台过滤。 |
| 2 | Library 自动同步 stale window 多久？ | ✅ Resolved | 15 分钟；手动刷新无视 stale。 |
| 3 | Settings logout 后是否清除 cached playlist catalog？ | ✅ Resolved | 清除，避免账号私有歌单名残留。 |
| 4 | Library online section 是否需要单独 view toggle/list-grid？ | ✅ Resolved | v1 跟随 sets wall 当前 view，减少新状态。 |
| 5 | 大量在线歌单是否需要虚拟化 card grid？ | ✅ Resolved | 复用已有架构；优先沿用当前 gallery / `VirtualCardGrid` 虚拟化能力，Settings 继续用限高滚动容器。 |

---

## 11. Acceptance Criteria

1. 打开 Library tab 后，已登录 source 的歌单目录会自动同步一次，并持久化显示。
2. 用户重新打开 app 或 Settings 时，能先看到上次同步的在线歌单，再进行后台刷新。
3. Library 中点击在线歌单可打开详情并在线播放，不要求先导入。
4. Library 中仍提供导入入口，复用现有 `PlaylistImportDialog`。
5. Library 在线歌单卡片显示平台来源 chip。
6. Library sets wall 顶部/toolbar 的来源 filter 可选择全部、本地、全部在线或特定在线平台，并与文字搜索组合生效。
7. Settings 在线音源下的歌单列表有最大高度，不再撑满整页。
8. Settings 歌单列表支持文字过滤，歌单多时可快速定位。
9. Settings 滚动条为 thin 且 track/background 透明。
10. 同步目录只拉 playlist metadata，不批量拉全部歌单曲目。
11. 登录态失效、网络失败、部分 source 失败都有可恢复状态，不清空可用的旧目录。
12. 无后端、无遥测、无 hidden runtime flag；所有持久化仍在本地 IndexedDB。

---

## 12. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-07-05 | Codex | Initial draft from product request: Library displays persisted synced online playlists with auto/manual refresh; Settings source playlist list becomes bounded and filterable with thin transparent scrollbar. |
| 2026-07-05 | Codex | Resolved Open Questions per product feedback: online playlists live in sets wall; auto-sync stale window is 15 minutes; logout clears cached catalog; v1 follows existing sets wall view; large catalogs reuse existing gallery/VirtualCardGrid architecture. Added source identity chips and platform filter chips for Bilibili / 网易云 / QQ 音乐. |
| 2026-07-05 | Codex | Completed Phase 1: metadata-only online playlist catalog types, catalog helper module, TDD coverage for merge/dedupe/stale/filter/error retention, and logout catalog clearing. |
| 2026-07-05 | Codex | Completed Phase 2: Library sets wall now renders persisted online playlists, source identity/filter chips, 15-minute metadata auto-sync, manual refresh, direct online detail open, import dialog reuse, and VirtualCardGrid-backed large catalog rendering. |
| 2026-07-05 | Codex | Completed Phase 3: Settings online-source playlists now read the shared catalog, refresh per source, filter by text/source aliases, and render in a bounded thin-transparent-scrollbar container while preserving open/import/sync controls. |
| 2026-07-05 | Codex | Completed Phase 4 and set PRD status to Completed: added local E2E-style harness and final targeted verification for catalog sync, Library display/filter/open/import, Settings bounded filter list, i18n coverage, Biome, and typecheck. |
| 2026-07-05 | Codex | Fixed NetEase refresh-storm regression: failed catalog refreshes now record `attemptedAt` and are auto-retried only after the stale window, while manual refresh still forces retry. |
| 2026-07-05 | Codex | Completed source-filter follow-up: sets wall filter now persists and supports all/local/online/specific-platform modes; online playlist cards now match the existing local set gallery grid/list style. |
| 2026-07-05 | Codex | Adjusted all-source wall ordering so local playlists remain the primary middle section and online playlists render underneath them, with roving keyboard order matching the visible layout. |
| 2026-07-05 | Codex | Added collapsible sets-wall sections for smart/local/online playlists and prevented local+online grid overlap by avoiding multiple ancestor-scroller virtual grids in the same wall. |
| 2026-07-05 | Codex | Cached online playlist detail tracks with TanStack Query so reopening a large online playlist does not refetch unless the user explicitly refreshes; daily recommendations keep reroll/afresh behavior. |
| 2026-07-05 | Codex | Completed played-online-track visibility follow-up: online playlist playback keeps full context but only the clicked/played track joins visible Library membership and playback media cache; context-only streamed rows are filtered from Library/global search. |
| 2026-07-05 | Codex | Added tab-switch performance guardrails: large inline online playlist sections are virtualized, Library/global search reads membership ids instead of scanning all track rows, and stale online context-only streamed rows are pruned before opening another online playlist context. |
| 2026-07-05 | Codex | Removed nested online playlist scrolling in the Library wall by routing online playlist virtualization through the shared outer wall scroller even when local playlists are visible. |
| 2026-07-05 | Codex | Fixed pre-push regression coverage: Library/global search now hides only unassigned streamed context rows while keeping local uploaded/generated loose tracks visible for DJ tree, live requests, and empty-library states. |
