# PRD: Like（红心）切换的 liveQuery 扇出掉帧修复

**Status:** Draft
**Created:** 2026-06-17
**Author:** DoodleBear
**Module:** `src/db`（`tracks.liked` 下沉侧表）· `src/db/repositories.ts`（`setTrackLiked`）· `src/shortcuts/actions.ts`（like action）· `liked` 读取方（favorite 按钮 / track-row / `system:liked` / dj-chat / sort filter）

> **这是 [`switch-song-playcount-fanout-fix`](../../../.claude/projects/d--code-project-MUZERO/memory/switch-song-playcount-fanout-fix.md) 记录的「scope B 残留」的兑现。** 那次（commit `07811cc`）把 `playCount` 从 `tracks` 行下沉到 `trackPlaybackStats` 侧表，根除了「每次计数播放都重取整个队列 + 全表」的扇出；当时明确留了一条：**`liked` 仍在 `tracks` 行，点红心仍触发同样的重取，优先级低（稀有动作 vs 每次计数播放）**。本期把它修掉。

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | 观测先行：用 harness `like` scenario 锁定 before 基线（已具备） | ✅ Completed | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | `liked` 下沉侧表 + 迁移 + 写路径改道（★核心） | 🔲 Pending | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | 读取方改 join 侧表（favorite 按钮 / track-row / `system:liked` / dj-chat / sort filter） | 🔲 Pending | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | harness 复测 before/after，确认 `queue.live.fetch=0`、无 `listAllTracks` 级联、FPS 不掉 | 🔲 Pending | [Phase 4 Checklist](#phase-4-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

QA 在 **Now Playing（tab 1）的 Dock 上点 Like 红心** 后出现**严重掉帧**。经 harness（`perf-control` + `perf-drive like` scenario）在用户真实库（**队列 5983 曲**）实测，5 次 Like 的 before 基线：

| 指标 | before（点 Like ×5） | 说明 |
|---|---|---|
| `fpsLowMin` | **3.7** | 严重掉帧（健康应 ≥30，idle 基线 116） |
| `frameMaxMs` / `frameP99Ms` | 266ms / 208ms | 单帧停顿 |
| `longTaskCount` / `longTaskMaxMs` / `longTaskTotalMs` | 13 / 261ms / **2231ms** | 多次主线程长停顿 |
| `queueLiveFetchCount` / `queueLiveFetchMaxMs` | **5** / **357ms** | **每次 Like 都重取整个 5983 队列** |
| `dbRequeryEntries` | `listAllTracks requery` ×5 | **每次 Like 都重触发 6k 全表 liveQuery** |

**根因（liveQuery 扇出）**：点红心走 [`setTrackLiked`](../../../src/db/repositories.ts)：

```ts
await db.tracks.update(id, { liked, updatedAt: Date.now() });  // 写 tracks 行
```

写 **`tracks` 表**会 re-fire **每一个观察 `tracks` 的 Dexie liveQuery**：
1. **播放队列**的 `getTracksByIds(5983)`/`bulkGet` —— 当前曲在队列集里，写它必触发 → ~357ms 重取一份**内容没变**的 5983 队列。
2. **`global-track-search`** 的 [`useLiveQuery(() => listAllTracks(db))`](../../../src/components/search/global-track-search.tsx#L123)（**全表观察**，6k）+ `memoryNotesByTrack` 的 O(N) 派生级联 —— **即便 ⌘F 关着也跑**（`GlobalTrackSearch` 在 `App` 里常驻挂载）。

这与 `playCount` 当年完全同源：**把高频写的字段（playCount / liked / lastPlayedAt）和冷目录行放在一起，落进热 liveQuery 观察集，Dexie 对任何被观察 key 的写都会 re-fire 整个查询。**

### 1.2 Target Users

| Role | Description | Permissions |
|------|-------------|-------------|
| **本地用户（owner）** | 在 Now Playing / 库列表里点红心收藏；期望即时、无卡顿（大库尤甚） | 全功能；本地优先、无账号 |

### 1.3 Core Value

1. **点红心即时无卡顿** —— 大库（6k+）下 Like 不再触发整队列 + 全表重取，FPS 不掉。
2. **复用既有 scope-A 范式** —— 与 `playCount→trackPlaybackStats` 同款下沉，最小风险、有先例可循。
3. **不改用户可见行为** —— 红心显示 / `system:liked` 歌单 / DJ 上下文照旧，只换底层存储位置。

---

## 2. System Architecture

### 2.1 Architecture Overview（现状 → 目标）

```
现状（扇出）：
  点红心 → setTrackLiked → db.tracks.update(id,{liked})   ← 写热目录行
                                  │ Dexie re-fire 所有 tracks 观察者
            ┌─────────────────────┼──────────────────────────┐
            ▼                     ▼                            ▼
   播放队列 getTracksByIds(5983)   listAllTracks(6k 全表)     memoryNotesByTrack O(N)
   ~357ms 重取(内容未变)          重取 + 派生级联(⌘F 关也跑)   → 主线程 2231ms longtask、FPS 3.7

目标（下沉侧表，零扇出）：
  点红心 → setTrackLiked → db.trackLikes.put({trackId,liked})  ← 写独立侧表
                                  │ 只 re-fire 观察 trackLikes 的查询
            ▼
   favorite 按钮单行订阅 / system:liked 过滤 join 侧表 —— tracks 表零写、零扇出
```

### 2.2 Technology Stack

| Component | Technology | Rationale |
|---|---|---|
| **持久化** | Dexie 4（IndexedDB `muzero-db`）新增 `trackLikes` 侧表 + version bump | 规则 1/4：本地优先、codename 稳定；镜像 `trackPlaybackStats` 侧表范式 |
| **写路径** | `setTrackLiked` 改写 `trackLikes`，**不再触碰 `tracks`** | 断开热 liveQuery 观察集 → 零扇出 |
| **读路径** | 读取方 join `trackLikes`（单行订阅 / 批量 map），镜像 `playCount` 读取方用 `trackPlaybackStats` | 规则 6：最小 selector、liveQuery 读 |
| **验证** | `perf-control` + `perf-drive like` scenario（[[perf-control-endpoint-harness]]） | §4 性能方法学：测帧节奏 + longtask + `queue.live.fetch` + `listAllTracks requery`，非凭感觉 |

### 2.3 Project Structure（仅列改动）

```
src/db/
├── muzero-db.ts          # ✎ version(26) 新增 trackLikes 表 + upgrade 回填(从 tracks.liked)
├── types.ts              # ✎ 新增 TrackLike 接口；tracks.liked 标记 deprecated→移除(分两步)
└── repositories.ts       # ✎ setTrackLiked 改写 trackLikes；新增 likedByTrack/isTrackLiked 读
src/shortcuts/actions.ts  # ✎ like action 的 getTrack(liked)/setTrackLiked 走侧表
src/components/player/favorite-control-button.tsx  # ✎ 单行订阅 trackLikes 而非 tracks.get().liked
src/components/library/track-row.tsx               # ✎ 红心显示读注入的 liked（来自侧表 join）
src/components/library/system-playlist-detail.tsx + queue-panel.tsx  # ✎ system:liked 过滤 join 侧表
src/components/library/(sort-chip 过滤 / entity-detail liked-filter)  # ✎ liked-only 过滤 join 侧表
src/chat/dj-chat-tools.ts # ✎ "liked" 字段投影读侧表(镜像 sumPlayCountsByTrack)
```

---

## 3. Data Model Design

### 3.1 Core Concepts

```
Track(冷目录行)         —— 高频写字段全部移出
  ├── liked  ❌ 移除(分两步：先 deprecated 双读，再删字段)
  └── (其余注释 tags/note/cover 仍在 —— 它们低频，且不在每次播放/点赞路径)

TrackLike(新侧表，高频写隔离)          ← 与 trackPlaybackStats 同范式
  ├── id:        string (blb/like id 前缀稳定)
  ├── trackId:   string  (索引)
  └── liked:     boolean  + updatedAt
```

### 3.2 Database Schema

⚠️ 优先改既有结构、镜像已有 `trackPlaybackStats`（v14）范式，不做大重构。

- **Current Schema**：[`src/db/muzero-db.ts`](../../../src/db/muzero-db.ts) 当前最高 `version(25)`；`tracks.liked:boolean`（[`types.ts:149`](../../../src/db/types.ts#L149)）。`trackPlaybackStats`（v14，`id, trackId, devicePublicId, updatedAt, [trackId+devicePublicId]`）是 scope-A 的下沉先例。
- **Required Changes**：`version(26).stores({ trackLikes: "id, trackId, updatedAt" })`（按 `trackId` 索引以支持单曲查 + 批量）。
- **Data Migration**：`version(26).upgrade(tx)` 遍历 `tracks`，对 `liked===true` 的行写一条 `trackLikes`（`liked:false` 不必落行 = 缺省即未赞，省空间）。回填在 worker/升级事务内，启动一次性。
- **下沉为何彻底断扇出**：`setTrackLiked` 改为 `db.trackLikes.put(...)`，**完全不写 `tracks`**（连 `updatedAt` 也不碰）→ 播放队列的 `getTracksByIds` / `listAllTracks` 的观察集不含 `trackLikes` → 零 re-fire。
- **Constraints & Indexing**：`trackLikes` 主键 `id`，二级索引 `trackId`（单曲订阅 `where("trackId").equals(id)`）、`updatedAt`（同步/排序备用）。
- **Performance Impact**：写从「热目录行（被 6k 全表 + 5983 队列观察）」变为「冷侧表（仅 favorite 按钮单行订阅 + system:liked 过滤观察）」；点赞写 O(1)、零大查询重取。
- **Zero-Downtime / 双读过渡**：分两步删 `tracks.liked` —— **v26** 建侧表 + 回填 + 写改道 + 读改道（此时 `tracks.liked` 仍在但不再写，读取方已切侧表）；**后续小版本**确认无遗漏读后再从 `tracks` 删字段（避免一次性破坏 schema）。
- **Rollback Plan**：回滚 = `git revert` 重发版（规则 3，不藏 flag）。侧表是新增、`tracks.liked` 字段在 v26 未删 → revert 后老代码仍能读 `tracks.liked`（但会丢 revert 后产生的新赞，属已知小代价；可在 revert 版加一次「侧表回写 tracks.liked」反向回填脚本兜底）。
- **Privacy & Retention**：`liked` 是设备本地偏好；不上报、不进遥测（规则 1/2）。跨设备同步语义沿用既有 R2 同步框架（若 `liked` 需同步，按 `trackPlaybackStats` 的 per-device merge 思路单列，见 Open Q2）。

### 3.3 Data Relationship Diagram

```
tracks(id) 1 ──── 0..1 trackLikes(trackId)     [缺行 = 未赞]
            └──── 0..N trackPlaybackStats(trackId)   [既有同款侧表]
```

---

## 4. 性能测量方法学（验收 ground truth，先于优化）

> 按 [`prd-create.md` §4](../../../.cursor/commands/prd-create.md) 「性能/掉帧类 PRD 先写测量方法」。本特性**已具备**测量手段（harness 在排查阶段即用它锁定根因），故 Phase 1 直接 Completed。

- **驱动**：[`scripts/perf-drive.mjs like`](../../../scripts/perf-drive.mjs)（`POST /action/playback.like` ×N）在 Now Playing tab + 大队列下跑；token/port 读 `.logs/perf-control.json`。
- **必测指标（before/after 对比，非渲染耗时）**：
  - **帧节奏**：`fpsLowMin` / `frameMaxMs` / `frameP99Ms`（`performance.frame`，dev-perf-panel rAF 采样）。
  - **长任务**：`longTaskCount` / `longTaskMaxMs` / `longTaskTotalMs`（`PerformanceObserver longtask`）。
  - **扇出的直接信号**：`queueLiveFetchCount`/`queueLiveFetchMaxMs`（`queue.live.fetch`）与 `dbRequeryEntries`（`listAllTracks requery`）—— **这两个归零是核心验收**，比 FPS 更无歧义。
- **环境**：dev 下复测（StrictMode/HMR 噪声已知）；关键数字也可在 prod-profile（无控制端点的局限见 [[perf-control-endpoint-harness]]）补测。**ELECTRON_RUN_AS_NODE 须 unset**（启动 harness 的已知坑）。
- **before 基线（已采，§1.1）**：`queueLiveFetchCount=5`、`listAllTracks requery ×5`、`fpsLowMin=3.7`、`longTaskTotalMs=2231ms`。
- **after 验收目标**：`queueLiveFetchCount=0`、**无** `listAllTracks requery`、`fpsLowMin` 接近 idle 基线（≥60）、`longTaskTotalMs` 接近 0。

---

## 5. Frontend Design

### 5.1 / 5.2 受影响读取方（改 join 侧表，不改外观）

| 读取方 | 现状 | 改动 |
|---|---|---|
| [`favorite-control-button.tsx`](../../../src/components/player/favorite-control-button.tsx) | `useLiveQuery(()=>db.tracks.get(current.id)?.liked)`（单行订阅，已很窄） | 改订阅 `db.trackLikes.where("trackId").equals(current.id)` 单行 |
| [`track-row.tsx`](../../../src/components/library/track-row.tsx)（红心 hint + 收藏按钮） | 直读 `track.liked` | 由列表注入 `liked`（列表读 `trackLikes` 批量 map 后合并） |
| `system:liked` 虚拟歌单（[`system-playlist-detail.tsx`](../../../src/components/library/system-playlist-detail.tsx) / [`queue-panel.tsx`](../../../src/components/library/queue-panel.tsx)） | 按 `track.liked` 过滤 | join `trackLikes`（liked 集合）过滤 |
| 库列表「红心-only 过滤」（sort-chip / [`entity-detail.tsx`](../../../src/components/library/entity-detail.tsx)） | 按 `track.liked` 过滤 | 同上 join 过滤 |
| [`dj-chat-tools.ts`](../../../src/chat/dj-chat-tools.ts) 投影 `"liked"` 字段 | 读 `track.liked` | 批量读 `trackLikes`（镜像现有 `sumPlayCountsByTrack` 的 `likedByTrack` map） |

### 5.3 State Management

- 写：`setTrackLiked` 单点改道（规则 5：不在 UI 散落 `if`）。读：liveQuery 读侧表（规则 6）。`liked` 不进 Zustand。
- 列表合并 `liked`：批量 `trackLikes.toArray()` → `Set<trackId>`，列表渲染时查 Set（O(1)），避免每行单查。

---

## 6. Implementation Plan

### Phase 1: 观测基线（已具备）
**Goal:** 用 harness `like` scenario 锁定 before 数字。
#### Phase 1 Checklist
- [x] `perf-drive like` 在 5983 队列 + Now Playing 实测：`queueLiveFetch=5`、`listAllTracks requery ×5`、`fpsLowMin=3.7`、`longTaskTotalMs=2231ms`（§1.1）。

### Phase 2: `liked` 下沉侧表 + 写改道（★核心）
**Goal:** `tracks` 表零写，断扇出。
**Tasks:**
- [ ] `types.ts` 加 `TrackLike`；`muzero-db.ts` `version(26)` 建 `trackLikes` + `upgrade` 回填（`tracks.liked===true` → 一条 trackLikes）。
- [ ] `repositories.ts` `setTrackLiked` 改写 `db.trackLikes.put`（缺行=未赞；取消赞=删行或 `liked:false`）；**不触碰 `tracks`**。
- [ ] 新增读 helper：`isTrackLiked(id)` / `likedTrackIdSet()`（批量）/ `likedByTrack(ids)`。
- [ ] `shortcuts/actions.ts` like action 的 `getTrack(liked)` + `setTrackLiked` 走侧表。
#### Phase 2 Checklist
- [ ] 迁移单测（`fake-indexeddb`）：v25→v26 回填 liked 行；缺行=未赞；toggle 写侧表不写 tracks。
- [ ] `setTrackLiked` 后 `tracks` 表无写（断言不 re-fire `tracks` 观察者）。

### Phase 3: 读取方改 join 侧表
**Goal:** 所有 `track.liked` 读取迁到 `trackLikes`，外观不变。
**Tasks:**
- [ ] favorite-control-button 单行订阅 `trackLikes`。
- [ ] track-row 红心由列表注入；列表批量读 likedSet 合并。
- [ ] `system:liked` 过滤 + 库 liked-only 过滤 join 侧表。
- [ ] dj-chat-tools `"liked"` 投影读侧表。
#### Phase 3 Checklist
- [ ] 红心显示 / 收藏按钮 / `system:liked` 歌单 / liked-only 过滤 / DJ 上下文 行为与之前**完全一致**（单测 + 手测）。

### Phase 4: harness 复测 before/after
**Goal:** 验收掉帧消除。
#### Phase 4 Checklist
- [ ] `perf-drive like` after：`queueLiveFetchCount=0`、**无** `listAllTracks requery`、`fpsLowMin≥60`、`longTaskTotalMs≈0`。
- [ ] CDP flame graph（按需）确认无 `getTracksByIds(5983)` / `listAllTracks` 调用进点赞路径。

---

## 7. Out of Scope

- **`tags`/`note`/`cover`/`memories` 等其它注释**：它们低频写，且不在每次播放/点赞热路径，本期不下沉（如未来发现某项也扇出，再按本范式单独处理）。
- **从 `tracks` 删 `liked` 字段**：v26 仅停写、读改道；删字段留到后续确认无遗漏读后的小版本（双读过渡，避免一次性破坏 schema）。
- **跨设备 `liked` 同步合并语义**：沿用既有 R2 同步框架；若需 per-device 合并按 `trackPlaybackStats` 思路单列（Open Q2）。
- **其它 tab/页的 Like 入口**：本期统一走改道后的 `setTrackLiked`，无需逐处改。

---

## 8. Security / Privacy

- `liked` 是设备本地偏好，存 IndexedDB；**不上报、不进遥测**（规则 1/2）。无新增出站请求。
- 回退 = `git revert` + 重发版（规则 3），不藏 `localStorage`/URL/`window.*` flag。
- codename 稳定（规则 4）：db 名 `muzero-db`、id 前缀不变；新表 `trackLikes` 跨壳/品牌稳定。

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [[switch-song-playcount-fanout-fix]]（memory） | scope-A：`playCount→trackPlaybackStats` 下沉（`07811cc`），本 PRD 是其 scope-B 兑现 |
| [[perf-control-endpoint-harness]]（memory） | `perf-drive like` scenario + 启动坑（unset ELECTRON_RUN_AS_NODE） |
| [`src/sync/playback-stats.ts`](../../../src/sync/playback-stats.ts) | playCount 读取方 join 侧表的范例（`likedByTrack` 镜像它） |
| [`prd-create.md` §4](../../../.cursor/commands/prd-create.md) | 性能/掉帧类 PRD 测量方法学要求 |
| [CLAUDE.md](../../../CLAUDE.md) | 硬规则 1（本地优先）/3（无 hidden flag）/4（codename）/5（provider/边界）/6（zustand selector）/7（vitest） |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | 取消赞用「删行」还是「`liked:false` 留行」？ | Open | 倾向**删行**（缺行=未赞，省空间、查 Set 更简）；若同步需 tombstone 则留行带 `updatedAt` |
| 2 | `liked` 是否需跨设备同步？per-track 全局 vs per-device？ | Open | 现状 `liked` 在 track 行（全局）；下沉后默认仍全局（一张 `trackLikes`）。若要 per-device 合并，按 `trackPlaybackStats` 单列；不阻塞本期掉帧修复 |
| 3 | `tracks.liked` 字段何时真正删除？ | Open | v26 双读过渡，后续小版本确认无遗漏读 + 一次反向校验后删；删字段须再 bump version + upgrade |
| 4 | 列表注入 liked：每列表批量 `likedSet` liveQuery vs 全局一个 likedSet provider？ | Open | 倾向**全局一个** `useLikedTrackIds()` liveQuery（一份 Set 多处订阅），避免每列表各起一个侧表观察者 |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-17 | DoodleBear | 初稿：QA 报「Now Playing dock 点 Like 严重掉帧」→ harness 实测锁定根因 = `switch-song-playcount-fanout-fix` 记录的 scope-B 残留（`liked` 仍在热 `tracks` 行 → 点赞 re-fire 5983 队列重取 + 6k 全表 liveQuery，FPS 3.7 / longtask 2231ms）。方案：镜像 scope-A 把 `liked` 下沉 `trackLikes` 侧表（v26 + 回填 + 写/读改道），验收以 `queue.live.fetch=0` + 无 `listAllTracks requery` 为 ground truth。Q1-Q4 待定。 |

---

> **Note:** 本 PRD 优先改既有结构、镜像 `trackPlaybackStats` 既有下沉范式（唯一新增 `trackLikes` 侧表 + 读 helper），不做大重构。根因与 before 基线均由 harness 实测得到（非凭感觉），验收以扇出信号归零为准。
