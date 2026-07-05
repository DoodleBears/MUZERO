# PRD: MUZERO Ctrl+F 全局搜索相关性排序与空查询最近歌曲

**Status:** Draft
**Created:** 2026-07-05
**Author:** Codex
**Module:** `src/components/search/global-track-search.tsx` · `src/workers/global-search-local-core.ts` · `src/lib/search-core.ts` · `src/lib/track-search.ts` · `src/db/types.ts` `TrackPlaybackStats`

---

## Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | 空查询最近歌曲：Ctrl+F 打开即显示最近播放/更新的 ready tracks | Completed | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | 搜索结果携带分数：tracks / artists / albums / sets 统一可排序 | Completed | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | 最佳匹配混排区：让高置信歌手/专辑不被固定分组埋住 | Pending | [Phase 3 Checklist](#phase-3-checklist) |

> Status Legend: Completed | In Progress | Pending

---

## 1. Overview

### 1.1 Background

当前 Ctrl+F 全局搜索已经具备局部相关性能力：

- 歌曲搜索走 `src/lib/search-core.ts` 的 `queryRows()` / `scoreRow()`，单个歌曲列表内部会按分数排序。
- 歌手 / 专辑 facet 走 `src/lib/track-search.ts` 的 `searchEntityFacetsLimited()`，能匹配拼音 / 假名 / romaji，但只返回 entity，不返回 score。
- Ctrl+F UI 在 `src/components/search/global-track-search.tsx` 中按固定顺序拼接导航项：歌单 -> 歌曲 -> 歌词 -> 专辑 -> 歌手 -> 在线。

这个固定分组顺序导致一个明显体验问题：用户输入的其实是歌手名时，歌手结果可能被歌曲、专辑等 section 压在下面，需要滚动才能看到。Ctrl+F 的心智更像“快速跳到我要的东西”，而不是完整浏览页，所以应该优先呈现最可能的目标。

同时，Ctrl+F 空状态目前不是“快速切歌”的入口。用户希望一打开 Ctrl+F，不输入任何内容时，就直接显示最近活动歌曲：优先最近播放，其次最近更新，再其次创建时间，方便快速键盘切换刚听过、刚导入、刚编辑、刚带记忆/标签更新过的歌曲。

### 1.2 Target Users

| Role | Description | Key Scenario |
|------|-------------|--------------|
| 本地听歌用户 | 通过 Ctrl+F 快速找歌、找歌手、找专辑、找歌单 | 输入歌手名时希望歌手直接出现在前几行 |
| 重度键盘用户 | 用 Ctrl+F + Enter 快速切换播放 | 空查询打开后直接选择最近播放/更新的歌曲 |
| 大曲库用户 | 本地曲库上千首，且有 CJK / romaji / pinyin 搜索 | 不想被固定 section 顺序迫使滚动 |

### 1.3 Core Value

1. **更快命中意图**：当 query 明显匹配歌手或专辑时，不再因为固定 section 顺序被埋在下方。
2. **保留浏览秩序**：下方仍保留原本的分组 section，用户可以继续按类型扫结果。
3. **空状态可操作**：Ctrl+F 打开即显示最近播放/更新的歌曲，变成轻量“最近播放/最近编辑切歌器”。
4. **复用现有搜索内核**：不引入新搜索引擎，不改变本地优先模型，不新增后端。

---

## 2. System Architecture

### 2.1 Architecture Overview

```
Ctrl+F open
  |
  |-- query empty + no filter
  |     `-- local worker returns ready track ids sorted by
  |         (lastPlayedAt ?? updatedAt ?? createdAt) desc
  |
  `-- query non-empty
        |
        |-- tracks: queryRows(trackToRow(...), query) => { id, score }
        |-- artists: score entity name against query => { entry, score }
        |-- albums : score album + artist against query => { entry, score }
        |-- sets   : score session.name against query => { session, score }
        |
        |-- Best Matches
        |     `-- mixed candidates sorted by adjustedScore
        |
        `-- Existing grouped sections remain below
              Sets / Songs / Lyrics / Albums / Artists / Online
```

### 2.2 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Search scoring | Existing `scoreRow`, `queryRows`, transliteration variants | Already handles CJK / kana / romaji and field-scoped tokens |
| Local search worker | Existing `global-search-local-worker` / `global-search-local-core` | Heavy local search stays off main thread |
| UI | Existing `GlobalTrackSearch` rows | Avoid a second search surface; only add a mixed top section |
| Storage | Existing IndexedDB rows | `Track.updatedAt?` is already additive and non-indexed; no schema bump |
| Playback stats | Existing `trackPlaybackStats` side table | `lastPlayedAt` already lives outside the hot `tracks` row |

