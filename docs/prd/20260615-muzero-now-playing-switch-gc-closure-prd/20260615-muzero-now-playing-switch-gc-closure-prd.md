# PRD: MUZERO Now Playing 切歌 worst-case GC 卡顿收尾（Phase 32-B clean 复测 + 残留分配归因）

**Status:** Draft
**Created:** 2026-06-15
**Author:** Claude
**Module:** Player / Now Playing — 切歌（Ctrl+Shift+→）worst-case 单帧 GC 停顿的 clean-prod 归因与收尾

---

## Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 0 | 现状复核：HEAD（Phase 32-A）切歌 trace 拆解 | ✅ 完成（本文档 §1.5 / §6 QA#50） | [QA#50](#qa50本-prd-起点80e0483-切歌-trace-拆解) |
| 1 | **观测先行**：clean-prod 复测 + 分配采样（剥离仪表，定位 ~35MB/切 分配点） | 🔲 Pending（桌面，用户侧） | [Phase 1](#phase-1观测先行clean-prod-复测--分配采样) |
| C.0 | Cover Pager 几何/槽位纯模型（`cover-pager.ts`，TDD）— C 前置 | ✅ 代码完成（15 例绿） | [Phase 2-A](#phase-2-acover-pagerts-纯模型tdd) |
| ~~B~~ | ~~卡片背光仅落定卡渲染~~ — **❌ 撤销（PM）：保留移动卡背光（要这个视觉效果）+ 未改善帧数（QA#51）** | ❌ Dropped | — |
| **C**（优先） | 持久化 Pager 接线（C.1 strip ✅ / C.2 wire / C.3 retire overlay） | 🔄 In Progress | [Phase 2-C](#phase-2-c持久化-pager-接线) |
| **D**（优先） | 背景跟随拖拽 crossfade（`background-crossfade.ts` + 三图 ring + 毛玻璃 scrim） | 🔲 Pending | [Phase 2-D](#phase-2-d背景跟随拖拽-crossfade) |
| 3 | 验收闭环：clean-prod 持续狂切 13+ window 复采，worst-case 收敛 | 🔲 Pending（桌面，用户侧） | [Phase 3](#phase-3验收闭环) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending
>
> **本 PRD 是 [`20260613-muzero-now-playing-switch-background-perf-prd`](../20260613-muzero-now-playing-switch-background-perf-prd/20260613-muzero-now-playing-switch-background-perf-prd.md)（下称「父 PRD」）的 Phase 32-B 收尾**：父 PRD 32 Phase 已把切歌路径上**所有显而易见的开销**（Pixi 重建、整图解码、cover preload churn、AutoScrollText 回流）逐一消除（QA#1–#49），但 QA#48 诚实承认 **worst-case 持续狂切仍有单帧 GC 停顿未真正收敛**。父 PRD 体量已 1400+ 行，故把这条「深层残留」carve 成本焦点文档。
>
> **方向（2026-06-15，用户拍板）：不再只做「debounce 围着症状打转」，而是按 Poweramp 的做法做结构性修复——把切歌动画从 React/数据平面解耦到一个常驻、GPU 合成的 Cover Pager**（详见 §6bis）。根因 = 每切歌 mount/unmount overlay（3 张 `motion.div` 卡 + Motion 对象）→ ~35MB/切瞬时分配 → major GC（§1.5 已证 `blobsCreated` 几乎不变、全 cache-hit，分配是非-blob 的 JS 对象）。持久化 pager **同时**消除该分配源**并**带来用户要的「拖拽看到后面封面 + 背景同步 crossfade + 毛玻璃、全程不卡」体验。Phase 1（clean-prod 采样）仍建议做以二次确认分配点，但**不阻塞** 2-A/2-B（结构修复对任何分配画像都成立）。
>
> **验证口径（沿用父 PRD 约定）：** 纯逻辑/不变量用 Vitest 单测在本仓库验（含「切歌不 remount 槽位 DOM」这类可测不变量）；**视觉顺滑 / GPU 帧率**标「✅ 代码完成（待桌面实测）」，由用户在桌面 prod build 用 [`dev-perf-panel`](../../../src/components/dev/dev-perf-panel.tsx) 的 `frameMax`/`longtask`/heap-churn 复采确认。

---

## 1. Overview

### 1.1 Background — 父 PRD 已做完什么

父 PRD（Phase 1–32-A）已结构性解决切歌掉帧的**绝大部分**，下列均**已验证生效、本 PRD 不再触碰**：

| 已解决 | Phase | 当前 trace 佐证（本文档日志） |
|--------|-------|------------------------------|
| Pixi App 不再每切歌重建（持久化 + 只换纹理） | 1, 10 | 全程 0 条 `appInit` |
| 切歌限速 ~5/s（治 firehose 错位 + 削每键成本） | 7 | 7 次切歌 cadence ~270ms，落在限速档 |
| 音频 stale load 正确 abort（requestId/seq 守卫） | — | `discard stale playback load` × 6（只最后一首落 blob） |
| Pixi ambient 只吃 192px backlight 派生，非原图 | 21 | `media.load` 源 `192×192 webp 10996B`，无原图 `muzfetch` |
| Pixi texture load abort + 180ms settle gate | 18, 19 | 无 2s stale fetch/decode |
| cover preload latest-only / in-flight dedupe / 延后 non-current | 14, 20 | `cover.preload.batch created:0`、全 `cache-hit` |
| stage/background full-cover decode 移除 | 22–24 | 无 `image.load/decode surface=now-playing/background` |
| 取色从 track metadata 同步命中（非每切歌重抽） | — | `cover.palette.track-metadata`（廉价、无 worker extract） |
| AutoScrollText 强制回流风暴（每 render clone→reflow） | 32-A | 本日志无 measure/reflow span（HEAD 已含 32-A） |

### 1.2 仍未解决的产品问题

**在 Tab 1（Now Playing）按住 / 连击 Ctrl+Shift+→ 持续快切时，仍出现 worst-case 单帧卡顿（"顿一下"）。** 父 PRD QA#48 已诚实定性为「~64MB/切瞬时 JS 分配 → major GC pause」，P1–P4 改善了**均值**但没消掉**单帧 GC 停顿**。本 PRD 提供的新一份 HEAD trace（§1.5）**复现并确认**该残留仍在，且**排除了** Phase 4/5/21 已修的整图解码路径。

### 1.3 Core Value

1. **正确测量**：先把仪表污染从测量里剥离（clean prod + 关 HUD/RDT），拿到**真实**的 worst-case 基线——避免在观测开销上调参（prd-create §4「dev mode 不作数」+ 父 PRD QA#49(1)）。
2. **精准归因**：用分配采样（DevTools Memory / Performance+memory）pin 住那 ~35MB/切的**具体分配点**，而非再凭直觉改渲染路径。
3. **最小收尾**：只改归因指向的那一处，验收锚定 worst-case `frameMax`/`longTask`/`fpsLow`/heap churn 的前后对比。

### 1.4 Target Users

| Role | Description |
|------|-------------|
| 桌面听众（重度切歌者） | 用 Ctrl+Shift+→ 在带封面歌单里快速跳找下一首；要求过程不卡 |
| 低/中端设备用户 | GC 停顿在弱机上更明显，是这条 worst-case 的最大受害者 |

### 1.5 现状 trace 拆解（本 PRD 起点）

数据：[`.logs/commit-80e048353aeae6b1487ab0402ccf04f20137c098/tab-1-switch-song.log`](../../../.logs/commit-80e048353aeae6b1487ab0402ccf04f20137c098/tab-1-switch-song.log)（HEAD = `80e0483`，含 Phase 32-A）。

**Burst：** 23:02:50.477 → 52.273，`playIndex` index 1→7 共 **7 次切歌**，cadence ~270ms（限速生效）。

**指标轨迹（`performance.frame` window）：**

| 时刻 | fpsAvg | fpsLow | frameAvgMs | frameMaxMs | longTaskMaxMs | heapMb | blobsCreated(img) |
|------|--------|--------|-----------|-----------|--------------|--------|-------------------|
| 静止基线（50.477 前） | ~97–105 | 9.2 | ~9.6 | 108 | 203 | 140–154 | 32 |
| burst 中段（51.393） | 84 | 6.7 | 11.9 | 150 | 203 | **235** | 32 |
| burst 尾（52.259） | 60 | 6.3 | 16.6 | 158 | 203 | **382** ← 峰值 | 34 |
| 落定刚过（53.607） | 44 | **4.8** | 22.6 | **208.4** | 203 | 268 | 34 |
| 停手回弹（57.732） | **119** | 59.9 | 8.4 | 16.7 | 203 | 272 | 34 |

**关键结论：**

1. **worst-case 仍卡：** `fpsLow 4.8`、`frameMax 208ms`、`longTask 203ms`、heap 140→**382**→GC→~270；停手 ~5s 后 fps 回 119。signature = **内存暴涨 → major GC 单帧停顿**（`frameMax 208 ≈ longTask 203`），与父 PRD QA#48 完全一致 → **Phase 32-A（AutoScrollText 回流修复）未消除此残留**（回流是 layout/CPU 成本，不是触发 GC 的**分配**）。
2. **排除整图解码：** burst 中 `blobsCreated(image)` 仅 **+2**（32→34），`cover.preload.batch created:0`、`cover.render` 全 `cache-hit`、`dbRequeries` 3→4。→ **不是** Phase 4/5/21 已修的封面整图解码 / preload / DB churn。那 ~242MB（140→382）churn 来自**别处**。
3. **1069ms 是症状非病因：** `background.texture decode=560.6ms` + `media.load=1069.9ms`（swapSeq=14）是**落定那首 192×192 webp（10996B）**——一张极小图解码却要 1 秒，正是**主线程被 GC/其它分配挤占**导致 `createImageBitmap` promise 迟迟不 resolve 的**congestion 症状**，不是像素成本（prd-create §4「渲染 compute ≠ 卡顿」）。
4. **本日志本身被仪表污染：** 一次 burst 打了数百条 DEBUG（`cover.render cache-hit` ~6/切、`cover.palette`、`background.cover`、`pixiCover.derivative`…）+ `dev-perf-panel` rAF tick + 可能开着 React DevTools。父 PRD QA#49(1) 已实测这些（`createTask 3196ms`/`run 3897ms`/`dev-perf-panel tick 296ms`/日志格式化 ~90ms）占主线程 self-time 一大块。**故本日志的 `frameMax 208` 含观测开销，不是 clean-prod 真值。**

> ⇒ 起点已明：残留是**与封面解码无关的 ~35MB/切瞬时分配 → GC**，且**必须先在 clean 环境复测**才能拿到可信基线并归因。这正是 Phase 1。

---

## 2. System Architecture（残留分配的可疑面）

```
Ctrl+Shift+→（限速 ~5/s）──▶ player-store.playIndex（音频 abort 正确）
        │  set currentIndex / queue（cursorPatch）
        ▼  每次 set 触发 Now Playing 整树 re-render：
  ┌──────────────────────────────────────────────────────────────┐
  │  SwipeableMediaStage  coverflow current/prev/next 三卡        │  ← 每首重渲染 3 份卡 + Motion
  │  StageIdentity ×（标题+副标题）× 3 卡                          │  ← AutoScrollText（32-A 已降频，但仍重渲染）
  │  SyncedLyricsView / lyrics cascade                             │  ← lyrics.cascade.frame（log 显示 <0.4ms，健康）
  │  PlaybackSpectrum（28: 切歌 fade + 停 rAF）                    │  ← burst 中应停（已修，需 clean 复核）
  │  NowPlayingBackground / flow / visualizer 合成层               │  ← settledTrack 去抖（已修）
  │  AnnotationEditor / TrackMemoryNotesPanel（30: in-place reset）│  ← 不再整体重挂（已修）
  └──────────────────────────────────────────────────────────────┘
        每首切歌的「整树 reconcile + 新 props/style 对象 + Motion 动画对象」= 候选分配源（QA#48 列为剩余嫌疑）
```

**可疑分配点（按 QA#48 剩余嫌疑 + 本 trace 收敛后排序，待 Phase 1 实证）：**

| # | 嫌疑 | 为什么仍可疑 | 已排除？ |
|---|------|-------------|---------|
| A | Now Playing **整树每首 reconcile + Motion 对象分配**（coverflow 3 卡 × 标识 × 过场动画） | `blobsCreated` 几乎不变却 heap +242MB → 分配是**非 blob 的 JS 对象**（props/style/VNode/Motion state），整树重渲染最吻合 | 否（主嫌疑） |
| B | 诊断日志 / perf HUD **自身分配**（每 burst 数百条 DEBUG 格式化 + sanitize + trace 缓冲） | QA#49(1) 已实测占大块 self-time；`.log` 每行 `formatTraceEntry`/`sanitizeValue` 都分配 | 否（污染项，Phase 1 剥离） |
| C | stage `CoverImage` full-res `<img>` decode 内存（crossfade 持有原图 ImageBitmap） | Phase 22–24 移除了**主动** decode，但浏览器 paint 时仍解码原图入 heap；`blobsCreated` 不计浏览器内部解码缓冲 | 部分（主动 decode 已除；被动 paint decode 内存待 Memory profile 确认） |
| D | audio blob 读节奏（每切歌读 7–9MB audio blob 入内存） | log 显示 `loading media blob bytes=9193965`；虽 abort，但已读入的字节在 GC 前占 heap | 部分（abort 生效，残留字节是 GC garbage） |

---

## 3. Data Model

**无数据模型改动。** 本 PRD 是性能归因 + 针对性收尾，不动 Dexie schema、不 bump version、不新增 settings 字段（除非 Phase 2 归因指向某个需可见 toggle 的行为——届时按硬规则 3 建可见 Settings 控件，不藏 flag）。

---

## 4. 测量方法学（prd-create §4，先于任何优化）

> 父 PRD QA#48 的教训：「日志已到极限，逐字段已排除显而易见嫌疑」。再加 `.log` 字段不会前进，反而**加重污染**。本 PRD 第一步必须换测量手段。

1. **clean prod build 复测**（§4「prod build 复测，dev mode 不作数」）：
   - `make build` 后 serve（非 `make dev`）；关 React DevTools；关 perf HUD（`dev-perf-panel` 不挂载或仅采 longtask）。
   - 诊断日志：把切歌路径的 `log.debug` 在采样期降到最低（prod 本就静默 debug，但本机抓 trace 时常手开）——确认**测量时不开**逐首 DEBUG，避免 QA#49(1) 的 `formatTraceEntry`/`sanitizeValue`/`createTask` 污染。
2. **测呈现帧节奏 + 长任务，而非渲染耗时**（§4）：保留 `requestAnimationFrame` frame-interval + `PerformanceObserver({entryTypes:["longtask"]})`（[`dev-perf-panel.tsx`](../../../src/components/dev/dev-perf-panel.tsx) 已有），验收看 `frame p99`/`frame max`/`longtask max`/`heap churn`。
3. **分配采样定位（本 PRD 核心新增手段）：** 用 **Chrome DevTools → Memory → Allocation instrumentation on timeline**（或 Performance 面板勾选 Memory + 长帧着色 🟢 GC）抓一次持续狂切，读「~35MB/切」的**构造器/调用栈归属**（是 Motion/React Fiber/Array/Object，还是 ImageBitmap/ArrayBuffer）。这能直接区分嫌疑 A（JS 对象）vs C/D（二进制缓冲）。
4. **充分采样**（§4 + QA#48 教训）：持续狂切收集 **≥13 个 fps window**，不要用单 window 下「已收敛」结论（QA#47 的教训）。

---

## 5. Frontend Design

本期默认**无 UI 改动**。Phase 1 是观测；Phase 2 的具体改动待归因确定，但已约束为下列**不改观感**的方向之一：

- **A 命中 → Now 树 memo / 降 reconcile：** 把 coverflow 过场卡（prev/next）的标识/派生 memo 化或在 burst 期跳过渲染（复刻 P2 coverflow-skip 思路），减少每首切歌的 VNode/Motion 对象分配。不改用户能看到的封面流。
- **C 命中 → stage 封面上限尺寸派生：** 把中央 stage `<img>` 从原图换 512/1024px 派生（decode 内存 ~16×↓）——**这是父 PRD 反复推迟的决定**（Open Q#9 用户拍板「保持原图」），需用户重新拍板，归 [`cover-quality PRD`](../20260614-muzero-cover-quality-and-scroll-prd/) Phase 3。
- **D 命中 → audio 读去抖：** burst 期延后非落定首的 audio blob 读（只读落定那首），与 Pixi/cover 的 settle 同拍。
- **B 命中 → 日志降噪：** 切歌路径的逐首 DEBUG 改为聚合/采样输出（不是污染产品，是让**抓 trace 时**的测量更干净）。

---

## 6. Implementation Plan

### Phase 1：观测先行——clean-prod 复测 + 分配采样

**Goal:** 拿到**剥离仪表污染**的真实 worst-case 基线，并用分配采样 pin 住 ~35MB/切的具体分配点。**纯观测，零产品行为改动，可独立先做。**

**Tasks:**
- [ ] `make build` + serve，关 RDT、关/减 perf HUD、关切歌逐首 DEBUG；持续狂切 Ctrl+Shift+→ 采 ≥13 个 fps window，记录 clean `frameMax`/`longTask`/`fpsLow`/heap churn。
- [ ] DevTools Memory「Allocation instrumentation on timeline」抓同一狂切，导出 top allocators（构造器 + 调用栈），判定命中 §2 表的 A/B/C/D 哪一项。
- [ ] 若 JS 对象分配为主（A）：进一步用 Performance 火焰图看是 React reconcile、Motion，还是某 `useMemo`/`map` 每首重建大数组。
- [ ] 把结论写成 QA#51 落到本文档 §6 + 父 PRD 变更日志（cross-link）。

**Checklist:**
- [ ] clean 基线数字（无 RDT/HUD/逐首 DEBUG）vs 本文档 §1.5 污染基线的差额量化——确认仪表占比（验证 QA#49(1) 推断）。
- [ ] 至少一个明确的「主分配点」结论（构造器名 + 大致字节/切），作为 Phase 2 的 ground truth。
- [ ] 若 clean 复测后 worst-case **已无** GC 停顿（即污染就是主因）→ 直接进 Phase 2 的 B 分支（仅日志/HUD 降噪），关闭本 PRD。

### Phase 2：持久化 Cover Pager（结构修复，分 2-A…2-D 落地）

> 设计全文见 [§6bis 持久化 Cover Pager 架构](#6bis-持久化-cover-pager-架构poweramp-like)。下列为可独立 commit 的 TDD 子阶段；与 Phase 1 解耦（结构修复对任何分配画像都成立，不必等采样）。

#### Phase 2-A：`cover-pager.ts` 纯模型（TDD）

**Goal:** 把「常驻 N 槽循环条」的几何/槽位逻辑抽成零-DOM 纯模块，作为 2-C 接线的可测契约。**纯新增，零运行时行为改动。**

**契约（纯函数）：**
- `assignPagerSlots(centerIndex, queueLength, radius)` → `PagerSlot[]`（长度 `2*radius+1`，每槽 `{ slotKey（稳定，0..N-1，不随 center 变）, queueIndex|null, offsetSteps }`）；**slotKey 稳定 = DOM 节点不 remount，只轮换内容**（recycling-list pattern）。
- `pagerTranslate(dragX, width, gain)` → 整条 strip 的 `translateX`（px）。
- `resolvePagerSettle(dragX, width, threshold)` → `-1 | 0 | +1`（松手落到 prev/留/next）。
- 边界：空队列、queueLength 1、center 在首/尾（缺侧槽 `queueIndex=null`）、radius 0。

**Tasks（TDD）:**
- [x] 先写 `cover-pager.test.ts`（15 例）：穷举边界（空队列 / len1 / 首尾 / radius0）+ slotKey 稳定性（center 5→6 同一 slotKey 仍同一槽、offsetSteps 不随 center 变）+ translate/restOffset/settle 方向（负 x=next）/clamp。
- [x] 实现 `cover-pager.ts`：`assignPagerSlots`（recycling-list，slotKey 稳定）/`pagerTranslate`/`slotRestOffsetPx`/`resolvePagerSettle`/`applyPagerSettle`，零 DOM 零副作用。

**Checklist:**
- [x] `cover-pager.test.ts` 15 例全绿；`tsc`（exit 0）/Biome 通过。

#### Phase 2-B：卡片背光仅落定卡渲染 — ❌ 撤销（PM，2026-06-15）

> **PM 决定撤销：**(1) **产品要保留移动卡上的 backlight blur**（拖拽时封面带流光是想要的视觉效果，不是要消除的成本）；(2) QA#51 实测此改动**未改善帧数**（worst-case GC 停顿与改前同量级）。本改动**不进** C/D 分支（新 branch 从 main 起，`swipeable-media-stage` 保持移动卡背光原样）。下文保留原方案记录仅作历史。

**Goal（已撤销）:** ~~把 `TrackVisual` 的 `blur(20px) saturate(400%)` 背光（opt-in `backlight` 外观模式）从「每张卡（含拖拽中的 prev/next）都渲染」收紧到「只落定/居中卡渲染」~~。

**契约：** 纯 helper `shouldRenderCardBacklight({ isCenter, dragging, bursting })`（仅 `isCenter && !dragging && !bursting` 为真）。

**实现说明（对原方案的精化）：** 现状已只有居中 `currentCard` 携带背光（prev/next 侧卡本就不渲染），且 base 层背光已 gate（`!baseHidden && !bursting`）。漏洞是 overlay 的 `currentCard` 背光在**拖拽中的平移卡**上无条件渲染 → `blur(20px) saturate(400%)` 每帧重栅格化。故把传给 `currentCard` 的 `coverHasBacklight` 从字面 `true` 换成 `shouldRenderCardBacklight({ isCenter:true, dragging: !!dragDirection||committing, bursting })`——`TrackVisual` 内 `hasBacklight && …` 逻辑不变（改面最小）。拖拽中无背光、落定后由 base 层接管 glow。

**Tasks（TDD）:**
- [x] helper 单测（真值表，4 例）先红后绿，置于 [`album-cover-appearance.ts`](../../../src/lib/album-cover-appearance.ts)（与 sibling `shouldRequestCoverBacklightDerivative` 同源）。
- [x] `swipeable-media-stage` 的 `currentCard` 接 helper：拖拽/burst 中跳过背光 `<img>`，居中落定卡保留。

**Checklist:**
- [x] helper 单测（10 例文件全绿）+ `swipeable-media-stage.test`（绿）；`tsc` exit 0、Biome 通过。
- [ ] 待桌面实测：`backlight` 模式拖拽时无平移卡 blur 重栅格化。

#### Phase 2-C：持久化 Pager 接线

**Goal:** 用常驻 N 槽 strip（消费 2-A）替换当前「每切歌 `setStack` → mount overlay portal（3 `motion.div`）→ `clearStack`」的 ephemeral 结构 → 消除 ~35MB/切的 mount/unmount 分配源；`bursting`/`COVERFLOW_BURST_SKIP_MS` 跳过逻辑可退役（pager 常驻、足够廉价，狂切也不重建）。

**落地方式（用户拍板：staged-with-testing）：** 大改面拆成可单独 commit + 桌面验证的 slice，每 slice 让用户在桌面 pull & test 后再叠下一层（避免一次性盲改 + 与并行编辑撞车）。

**Slices：**
- **2-C.1（内部脚手架，仅单测）✅：** 新增 presentational [`cover-pager-strip.tsx`](../../../src/components/player/cover-pager-strip.tsx)——消费 `assignPagerSlots`/`slotRestOffsetPx` 渲染常驻 N 槽（每槽 `data-slot-key` 稳定，单一 strip `translateX`）。Testing Library 4 例：每 slotKey 一槽 / center 5→6 同一 `data-slot-key` 节点**身份不变**（`toBe` 引用相等）只内部 `<img src>` 由 `cover-5`→`cover-6` / null 槽不渲染 img 但节点保留 / rest offset + translate。**未接线 live**（桌面无可见变化，验证留到 2-C.2）。
- **2-C.2（可见）：** 把 `CoverPagerStrip` 接进 stage 替换 ephemeral overlay 的 card 构建；drag 经现有 `useMotionValue(x)` 驱动 `pagerTranslate`；松手 `resolvePagerSettle` → `animate(x,…)` snap → settle 才 dispatch store。用户桌面测拖拽/切歌观感。
- **2-C.3（可见）：** 退役 `stack`/`stackOverlay`/`clearStack`/`bursting` 跳过逻辑（pager 常驻已不需要）。用户桌面测狂切。

**Checklist:**
- [ ] 各 slice：no-remount/相关单测 + 现有 stage 测试绿；`tsc`/Biome 通过；用户桌面确认后再进下一 slice。
- [ ] 待桌面实测：狂切 worst-case heap 不再每 burst +240MB、`frameMax`/`longTask` 收敛。

#### Phase 2-D：背景跟随拖拽 crossfade

**Goal:** 实现用户要的「拖拽时背景也跟着 crossfade 到将露出的封面」。背景从「只在 settle 后 crossfade 当前 src」升级为「持有 prev/cur/next 三图 ring，按**共享拖拽进度**插值两层 opacity」，毛玻璃 = 其上一层静态 scrim（非 live `backdrop-filter`，避免移动层每帧重栅格化）。

**契约（纯函数）：** `backgroundCrossfadeProgress(dragX, width, direction)` → `{ fromOpacity, toOpacity, toIndexDelta }`。共享进度经 store/context 的单一 `MotionValue` 从 stage 传给 background（二者本是兄弟组件）。

**Tasks（TDD）:**
- [x] **D.1（纯模型）✅：** [`background-crossfade.ts`](../../../src/lib/background-crossfade.ts) `backgroundCrossfadeProgress(dragX, width, gain)` → `{ direction, progress, currentOpacity, incomingOpacity }` + `crossfadeIndexDelta`（负 x=next）。7 例先红后绿（rest / next / prev / over-drag clamp / gain / 非有限或缺 width）。
- [x] **D.2（可见，代码完成，待桌面实测）：** 共享通道 [`now-playing-drag.ts`](../../../src/lib/now-playing-drag.ts)（单例 `nowPlayingDragX` MotionValue + `useNowPlayingDragRing` zustand 持 width/cur/next/prev URL）；stage 经 `useMotionValueEvent` 镜像 `x`→`nowPlayingDragX`（每帧只 `.set()`，不重渲染）+ 发布 ring；新 [`drag-crossfade-background.tsx`](../../../src/components/player/drag-crossfade-background.tsx) 在 `NowPlayingBackground` 里挂两张 canvas（next/prev），复用 WKWebView-safe 的 [`canvas-blur.ts`](../../../src/lib/canvas-blur.ts)（从 `CanvasBlurBackground` 抽出，避免 CSS filter），按 `crossfadeLayerOpacities` 命令式写 opacity（订阅 MotionValue，不进 React render）。**静止两层 opacity=0 → 纯附加，不改静止背景**。49 例（5 文件）绿、`tsc` exit 0、Biome 通过。毛玻璃 scrim：现有 `imageMaskOpacity` 已在其上充当 dim 层；如需更强毛玻璃感可后续加 scrim。

**Checklist:**
- [ ] crossfade 纯函数单测绿；`tsc`/Biome 通过。
- [ ] 待桌面实测：拖拽时封面与背景同步 crossfade、毛玻璃自然、全程不掉帧。

**全 Phase 通用 Checklist:**
- [ ] 回退 = `git revert`，无 hidden flag（硬规则 3；若需 toggle 建可见 Settings 控件）。
- [ ] 每个子阶段：先红后绿单测 → 更新本 PRD 标 ✅ → 原子 commit。

### Phase 3：验收闭环

**Goal:** clean-prod 持续狂切 13+ window 复采，worst-case 真正收敛（不再用单 window oversell）。

**Checklist:**
- [ ] clean-prod worst-case：`frameMax` < ~60ms、`longTask` 无 ≥150ms 项、`fpsLow` 显著回升、heap 不再每 burst +240MB。
- [ ] 与父 PRD QA#48 基线（`fpsLow 6`/`frameMax 183`/`longTask 226`/heap→888）逐项对比改善。
- [ ] 结果回写父 PRD（关闭其 Phase 32-B / QA#48 Reopen 的悬项）。

---

## 6bis. 持久化 Cover Pager 架构（Poweramp-like）

### 核心原则

> **动画必须跑在一个 React/数据平面每帧都不碰的层上。** 一旦封面成为已上传的合成层，拖拽/crossfade 就只是移动既有层（transform/opacity）——无 JS 分配、无解码、无 layout。数据模型只在手势**落定后**变。

Poweramp 顺滑的本质不是「渲染更快」，而是「动画期间几乎不渲染」。两套解耦的世界：

1. **数据 → 纹理（罕见、在热路径之外）：** track 变 adjacent 时，其封面**一次性**解码为合成层（bounded 尺寸），放进 prev/cur/next（±N）的小 ring。
2. **合成（每帧、仅 GPU）：** 一条 view-pager 持有固定槽位 sprite；拖拽只 set `translateX`；背景是同一图 downscale+blur，按 alpha crossfade。落定才 dispatch 数据变更。

### 现状违背原则的三处（= §1.5 的 GC 残留来源）

已有对的**原语**：`useMotionValue(x)`+`useTransform`+`animate(x,…)`（[`swipeable-media-stage.tsx`](../../../src/components/player/swipeable-media-stage.tsx)，Motion 在合成线程写 transform，拖拽不触发 React 重渲染 ✅）；[`canvas-blur-background.tsx`](../../../src/components/player/canvas-blur-background.tsx)（downscale 到 ~64px + 双缓冲 canvas crossfade ✅）。但违背原则于：

1. **coverflow 是 ephemeral overlay，每切歌 mount/unmount。** `setStack` → `stackOverlay` portal（3 `motion.div` 卡 + 每卡 `StageIdentity ×2` + 背光）→ `clearStack`。每切歌 = build → mount → animate → tear down → **~35MB/切 VNode+Motion 分配 → major GC**。`bursting`/`COVERFLOW_BURST_SKIP_MS` 是反向 band-aid：恰在狂切时**关掉**好动画。
2. **封面以原图喂手势。**（Open Q#9「保持原图」）解码内存填满 heap，GC 再用一次 ~200ms 停顿回收。
3. **移动元素上的重 CSS filter。** `backlight` 模式 3 卡 `blur(20px) saturate(400%)` 随拖拽平移 → 每帧重栅格化（Phase 2-B 修）。

### 目标分层（DOM 合成优先，非 WebGL）

```
[最上] Cover Pager（常驻 N 槽 strip，DOM <img>/<canvas> 复用节点）
        └ drag → translate3d（Motion 写，合成线程）；落定才 dispatch store
[中]  毛玻璃 scrim（静态半透明 gradient/scrim，非 live backdrop-filter）
[底]  Blurred Background（CanvasBlurBackground 双缓冲；按同一 drag 进度 crossfade）
            ▲ 二者读同一 prev/cur/next ring + 同一 MotionValue → 天然同步
```

- **DOM 合成优先**：transform/opacity 永不上主线程；`CanvasBlurBackground` 的 downscale crossfade 已近免费、GC 安静。**Pixi 仅保留**给落定态的 shader 特效（noise/pixel），**不**让每帧手势穿过它。仅当未来要真 gaussian / 持续动画的特效才上单 WebGL scene。
- **bounded ring**：carousel + 背景都读 ring 里 bounded 尺寸的已解码图（`createImageBitmap` 线程外 / `img.decode()` 预热），adjacency 变（settle）时解码，**绝不**在槽位滚入可见时解码。
- **单一 live-index 时钟**（父 PRD Phase 8 不变）：背景与封面读同一 index，拖拽进度是同一 `MotionValue` → 不可能串号。

### 取舍

- 常驻 N 槽 = 始终渲染 N 份封面 DOM，但**节点稳定**（只换 `src`/transform）→ 廉价；`bursting` skip 退役。
- 毛玻璃用**预 blur 的静态层 crossfade**，不用 live `backdrop-filter`（后者对移动/每帧更新的区域会重栅格化）。
- `backlight` 重 filter 只给落定居中卡（Phase 2-B）。

### 与本仓库验证约定

纯逻辑（geometry / crossfade math / backlight gating）+ 结构不变量（**切歌不 remount 槽位 DOM**）用 Vitest 在本仓库验；视觉顺滑 / GPU 帧率标「代码完成（待桌面实测）」，用户在桌面 prod build 用 `dev-perf-panel` 复采。

---

## 7. Out of Scope（交叉引用，本 PRD 不处理）

- **父 PRD 已完成的 32 Phase**（Pixi 生命周期、settle 闸门、GPU 后端、ImageBitmap 化、preload 收敛、AutoScrollText 频率修复）：本 PRD 只复测/归因其**残留**，不重做。
- **封面派生管线内部实现**（palette/thumbnail/backlight worker、render-by-reference）：见 [`cover-render-pipeline-performance PRD`](../20260613-muzero-cover-render-pipeline-performance-prd/20260613-muzero-cover-render-pipeline-performance-prd.md)。
- **stage 封面降采样到上限派生的产品决策**：归 [`cover-quality PRD`](../20260614-muzero-cover-quality-and-scroll-prd/) Phase 3（Open Q#9 用户曾拍板保持原图；若 Phase 1 命中 C 需重拍）。
- **Tab 切换 / view-transition 性能**：见 [`20260615-tab-switch-view-transition-perf PRD`](../20260615-muzero-tab-switch-view-transition-perf-prd/)（与本「同 tab 内切歌」无关，QA#48 已排除 keep-mount 回归）。
- **cadence > ~600ms 中速点击单帧尖峰**（父 PRD Open Q#27）：独立边界，本 PRD 聚焦持续狂切 worst-case。

---

## 8. Security / 本地优先

- 无新增出站请求、无后端、无遥测（硬规则 1）。
- 不引入 hidden flag；任何 runtime toggle 走可见 Settings（硬规则 3）。
- codename 层不变（无表名/id 前缀/provider 改动，硬规则 4）。

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [父 PRD：now-playing-switch-background-perf](../20260613-muzero-now-playing-switch-background-perf-prd/20260613-muzero-now-playing-switch-background-perf-prd.md) | 本 PRD 的来源；32 Phase + QA#1–#49 的完整历史；本 PRD 收其 QA#48 Reopen / Phase 32-B |
| [`.logs/commit-80e0483…/tab-1-switch-song.log`](../../../.logs/commit-80e048353aeae6b1487ab0402ccf04f20137c098/tab-1-switch-song.log) | 本 PRD 起点 trace（HEAD，含 Phase 32-A） |
| [`.logs/commit-80e0483…/tab-2-switch-song.log`](../../../.logs/commit-80e048353aeae6b1487ab0402ccf04f20137c098/tab-2-switch-song.log) | 同 commit Tab 2（队列/库）对照，用于隔离「仅 Now Playing 挂载」成本 |
| [cover-render-pipeline-performance PRD](../20260613-muzero-cover-render-pipeline-performance-prd/20260613-muzero-cover-render-pipeline-performance-prd.md) | 封面派生管线（上游） |
| [cover-quality-and-scroll PRD](../20260614-muzero-cover-quality-and-scroll-prd/) | stage 封面上限派生决策的归属（Open Q#9 / 分支 C） |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | 本文档 §1.5 的 `frameMax 208` 有多少来自仪表污染（RDT/HUD/逐首 DEBUG）vs 真实产品 GC？ | 🔲 Open | Phase 1 clean 复测量化；若污染即主因，收尾退化为 B 分支（日志/HUD 降噪） |
| 2 | ~35MB/切 的主分配点是 JS 对象（Motion/Fiber，嫌疑 A）还是二进制缓冲（ImageBitmap/audio，嫌疑 C/D）？ | 🔲 Open | Phase 1 Allocation timeline 的构造器归属裁决 |
| 3 | 若命中 C（stage 原图 decode 内存），是否重开「stage 用 512/1024px 派生」？ | 🔲 待用户拍板 | 推翻父 PRD Open Q#9「保持原图」需用户同意；否则只走 A/D |
| 4 | Tab 2（队列）同 commit 切歌是否也复现此 GC 停顿？ | 🔲 Open | 对照 `tab-2-switch-song.log` 判定残留是否「仅 Now Playing」——决定改动落在共享层还是前台层 |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-15 | User(PM)+Claude | **Phase 2-D.2 修正（解耦叠层）**：用户实测发现**均衡模式**（`backgroundRenderer:"blur"`，与 drag 层同为 canvas-blur）fade 自然，但**画质优先**（`backgroundRenderer:"noise"` Pixi + `flowEnabled` + viz-as-bg，见 [`graphics-quality.ts`](../../../src/lib/graphics-quality.ts)）下「完全拖到第二张背景却不是完全第二张」——根因：drag blur 层夹在 Pixi-noise 与 flow/visualizer 之间，既不匹配 Pixi 观感、又被上层 flow/viz 染色 + 只到 0.9 opacity（叠层耦合）。**修正：把 `DragCrossfadeBackground` 移到整组背景最顶层**（renderer + flow + viz 之上）+ `maxOpacity=1` → **与 quality preset 用哪个 renderer 解耦**，任意模式下满拖都落到 100% 第二张封面；静止 opacity=0 纯附加，松手后效果栈在新封面上 settle 回来（沿用父 PRD「特效落定后长出来」UX）。21 例绿、`tsc`/Biome 通过。**待桌面复测：满拖是否完全第二张 + 满拖→松手亮度是否一致（顶层无 mask dim，可能偏亮，待反馈决定是否补 dim）。** |
| 2026-06-15 | Claude | **Phase 2-D.2 代码完成（待桌面实测）**：背景跟随拖拽 crossfade 接线。新增共享通道 [`now-playing-drag.ts`](../../../src/lib/now-playing-drag.ts)（单例 `nowPlayingDragX` MotionValue + `useNowPlayingDragRing` 持 cover ring）；`SwipeableMediaStage` 用 `useMotionValueEvent` 镜像 `x`→`nowPlayingDragX`（每帧只 `.set()`）+ 发布 width/cur/next/prev URL；新 [`drag-crossfade-background.tsx`](../../../src/components/player/drag-crossfade-background.tsx)（两 canvas，复用从 `CanvasBlurBackground` 抽出的 WKWebView-safe [`canvas-blur.ts`](../../../src/lib/canvas-blur.ts)，opacity 由 `crossfadeLayerOpacities` 命令式订阅 MotionValue 写入，**不进 React render**），挂在 `NowPlayingBackground` 静止背景之上、mask 之下，**静止 opacity=0 纯附加**。修测：`drag-crossfade-background` ResizeObserver guard（jsdom 无 RO）+ swipeable test 的 motion mock 补 `motionValue`/`useMotionValueEvent`。49 例（5 文件）绿、`tsc` exit 0、Biome 通过。**待用户桌面测：拖拽时背景是否同步 crossfade 到将露出的封面。** |
| 2026-06-15 | Claude | **Phase 2-D.1 代码完成（TDD，纯模型）**：新增 [`background-crossfade.ts`](../../../src/lib/background-crossfade.ts) `backgroundCrossfadeProgress`（drag→`{direction,progress,currentOpacity,incomingOpacity}`，负 x=next，clamp、gain、非有限/缺 width 回 rest）+ `crossfadeIndexDelta`。7 例先红后绿；Biome/`tsc` 通过。是 D.2「背景跟随拖拽 crossfade」的纯数学契约（待 D.2 接共享拖拽进度 + 三图 ring 接线，桌面验证）。**方向修正（两发现）：**(1) 现状 coverflow `CoverflowCard` 含 backlight+3D+identity，裸 `CoverPagerStrip` 非 drop-in（会丢 PM 要保留的移动卡背光）→ 忠实 Phase C = 让**现有富 overlay 常驻**（复用 CoverflowCard）；(2) Ctrl+Shift+→ firehose **已被 `bursting` 跳过 overlay**（父 PRD P2），故 C/D 提升的是**手动拖拽体验**，键盘狂切 GC 是另一条路径（base 重渲染 + 封面解码 + pixiCover.derivative）。用户拍板：**两者都做，拖拽体验优先**。 |
| 2026-06-15 | User(PM)+Claude | **QA#51 + 方向修正：撤销 Phase 2-B，新 branch 从 main 起，优先 C/D。** 用户提供新 trace [`.logs/20260615-3-…/tab-1-switch-song-low-fps.log`](../../../.logs/20260615-3-performance-switch-song-on-tab-1/tab-1-switch-song-low-fps.log)（带 A/B/C.1 的 build）。**分析：**(a) `cover-pager.ts`/`cover-pager-strip.tsx` 经 grep 证实**仅被自身测试 import**（runtime dead code）→ Phase A/2-C.1 **不可能**影响帧率；(b) Phase B 只在 opt-in `backlight` 模式**减少**移动卡渲染，不增成本，且 `useCoverDerivativeUrl(backlight)` 在 `TrackVisual` 本就无条件调用（B 未改）；(c) 此 trace 是**更重的场景**（5983 首 uploaded 队列、倒序狂切、burst 中 +12 张 uploaded 封面解码 cache-miss），worst-case `fpsLow 5`/`frameMax 199.9`/`longTask 200`/heap 133→232 与 §1.5 基线（4.8/208/203/140→382）**同量级、略好**——无回归信号，是 A/B 从未针对的同一 GC 残留 + 封面解码 churn。**PM 决定：**保留移动卡背光（要这个视觉效果）、撤销 B；A/B 未改善帧数；**优先实现真正的修复 C（持久化 pager 接线）+ D（背景跟随拖拽）**。新 branch `perf/now-playing-pager-cd` 从 main 起，仅带 pager 纯模型（C.0）+ strip（C.1），不带 B。 |
| 2026-06-15 | Claude | **Phase 2-C.1 代码完成（TDD，内部脚手架）**：新增 presentational [`cover-pager-strip.tsx`](../../../src/components/player/cover-pager-strip.tsx)（消费 2-A 的 `assignPagerSlots`/`slotRestOffsetPx`，常驻 N 槽 + 稳定 `data-slot-key` + 单 strip translate，dumb 无状态）。Testing Library 4 例先红后绿，核心是**no-remount 不变量**：center 5→6 同一 slotKey 的 DOM 节点 `toBe`（引用相等）不变、只内部 `<img src>` 轮换——证明切歌不再 mount/unmount 卡片（~35MB/切 churn 源）。**未接线 live**（用户拍板 staged-with-testing，可见验证留 2-C.2）。`tsc` exit 0、Biome 通过。用户拍板：2-C/2-D 按 slice 落地，每 slice 桌面验证后再续。 |
| 2026-06-15 | Claude | **Phase 2-B 代码完成（TDD）**：新增纯 helper [`shouldRenderCardBacklight`](../../../src/lib/album-cover-appearance.ts)（`isCenter && !dragging && !bursting`，4 例先红后绿）；`swipeable-media-stage` 的 overlay `currentCard` 把 `coverHasBacklight` 从字面 `true` 换成该 helper → 拖拽中的平移居中卡不再渲染 `blur(20px) saturate(400%)` 背光（每帧重栅格化源），落定后 base 层接管 glow。album-cover-appearance 10 例 + swipeable-media-stage 测试绿；`tsc` exit 0、Biome 通过。专修 opt-in `backlight` 模式拖拽成本；默认 `shadow` 不受影响。 |
| 2026-06-15 | Claude | **Phase 2-A 代码完成（TDD）**：新增纯模块 [`cover-pager.ts`](../../../src/components/player/cover-pager.ts)（`assignPagerSlots`/`pagerTranslate`/`slotRestOffsetPx`/`resolvePagerSettle`/`applyPagerSettle`）——常驻 N 槽循环条的几何/槽位模型，slotKey 稳定（切歌不 remount，只轮换 queueIndex 内容）。`cover-pager.test.ts` 15 例（边界 + slotKey 稳定性 + settle 方向）先红后绿；`tsc` exit 0、Biome 通过。纯新增、零运行时行为改动，作为 2-C 接线契约。 |
| 2026-06-15 | Claude | 初稿：从父 PRD carve「切歌 worst-case GC 残留」为焦点收尾文档。基于 HEAD（80e0483，含 Phase 32-A）新 trace（§1.5 QA#50）确认：限速/音频 abort/Pixi 派生/preload/AutoScrollText 均生效，但 worst-case 仍 `fpsLow 4.8`/`frameMax 208`/`longTask 203`/heap 140→382→GC；`blobsCreated` 仅 +2 → **排除整图解码**，残留是 ~35MB/切 非-blob 分配 + 仪表污染。按 prd-create §4 定 Phase 1（clean-prod 复测 + Allocation 采样归因）→ Phase 2（按归因最小收尾）→ Phase 3（13+ window 验收）。无产品代码改动。 |
