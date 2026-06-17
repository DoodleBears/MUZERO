# PRD: Coverflow 切歌的标题闪烁 + 多次拖拽后丢失 3D 效果

**Status:** Draft
**Created:** 2026-06-18
**Author:** DoodleBears / Claude
**Module:** Now Playing 封面 coverflow（`SwipeableCoverStage` + `CoverPagerStrip` + cover-preload）

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | 观测：标记切歌 hand-off 各阶段的 identity / cover 可见性 | 🔲 Pending | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | 修复 #1：标题/歌手不随封面 hand-off fade（commit 即显示 B） | 🔲 Pending | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | 修复 #2：多次/快速拖拽后侧封面回退 title（3D 退化） | 🔲 Pending | [Phase 3 Checklist](#phase-3-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

Now Playing 的封面区是一个「持续可拖拽的 windowed coverflow」（[`swipeable-cover-stage.tsx`](../../../src/components/player/swipeable-cover-stage.tsx) + [`cover-pager-strip.tsx`](../../../src/components/player/cover-pager-strip.tsx)）。本期之前的性能工作（PRD `20260617-dock-swipe-switch-jank` / `reactivity-render-observability`）已把切歌掉帧治到 UI-safe 极限。这次是**两个纯视觉缺陷**，与性能无关，是 hand-off / 预载状态机的边界 bug：

1. **拖拽 A→B 松手 commit 后，标题/歌手/专辑信息会先 fade out 再重新出现**（一次没必要的闪烁）。既然拖拽时已经看到 B 的正确标题，commit 后应该直接定格在 B，不该让同一份 B 文本淡出再淡入。
2. **连续拖拽切歌几次之后，3D coverflow 效果突然消失**——拖拽退化成「水平平移」，且**看不到左右 slot 的封面**。用户怀疑是 burst 限制。

### 1.2 Target Users

| Role | Description | Permissions |
|------|-------------|-------------|
| **听歌用户（桌面优先）** | 在 Now Playing 用鼠标拖拽 / 触控板横滑切歌 | 纯本地，无权限概念 |

### 1.3 Core Value

1. **切歌视觉连续**：拖到哪首就定格哪首，文本不闪。
2. **coverflow 始终是 coverflow**：连续快速拖拽时侧封面不应塌成标题占位，3D 立体感不退化。
3. **不牺牲既有性能**：本期是边界修复，不得回退 dock-swipe-jank / reactivity 两个 PRD 已达成的 UI-safe 性能基线。

---

## 2. System Architecture

### 2.1 当前 hand-off / 预载结构（现状，供定位）

```
拖拽中 (active=true)
  ├─ base MediaStage           : opacity 0（被 overlay 遮住）
  ├─ base StageIdentity (行673): opacity 0（active?0:1）   ← 关键
  └─ overlay CoverPagerStrip   : opacity 1，5 个 slot 随 coverWindowOffset 平移+rotateY
        每个 slot:  cover(CanvasCover 或 renderFallback 标题) + 行下方 travelling identity

松手 settle → animateOffsetTo(snap) → commitAndHandoff()
  ├─ playIndex(target=B)  → store.currentIndex = B
  ├─ awaitingHandoffRef = true
  └─ 等 base 画出 B 封面 (onCoverReady===B)
        → setTimeout(HANDOFF_BASE_SETTLE_MS 260ms)
        → beginHandoffFade(): handoffFading=true
              overlay 整体 opacity 1→0 over HANDOFF_FADE_MS 280ms   ← #1 标题随之淡出
        → closeOverlay(): active=false
              base StageIdentity opacity 0→1 瞬间出现           ← #1 标题瞬间淡入
```

`HANDOFF_BASE_SETTLE_MS` / `HANDOFF_FADE_MS` / 整套 `awaitingHandoffRef` 机制的**唯一目的是遮住 base 的「A→B 封面 *图片* crossfade」**（解码闪一下，注释里的「松手到 D 时闪一下 A」）。标题是纯文本、无解码、无 crossfade，却被绑在同一个 fading overlay 节点里一起淡出，base 那份又要等 `active` 翻 false 才瞬现 —— 于是同一份 B 文本「淡出→空档→瞬现」。