### 2.3 Project Structure

```
src/lib/search-core.ts
  - keep existing scoreRow/queryRows behavior
  - export or reuse score helpers only if needed

src/lib/track-search.ts
  - add scored entity facet helper or extend limited helper with scores

src/workers/global-search-local-core.ts
  - return track scores for non-empty query
  - sort empty-query tracks by lastPlayedAt ?? updatedAt ?? createdAt desc
  - return album/artist scores for mixed ranking

src/components/search/global-track-search.tsx
  - request local worker on empty query for default recent songs
  - render Best Matches above grouped sections for non-empty query
  - keep grouped sections and keyboard navigation coherent

src/workers/global-search-local-core.test.ts
src/lib/track-search.test.ts
  - add ranking and empty-state regression coverage
```

---

## 3. Data Model Design

### 3.1 Core Concepts

```
SearchCandidate
  kind: "set" | "track" | "lyric" | "album" | "artist" | "online"
  rawScore: number       // lower is better, same convention as queryRows()
  typeBias: number       // small nudge, not a hard order
  adjustedScore: number  // rawScore + typeBias + optional usage signals
```

### 3.2 Database Schema

No Dexie schema bump is required.

- `Track.updatedAt?: number` already exists in `src/db/types.ts`.
- `TrackPlaybackStats.lastPlayedAt?: number` already exists in `src/db/types.ts` and is the authoritative playback recency source.
- Legacy rows may lack `updatedAt`; never-played rows may lack `lastPlayedAt`. All sorting must fall back to `updatedAt ?? createdAt`.
- `tracks` does not need an `updatedAt` index for this PRD because the local search worker already loads in-memory track rows for global search.
- `trackPlaybackStats` already has indexes `trackId` and `[trackId+devicePublicId]`; the worker can fold the loaded stats rows into a `Map<trackId, max(lastPlayedAt)>`.
- If a future performance pass needs indexed recent-activity queries for very large libraries, that should be a separate PRD with a Dexie version bump.

### 3.3 Data Relationship Diagram

```
Track
  id
  title
  mediaMetadata.artists[]
  mediaMetadata.album
  tags[]
  createdAt
  updatedAt?

TrackPlaybackStats
  trackId
  devicePublicId
  lastPlayedAt?
  updatedAt

DjSession
  id
  name
  trackIds[]
  updatedAt

Derived facets
  ArtistEntry <- buildArtistIndex(tracks)
  AlbumEntry  <- buildAlbumIndex(tracks)
```

---

## 4. API Design

### 4.1 Internal Worker Contract

Extend the local worker result shape without changing external app architecture.

Current:

```ts
export interface GlobalSearchLocalResults {
  albums: AlbumEntry[];
  artists: ArtistEntry[];
  coverTrackIds: string[];
  trackIds: string[];
}
```

Target:

```ts
export interface ScoredResultRef {
  id: string;
  score: number;
}

export interface ScoredAlbumResult {
  entry: AlbumEntry;
  score: number;
}

export interface ScoredArtistResult {
  entry: ArtistEntry;
  score: number;
}

export interface GlobalSearchLocalResults {
  albums: AlbumEntry[];
  artists: ArtistEntry[];
  coverTrackIds: string[];
  trackIds: string[];
  trackHits?: ScoredResultRef[];
  albumHits?: ScoredAlbumResult[];
  artistHits?: ScoredArtistResult[];
}
```

Notes:

- `trackIds` / `albums` / `artists` remain for compatibility with existing rendering.
- `*Hits` are additive metadata used by mixed ranking.
- Empty query can return `trackHits` with score `0`, sorted by recent activity order.
- Worker and inline fallback must both load `trackPlaybackStats` alongside `tracks` / `memories` and pass them into `buildGlobalSearchLocalResults` or an equivalent pre-folded map.

### 4.2 Error Handling

- If scoring metadata is missing, UI falls back to existing fixed section order.
- If worker returns no rows for empty query, show the existing empty state.
- No network or remote API changes.

---

## 5. Frontend Design

### 5.1 Page Structure

```
GlobalTrackSearch
  Search input
  Filter chips / @ menu
  Results
    - Empty query: Songs section with recent activity songs
    - Non-empty query:
        Best Matches       // new, mixed, max 5
        Sets               // existing
        Songs              // existing
        Lyrics             // existing
        Albums             // existing
        Artists            // existing
        Online             // existing
```

### 5.2 UI Components

#### Empty Query Behavior

When Ctrl+F opens with:

