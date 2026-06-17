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
| 3 | **Axis B-1**：列表级查询不再观察全量内容（一次性快照 + 当前曲单行订阅） | ✅ Completed（贵 liveQuery 删除→ `queue.live.fetch` 5→0；切歌 FPS 不回退） | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | **Axis B-2**：常驻挂载页的「全库索引派生」空闲时不随单曲写重建（冻结/防抖）；metadata 编辑不再扇出 | ✅ Completed（CPU profile 定位真凶=SearchPage+⌘F 全库索引；`useFrozenWhileInactive` → metadata fpsLow 4→60、longtask 1378→0ms） | [Phase 4 Checklist](#phase-4-checklist) |
| 5 | 全 4 场景 @5983 队列 harness 复测验收 + 播放 loop 完整性 | ✅ Completed（like 116fps／metadata 60fps／playback loop 切歌进位+在播，扇出全 0） | [Phase 5 Checklist](#phase-5-checklist) |
| 4b | **逐行 `useTrack(id)`**：队列 tab 编辑任一曲只重渲该行；切歌等原有操作性能不回退 | ✅ Completed（队列行单键 liveQuery；队列 metadata longtask 0、queue.live.fetch 0；切歌 now 56ms≈4b 前 53ms 不回退） | [Phase 4b Checklist](#phase-4b-checklist) |

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
**Goal:** 列表级查询不再观察全量行内容。
**Tasks:**
- [x] 贵 liveQuery 删除：`getTracksByIds(N)` 改为**一次性快照**（仅 entries STRUCTURE 变化时刷新，非订阅）。
- [x] 新增**当前曲单行订阅**（`liveQuery(getTrack(currentId))`，随游标 re-target）→ 编辑当前曲只 patch 该 slot，Now Playing 仍响应式；编辑非当前曲不触发任何列表级重取。
#### Phase 3 Checklist
- [x] **harness 验收（5983，metadata 编辑当前曲 ×5）before→after**：`queue.live.fetch` **5@385ms→0**、`dbRequeriesMax 45→20`、`longTaskTotal 1657→1391ms`。扇出（O(N) 重取）彻底消除。
- [x] 切歌不回退：pingpong ×8 @5983 `switchToFrame` avg 51ms / max 77ms、`queue.live.fetch 0`。
- [x] 单测：3 个 Axis B-1 integration test（当前曲编辑→单行 patch 响应式 ✓；非当前曲编辑→`queue` 引用不变=无重取 ✓；切歌后 re-target ✓）；player-store 全 22 绿；tsc 0。**附带修复**：旧 `queueSig` 不含 tags/note → 旧码编辑当前曲 tags 根本不 republish；单行订阅按内容 sig（含 tags/note）patch，反而修好了 Now Playing 对 tags/note 编辑的响应式。
- [ ] 残留：`set({queue})` 仍触发 Now Playing 当前曲重渲（`fpsLow` 仍 ~4.6）——**重取已 0，剩下的是「单次重渲太贵」**，由 Phase 4（窄订阅 + 重活按稳定 key memo）收口。

### Phase 4: Axis B-2 — 常驻挂载页的全库派生「空闲不重建」
**Goal:** 单曲 metadata 写不再扇出到全库索引重建（scenario 4 的真正瓶颈）。

> **CPU profile 改写了诊断**：Phase 3 把 `queue.live.fetch` 打到 0 后，metadata 编辑 fpsLow 仍 4.x。profile（`perf-profile metadata`）显示真凶**不在队列、也不在 now-playing 重渲**，而是：**所有 tab 页常驻挂载**（App `display:none` 不卸载，避免 remount jank）→ `SearchPage` + app-wide `⌘F GlobalTrackSearch` 各持 `listAllTracks` 全表订阅，**任一 track 写**就同步重建全库 `buildArtist/AlbumIndex` + `searchVariants` 转写（~240ms longtask）。这是与队列同构的「整表 liveQuery 扇出」，只是落在 search/库索引层。

**Tasks:**
- [x] 新 hook [`useFrozenWhileInactive(value, active, resyncMs?)`](../../../src/hooks/use-frozen-while-inactive.ts)：常驻挂载页保留 liveQuery 订阅（不 remount），但派生输入在「surface 非激活」时**冻结**（硬冻结）或**尾沿防抖 resync**（保温），单曲写不再触发 O(N) 重建。
- [x] `SearchPage`：`allTracks` 在 `tab!=="search"` 时**硬冻结**（切回该 tab 才重建，等同普通导航）。
- [x] `GlobalTrackSearch`：`allTracks` 在 `!open` 时**尾沿防抖**（2s 静默后 resync）——编辑突发合并成一次延后重建、保温供秒开；**不硬冻结**（实测硬冻结让冷开 ⌘F 首 query 阻塞 ~2s）。
#### Phase 4 Checklist
- [x] **harness `metadata` ×5 @5983（now tab）before→after**：`fpsLowMin 4.1→60.2`、`frameMaxMs 241→16.6`、`longTaskCount 9→0`、`longTaskTotalMs 1378→0`、`queue.live.fetch` 维持 0。overlay 预热后再测仍 `fpsLow 59.5 / longtask 0`（防抖把重建推到编辑停止之后）。
- [x] **无回退**：冷开 ⌘F @5983 `p50 612→763ms`（同量级，远好于硬冻结的 2029ms）；hook 单测 5 个（含尾沿防抖时序）。
- [x] 残留收口 → Phase 4b（队列 tab 编辑非当前曲的列表行响应式）。

### Phase 4b: 队列逐行 `useTrack(id)` 响应式读
**Goal:** 队列 tab 看列表时，编辑**任一曲**（含非当前曲）封面/标题/标签 → **只重渲该行**、不回到全表扇出；**切歌等原有操作性能不回退**（用户硬约束）。

> B-1 后 `state.queue` 是一次性快照（只随结构变化刷新）+ 当前曲单行订阅。非当前曲内容写不再更新快照 → 队列行内容滞后。Phase 4b 用**逐行单键 liveQuery**（`db.tracks.get(id)`，Dexie 只观察该 key → 写别的曲不 re-fire）跟随虚拟窗口，与 TanStack Virtual 同构：只有可见行有订阅，编辑某曲只该行 re-fire。

**Tasks:**
- [x] 新 hook [`useTrack(id?)`](../../../src/hooks/use-track.ts)：单行 liveQuery（id 缺省=不订阅）。单测 3 个（含「编辑别的曲不 re-fire」单键观察证明）。
- [x] `VirtualTrackList` 抽出 `VirtualTrackRow`（行内调 `useTrack`），加 opt-in `reactiveRowContent`；**两个队列面** [`queue-panel`](../../../src/components/player/queue-panel.tsx)（dock 抽屉/Now Playing 侧栏）+ [`queue-page`](../../../src/pages/queue-page.tsx)（队列 tab）开，gallery（`track-list-section`）不开。`TrackRow` 既有 `memo(track===)` → 只重渲内容变的行；`live ?? baseTrack` 快照兜底无闪烁。
- [x] 顺带修 Axis A 遗留 bug：`onToggleLike` 读冷 catalog `track.liked`（v26 停写=陈旧）→ 新 `toggleTrackLike` 读侧表（`isTrackLiked` 翻转）。
#### Phase 4b Checklist
- [x] harness 队列 tab `metadata` ×5 @5983：`queue.live.fetch=0`、`longTaskTotalMs=0`、`fpsLowMin 39.8`（frameMax 25ms，无 hitch；行经 `useTrack` 单键刷新）。
- [x] **切歌不回退**（用户硬约束）：now tab pingpong ×8 @5983 `switchToFrame avg 56ms ≈ 4b 前 53ms`（噪声内）；逐行订阅只在「该 track 行写」时 re-fire，**不进切歌（游标写）路径**，逻辑上与 switch 解耦。queue tab switch 61ms = 队列列表渲染本身（非 per-row 订阅）。
- [x] gallery 不回退：未开 `reactiveRowContent` → `useTrack(undefined)` 不订阅、行为不变。tsc 0、35 单测绿（use-track 3 + frozen 5 + queue-panel + player-store 22…）。

### Phase 5: 全场景 @5983 验收
#### Phase 5 Checklist
- [x] **4 场景 @5983 harness 复测（now tab）**：
  | 场景 | before fpsLow | after fpsLow | queue.live.fetch | longtask |
  |---|---|---|---|---|
  | 2 红心 like ×5 | 3.7 | **116** | 5→**0** | 2231→**0** |
  | 4 metadata ×5 | 4.1 | **60** | 5→**0** | 1378→**0** |
  | 3 playback counted ×3 | — | 12（=切歌封面成本） | **0** | 354（切歌） |
  成本与 N 解耦：扇出信号全 0，剩余 fpsLow 仅来自切歌封面解码（属 switch-fps PRD）。
- [x] **播放 loop 完整性**（用户「完整化整个 loop」诉求）：switch ×6 @5983 → `currentIndex 0→6`、`isPlaying:true`、`queue.live.fetch 0`、`switchToFrame avg 53ms`；player-store 全 22 单测绿（含 3 个 B-1 integration test）。
- [x] CDP profile 确认：metadata 写路径已无 `buildArtist/AlbumIndex`/`searchVariants` longtask（冻结生效）。
- [ ] 场景 1（歌单增删歌）未单独建 harness scenario：结构变 → 一次性有界 refetch（非订阅扇出），已在 B-1 覆盖；按需补 `playlistEdit` scenario。
- [ ] **残留（Phase 4b 可选）**：队列 tab 看列表时编辑**非当前曲**封面/标题，行内容要到队列结构变化才刷新（B-1 快照不再随内容写）。逐行 `useTrack(id)` 可收口，但触碰共享 `VirtualTrackList`（队列+gallery 共用），风险/收益待评估。

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
| 2026-06-17 | DoodleBear（TDD 实现）| **Phase 4b ✅ 队列逐行 `useTrack(id)`**：B-1 后 `state.queue` 快照不再随非当前曲内容写刷新 → 队列 tab 行内容滞后。新 `useTrack(id?)`（单键 `db.tracks.get(id)` liveQuery，写别的曲不 re-fire）+ `VirtualTrackList` 抽 `VirtualTrackRow`（opt-in `reactiveRowContent`，两个队列面开、gallery 不开）→ 编辑任一曲只重渲该行、无全表扇出。顺带修 Axis A bug：`onToggleLike` 读冷 catalog `track.liked`（停写后陈旧）→ 改读侧表翻转。**harness @5983**：队列 metadata `queue.live.fetch 0 / longtask 0`；切歌不回退（now 56ms≈53ms，逐行订阅不进游标路径）。use-track 3 + 全套 35 单测绿、tsc 0。 |
| 2026-06-17 | DoodleBear（TDD 实现）| **Phase 3/4/5 ✅ 落地 + harness 全验收**（分支 `perf/scalable-track-list-reactivity`，commit `3f747aa`/`d0eb399`）。**B-1（3f747aa）**：列表级查询不再观察全量内容——贵 liveQuery `getTracksByIds(N)` 改一次性快照（仅 STRUCTURE 变化刷新）+ 当前曲单行订阅（随游标 re-target、按内容 sig patch）→ metadata 编辑 `queue.live.fetch 5→0`；附带修好 Now Playing 对 tags/note 编辑的响应式（旧 queueSig 不含 tags）。**B-2（d0eb399）**：CPU profile 定位 metadata 剩余掉帧真凶=**常驻挂载页**（App `display:none` 不卸载）SearchPage+⌘F 各持 `listAllTracks` 全表订阅、任一写就重建全库 `buildArtist/AlbumIndex`+`searchVariants`(~240ms longtask)——新 `useFrozenWhileInactive`（SearchPage 非激活硬冻结／⌘F 非开尾沿防抖 2s 保温）→ metadata **fpsLow 4→60、longtask 1378→0**、冷开 ⌘F 无回退（612→763ms，远好于硬冻结的 2029ms）。**Phase 5**：like 116fps、metadata 60fps、playback loop 切歌进位+在播、扇出全 0；player-store 22 + hook 5 + B-1 3 个 integration test 全绿。残留：队列 tab 编辑非当前曲的列表行响应式（Phase 4b 可选，触碰共享 VirtualTrackList）。 |
| 2026-06-17 | DoodleBear（TDD 实现）| **Phase 2 Axis A ✅ 落地 + harness 验收**（分支 `perf/scalable-track-list-reactivity`）：`liked` 下沉 `trackLikes` 侧表（v26 + 一次性 `.upgrade` 回填，纯 mapper 单测）；`setTrackLiked` 只写侧表、不碰 `tracks`；读取方全迁（favorite 单行订阅 / track-row `useLikedTrackIds` 仅可见行 / `system:liked` + liked-only 过滤 + dj-chat join 侧表）；删死代码 `incrementPlayCount`。**5983 队列实测 like ×5：`queue.live.fetch` 5@357ms→0、`listAllTracks requery` ×5→无、`fpsLow` 3.7→117.6、`longtask` 2231→0ms** —— QA 报的 Now Playing 点 Like 掉帧彻底消除。单测全绿、tsc 0、biome 绿。Axis B（order/content 解耦）待后续 phase。 |
| 2026-06-17 | DoodleBear | 初稿：用户指出「任意队列长度都应 handle，现设计非 best practice」。排查 4 写场景（增删/红心/播放/改 metadata）→ 锁定**架构反模式 = 队列把全量行内容作为一个 liveQuery 观察**（`getTracksByIds(N)` 物化+观察全部 N），任一写 re-fire 全量重取（实测 @5983：357ms×5 + 全表 requery、fpsLow 3.7、longtask 2231ms）。提出**两轴最佳实践**：Axis A 高频字段下沉侧表（catalog 零高频写，统辖 like/playCount 两战术 PRD）；Axis B order/content 解耦（store 持 id 列表 + 逐行/窗口 `useTrack(id)` 响应式读，对齐 TanStack Virtual）→ 4 场景成本与 N 解耦。5 phase（Axis A 先行低风险，Axis B 读侧重构在后）。Q1-Q5 待定。 |

---

> **Note:** 本 PRD 是架构总纲：唯一新增 `trackLikes` 侧表 + `use-track` hook，其余改既有订阅/渲染形状，对齐既有 `trackPlaybackStats` 下沉范式与 TanStack Virtual。核心命题——**列表级查询永不读全量行内容**——是「任意队列长度都不掉帧」的充要条件。根因与 before 基线由 harness 实测得到，验收以扇出信号（`queue.live.fetch`/`listAllTracks requery`）与 N 解耦为准。
