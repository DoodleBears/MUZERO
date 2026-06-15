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
| 2 | queue liveQuery 全量重取（getTracksByIds O(n)）消除 | 🔲 Pending | [Phase 2](#phase-2-queue-livequery-全量重取消除) |
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
  ├─ image.load / image.decode ← ❸ 106 / 128ms
空闲 rAF（与切歌无关，但一直空转）
  ├─ lyrics.cascade.frame   ← ❹ ×2324，无 isPlaying 门
  └─ lyrics.wordFill.paint  ← ❹ ×1166
```

### 2.2 ❶ queue liveQuery 全量重取（Phase 2 主攻）

[`player-store.ts:625`](../../../src/stores/player-store.ts#L625) 的 `liveQuery` 读了 `playQueue` / `tracks` / `sessions` 三张表，**只要任一张变动就整段重跑**，每次都 `getTracksByIds(5983)` 把整条队列从 IndexedDB 重新读取 + 反序列化成 5983 个 Track 对象（→ heap 垃圾 + 192ms 主线程）。触发源包括：游标持久化（debounced）、某条 track 行写入（如 `cover.palette.settle` 回填 `coverPalette`、播放计数）、context session 变化。**问题本质**：渲染列表只在 `listChanged` 时才需要重建，但当前实现对"非列表变化"的 fire 也付了全量重取的代价。

### 2.3 ❹ 空闲 rAF（Phase 3）

[`synced-lyrics-view.tsx:541`](../../../src/components/player/synced-lyrics-view.tsx#L541) 的级联 rAF 门控是 `cascadeDriverActive = isAmlStyleEngine && following && !suspendMotion`，**不含 `isPlaying`**。`following` 默认 `true`，故 AMLL 引擎下歌词面板一挂、未手动滚动、未 reduced-motion，rAF 就每帧空转（`getCurrentTime` / `activeLineIndex` / `solveLyricLayout` / 弹簧步进），即使暂停、弹簧早已 settle。`lyrics.wordFill.paint`（逐字填充）同类。单帧成本小（~0.2ms），但**永不 idle**=持续占帧、吃 CPU、费电。

### 2.4 ❷❸ 封面管线峰值（Phase 4）

`cover.preload.batch` 单次 max 237ms、`image.decode` max 128ms、`image.load` max 106ms。连切时每次切歌的 50–150ms 卡顿主要落在这里。需确认：是否 main-thread decode（应走 `createImageBitmap` off-thread）、连切是否该 defer/throttle 非当前封面、preload batch 是否在 burst 中做了无用功（被下一次切换 abort 前已付出解码）。

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
- [ ] **零风险先手**：`!changed` 早退提前到 `queueSig` 之前（列表没变就不白算 sig）。语义不变。
- [ ] **拆订阅**：把"游标（currentIndex）"与"队列列表（tracks）"拆成两路——游标持久化**不应**触发列表 liveQuery 全量重取；列表只在 `playQueue.entries` 结构变化时重取。
- [ ] **避免无谓 refetch**：单条 track 行写入（palette 回填 / 播放计数）尽量**增量更新**对应 Track，而非整条 `getTracksByIds` 重读；或对 liveQuery 结果做 id→Track 复用（结构未变时复用旧对象，减少 5983 次反序列化 + GC）。
- [ ] 单测：游标变化不重建 `queue` 数组、不重算 sig、不重取全量；列表结构变化才重建（`fake-indexeddb` + 注入）。
- [ ] HUD 复测：连切时 `queue.live.fetch` 的 `count` 不随每次切歌增长、`max` 不再 ~192ms。

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
- [ ] HUD 复测：连切时 `cover.preload.batch` / `image.decode` 的 `max` 显著下降。

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
| 2026-06-15 | User + Claude | **Phase 3 QA 通过 ✅**（暂停后 `lyrics.cascade.frame` count 停止增长、播放正常、恢复/seek 跟上）。**Burst HUD 截图**坐实 **`queue.live.fetch` burst 态 ×11 / max 499ms**（calm 仅 ×2-3）→ 纠正"游标 debounced 不会每切触发"：连切时 track 行写入（palette/计数）也重新 fire 全量重取，近乎每切都中。**Phase 2 升为头号**（Open Q1/Q3 据此更新）。其余 burst per-switch：`cover.preload.batch` ×50(258ms wall-clock)、`mediaSession.metadata` ×14(74ms)、`image.load/decode` 121/138ms。 |
| 2026-06-15 | User + Claude | **新分支 `perf/switch-song-large-queue-fps`。Phase 3 落地（待 QA）**：cascade rAF 改为「暂停且弹簧 settle 即 park、resume/seek 唤醒」，`lyrics.cascade.frame` 空闲不再空转（QA：count 从 ×56026 一路涨）。`wordFill` 经核已自带 isPlaying 门，无需改。重排优先级澄清：原"Phase 2 `!changed` 早退"对 7ms 的 queueSig 无效——真正 275ms 在 `getTracksByIds`（async fn，早退够不着），故 Phase 3 先行。 |
| 2026-06-15 | User + Claude | HUD #2（calm 态）校正数据：`queue.live.fetch` max **275ms ≈ jank 285ms**、`cover.preload.batch` max **836ms（×21，但 wall-clock 异步）**、`image.load` 189ms、`lyrics.cascade.frame` **×56026 仍涨**。新增**方法学校正**：`notePerfWork` span 是 wall-clock（含 await），主线程真值看 longtask。据此 **Open Q3 拍板**：Phase 2 为主线程头号，顺序 Phase 2 零风险先手 → Phase 3 → Phase 2 拆订阅 → Phase 4。 |

---

> **Note:** 本 PRD 强调"修改既有代码、观测先行、用字段证伪直觉"，不新建后端、不藏 flag、回退走 `git revert`。