- no typed query,
- no active `@` filter,
- no pasted link,

the results panel should show ready local tracks sorted by:

```ts
(lastPlayedAtByTrackId.get(track.id) ?? track.updatedAt ?? track.createdAt) desc
```

`lastPlayedAtByTrackId` is derived from `trackPlaybackStats` by taking the maximum `lastPlayedAt` across devices for each track. This mirrors existing library/stat helpers and keeps playback churn out of the `tracks` table.

This replaces the current inert empty state for the default open state. The row UI should reuse `GlobalTrackSearchRow` so Enter / Shift+Enter behavior remains identical.

Do not show albums / artists / sets by default in the empty unfiltered state. Those remain available via `@artist`, `@album`, `@set`, or non-empty search.

#### Best Matches Behavior

For non-empty local search, render a compact top section:

- Title: `Best Matches`
- Limit: 5 rows
- Include: sets, tracks, albums, artists, and lyrics if already computed
- Exclude online results unless the query is a pasted link / playlist URL; existing pasted-link `onlineFirst` behavior remains stronger
- De-duplicate with grouped sections only by navigation item identity, not by hiding grouped rows; the same item may appear in Best Matches and again in its type section for scanability

Rows should reuse existing row components:

- set -> `GlobalSetRow`
- track -> `GlobalTrackSearchRow`
- album / artist -> `GlobalEntityRow`
- lyric -> `GlobalLyricSearchRow`

### 5.3 Ranking Model

Use “lower is better”, matching `queryRows()`.

Base score:

| Candidate | Base Score Source |
|-----------|-------------------|
| Track | `queryRows(trackToRow(track), query).score` |
| Artist | score against artist name variants |
| Album | score against `album name + artist name` variants |
| Set | score against `session.name` |
| Lyric | existing lyric result order, translated into a score bucket |
| Online | existing provider order; only mixed first for pasted links |

Suggested type bias:

| Kind | Bias | Why |
|------|------|-----|
| track | 0 | Primary playback object |
| artist | 1 | User often searches artist names directly; should not be buried |
| album | 2 | Entity result, slightly below artist on equal score |
| set | 2 | Useful but less likely than exact song/artist |
| lyric | 6 | Usually a deeper match; keep visible but not dominant |

Important rule: **type bias must be small enough that a much better artist match beats a weaker song match.** This PRD explicitly rejects hard type order like `set > track > album > artist`.

Tie breakers:

1. `adjustedScore`
2. exact normalized label match before prefix/substring
3. `lastPlayedAt ?? updatedAt ?? createdAt` desc for tracks
4. `updatedAt` desc for sessions
5. existing input order as final stable fallback

### 5.4 State Management

- Keep all durable data in IndexedDB.
- Do not add Zustand state for derived search results.
- Keep worker result in component state as today.
- Keep keyboard selection based on the final visual/nav order.

---

## 6. Implementation Plan

### Phase 1: Empty Query Recent Activity Songs

**Goal:** Ctrl+F opened with an empty query immediately shows recently played/updated ready songs.

**Tasks:**

- [x] Change `localWorkerRequested` in `global-track-search.tsx` so the default empty unfiltered state requests local tracks.
- [x] Update `global-search-local-worker.ts` and inline fallback to load `trackPlaybackStats` with `tracks` / `memories`.
- [x] In `buildGlobalSearchLocalResults`, when `query === ""`, sort ready tracks by `(lastPlayedAt ?? updatedAt ?? createdAt)` desc instead of `createdAt` desc.
- [x] Fold multiple `TrackPlaybackStats` rows per track by taking max `lastPlayedAt`.
- [x] Keep `@video` / `@audio` empty browse behavior working with the same recent-activity ordering.
- [x] Add worker test coverage for empty query ordering by `lastPlayedAt`, then `updatedAt`, with legacy fallback to `createdAt`.

### Phase 1 Checklist

- [x] Ctrl+F open on a populated library shows up to `MAX_SONG_RESULTS` ready songs.
- [x] Recently played tracks appear before merely edited tracks.
- [x] Most recently edited/tagged/memory-updated never-played track appears before older created never-played tracks.
- [x] Legacy tracks without `lastPlayedAt` / `updatedAt` still appear correctly via `createdAt`.
- [x] Enter plays selected recent song; Shift+Enter queues next.

### Phase 2: Scored Local Results

**Goal:** Make local result types carry relevance score so UI can rank across types.

**Tasks:**