### 2.2 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **拖拽 / 动画** | motion/react `drag` + `animate(coverWindowOffset)` | 已有，连续拖拽走 MotionValue |
| **3D 变换** | 每 slot 命令式读 `coverWindowOffset.on("change")` 写 `transform` | 见 [`cover-pager-strip.tsx:99-110`](../../../src/components/player/cover-pager-strip.tsx#L99-L110) |
| **封面预载** | `usePreloadedCoverUrls` + `preloadCoverBatch`（串行 await + batchSeq 取消） | 见 [`cover-preload.ts`](../../../src/components/player/cover-preload.ts) |

### 2.3 关键文件

```
src/components/player/
├── swipeable-cover-stage.tsx     # hand-off 状态机 + identity 可见性（#1 主战场）
├── cover-pager-strip.tsx         # slot 3D transform + cover/identity 渲染
├── cover-pager.ts                # coverflowTransform（rotateY/scale/opacity 纯函数）
├── use-preloaded-cover-urls.ts   # 预载 hook（batchSeq 取消、settle 窗口）（#2 主战场）
├── cover-preload.ts              # preloadCoverBatch 串行解码 + burst filter
└── stage-identity.tsx            # 标题/歌手 pill（无自带过渡）
```

---

## 3. Root Cause 分析

### 3.1 #1 — 标题/歌手 commit 后淡出再出现

**症状**：拖拽 A→B，松手后标题区（title + artist·album pill）淡出，短暂空档，再淡入（内容仍是 B）。

**根因**：identity 被耦合进 cover 的 hand-off 遮罩。

- 拖拽期：base 行 673 的 `<StageIdentity>` 被 `opacity: active ? 0 : 1` 全程压成 0；可见的标题来自 overlay 里每个 slot 下方的 travelling identity（[`swipeable-cover-stage.tsx:600-609`](../../../src/components/player/swipeable-cover-stage.tsx#L600-L609) / [`cover-pager-strip.tsx:140-144`](../../../src/components/player/cover-pager-strip.tsx#L140-L144)）。
- commit：`commitAndHandoff` → `playIndex(B)`，此时 base 的 `current = queue[currentIndex]` **已经是 B**，行 673 已经渲染 B 的文本，但仍被 `active=true` 压到 opacity 0。
- hand-off fade：`handoffFading=true` 让**整个 overlay**（含 B 的 travelling 标题）`opacity 1→0`（`HANDOFF_FADE_MS` 280ms，[`swipeable-cover-stage.tsx:683-696`](../../../src/components/player/swipeable-cover-stage.tsx#L683-L696)）。
- `closeOverlay`：`active=false`，行 673 的 B 标题 `opacity 0→1` **瞬间**出现（plain div，无过渡，[`stage-identity.tsx`](../../../src/components/player/stage-identity.tsx) 也无自带 fade）。

净效果：**同一份 B 文本被淡出（overlay）+ 瞬现（base）**。封面需要这套 fade 是因为它有解码 crossfade flash；文本没有，所以这次 fade 对文本是纯多余。

**结论**：identity 的 hand-off 必须与 cover 的 hand-off **解耦**。文本可以在 commit 瞬间直接定格到 B（overlay 文本立即让位、base 文本立即显示），因为 B==B，无任何可见跳变；只有封面图保留 `HANDOFF_FADE_MS` 那套谨慎遮罩。

### 3.2 #2 — 多次/快速拖拽后丢失 3D、侧封面变空

**症状**：连续拖几次后，左右 slot 不再显示封面图，coverflow 看起来像「水平平移标题」，立体感消失。用户猜是 burst 限制。

**根因（主）**：快速连续 recenter 反复**取消并重启**封面预载批次，邻居封面来不及解码就被作废，侧 slot 回退到 `renderFallback`（标题占位），于是「看不到侧封面」；rotateY 仍在施加，但没有封面图、只剩标题卡，立体感读不出来，看起来就是平移。

证据链：
- 每次跨过一个整步 `driveOffset`→`recenterBy`→`setCenterIndex`（[`swipeable-cover-stage.tsx:280-311`](../../../src/components/player/swipeable-cover-stage.tsx#L280-L311)）。
- `centerIndex` 变 → `win`/`offsetTracks`/`candidates`/`requests` 全部重算 → `usePreloadedCoverUrls` 的 load effect 依赖 `[activeRequests]` 变化 → cleanup 把上一批 `alive=false` + 新 effect `batchSeqRef.current += 1`，使上一批 `isCurrent()` 返回 false → **cancel**（[`use-preloaded-cover-urls.ts:77-122`](../../../src/components/player/use-preloaded-cover-urls.ts#L77-L122)）。
- `preloadCoverBatch` 是 `for` 循环里**串行 `await`** 每个封面的 IndexedDB blob 解析 + `decode()`（[`cover-preload.ts:153-226`](../../../src/components/player/cover-preload.ts#L153-L226)）。5 个 slot 串行解码耗时，若每 ~100ms 就 recenter 一次，批次在邻居解析完之前就被作废。
- `setUrls` 只在**未取消**的批次完成后才提交（[`use-preloaded-cover-urls.ts:104-108`](../../../src/components/player/use-preloaded-cover-urls.ts#L104-L108)）。持续取消 → `urls` 停留在旧 center 的 trackId → 新 center 的邻居 `coverUrls[track.id] ?? null = null` → slot `content.coverUrl = null` → 走 `renderFallback`（[`cover-pager-strip.tsx:128-137`](../../../src/components/player/cover-pager-strip.tsx#L128-L137)）。

**关于用户的「burst 限制」猜测**：方向对了一半，但**不是主因**。
- `filterCoverPreloadRequestsForBurst`（[`cover-preload.ts:110-116`](../../../src/components/player/cover-preload.ts#L110-L116)）确实会在非拖拽态丢掉非 current 的本地封面，但拖拽时 `usePreloadedCoverUrls(candidates, active)` 的 `forceNonCurrentLocal=active=true`，burst filter 被**绕过**，邻居本来是要载的。所以让侧封面消失的不是 burst filter，而是上面的**批次取消 churn + 串行解码**。
- 另有一处**真的会跳过 3D 的 burst 路径**，但属于 *外部/程序化* 切歌（不是手指拖拽）：external-switch layout effect 里 `burst = activeAnimation != null` 或远跳时直接 `coverWindowOffset.set(0)` + `closeOverlay()`，无 slide（[`swipeable-cover-stage.tsx:463-502`](../../../src/components/player/swipeable-cover-stage.tsx#L463-L502)）。连点上一首/下一首会走这里、无 coverflow。需在 PRD 中与拖拽场景区分，避免修错地方。

**次要因素（待 Phase 1 用 trace 确认占比）**：
- `coverflowTransform` 的 opacity 在 ±1 整步处为 0（[`cover-pager.ts:107-119`](../../../src/components/player/cover-pager.ts#L107-L119)），即「静止时侧封面本就不可见、只在拖拽中途可见」是设计，不是 bug；但若邻居图未就绪，中途也只能露出标题占位。
- 串行解码本身的延迟（即便不取消）也可能让快速拖拽时邻居图慢一两帧到位。

---

## 4. 验收信号（measurement-first）

> 遵循 prd-create.md 第 4 节「性能/卡顿类先写测量方法学」精神：先能稳定**复现 + 观测**，再改。

- **#1 验收**：commit 后用 RenderTraceBoundary / 逐帧录屏确认标题区在 hand-off 窗口内 opacity 不再出现 `1→0→1` 序列；A→B 拖拽松手后标题**单调定格** B，无淡出。
- **#2 验收**：脚本化「连续 N 次（≥6）相邻拖拽 + 快速多步拖拽」，断言侧 slot 的 `content.coverUrl` 命中率（非 null 比例）在拖拽窗口内 ≥ 阈值；rotateY 始终非零（已有）。**测试必须用有封面的歌曲**（idx 183-192 区段；部分歌曲无封面会误判，见用户 2026-06-17 反馈 [[switch-song-playcount-fanout-fix]] 同一测试纪律）。
- 复测在 prod-preview（dev StrictMode 双渲染会放大 ~3x，且会多触发一次批次取消，污染 #2 基线）。

---

## 5. Implementation Plan

### Phase 1: 观测先行

**Goal:** 让两个症状都有可脚本化的 before/after ground truth。

**Tasks:**
- [ ] 给 hand-off 各阶段（commit / awaitingHandoff / baseCoverShown / handoffFading / closeOverlay）打 render-trace 标记，记录标题区与 base/overlay 的可见性时间线。
- [ ] 扩 `render-sweep` / `perf-gesture` 增加「连续相邻拖拽 ×N」「快速多步拖拽」两个场景，dump 每次 recenter 后侧 slot 的 `coverUrl` 命中率 + 预载批次 canceled 次数（`CoverPreloadStats.canceled`）。

### Phase 1 Checklist
- [ ] 能稳定复现 #1 的 `1→0→1` opacity 序列
- [ ] 能量化 #2 的批次取消次数与侧封面 null 率

### Phase 2: 修复 #1（identity 与 cover hand-off 解耦）

**Goal:** commit 即把标题定格到 B，封面保留既有遮罩。

**候选方案（择一，Phase 1 后定）：**
- **(A) 推荐**：identity 不进 overlay 的 `handoffFading` 淡出。commit 瞬间：overlay 的 travelling identity 立即隐藏、base 行 673 的 identity 立即显示（用独立于 `active` 的「identity 已 commit」标志，而非等 `closeOverlay`）。封面 overlay 继续按 `HANDOFF_FADE_MS` 淡出。
- **(B)** base identity 始终常显 committed `current`（opacity 恒 1），overlay 仅负责拖拽中途的 travelling 文本，commit 即停渲 overlay 文本。

**Tasks:**
- [ ] 拆分 identity 可见性，不再 `opacity: active ? 0 : 1` 一刀切
- [ ] 确认拖拽中途 travelling 文本仍随 slide（不能因解耦而让拖拽时标题不动）
- [ ] 不影响封面的 flash 遮罩（#1 修复不得让封面 A-flash 回归）

### Phase 2 Checklist
- [ ] A→B 松手后标题无淡出、单调定格 B
- [ ] 拖拽中途标题仍随封面一起平移
- [ ] 封面 A-flash 未回归（回归测 dock-swipe-jank 场景）

### Phase 3: 修复 #2（侧封面在快速拖拽中保持）

**Goal:** 连续/快速拖拽时侧 slot 仍显示封面图，3D 不退化。

**候选方向（Phase 1 后据数据定，不预设全做）：**
- **(a)** 预载在 recenter 时**增量更新**而非整批取消：`setUrls` 改为合并保留已解析、仅补新邻居（避免 churn 把已就绪的图也丢回 null）。
- **(b)** `preloadCoverBatch` 邻居解码**并行**（`Promise.all`）而非串行 `await`，缩短就绪窗口。
- **(c)** recenter 时把「即将成为新中心邻居」的图预热（拖拽方向上多预载一格），抵消串行延迟。
- **(d)** 侧 slot 在封面图未就绪时显示 thumbhash/低清占位（而非纯标题），保住立体感——但需评估是否构成「软化」UI 取舍。

**Tasks:**
- [ ] 选定方向并实现（优先 a/b，侵入小、无 UI 取舍）
- [ ] 区分手指拖拽 vs 外部 burst 路径，确保只改拖拽侧封面就绪，不动外部 burst 的 snap 行为（除非另行确认）

### Phase 3 Checklist
- [ ] 连续 ≥6 次相邻拖拽侧封面命中率达标
- [ ] 快速多步拖拽（一帧跨多步）侧封面不全空
- [ ] 不回退 dock-swipe-jank / reactivity 性能基线（prod-preview 复测）

---

## 6. Out of Scope

- 移动端触摸专属调优（本期桌面优先；布局保持 responsive，但不专门验移动手势）。
- 外部 burst（连点上一首/下一首）是否也要走 slide 动画 —— 当前 hard-snap 是刻意的，本期不改，仅在分析中区分。
- 封面解码/上传的 GPU `drawImage` 固有成本（已在 `reactivity-render-observability` PRD 裁决「接受现状」）。
- 任何 hidden flag / runtime kill switch —— 回退一律 `git revert`（硬规则 3）。

---

## 7. Related Documents

| Document | Description |
|----------|-------------|
| [20260617 dock-swipe-switch-jank PRD](../20260617-muzero-dock-swipe-switch-jank-prd/) | 切歌 overlay 遮罩、external-switch layout effect 的来历 |
| [20260617 reactivity-render-observability PRD](../20260617-muzero-reactivity-render-observability-prd/) | render-trace / render-sweep / perf-gesture 工具链 + 封面切换裁决 |

---

## 8. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | #2 主因是「批次取消 churn」还是「串行解码延迟」占比更大？ | Open | Phase 1 用 `canceled` 次数 + 命中率量化后定 Phase 3 方向 |
| 2 | 侧 slot 未就绪时是否接受 thumbhash 占位（方向 d）作为兜底？ | Open | 若 a/b/c 已达标则不引入，避免 UI 取舍 |
| 3 | identity 解耦用方案 (A) 还是 (B)？ | Open | Phase 1 看 travelling 文本在 (B) 下是否仍自然随 slide |

---

## 9. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-18 | DoodleBears / Claude | 初稿：两个 coverflow 视觉缺陷的根因调研 + 三 Phase 计划 |
