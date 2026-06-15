# PRD: 切歌掉帧 @ 大队列（Switch-Song FPS on Large Queue）

**Status:** Draft
**Created:** 2026-06-15
**Author:** User + Claude
**Module:** player-store（播放队列编排）/ cover 预载管线 / synced-lyrics（级联动画）/ dev-perf HUD

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | 观测先行：longtask 归因 + HUD 子分类耗时分解 | ✅ Completed | [Phase 1](#phase-1-观测先行) |
| 2 | queue liveQuery 全量重取（getTracksByIds O(n)）消除 | 🔄 待 QA | [Phase 2](#phase-2-queue-livequery-全量重取消除) |
| 3 | 空闲 rAF 归零（lyrics cascade settle-then-park） | ✅ Completed | [Phase 3](#phase-3-空闲-raf-归零) |
| 4 | 切歌封面管线峰值（preload.batch / decode / load）削峰 | 🔲 Pending | [Phase 4](#phase-4-切歌封面管线削峰) |
| 5 | 验收：大队列连切 before/after | 🔲 Pending | [Phase 5](#phase-5-验收) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

在 Tab 1（Now Playing）快速/慢速切歌时掉帧、"顿一下"。复现环境关键变量：**当前播放队列 5983 首（上传本地文件）**。昨日同类排查的队列只有 22 首、只偶发一次卡顿；今天 5983 首时**每次切歌都卡 50–150ms**，连切时 fpsAvg 从 71 一路塌到 28。用户判断"似乎有 regression"。

本 PRD 遵循 [prd-create.md §4 性能/卡顿类附加要求](../../../.cursor/commands/prd-create.md)：**先把测量方法学落地（Phase 1 已 ship），用真实快照字段证伪"显而易见的嫌疑"，再做优化**——而不是凭感觉调参。

### 1.2 症状测量（已证伪 / 已坐实）

Phase 1 给 dev-perf HUD 加了 **per-longtask 归因** + **per-`notePerfWork` 子分类耗时分解**后，用两份对照 log（fast-switch / slow-switch）+ HUD 实测，得到：

| 嫌疑 | 字段证据 | 结论 |
|------|----------|------|
| GC 暂停 | `culprit:self` 恒定；卡顿连发时 heap **仍在爬**（不是每次卡顿就掉） | **证伪为主因**：GC 只是分配压力的副产品（偶尔大回落），不是每次切歌的 50–150ms |
| blob churn（object URL 泄漏/翻搅） | fast-switch `blobsLive image` **恒定 138**、`blobsCreated` 恒定 → 卡顿照旧 | **证伪**：不是 blob 数量驱动 |
| `queueSig` O(n) 字符串构建 | HUD `queue.live.process` = **max 7ms** | **次要**：比预想便宜得多（~7ms） |
| `getTracksByIds(5983)` 全量重取 | HUD `queue.live.fetch` = **max 275ms**，且 **≈ `jank/longtask max 285ms`** | **坐实为主线程头号阻塞**：liveQuery 一重跑就从 IndexedDB 把整条 5983 队列重读 + 反序列化进 JS 回调；其 wall-clock 几乎等于真实长任务 |
| 切歌封面管线 | `cover.preload.batch` **max 836ms ×21** / `image.load` **max 189ms** / `image.decode` **max 89ms** | **重，但多为 off-main wall-clock**：836ms 是跨多张异步解码的墙钟，**不是**一次 836ms 主线程 block；仍需削峰（Phase 4） |
| 背景 `<img>` 隐形解码 | `image.load` **371ms** / `image.decode` **242ms**（`surface=background` 800×800 `muzfetch`）；但该帧渲染的是 **Pixi**，plain `<img>` 分支与 Pixi **互斥、不上屏** | **坐实（隐形浪费）**：Pixi 渲染时 `useLoadedImageUrl(decode:true)` 仍把全图解进一个**永不绘制**的 `<img>`，且 Pixi 又**独立** `createImageBitmap` 同一 URL → **同图解码两次，其一纯浪费**（Phase 4 新增项） |
| 空闲 rAF 空转 | `lyrics.cascade.frame` **×56026（仍在涨）** / `lyrics.wordFill.paint`，且**没放歌时 count 仍持续增长** | **坐实（独立浪费）**：级联/逐字动画的 rAF 不以 `isPlaying` 为门，空闲也每帧空转 |

> **方法学校正（重要）**：`notePerfWork` 的 span 是 **wall-clock**（包住 `await`，含异步解码 / IDB 等待），**不等于主线程阻塞时长**。真正的主线程卡死以 **`jank`（longtask）** 为准。据此：`queue.live.fetch 275ms ≈ jank 285ms` → 基本就是主线程（Phase 2 头号）；`cover.preload.batch 836ms` 是异步 wall-clock，削峰仍做但非单次 block。
>
> **关键纠偏**：Phase 1 的子分类分解推翻了"queueSig 是元凶"的初判——真正最贵的是 `getTracksByIds` 的 **IndexedDB 全量重取 + 反序列化（~275ms，≈ 真实长任务）**。这正是"观测先行、用字段证伪直觉"的价值。

### 1.3 Core Value

1. **大库可用**：5983+ 队列下切歌不再每次卡 50–150ms；连切 fps 不塌。
2. **不回退既有不变量**：gc-closure / background-perf 既有的 no-remount / 不串歌 / 不闪 基线不动。
3. **真正空闲归零**：暂停/不播放时不再有 rAF 空转（省电、让主线程 idle）。
4. **可复测**：HUD 子分类分解成为长期 before/after ground truth。

---

## 2. 根因与架构

### 2.1 主线程每次切歌的工作来源

```
playIndex(index)                       ← O(1) 同步：clamp + set(cursorPatch) + 持久化(debounced 900ms)
  └─ set(cursorPatch) ─▶ React 重渲染订阅 currentIndex 的组件（windowed 列表 = O(visible)）
持久化游标 / track 行写入 / palette 回填 / session 变化
  └─▶ Dexie liveQuery 重跑（player-store.ts:625）
        ├─ getPlayQueue()
        ├─ getTracksByIds( pq.entries.map(e=>e.trackId) )   ← ❶ O(n) 从 IDB 重读全部 5983 行 = 192ms
        └─ next(): queueSig(5983)(~7ms) + patch；!changed 早退（但已付完 ❶）
切歌封面管线（每次切歌）
  ├─ cover.preload.batch    ← ❷ max 237ms
  ├─ image.load / image.decode ← ❸ 106 / 128ms（pixi 路径还会隐形解码一张不上屏的全图 = ❸b §2.5）
空闲 rAF（与切歌无关，但一直空转）
  ├─ lyrics.cascade.frame   ← ❹ ×2324，无 isPlaying 门
  └─ lyrics.wordFill.paint  ← ❹ ×1166
```

### 2.2 ❶ queue liveQuery 全量重取（Phase 2 主攻）

[`player-store.ts:625`](../../../src/stores/player-store.ts#L625) 的 `liveQuery` 读了 `playQueue` / `tracks` / `sessions` 三张表，**只要任一张变动就整段重跑**，每次都 `getTracksByIds(5983)` 把整条队列从 IndexedDB 重新读取 + 反序列化成 5983 个 Track 对象（→ heap 垃圾 + 主线程）。

**copy-trace 实锤触发源 = 游标持久化（debounced 900ms）**：`queue.live.fetch` 恒在每次切歌**约 900ms 之后**触发（switch@32.133 → fetch@33.198；switch@33.206 → fetch@34.281），正好等于 `QUEUE_CURSOR_PERSIST_DEBOUNCE_MS = 900`。即 `persistQueueIndex` 把 `currentIndex` 写回 `playQueue` 行 → liveQuery 重跑 → 全量重取。同帧 `queue.live.process` 记 `changed:false / listChanged:false`——**列表根本没变，却付了 133–499ms 全量重取**。

**问题本质**：游标（`currentIndex`，高频变）与队列列表（`entries`+track 行，低频变）**同处一个 liveQuery 的观察集**，游标写也触发整条 track 列表重取。**修法（无需 schema）**：拆成两路——cheap 订阅观察 `playQueue`（entries ids/cursor/contextSetId），expensive 订阅 `getTracksByIds(ids)` 只观察 `tracks` 表、且 ids 由前者以 JS 值喂入（不读 playQueue）→ 游标写不再 re-fire track 重取；改封面（写 tracks 行）仍能 re-fire（不回退"改封面即刷新"）。

**两类成本要分开看（trace 证）**：切歌**当下** ~105ms longtask = `set(cursorPatch)` 的 React 重渲染 + `mediaSession.metadata` ~61ms + 背景 `<img>` 双重解码 130/59ms（§2.5，Phase 4）；切歌**后 ~900ms** 的 `queue.live.fetch` = 游标 re-fire 全量重取（Phase 2）。

### 2.3 ❹ 空闲 rAF（Phase 3）

[`synced-lyrics-view.tsx:541`](../../../src/components/player/synced-lyrics-view.tsx#L541) 的级联 rAF 门控是 `cascadeDriverActive = isAmlStyleEngine && following && !suspendMotion`，**不含 `isPlaying`**。`following` 默认 `true`，故 AMLL 引擎下歌词面板一挂、未手动滚动、未 reduced-motion，rAF 就每帧空转（`getCurrentTime` / `activeLineIndex` / `solveLyricLayout` / 弹簧步进），即使暂停、弹簧早已 settle。`lyrics.wordFill.paint`（逐字填充）同类。单帧成本小（~0.2ms），但**永不 idle**=持续占帧、吃 CPU、费电。

### 2.4 ❷❸ 封面管线峰值（Phase 4）

`cover.preload.batch` 单次 max 237ms、`image.decode` max 128ms、`image.load` max 106ms。连切时每次切歌的 50–150ms 卡顿主要落在这里。需确认：是否 main-thread decode（应走 `createImageBitmap` off-thread）、连切是否该 defer/throttle 非当前封面、preload batch 是否在 burst 中做了无用功（被下一次切换 abort 前已付出解码）。

### 2.5 ❸b 背景 `<img>` 隐形 + 冗余解码（Phase 4 新增，**已坐实**）

切歌 log 里出现 `image.load 371ms` + `image.decode 242ms`（`surface=background`、800×800、`muzfetch`）。溯源到 [`now-playing-background.tsx:240`](../../../src/components/player/now-playing-background.tsx#L240) 的 `useLoadedImageUrl(coverBackgroundLoadUrl, { decode:true, trace:{surface:"background"} })`——它**无条件挂载**，会把整张全分辨率封面 load 进一个 `<img>` 并 `image.decode()`，**仅为产出一个"已就绪"的 `displayUrl` 门控**。

但渲染分支是**互斥的** ternary（[:434-473](../../../src/components/player/now-playing-background.tsx#L434-L473)）：plain `<img>`（`CrossfadeBackgroundImage`）只在 `!pixiEffect` 分支上屏。**Pixi 在渲染时，这张 `<img>` 永不绘制**。于是出现双重浪费：

1. **隐形**：解码出的 800×800 `<img>` 不上屏（Pixi 才是可见层）。
2. **冗余**：此路径下 `pixiCoverUrl = backgroundUrl`，**Pixi 又会用自己的 `createImageBitmap`（降采样到 1024、off-thread）把同一 URL 再加载一遍** → 同图解码两次，`<img>` 那次纯浪费且发生在切歌帧。

**已对的部分（不动）**：标准「Pixi + 封面 + 有 `coverBlobId`」路径，[:185](../../../src/components/player/now-playing-background.tsx#L185) `coverBackgroundLoadUrl = shouldUsePixiCoverDerivative ? null : backgroundCoverUrl` 已把 URL 置 `null` → 不解码、Pixi 走 192px backlight 派生。**浪费只发生在 `pixiEffect` 开、但未走 derivative 的路径**（无 `coverBlobId` / `pixiMedia.source` 非 cover / 切歌过渡态），此时 `coverBackgroundLoadUrl = backgroundCoverUrl`（全图）→ 隐形+冗余解码。

**修法（已选 = 更彻底的方案 2）**：`pixiEffect` 活跃时，**让 Pixi 直接吃 `backgroundCoverUrl`，整段绕过 `useLoadedImageUrl`**——`<img>` 的 decode 门控只为 plain 路径存在，Pixi 自带 load+decode 生命周期，不需要这层门控。这样既去掉隐形解码、又去掉二次加载（Pixi 仍拿到 URL，自己 off-thread 解码 + 降采样）。
- 次选（最小改动）：`useLoadedImageUrl(..., { decode: pixiEffect ? false : true })`——保留 hook 但跳过 `image.decode()`，仅解析 URL；blur/none（真绘制 `<img>`）保留 `decode:true`。方案 2 更优，因为它连「load 整张全图进 `<img>`」本身都省了。
- **不能删 plain `<img>` 路径**：`blur` / `none` renderer 仍以它为可见背景。本项只在 `pixiEffect` 时绕过，不影响非 Pixi 模式。

---

## 3. Data Model

不改 schema。`muzero-db` / 表名 / id 前缀不动（硬规则 4）。Phase 2 可能调整 `playQueue` 游标的**订阅/读取方式**（把"游标"与"列表"拆成两路 liveQuery，或游标走非 liveQuery 读），但**不改存储结构**。

---

## 4. 测量方法学（Phase 1 已落地）

遵循 §4：必须测**呈现帧节奏 + 长任务**，而非只测某段渲染耗时。

- **frame cadence**：dev-perf HUD 的全局 rAF delta（`fpsAvg` / `fpsLow` / `frame p99` / `frame max`）。
- **Long Tasks**：`PerformanceObserver(["longtask"])` —— Phase 1 把**每一次 ≥50ms 停顿**单独打成 `[performance.longtask]`（duration + `culprit` 帧归因 + `attribution` + 观测时 `heapMb`），可在 trace ring 里和 `playIndex`/`textureSwap`/heap 对齐。
- **子分类耗时分解**：`notePerfWork` 增加**按 name 的生命周期累加器**，HUD 渲染 `work · last / max / count`（top 14，按 max 降序）。这是把"一个总 jank 值"拆成"哪类计算各花多少"的关键，直接坐实了 ❶❷❸❹。
- **复测纪律**：prod build 复测、第二次循环（首次 warmup 上涨预期）；连切与慢切两组对照。

---

## 5. Implementation Plan

### Phase 1: 观测先行

**Goal:** 把症状变得可见、可归因、可 before/after。**已 ship。**

**Checklist:**
- [x] per-longtask 归因 trace（`8713c8b`：`[performance.longtask]` duration/culprit/attribution/heap）
- [x] `queue.live.fetch` / `queue.live.process` 探针（`27bba3c`）
- [x] HUD 子分类耗时分解 `readPerfWork()` + `work · last/max/count`（`63772ae`）
- [x] 双对照 log（fast / slow switch）采集 + HUD 实测截图

### Phase 2: queue liveQuery 全量重取消除

**Goal:** 切歌（及游标/单行写入）不再 `getTracksByIds(5983)` 全量重取整条队列。

**Tasks / Checklist:**
- [x] **拆订阅（已落地，无 schema）**：`player-store.ts` 把单一 liveQuery 拆成 ① cheap `playQueue`(+session) 订阅（entries/cursor/session，不 materialize）② expensive `getTracksByIds(ids)` 订阅（只观察当前 entries 的 track 行）。`queueEntriesKey(ids)` 廉价 hash 判定 entries 结构是否变；**仅结构变才重订阅 tracks**，游标写只 `processQueueUpdate()` 复用缓存队列（零 refetch）。改封面（写 tracks 行）仍 re-fire tracks 订阅 → 不回退"改封面即刷新"。
- [x] 单测：`queueEntriesKey` 纯函数（游标 move 同 ids→同 key；reorder/append/prepend/length→变 key）；player-store 18 例（含 cursor persist / coalesce）全绿，行为不回退。
- [ ] **HUD 复测**：连切时 `queue.live.fetch` 的 `count` **不随每次切歌增长**、`max` 不再 100–499ms（仅在真正改列表/改封面时才出现）。
- [ ] QA：队列列表正常加载/排序；切歌 currentIndex 正确；改封面/注释后列表与背景仍即时刷新；DJ 续歌 append 后队列增长正常；boot 恢复游标正常。
- 实现：`player-store.ts`（`queueEntriesKey` + `processQueueUpdate` + `subscribeTracks` 双订阅）。typecheck + player-store 19 / dj-engine+queue 46 例绿。

### Phase 3: 空闲 rAF 归零

**Goal:** 暂停/不播放且动画 settle 时停掉 rAF，事件唤醒。

**Tasks / Checklist:**
- [x] cascade rAF：`isPlaying`(via ref) 为假**且所有弹簧 settle**（`anyMotion=false`）→ 停止 re-arm rAF；`cascadeWakeRef` 在 `isPlaying`↑ / `activeIndex` 变（seek/换行）唤醒；resize / 歌词行 / following(手动滚动) 经 effect deps 重挂自然重启。
- [x] `lyrics.wordFill.paint` **已自带 `isPlaying` 门**（其 effect `if (!isPlaying) return;` + deps 含 isPlaying，暂停即 cleanup 取消 rAF）→ 无需改；×1166 是播放期累计，非空转。
- [ ] HUD 复测：暂停后 `lyrics.cascade.frame` 的 `count` **不再增长**。
- [ ] QA（真实放歌）：播放中级联正常、暂停停止空转、恢复/seek/点歌词跳转立即跟上、reduced-motion(`suspendMotion`) 仍正确。
- 实现：`synced-lyrics-view.tsx`（`isPlayingRef` / `cascadeIdleRef` / `cascadeWakeRef` + 每帧 `anyMotion` + park-or-rearm + wake effect）。typecheck + 34 lyrics 例绿。

### Phase 4: 切歌封面管线削峰

**Goal:** 切歌时封面 preload/decode/load 不再产生 100–237ms 主线程峰值。

**Tasks / Checklist:**
- [ ] 定位 `cover.preload.batch` 237ms 的成因（main-thread crop/decode？大图？），确保解码走 `createImageBitmap` off-thread。
- [ ] 连切 burst 中 defer/skip 非当前封面的 preload（复用既有 burst-skip 思路），避免被 abort 前已付解码。
- [ ] **❸b 背景 `<img>` 隐形 + 冗余解码消除（§2.5，已选方案 2）**：`pixiEffect` 活跃时让 Pixi 直接吃 `backgroundCoverUrl`、**整段绕过 `useLoadedImageUrl`**（`<img>` decode 门控只服务 plain 路径）。消除「解码永不上屏的全图」+「同图被 Pixi 二次加载」。
  - [ ] 保留 plain `<img>`/blur/none 路径不变（仍需 `decode:true` 门控）；仅在 Pixi 渲染时绕过。
  - [ ] 确认标准 pixi+封面（有 `coverBlobId`）路径仍由 [:185](../../../src/components/player/now-playing-background.tsx#L185) `coverBackgroundLoadUrl = null` 跳过（不回退）。
  - [ ] 不回退防闪/不串歌：Pixi 拿不到 URL 时维持既有 hold-previous / `waitForLocalCoverUrl` 语义。
- [ ] HUD 复测：连切时 `cover.preload.batch` / `image.decode` 的 `max` 显著下降；**Pixi 模式下 `image.decode`/`image.load`（surface=background）不再出现**（仅 blur/none 模式才有）。

### Phase 5: 验收

**Checklist:**
- [ ] 5983 队列**连切 ×10**：fpsAvg 不塌到 30 以下、无 100ms+ longtask；与 Phase 1 基线 before/after 对比。
- [ ] 慢切：无 50ms+ 每切固定卡顿。
- [ ] 不回退 gc-closure / background-perf 的 no-remount / 不串歌 / 不闪。
- [ ] 暂停态主线程真正 idle（HUD work count 静止）。

---

## 6. Out of Scope

- **背景帧控制器 / Transition Driver（blur 路径）**：本次 log 是 Pixi 背景 + 按钮/键盘连切，未走该路径；其优化在 `20260615-muzero-background-frame-controller-prd`。
- **codename 层 / DB schema / 网络**：冻结（硬规则 4）。
- **search-index 性能**：见 `20260615-muzero-global-search-index-performance-prd`（独立）。
- **新 renderer / 新设置项**：不在内。
- **runtime kill-switch / hidden flag**：禁止（硬规则 3）；回退 = `git revert` + redeploy。

---

## 7. Related Documents

| Document | Description |
|----------|-------------|
| [now-playing-switch-gc-closure-prd](../20260615-muzero-now-playing-switch-gc-closure-prd/) | 切歌 GC / 防闪不变量来源；本 PRD 不回退其基线 |
| [now-playing-switch-background-perf-prd](../20260613-muzero-now-playing-switch-background-perf-prd/) | 单时钟 / 防闪 QA / longtask 指标先例 |
| [global-search-index-performance-prd](../20260615-muzero-global-search-index-performance-prd/) | 同期大库性能（搜索倒排），相邻但独立 |
| [prd-create.md §4](../../../.cursor/commands/prd-create.md) | 性能/卡顿类 PRD 方法学（观测先行、字段证伪、frame cadence + longtask） |

---

## 8. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | 连切时 `queue.live.fetch` 究竟每次切歌触发几次？ | ✅ Resolved（burst HUD） | **burst 态 ×11、max 499ms**（calm 态仅 ×2-3）→ **纠正"游标 debounced 所以不会每切触发"的判断**：连切时它近乎每切都打，且 499ms 灾难级。触发不止游标——**每切的 track 行写入（palette 回填 / 播放计数）也会重新 fire** 整条队列重取。Phase 2 升为头号。 |
| 2 | 游标"拆订阅"的实现路径：双 liveQuery vs 游标走 store 不入 liveQuery vs id→Track 复用 | Open | 倾向"列表 liveQuery 只观察结构 + id→Track 复用"，Phase 2 评估 |
| 3 | Phase 优先级 | ✅ Resolved（HUD #2 校正） | `queue.live.fetch 275ms ≈ jank 285ms` 确认 **Phase 2 是主线程头号**；封面 836ms 多为 off-main wall-clock。顺序：**Phase 2 零风险先手（`!changed` 早退）→ Phase 3（独立低风险，肉眼可验 count 归零）→ Phase 2 拆订阅 → Phase 4 封面削峰** |
| 4 | 是否确有 regression（vs 仅是大库放大的固有 O(n)）？ | Open | 需同一 5983 库的旧版本对照；当前证据足以"无论是否 regression 都该修" |

---

## 9. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-15 | User + Claude | 初稿。Phase 1 观测（longtask 归因 + HUD 子分类分解）**已 ship**（`8713c8b`/`27bba3c`/`63772ae`），用其证据坐实根因：❶ `getTracksByIds(5983)` 全量重取 192ms（最贵）❷❸ 封面管线 preload/decode/load 100–237ms（每切都中）❹ lyrics rAF 空闲空转。Phase 2–5 待评审拍板优先级（Open Q3）。**未动优化代码。** |
| 2026-06-15 | User + Claude | **Phase 2 落地（待 QA）**：按 trace 实锤的"游标 re-fire 全量重取"，把单一 queue liveQuery **拆成两路（无 schema）**——cheap `playQueue`(+session) + expensive `getTracksByIds(ids)`（只观察 tracks 行），`queueEntriesKey` 廉价 hash 判定结构变更，仅结构变才重订阅 tracks；游标写只复用缓存队列、零 refetch；改封面仍 re-fire tracks 订阅（不回退）。新增 `queueEntriesKey` 纯函数单测；player-store 19 / dj-engine+queue 46 例全绿。 |
| 2026-06-15 | User + Claude | **Phase 3 QA 通过 ✅**（暂停后 `lyrics.cascade.frame` count 停止增长、播放正常、恢复/seek 跟上）。**Burst HUD 截图**坐实 **`queue.live.fetch` burst 态 ×11 / max 499ms**（calm 仅 ×2-3）→ 纠正"游标 debounced 不会每切触发"：连切时 track 行写入（palette/计数）也重新 fire 全量重取，近乎每切都中。**Phase 2 升为头号**（Open Q1/Q3 据此更新）。其余 burst per-switch：`cover.preload.batch` ×50(258ms wall-clock)、`mediaSession.metadata` ×14(74ms)、`image.load/decode` 121/138ms。 |
| 2026-06-15 | User + Claude | **新分支 `perf/switch-song-large-queue-fps`。Phase 3 落地（待 QA）**：cascade rAF 改为「暂停且弹簧 settle 即 park、resume/seek 唤醒」，`lyrics.cascade.frame` 空闲不再空转（QA：count 从 ×56026 一路涨）。`wordFill` 经核已自带 isPlaying 门，无需改。重排优先级澄清：原"Phase 2 `!changed` 早退"对 7ms 的 queueSig 无效——真正 275ms 在 `getTracksByIds`（async fn，早退够不着），故 Phase 3 先行。 |
| 2026-06-15 | User + Claude | HUD #2（calm 态）校正数据：`queue.live.fetch` max **275ms ≈ jank 285ms**、`cover.preload.batch` max **836ms（×21，但 wall-clock 异步）**、`image.load` 189ms、`lyrics.cascade.frame` **×56026 仍涨**。新增**方法学校正**：`notePerfWork` span 是 wall-clock（含 await），主线程真值看 longtask。据此 **Open Q3 拍板**：Phase 2 为主线程头号，顺序 Phase 2 零风险先手 → Phase 3 → Phase 2 拆订阅 → Phase 4。 |
| 2026-06-15 | User + Claude | **Phase 4 新增 ❸b（§2.5）**：溯源 `image.load 371ms`/`image.decode 242ms`（surface=background 800×800）到 [`now-playing-background.tsx:240`](../../../src/components/player/now-playing-background.tsx#L240) `useLoadedImageUrl(decode:true)`——Pixi 渲染时 plain `<img>` 分支互斥不上屏，却仍把全图解进一个永不绘制的 `<img>`，且 Pixi 又独立 `createImageBitmap` 同一 URL = **同图解码两次、其一隐形浪费**。标准 pixi+封面路径已由 :185 `coverBackgroundLoadUrl=null` 跳过；浪费仅在「pixiEffect 开但未走 derivative」路径。**采用方案 2（更彻底）**：pixiEffect 时 Pixi 直接吃 `backgroundCoverUrl`、绕过 `useLoadedImageUrl`；plain/blur/none 路径不变。**未动代码**。 |

---

> **Note:** 本 PRD 强调"修改既有代码、观测先行、用字段证伪直觉"，不新建后端、不藏 flag、回退走 `git revert`。