- [x] Extend track worker path to preserve `queryRows()` scores before mapping back to ids.
- [x] Add scored artist / album facet helper, or extend `searchEntityFacetsLimited()` to optionally return scores.
- [x] Add set scoring in `global-track-search.tsx` using `scoreRow()` or a small local helper over `session.name`.
- [x] Preserve old arrays for grouped rendering.
- [x] Add tests where exact artist match scores better than a buried song metadata match.

### Phase 2 Checklist

- [x] Song results keep existing internal ranking.
- [x] Artist / album results are ordered by relevance, not only index order.
- [x] Existing `artist:` and `album:` scoped tokens still work.
- [x] Transliteration tests continue to pass.

### Phase 3: Best Matches Mixed Section

**Goal:** Present the most likely target at the top while keeping grouped sections below.

**Tasks:**

- [ ] Build `bestMatchItems` from scored sets, tracks, lyrics, albums, and artists.
- [ ] Sort by adjusted score and tie breakers.
- [ ] Render a `Best Matches` section above grouped local sections for non-empty query.
- [ ] Integrate `bestMatchItems` into keyboard navigation order.
- [ ] Keep pasted-link / playlist `onlineFirst` behavior unchanged.
- [ ] Add component or core tests for visual/nav order where artist should appear before lower-quality song matches.

### Phase 3 Checklist

- [ ] Querying an exact artist name surfaces that artist in the first 5 rows.
- [ ] Querying an exact song title surfaces the song before weaker artist/album matches.
- [ ] Querying an exact album name surfaces the album near top without hiding song results.
- [ ] Down-arrow navigation follows visual order, including Best Matches.
- [ ] No duplicate keyboard indices.

---

## 7. Out of Scope

- Replacing the search engine with Fuse, Lunr, SQLite FTS, or a remote service.
- Adding cloud search, telemetry, accounts, or MUZERO backend.
- Changing `TrackBrief`, music generation, playback queue model, or provider boundaries.
- Indexed Dexie migration for `tracks.updatedAt` or playback recency.
- Redesigning the full Search page outside Ctrl+F global overlay.
- Changing online provider ranking, except preserving pasted-link first behavior.

---

## 8. Security Considerations

- **Authentication:** Not applicable; local-only app, no account system.
- **Authorization:** No permission model changes.
- **Data Protection:** Search remains local. No search query, file name, artist, tag, memory, or lyrics content is sent to MUZERO-owned services.
- **Logging:** Do not add `console.*`; use `src/lib/logger.ts` only if diagnostics are necessary. Avoid logging raw queries or library metadata.
- **Hidden Flags:** Do not hide ranking behavior behind `localStorage`, URL params, or `window.*`. Rollback is `git revert`.

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [`prd-create.md`](../../../.cursor/commands/prd-create.md) | PRD workflow used to create this document |
| [`AGENTS.md`](../../../AGENTS.md) | MUZERO architecture and hard rules |
| [`src/lib/search-core.ts`](../../../src/lib/search-core.ts) | Existing score/query core |
| [`src/lib/track-search.ts`](../../../src/lib/track-search.ts) | Track and entity search helpers |
| [`src/components/search/global-track-search.tsx`](../../../src/components/search/global-track-search.tsx) | Ctrl+F global search UI |
| [`src/workers/global-search-local-core.ts`](../../../src/workers/global-search-local-core.ts) | Local worker result builder |
| [`src/db/types.ts`](../../../src/db/types.ts) | `Track.updatedAt?` and `TrackPlaybackStats.lastPlayedAt?` source fields |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | Best Matches 是否复用英文 key `globalSearch.bestMatches` 并补 zh/ja/ko？ | Resolved | 使用 `globalSearch.bestMatches`，补 en/zh/ja/ko，不内联文案 |
| 2 | 空查询最近歌曲是否应包含最近播放 `lastPlayedAt`？ | Resolved | 应包含，且优先级最高：`lastPlayedAt ?? updatedAt ?? createdAt` |
| 3 | Best Matches 中是否隐藏下方分组重复项？ | Resolved | 不隐藏；顶部用于快速命中，下方保留类型扫描 |
| 4 | `artist:` 查询是否只显示 artist Best Matches？ | Resolved | 遵循现有 scope：artist token 强约束 artist field，但歌曲仍可因 artist field 命中出现 |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-07-05 | Codex | Initial draft: relevance mixed ranking + empty-query recent songs |
| 2026-07-05 | Codex | Resolved open questions; changed empty query ordering to prioritize `lastPlayedAt` |
| 2026-07-05 | Codex | Completed Phase 1: empty Ctrl+F now requests recent activity songs |
| 2026-07-05 | Codex | Completed Phase 2: local track/artist/album results now carry relevance scores |
