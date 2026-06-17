# PRD: 可扩展的 track-list 响应式数据层（任意队列长度都不掉帧）

**Status:** Draft
**Created:** 2026-06-17
**Author:** DoodleBear
**Module:** `src/stores/player-store.ts`（队列订阅：order/content 解耦）· `src/db`（高频字段下沉侧表）· `src/db/repositories.ts`（写路径）· `src/components/library/virtual-track-list.tsx` + `queue-panel.tsx`（按 id 渲染、逐行订阅）

> **本 PRD 是架构层总纲，统辖并泛化两个战术 PRD**：[`20260617-like-toggle-livequery-fanout`](../20260617-muzero-like-toggle-livequery-fanout-prd/20260617-muzero-like-toggle-livequery-fanout-prd.md)（红心下沉，scenario 2 的切片，可先独立 ship）与既有 [`switch-song-playcount-fanout-fix`](../../../.claude/projects/d--code-project-MUZERO/memory/switch-song-playcount-fanout-fix.md)（playCount 下沉，scenario 3 的切片）。本文把它们收进**统一的两轴最佳实践**，并补上读侧（scenario 1/4）的解耦。

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | 观测先行：harness 覆盖 4 场景的 before 基线 + 验收信号 | 🔄 部分（like 已采） | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | **Axis A**：高频字段全部下沉侧表（playCount / liked / lastPlayedAt），catalog 零高频写 | ✅ Completed（liked→trackLikes v26；playCount 早已在 trackPlaybackStats，删死代码 incrementPlayCount） | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | **Axis B-1**：`state.queue` 由 `Track[]` 降为 id 列表；队列 UI 按 id 渲染 | 🔲 Pending | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | **Axis B-2**：逐行/窗口化 `useTrack(id)` 响应式读（跟随虚拟窗口），单曲写只重渲该行 | 🔲 Pending | [Phase 4 Checklist](#phase-4-checklist) |
| 5 | 全 4 场景 @5983 队列 harness 复测验收 | 🔲 Pending | [Phase 5 Checklist](#phase-5-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

当前 track-list 响应式数据层在**长队列/大库**下不可扩展。根因不是单个 bug，而是一个**架构反模式**：

> **把整张大列表的「全部行内容」作为一个 Dexie `liveQuery` 来观察** —— Dexie 对**任何被观察 key 的写**都 re-fire 整个查询。于是无论列表多长，任一首歌的任一次写，都会触发**全量重取 + O(N) 处理 + 列表重渲**。

实测（harness，队列 **5983**，点 Like ×5）：`queue.live.fetch` ×5 @ 357ms、`listAllTracks requery` ×5、`fpsLowMin 3.7`、`longTaskTotalMs 2231ms`。

代码里已有半步缓解（switch-fps Phase 2，[`player-store.ts:680-803`](../../../src/stores/player-store.ts#L680-L803)）：把**游标写**和**内容物化**拆成两个订阅，使「切歌的游标写」不再重取全队列。但贵订阅仍 `getTracksByIds(N)` 物化**全部** N 行、观察**全部** N 行——其注释明说残留：

```
// tracks sub (expensive): … still re-fires on a queue track's row write
//   (cover edit / palette backfill republish). A cursor write no longer touches it.
```

即**编辑队列里任一首歌的封面/记忆/标题/红心，仍重取全部 5983 行**。要「任意长度都 handle」，必须从架构上消除「观察全量内容」这件事。

### 1.2 四个写场景 × 现状扇出 × 目标

| # | 场景 | 现状写 | 现状扇出（@5983） | 目标 |
|---|---|---|---|---|
| 1 | **歌单增删歌** | `session.trackIds`（顺序数组）+ 入库 track 行 | 便宜 sub re-fire（对）；但贵 sub 把**全部** N 重取 | 顺序变 O(变更)；只为**新增可见行**取内容 |
| 2 | **红心某曲** | `setTrackLiked`→`db.tracks.update({liked})` | 写热目录行 → 队列 N 重取 + 6k 全表 listAllTracks 重取 | **catalog 零写** → 零扇出（侧表） |
| 3 | **播放某曲** | `incrementPlayCount`→`db.tracks.update({playCount})`（[`repositories.ts:1103`](../../../src/db/repositories.ts#L1103)）+ 游标 | scope-A 已让读取方用侧表，但 catalog 仍有 playCount 字段/残留写 | **catalog 零写**（playCount/lastPlayedAt 仅侧表）；游标走便宜 sub |
| 4 | **改 metadata**（封面/记忆/标题/标签） | `setTrackTags/Note/Cover`→`db.tracks.update(...)`（**合法**内容变更） | 合法写一行 → 贵 sub 重取**全部** N + O(N) 处理 + 列表重渲 | 只重渲**被改的那一行**（逐行订阅） |

> 关键区分：**场景 2/3 是「字段不该在 catalog」(写侧)；场景 4 是「合法写不该扇出到全量重取」(读侧)；场景 1 兼有顺序变更（合法）+ 内容重取（浪费）。** 两轴必须都治。

### 1.3 Core Value

1. **任意队列长度都不掉帧** —— 增删/红心/播放/改 metadata 的成本与队列长度 N **解耦**（O(1) 或 O(变更/可见)），而非 O(N)。
2. **复用既有范式 + 收敛战术 PRD** —— Axis A 镜像 `trackPlaybackStats` 下沉；Axis B 对齐既有 TanStack Virtual。
3. **不改用户可见行为** —— 红心/封面/记忆/歌单/`system:liked` 照旧，只换底层「观察什么」。

---

## 2. System Architecture

### 2.1 反模式 → 最佳实践（两轴）

```
反模式（现状）：
  state.queue: Track[]  ← getTracksByIds(N) liveQuery 物化并观察【全部 N 行内容】
       任一行写(封面/记忆/标题/红心/playCount) → re-fire → 全量重取 357ms → O(N) 处理 → 列表重渲

最佳实践（目标）：两件事解耦
  ┌─ ORDER（顺序）  = 轻量 id 列表 + 游标，存 store，无内容 liveQuery
  │     歌单增删 → id 列表 diff（O(变更)）；播放/红心 → 不碰它
  └─ CONTENT（逐行内容）= 按 id、跟随【虚拟窗口】的响应式读 useTrack(id)
        只订阅【可见的 ~20 行】；编辑某曲 → 只该 id 的订阅者重渲（1 行）
  +
  Axis A：高频易变字段（playCount / liked / lastPlayedAt）下沉侧表
        → 播放/红心【完全不写 catalog】→ 连「该行内容」都不变 → 零重渲
```

### 2.2 为什么这是「best practice」

- **Dexie liveQuery 的语义**：观察集 = 查询读到的 key 集；写任一被观察 key → re-fire 整个查询。**故唯一的可扩展解法 = 让「列表级查询」永不读「全量行内容」**——只读 id/order（轻），内容下放到「逐行/窗口」级别的小查询。
- **与虚拟化对齐**：TanStack Virtual 已只渲 ~20 可见行；数据层必须同构——**只订阅可见行的内容**，而非物化全量。这是 windowed-list 的标准做法（virtualization-aligned data fetching）。
- **写读分离**：高频写字段（计数/红心/最近播放）属于「ephemeral 状态」，不该和「冷目录元数据」同行——分表后写它们零扇出（与 RTK Query / normalized entity store 同理）。

### 2.3 Technology Stack

| Component | Technology | Rationale |
|---|---|---|
| 队列订阅 | `player-store` 双订阅保留；贵订阅由「物化全量」改为「只持 id 列表」 | 切断 N 量级内容观察 |
| 逐行内容 | 新 hook `useTrack(id)`：单行 `db.tracks.get(id)` liveQuery（或 id-keyed 共享 normalized cache） | 单曲写只 re-fire 该 id 订阅者；虚拟窗口限 ~20 活跃订阅 |
| 高频字段 | 新 `trackLikes` 侧表 + 既有 `trackPlaybackStats`（playCount/lastPlayedAt） | catalog 零高频写 |
| 验证 | `perf-control` + `perf-drive`（`like` / 新增 `metadata` / `playlistEdit` scenario） | §4 测量方法学 |

### 2.4 Project Structure（仅列改动）

```
src/stores/player-store.ts        # ✎ 贵订阅不再 getTracksByIds(N) 物化；state.queue → 轻量
src/db/muzero-db.ts / types.ts    # ✎ trackLikes 侧表 + version bump；移除 catalog 高频字段(分步)
src/db/repositories.ts            # ✎ setTrackLiked/incrementPlayCount 改道侧表；setTrackTags/Note/Cover 不变(合法)
src/hooks/use-track.ts            # ✚ 新增 useTrack(id)/useTracksWindow(ids) 逐行/窗口响应式读
src/components/library/virtual-track-list.tsx + track-row.tsx  # ✎ 按 id 渲染、行内 useTrack(id)
src/components/player/queue-panel.tsx + pages/queue-page.tsx   # ✎ 消费 id 列表而非 Track[]
```

---

## 3. Data Model Design

### 3.1 Core Concepts

```
PlayQueue(order)         = entries: {trackId}[] + cursor      ← 轻量，store/playQueue 表，无内容观察
Track(cold catalog row)  = title/artists/album/cover/note/tags/lyrics… ← 仅【真内容】，低频写
  ├── playCount    ❌ 移除(仅 trackPlaybackStats)
  ├── liked        ❌ 移除(→ trackLikes 侧表)
  └── lastPlayedAt  —— 本就在 trackPlaybackStats（catalog 无）
TrackLike(侧表)   = {id, trackId, liked, updatedAt}            ← 高频写隔离(同 trackPlaybackStats 范式)
TrackPlaybackStats(既有侧表) = {playCount, listenedSec, lastPlayedAt,…}
```

### 3.2 Database Schema

⚠️ 优先改既有结构、镜像 `trackPlaybackStats`（v14）已有下沉范式，不做大重构。当前最高 `version(25)`。

- **Required Changes**：`version(26).stores({ trackLikes: "id, trackId, updatedAt" })`；`upgrade` 从 `tracks.liked===true` 回填。playCount 字段在 catalog 留作 deprecated（双读过渡），停写。
- **下沉为何断扇出**：场景 2/3 改写侧表后 `tracks` 表零写 → 队列/全表 liveQuery 的观察集不含侧表 → **零 re-fire**。
- **读侧（Axis B）不需 schema 变更**：纯订阅形状重构（store 持 id、行内 `useTrack`）。
- **Zero-Downtime / 双读**：分两步删 catalog 高频字段——v26 建侧表+回填+写改道+读改道（catalog 字段仍在不写）；后续小版本确认无遗漏读后再删字段 + bump version。
- **Rollback**：`git revert` + 重发版（规则 3）；v26 不删 catalog 字段 → revert 后老码可读旧值（仅丢 revert 后新写，按需加反向回填脚本兜底）。
- **Privacy**：playCount/liked/lastPlayedAt 设备本地，不上报（规则 1/2）。

### 3.3 关系

```
playQueue.entries[].trackId ──▶ tracks(id) 1 ── 0..1 trackLikes ── 0..N trackPlaybackStats
                                  (id 列表持有顺序；内容/状态分表，各自独立 re-fire 域)
```

---

## 4. 性能测量方法学（验收 ground truth，先于优化）

> 按 [`prd-create.md` §4](../../../.cursor/commands/prd-create.md)：性能/掉帧类 PRD 先写测量方法，用真实快照字段证伪、测帧节奏+长任务而非渲染耗时。

- **驱动**：[`perf-drive`](../../../scripts/perf-drive.mjs) 在 Now Playing/Queue + **5983 队列**下，对 4 场景各跑 N 次：
  - 场景 2 `like`（已有 scenario）；场景 3 `counted`（计数播放，已有）；
  - 场景 1/4 需**新增 scenario**：`metadata`（对当前曲反复 `setTrackTags/Cover`）、`playlistEdit`（往 set 增删歌）—— 经 perf-control 加对应 action（dev-only，镜像 `like`）。
- **必测指标（before/after）**：`fpsLowMin`/`frameMaxMs`/`frameP99Ms`（`performance.frame`）、`longTaskCount/Max/TotalMs`（`longtask`）。
- **扇出的直接信号（核心验收，比 FPS 更无歧义）**：
  - `queueLiveFetchCount` / `queueLiveFetchMaxMs`（`queue.live.fetch`）→ **目标 0**（除非顺序真变）。
  - `dbRequeryEntries` 含 `listAllTracks requery` → **目标 无**。
  - `queue.live.process`（O(N) `queueSig`）次数 → 不随单曲写增长。
- **before 基线（已采，场景 2）**：`queueLiveFetch=5@357ms`、`listAllTracks requery ×5`、`fpsLow 3.7`、`longtask 2231ms`。
- **after 目标**：4 场景下 `queue.live.fetch`/`listAllTracks requery` 仅在「顺序真变」时各发生**一次有界**、内容编辑/红心/播放为 **0**；`fpsLow` 接近 idle（≥60）；成本与 N 无关。
- **环境**：dev 复测（StrictMode/HMR 噪声已知），关键数字按需 prod-profile 补测；启动 harness **须 unset `ELECTRON_RUN_AS_NODE`**。

---

## 5. Frontend Design

### 5.1 受影响处（按 id 渲染 + 逐行订阅）

- [`virtual-track-list.tsx`](../../../src/components/library/virtual-track-list.tsx)：rows 由 `Track[]` 改为 `ids: string[]`；每个虚拟行渲 `<TrackRow id={id}>`，行内 `const track = useTrack(id)`。虚拟窗口限活跃订阅 ~20。
- [`track-row.tsx`](../../../src/components/library/track-row.tsx)：自取 `useTrack(id)` + `useTrackLiked(id)`（侧表）；编辑某曲只此行重渲。
- [`queue-panel.tsx`](../../../src/components/player/queue-panel.tsx) / [`queue-page.tsx`](../../../src/pages/queue-page.tsx)：消费 `s.queueIds`（轻量）而非 `s.queue: Track[]`。
- [`favorite-control-button.tsx`](../../../src/components/player/favorite-control-button.tsx)：`useTrackLiked(currentId)`（单行侧表订阅）。
- `system:liked` / liked-only 过滤 / dj-chat `"liked"` 投影：join `trackLikes`（见 like-fanout PRD §5）。

### 5.2 State Management

- store 持 **order（id 列表 + 游标）**，不持全量内容（规则 6：非响应式列表不塞 Zustand 全量）。
- 内容/状态走 liveQuery 逐行读（规则 6）。`useTrack` 可选共享 normalized cache（一份 id→Track 订阅多处复用，避免重复单查）。
- 写路径单点改道（规则 5）。

---

## 6. Implementation Plan

> 顺序：**先 Axis A（写侧下沉，立竿见影修红心/播放，低风险）→ 再 Axis B（读侧解耦，修 metadata/增删，较大重构）**。每步 TDD + harness before/after。

### Phase 1: 观测覆盖 4 场景
**Goal:** harness 能量 4 场景 before/after。
#### Phase 1 Checklist
- [x] 场景 2（like）/ 场景 3（counted）已有 scenario + like before 基线。
- [ ] perf-control 加 `metadata` / `playlistEdit` action + perf-drive scenario（dev-only）。

### Phase 2: Axis A — 高频字段下沉（scenario 2/3）
**Goal:** catalog 零高频写。
**Tasks:**
- [ ] `trackLikes` 侧表 + v26 回填；`setTrackLiked` 改写侧表（详见 like-fanout PRD）。
- [ ] `incrementPlayCount` 停写 catalog（确认 scope-A 读取方已用 `trackPlaybackStats`；移除/改道残留 `tracks.update({playCount})`）。
- [ ] 读取方 join 侧表（favorite 按钮 / system:liked / dj-chat / liked-only 过滤）。
#### Phase 2 Checklist
- [x] `trackLikes` 侧表（`trackId` 主键，presence=liked）+ v26 `.upgrade` 一次性回填（纯 `likeRowsFromLegacyTracks` mapper 单测）；`setTrackLiked` 改写侧表、**不碰 tracks**；`isTrackLiked`/`likedTrackIdSet` + `useLikedTrackIds` hook。
- [x] 读取方全部迁侧表：favorite 按钮（单行订阅）、track-row（`useLikedTrackIds`，仅可见行）、`system:liked`（`deriveHeartedPlaylist(tracks, likedIds)`）、liked-only 过滤（`filterLikedTracks(...,likedIds)`，entity-detail/search-page）、dj-chat（`likedSetForTracks` join，镜像 `sumPlayCountsByTrack`）。
- [x] playCount 早已在 `trackPlaybackStats`（scope-A）；删死代码 `incrementPlayCount`（唯一残留的 `tracks.update({playCount})`，0 调用点）。
- [x] **harness 验收（5983 队列，Now Playing，like ×5）before→after**：`queueLiveFetch 5@357ms→0`、`listAllTracks requery ×5→无`、`fpsLow 3.7→117.6`、`frameMax 266→8.5ms`、`longTaskTotal 2231→0ms`。
- [x] 单测全绿：track-likes-repo（6）、system-playlists/track-gallery（parity，27）、queue-panel/system-playlist-detail（mock 侧表，11）、dj-chat、tsc 0、biome 绿。

### Phase 3: Axis B-1 — order/content 解耦
**Goal:** `state.queue` 不再物化全量 `Track[]`。
**Tasks:**
- [ ] 贵订阅不再 `getTracksByIds(N)`；store 暴露 `queueIds: string[]` + 当前曲单行订阅（transport 用）。
- [ ] queue-panel/queue-page 消费 `queueIds`。
#### Phase 3 Checklist
- [ ] 切歌/增删/编辑后 `state.queue` 路径无 O(N) `queueSig` 全量处理；现有切歌 FPS 不回退。

### Phase 4: Axis B-2 — 逐行/窗口响应式读
**Goal:** 单曲 metadata 写只重渲该行（scenario 4）。
**Tasks:**
- [ ] `use-track.ts`：`useTrack(id)`（单行 liveQuery / 共享 cache）+ `useTrackLiked(id)`。
- [ ] virtual-track-list 按 id 渲染、行内 `useTrack`。
#### Phase 4 Checklist
- [ ] harness `metadata` 场景：编辑当前曲封面/标签 → **只 1 行重渲**、`queue.live.fetch=0`、`fpsLow≥60`。

### Phase 5: 全场景 @5983 验收
#### Phase 5 Checklist
- [ ] 4 场景 before/after 表入档；成本与 N 解耦（5983 与 100 队列数字相当）。
- [ ] CDP flame graph（按需）确认无 `getTracksByIds(N)` / `listAllTracks` 进入这 4 条写路径。

---

## 7. Out of Scope

- **倒排/分页持久化等大库搜索优化** —— 属 global-search PRD，不在本数据层重构内。
- **catalog 删除高频字段** —— v26 仅停写、读改道；删字段留后续小版本（双读过渡）。
- **跨设备同步合并语义**（liked/playCount per-device）—— 沿用既有 R2 框架，按需单列（Open Q）。
- **非 track-list 的 liveQuery**（sessions/lyrics/memories 等单实体订阅）—— 本就窄，不动。
- **其它注释字段额外下沉** —— tags/note/cover 是低频【真内容】，留在 catalog（场景 4 由读侧解耦解决，不需下沉）。

---

## 8. Security / Privacy

- 高频字段设备本地，不上报、不进遥测（规则 1/2）。无新增出站请求。
- 回退 = `git revert` + 重发版（规则 3），不藏 flag。
- codename 稳定（规则 4）：db 名/表名/id 前缀不变；新 `trackLikes` 跨壳稳定。

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [like-toggle-livequery-fanout PRD](../20260617-muzero-like-toggle-livequery-fanout-prd/20260617-muzero-like-toggle-livequery-fanout-prd.md) | scenario 2 战术切片（红心下沉），可先独立 ship |
| [[switch-song-playcount-fanout-fix]]（memory） | scenario 3 战术切片（playCount 下沉，`07811cc`）+ 通用 liveQuery 教训 |
| [[perf-control-endpoint-harness]]（memory） | harness scenario + 启动坑（unset ELECTRON_RUN_AS_NODE） |
| [`player-store.ts:680-803`](../../../src/stores/player-store.ts#L680-L803) | 现有双订阅（switch-fps Phase 2）+ 残留注释 |
| [`virtual-track-list.tsx`](../../../src/components/library/virtual-track-list.tsx) | 既有 TanStack Virtual，Axis B 对齐它 |
| [`prd-create.md` §4](../../../.cursor/commands/prd-create.md) | 性能/掉帧类 PRD 测量方法学 |
| [CLAUDE.md](../../../CLAUDE.md) | 规则 1/3/4/5/6/7 |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | `useTrack(id)`：每行一个单行 liveQuery vs 一个 id-keyed 共享 normalized cache（窗口 `bulkGet`）？ | Open | 倾向**共享 cache + 窗口 bulkGet(可见 ids)**：单曲写只 re-fire 当前窗口(~20)，订阅者更少；退而求其次每行单 liveQuery 也可（Dexie 单 key 观察很轻）。Phase 4 实测定 |
| 2 | `state.queue: Track[]` 消费方多（now-playing/transport/queue UI）—— 一次性改 id 还是渐进双轨？ | Open | 渐进：先加 `queueIds` 并存 `queue`，逐个迁消费方，最后删 `queue`。避免一次大改 |
| 3 | playCount 是否还有人写 catalog（`incrementPlayCount` 调用点）？ | Open | Phase 2 排查调用点；若 scope-A 已全切 `trackPlaybackStats`，`incrementPlayCount` 可能是死代码，直接删 |
| 4 | liked/playCount 跨设备同步：per-track 全局 vs per-device merge？ | Open | 不阻塞本期掉帧修复；下沉后默认全局（trackLikes 一张），per-device 按 trackPlaybackStats 思路后续单列 |
| 5 | 顺序变更（场景 1）后内容增量：只取新增 id vs 仍窗口化？ | Open | 窗口化 useTrack 天然解决——顺序变只动 id 列表，可见行各自 useTrack 命中 cache/单取，无全量重取 |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-17 | DoodleBear（TDD 实现）| **Phase 2 Axis A ✅ 落地 + harness 验收**（分支 `perf/scalable-track-list-reactivity`）：`liked` 下沉 `trackLikes` 侧表（v26 + 一次性 `.upgrade` 回填，纯 mapper 单测）；`setTrackLiked` 只写侧表、不碰 `tracks`；读取方全迁（favorite 单行订阅 / track-row `useLikedTrackIds` 仅可见行 / `system:liked` + liked-only 过滤 + dj-chat join 侧表）；删死代码 `incrementPlayCount`。**5983 队列实测 like ×5：`queue.live.fetch` 5@357ms→0、`listAllTracks requery` ×5→无、`fpsLow` 3.7→117.6、`longtask` 2231→0ms** —— QA 报的 Now Playing 点 Like 掉帧彻底消除。单测全绿、tsc 0、biome 绿。Axis B（order/content 解耦）待后续 phase。 |
| 2026-06-17 | DoodleBear | 初稿：用户指出「任意队列长度都应 handle，现设计非 best practice」。排查 4 写场景（增删/红心/播放/改 metadata）→ 锁定**架构反模式 = 队列把全量行内容作为一个 liveQuery 观察**（`getTracksByIds(N)` 物化+观察全部 N），任一写 re-fire 全量重取（实测 @5983：357ms×5 + 全表 requery、fpsLow 3.7、longtask 2231ms）。提出**两轴最佳实践**：Axis A 高频字段下沉侧表（catalog 零高频写，统辖 like/playCount 两战术 PRD）；Axis B order/content 解耦（store 持 id 列表 + 逐行/窗口 `useTrack(id)` 响应式读，对齐 TanStack Virtual）→ 4 场景成本与 N 解耦。5 phase（Axis A 先行低风险，Axis B 读侧重构在后）。Q1-Q5 待定。 |

---

> **Note:** 本 PRD 是架构总纲：唯一新增 `trackLikes` 侧表 + `use-track` hook，其余改既有订阅/渲染形状，对齐既有 `trackPlaybackStats` 下沉范式与 TanStack Virtual。核心命题——**列表级查询永不读全量行内容**——是「任意队列长度都不掉帧」的充要条件。根因与 before 基线由 harness 实测得到，验收以扇出信号（`queue.live.fetch`/`listAllTracks requery`）与 N 解耦为准。
