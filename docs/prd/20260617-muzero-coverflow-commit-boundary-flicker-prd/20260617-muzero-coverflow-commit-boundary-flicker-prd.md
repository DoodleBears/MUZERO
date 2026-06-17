# PRD: Coverflow 拖拽 commit 边界的描边 / 背景闪烁与卡顿修复（Commit-Boundary Flicker & Jank）

**Status:** Draft
**Created:** 2026-06-17
**Author:** Claude（调查）/ DoodleBears（拍板）
**Module:** Now Playing 沉浸式封面流（windowed coverflow）↔ Pixi 背景 ↔ 取色 ↔ Electron 窗口描边 —— commit 点位的视觉与节奏一致性

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 0 | 观测先行：补 commit 边界的 frame cadence + longtask 指标（纯 observability，可独立 ship） | 🔲 Pending | [Phase 0 Checklist](#phase-0-checklist) |
| 1 | 描边色修复：commit 不再闪回旧封面色（endpoint re-base / 绝对模型） | 🔲 Pending | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | 背景修复：offset 重置与窗口 re-center 原子化（消除 stale 帧） | 🔲 Pending | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | 卡顿修复：把 commit 重活移出 snap-settle 帧（纹理交接 + defer + idle 预取） | 🔲 Pending | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | 收敛：三个平面统一到单一「绝对中心 + 分数 offset」坐标模型 | 🔲 Pending | [Phase 4 Checklist](#phase-4-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending
> **硬约束：用户可见行为只允许变「更顺」，不改设置项、不动 codename 层（`muzero-db` / id 前缀 / provider id）。每个 phase 可独立 `git revert`，回退不藏 hidden flag（沿用 `feedback_no_hidden_backend_flags`）。**

---

## 1. Overview

### 1.1 Background

Now Playing 的封面区是一个 **windowed、可连续拖拽的 coverflow**（[`swipeable-cover-stage.tsx`](../../../src/components/player/swipeable-cover-stage.tsx)）：一个 ±2 的回收窗口（`RADIUS = 2`，共 5 个常驻 slot/sprite），用户可以拖着它**在一次手势里连续跨过多首歌**（拖到下一张、还没落定就继续拖到再下一张，双向无限）。视觉中心 `centerIndex` **领先**已提交的 `currentIndex`；store 只在手势 settle 后才 commit（避免背景静止层 re-point 到未解码封面 —— 旧的「闪黑」）。同一套 `coverWindowOffset` MotionValue + 推送的窗口内容，驱动 **Pixi 背景**（[`cover-window-store.ts`](../../../src/components/player/cover-window-store.ts) + [`pixi-background-controller.ts`](../../../src/components/player/pixi-background-controller.ts) 的 lockstep window mode）和 **Electron 窗口描边色**（[`App.tsx` `useWindowBorderDragColor`](../../../src/App.tsx#L434-L487)）与彼此 lockstep。

这套架构（环状回收 + 取色影响描边 + 背景 lockstep）**已经实现**。本 PRD 不是从零搭，而是修它在 **commit 边界**（拖到一首歌完全居中、松手提交那一刻）暴露的三个缺陷。

### 1.2 症状（用户报告，2026-06-17）

把「从 0 拖到 1，在 1 完全 drag 到 center 的位置」这一步拆开看：

1. **描边闪回旧色**：commit 那一刻，Electron 窗口描边会**闪一下 index 0（上一首）的封面色**，然后才落到 index 1 的色。
2. **背景闪烁**：同一刻，Pixi 背景也会闪一下（短暂回到上一张封面）。
3. **卡顿 / 顿挫**：拖到完全到位、snap 落定的那个点位，有明显的「咔哒、顿一下」的手感。

三者都精确发生在 **snap 居中 → recenter → commit** 这个边界帧，指向同一类根因：**「视觉已落定」与「数据/坐标 re-base」不是原子的**。

### 1.3 Target Users

| Role | Description | 关注点 |
|------|-------------|--------|
| **终端用户（桌面播放器）** | 用封面流拖拽切歌 | 拖拽切歌应当**全程顺滑**：描边/背景/封面三平面颜色一致、不闪、不顿 |
| **维护者（本人）** | 后续要在 flow 模式上继续加效果 | commit 边界有明确的坐标模型与不变量，不要每加一层就踩一次闪烁 |

### 1.4 Core Value

1. **顺滑**：拖拽切歌（含多首连拖）在 commit 边界无描边/背景闪烁、无顿挫 —— 这是「沉浸式」的下限。
2. **一致**：前景封面、Pixi 背景、描边色三个平面在任意拖拽瞬间显示**同一首歌**的内容/取色。
3. **可维护**：把当前「recenter-相对窗口」与「frozen-endpoint 描边」两套坐标系收敛成一套，消除整类 off-by-one-frame bug。

---

## 2. System Architecture

### 2.1 当前 commit 边界的数据流（从拖拽到落定）

```
用户拖拽（pointer / wheel）
  └─ driveOffset(offsetSteps)                         swipeable-cover-stage.tsx
       ├─ coverWindowOffset.set(offsetSteps)          ── 共享 MotionValue（每帧）
       │     ├─▶ [背景] PixiPixelBackground 监听 → controller.setWindowOffset(steps)
       │     │       └─ applyWindowLayout(): sprite.alpha = 1 - |slotOffset + windowOffsetSteps|
       │     └─▶ [描边] swipeable-cover-stage 监听(L435-450) → transitionProgress.set(|offset|)
       │             └─▶ App.tsx useWindowBorderDragColor 监听 → 描边 = lerp(fromColor,toColor,progress)
       └─ pendingRecenterSteps(offset) ≠ 0 → recenterBy(±1)（跨过一整步时）

松手 → settle()
  └─ animateOffsetTo(target=±1, SNAP_DURATION) ──(onDone)──┐
                                                            ▼
     recenterBy(±1):  centerIndexRef = stepCenter(...)      // 视觉中心 +1
                      pendingResetRef += step
                      setCenterIndex(...)                    // ← React 重渲染
        │
        ├─ useLayoutEffect(L272-278)  [pre-paint]            // 偏移重置（同步）
        │     coverWindowOffset.set(get() - delta)  → 回到 0
        │        ├─▶ [背景] setWindowOffset(0)  作用在【旧】sprite ring（内容还没换）
        │        └─▶ [描边] transitionProgress.set(0) → App.tsx 画 fromColor=【旧】色
        │
        ├─ useEffect(L234-249)        [post-paint]           // 窗口内容 re-base（晚一拍）
        │     setCoverWindow({active, 新 slots}) → controller.setWindow(...)
        │        └─ 重新按 src re-key sprite ring，新中心 sprite 落到 offset 0
        │
        └─ commitAndHandoff():
              setCoverGestureActive(false)                   // DJ refill 解禁（最差时机）
              playIndex(target)                              // ← store 大提交 + 音频 load + liveQuery 级联 + 新封面解码
              awaitingHandoff = true → (base 画好后) beginHandoffFade（280ms 淡出 overlay）
```

### 2.2 关键：现在有**两套坐标系**在 commit 边界打架

| 平面 | 坐标模型 | commit 时行为 |
|------|----------|---------------|
| **前景 strip / Pixi 背景窗口** | **recenter-相对**：每跨一整步，`centerIndex += 1`、`offset` 减 1 回到 0；「什么在 offset 0」始终相对**当前**中心 | offset 重置到 0 = 落在新中心 —— 但前提是窗口内容已 re-base |
| **描边色 `useNowPlayingTransition`** | **frozen-endpoint**：`begin()` 时冻结 `fromColor=旧中心色` / `toColor=邻居色`，`progress 0→1` 映射整段；**recenter 不会重置 endpoint** | offset 重置 → `progress=0` → 画 `fromColor`=**旧中心色**（与 recenter 后的真实中心错位） |

这两套模型在 §2.1 的 `[pre-paint]` 那一拍**短暂不一致**，就是三个症状的共同根。

---

## 3. Root Cause Analysis

### RC-1：描边 commit 闪回旧封面色

**链路**：拖拽时 [`beginBorderTransition`](../../../src/components/player/swipeable-cover-stage.tsx#L418-L430) 调 `useNowPlayingTransition.begin(from=getVisualizerCoverColorRgb()??色(中心), to=色(邻居))`，endpoint 冻结。[`App.tsx` apply](../../../src/App.tsx#L457-L477) 每帧画 `lerp(fromColor, toColor, transitionProgress)`。

**闪烁的精确机制**：
1. snap 动画把 `coverWindowOffset` 拉到 ±1 → `transitionProgress=1` → 描边 = `toColor`（新色，正确）。
2. onDone → `recenterBy` → `setCenterIndex` → [`useLayoutEffect`](../../../src/components/player/swipeable-cover-stage.tsx#L272-L278) 同步 `coverWindowOffset.set(0)`。
3. 这触发 [stage 的 offset 监听](../../../src/components/player/swipeable-cover-stage.tsx#L440-L447)：`offset≈0 → dir=0 →` **不** re-begin endpoint，只 `transitionProgress.set(0)`。
4. `useNowPlayingTransition.active` **仍是 true**（`end()` 要等 handoff 淡出后的 `closeOverlay` 才调）。于是 [`App.tsx` apply](../../../src/App.tsx#L457-L477) 以 `t=0` 画 `fromColor` = **旧中心(index 0)色** → 闪。
5. 描边卡在旧色直到 handoff 结束 → `closeOverlay` → `end()` → 静止态 [`useAppearanceCssVars`](../../../src/App.tsx#L396-L422) 才把描边收敛到 `currentIndex=1` 的取色（而取色本身还有 [`COVER_COLOR_APPLY_SETTLE_MS = 650ms`](../../../src/stores/visualizer-color-store.ts#L5) 延迟）。

> App.tsx 里[已有一个 guard](../../../src/App.tsx#L458-L463) 专门防「`end()` 之后 stage 把 progress 归 0」的 flash-back，但它只在 `active === false` 时生效。**recenter-mid-active** 这条路 `active` 仍是 true，guard 漏掉 —— 这正是缺口。

**根因**：recenter 后 `offset` 归 0，但描边的 frozen endpoint **没有 re-base 到新中心**；`offset=0` 被描边模型解释成「progress 0 = fromColor = 拖拽前的封面色」。

**加重项（多首连拖）**：[stage 的 offset 监听](../../../src/components/player/swipeable-cover-stage.tsx#L440-L447) 只在**方向翻转**时 `beginBorderTransition`（`borderDirRef`），同方向跨过第二步**不**重置 endpoint。于是从歌 1 拖向歌 2 时，描边还在 `色(0)→色(1)` 之间插值，整段错位。

### RC-2：Pixi 背景 commit 闪回旧封面

**链路**：window mode 下 [`PixiPixelBackground`](../../../src/components/player/pixi-pixel-background.tsx#L157-L195) 把 `coverWindowOffset → controller.setWindowOffset`，[`applyWindowLayout`](../../../src/components/player/pixi-background-controller.ts) 令 `sprite.alpha = 1 - |slotOffset + windowOffsetSteps|`（中心 sprite 满 alpha）。

**闪烁的精确机制**：commit onDone 的 [`useLayoutEffect`](../../../src/components/player/swipeable-cover-stage.tsx#L272-L278)（**pre-paint**）同步把 `coverWindowOffset` 归 0 → `setWindowOffset(0)` 立刻作用在**旧 sprite ring**（内容仍中心在 index 0，因为换内容的是另一条 effect）→ 旧中心 sprite 的 `alpha = 1 - |0+0| = 1` → **旧封面满屏可见**。浏览器在这一帧 paint（闪）。随后 [推送新窗口的 `useEffect`](../../../src/components/player/swipeable-cover-stage.tsx#L234-L249)（**post-paint**）才跑 `setCoverWindow → controller.setWindow`，把 sprite ring 按 src re-key、新中心落到 offset 0、旧中心 alpha 归 0 —— 但已经晚了一帧。

**根因**：**offset 重置（`useLayoutEffect`，pre-paint）与窗口内容 re-base（`useEffect`，post-paint）不在同一拍** → 中间存在「offset=0 但内容还是旧中心」的 stale 帧。

### RC-3：snap 落定点的「顿一下」

commit onDone 在**一帧内同步**砸下一大坨主线程重活：
- `recenterBy → setCenterIndex` → SwipeableCoverStage 重渲染：`peekWindowFrom`、`offsetTracks`、`candidates`、`slots` 重算 → `setCoverWindow` → `controller.setWindow` → **dispose 旧边 sprite + `deps.loadMedia` 解码新边封面**（±2 那张）。
- `commitAndHandoff → playIndex(target)`：store 大提交 → `AudioEngine` 载入新音轨 + liveQuery 级联（[`now-playing-background.tsx`](../../../src/components/player/now-playing-background.tsx) 整棵树重渲染、`MediaStage` 解码已提交封面、歌词查询等）。
- `setCoverGestureActive(false)` 让 [DJ `maybeRefill`](../../../src/stores/player-store.ts) **在此刻解禁**，可能立即追加队列（最差时机）。

这些**解码 + store + liveQuery** 的突发全部落在 snap 视觉刚落定的那一帧 → 一个长任务（long task）→「咔哒」。注意：被 commit 的那首封面**其实已经解码过了**（它就是窗口里居中的 sprite），却又走 `setSource` 路径**再解码一次**，纯浪费。

---

## 4. 测量方法学（先量再改 —— 来自 prd-create §4）

「顿一下」类问题必须先把症状变成**可见的 before/after 指标**，否则会「凭感觉调参 + 无法验证」。

- **症状是否 layer-type 无关**：先确认闪烁/顿挫在 generated 本地封面、uploaded 封面、QQ streamed 远程封面三类上都复现。若都复现，根因在公共 commit 路径（本 PRD 的假设），而非某条封面来源专用路径。
- **渲染耗时 ≠ 卡顿**：`renderDuration` 健康不代表不顿。「顿一下」是渲染 tick **之间**的主线程停顿（解码 burst / liveQuery 反序列化 / GC / layout）。必须分别测「渲染耗时」与「呈现帧间隔」。
- **必测指标**（验收标准的一部分）：
  - **frame interval**：Pixi/canvas 预览无 `<video>`，用 `requestAnimationFrame` 间隔测真实合成帧节奏（commit 那一拍的 `frame max` 飙升 = 顿）。
  - **Long Tasks API**：`PerformanceObserver({ entryTypes: ["longtask"] })` 记录 commit 前后每一次 ≥50ms 停顿，是「顿一下」的无歧义信号。
  - **描边/背景一致性**：在 commit 边界采样 `--electron-window-border-color` 与窗口中心 sprite 的 src，断言它们指向同一 trackId（闪烁 = 出现不一致帧）。
- **prod build 复测**：数字必须在 `make desktop-build` 或 prod serve 下采；dev 的 StrictMode + HMR + sourcemap 会污染基线，且 StrictMode 的双跑 effect 会放大 commit effect 时序问题。
- **观测先行**：Phase 0 只补指标（纯 observability、低风险），给后续优化 phase 提供 ground truth。

---

## 5. 设计方向

### 5.1 核心思路：收敛到单一「绝对中心 + 分数 offset」模型

三个平面（前景 strip / Pixi 背景窗口 / 描边色）都应从**同一个绝对量**派生当前显示：

```
显示内容/色 = f(centerTrackId, neighbourTrackId(dir), |offset|)
```

其中 `centerTrackId` 与窗口 slots 一起 re-base，`offset` 是相对**当前**中心的分数位移。这样「offset 归 0」永远意味着「落在当前中心」，三平面对 `offset=0` 的解释天然一致 —— RC-1 的 frozen-endpoint 错位、RC-2 的坐标系打架都从根上消失。

描边色不再用 `transitionProgress(0→1) × frozen(from,to)`，而是：`描边 = lerp(色(centerTrack), 色(dir 邻居), |offset|)`，`center`/`邻居` 随 recenter 同步 re-base。

### 5.2 原子化 commit（RC-1 / RC-2 的直接修法，Phase 1-2 先落地）

在不立刻做大重构的前提下，先让「offset 重置 + 内容 re-base + endpoint re-base」**在同一个 `useLayoutEffect`（pre-paint）里原子完成**：

1. 把 [推送窗口内容的 `useEffect`](../../../src/components/player/swipeable-cover-stage.tsx#L234-L249) 在 recenter 路径上提升为 **layout 阶段**（或在 recenter 的 layoutEffect 里直接 `setCoverWindow` + 命令式 `controller.setWindow`），保证 `coverWindowOffset.set(0)` 与新 slots 在同一帧、paint 之前都就位 → 无 stale 背景帧（RC-2）。
2. 在同一处 recenter 时**同步 re-base 描边 endpoint**（`begin(色(新中心), 色(新邻居))`）或直接切到 §5.1 的绝对色模型 → `offset=0` 落在新中心色，不再闪回旧色（RC-1）。
3. App.tsx 的 [flash-back guard](../../../src/App.tsx#L458-L463) 扩展到覆盖 recenter-mid-active（不止 `active===false`）。

### 5.3 把 commit 重活移出 snap-settle 帧（RC-3，Phase 3）

- **复用已解码纹理**：commit 的封面就是居中 window sprite，用 [`clearWindow` 的纹理交接](../../../src/components/player/pixi-background-controller.ts)（中心纹理直接交给 resting sprite）替代 `setSource` 再解码；前景 `MediaStage` 同理优先复用 preload 过的 cover（[`usePreloadedCoverUrls`](../../../src/components/player/use-preloaded-cover-urls.ts) 已解码）。
- **defer 重提交**：把 `playIndex(target)` 的非视觉部分（音频 load、liveQuery 触发的级联）从 snap-settle 帧 defer 到下一个 `rAF` / idle，让落定帧只做轻量视觉收尾；或评估「commit-at-threshold」（越过阈值即提交 store，settle 只做收尾），把重活摊到拖拽中而非边界。
- **±2 边缘封面 idle 预取**：recenter 渲染时**不要**同步 `loadMedia` 新边封面，调度到 idle。
- **DJ refill 时机**：`setCoverGestureActive(false)` 之后的 `maybeRefill` 延后到视觉落定之后再解禁，别在落定帧追加队列。

---

## 6. Implementation Plan

### Phase 0: 观测先行（observability）

**Goal:** 把 commit 边界的闪烁与顿挫变成可见 before/after 指标。

**Tasks:**
- [ ] 在 dev perf HUD / 诊断里加 `requestAnimationFrame` frame-interval 采样（`frame p99` / `frame max`），标注 commit 时刻。
- [ ] 加 `PerformanceObserver(["longtask"])`，记录 commit 前后 ≥50ms 停顿（`longtask max` / count）。
- [ ] 加 commit-边界一致性探针：采样描边色 trackId vs 背景中心 sprite trackId vs `currentIndex`，记录不一致帧。
- [ ] 三类封面（generated / uploaded / QQ streamed）各跑一遍，确认症状 layer-type 无关。

### Phase 0 Checklist
- [ ] prod build 下能稳定复现并量到 commit 帧的 `frame max` 飙升 + 描边/背景不一致帧
- [ ] 指标改动是纯 observability、零行为变更，可独立先 ship

### Phase 1: 描边色 commit 不再闪回旧色

**Goal:** RC-1 消除。

**Tasks:**
- [ ] recenter 时同步 re-base 描边 endpoint（或切绝对色模型 `lerp(色(中心),色(邻居),|offset|)`）。
- [ ] 同方向多步连拖每步都 re-base endpoint（修 `borderDirRef` 只认方向翻转的漏洞）。
- [ ] App.tsx flash-back guard 覆盖 recenter-mid-active。

### Phase 1 Checklist
- [ ] 单步 0→1 commit：描边全程 色(0)→色(1) 单调，无 色(1)→色(0)→色(1) 回闪
- [ ] 连续多步拖拽：描边每一步都跟随当前中心/邻居，无跨步错位
- [ ] [`now-playing-transition.test.ts`](../../../src/lib/now-playing-transition.test.ts) / [`electron-window-appearance.test.ts`](../../../src/lib/electron-window-appearance.test.ts) 补 recenter re-base 用例

### Phase 2: 背景 offset 重置与窗口 re-center 原子化

**Goal:** RC-2 消除（无 stale 背景帧）。

**Tasks:**
- [ ] 在 recenter 的 `useLayoutEffect` 里让 `coverWindowOffset.set(0)` 与新 slots 推送 + `controller.setWindow` 同帧、pre-paint 完成。
- [ ] 验证 sprite ring 按 src re-key 时，居中 sprite 不被重新解码（[controller 注释承诺只回收一个边 sprite](../../../src/components/player/pixi-background-controller.ts)）。

### Phase 2 Checklist
- [ ] commit 边界逐帧（或一致性探针）确认背景中心始终是已提交封面，无回闪上一张
- [ ] [`pixi-background-controller.test.ts`](../../../src/components/player/pixi-background-controller.test.ts) 补「offset 归 0 与窗口 re-base 同帧」不变量

### Phase 3: 卡顿 —— commit 重活移出落定帧

**Goal:** RC-3 消除（commit 帧 `frame max` / `longtask` 回落）。

**Tasks:**
- [ ] commit 复用居中 window sprite 的已解码纹理（纹理交接），不再 `setSource` 二次解码。
- [ ] `playIndex` 的非视觉部分 defer 到 rAF/idle（或评估 commit-at-threshold）。
- [ ] ±2 边缘封面改 idle 预取，不在 recenter 渲染里同步解码。
- [ ] `maybeRefill` 解禁延后到视觉落定之后。

### Phase 3 Checklist
- [ ] prod build 下 commit 帧 `frame max` 显著回落、commit 处无 ≥50ms longtask（Phase 0 指标 before/after）
- [ ] 拖拽落定手感无「咔哒」；快速连拖不掉帧

### Phase 4: 坐标模型收敛（可选 / 防回归）

**Goal:** 把前景/背景/描边统一到 §5.1 单一绝对模型，作为整类 off-by-one-frame 的结构性预防。

**Tasks:**
- [ ] 抽出共享的 `windowProjection(center, offset)` 纯函数，三平面共用、穷举单测。
- [ ] 移除 `transitionProgress + frozen endpoint` 这条与 recenter 模型并行的旧路径（确认无其它消费者）。

### Phase 4 Checklist
- [ ] 三平面在任意拖拽瞬间显示同一 trackId（属性单测覆盖随机 offset 序列）
- [ ] 删除并行坐标路径后无回归

---

## 7. Out of Scope

- **非拖拽切歌**（按钮 / 快捷键 / 自动续播）的背景路径 —— 走 `setSource` 静止层，已另有 hold/crossfade 机制；本 PRD 只管拖拽 commit 边界。
- **QQ streamed 远程封面在普通切歌时 `pixiHoldsCover=false` 的黑闪**（[`now-playing-background.tsx:350-356`](../../../src/components/player/now-playing-background.tsx#L350-L356)）—— 那是独立老问题，可单独小补丁，不在本 PRD。
- 新的视觉特效 / 新 flow effect / 新 renderer。
- 移动端手势（本期桌面优先；模型修好后移动端自然受益）。
- 引入新依赖（embla / swiper 等）—— 现有自研环状窗口已满足，不新增 runtime owner。

---

## 8. Security / 隐私 Considerations

- 纯前端视觉/时序修复，无网络、无新出站请求、无新持久化。
- 取色（[`extractImagePalette`](../../../src/lib/image-palette.ts) / [`visualizer-color-store`](../../../src/stores/visualizer-color-store.ts)）全本地 canvas，描边色只写 CSS 变量，不上报任何色值（与 telemetry whitelist 一致）。
- 回退 = `git revert` 对应 phase + redeploy，**不藏** localStorage / URL / `window.*` flag。

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [now-playing-background-layer-consolidation-prd](../20260615-muzero-now-playing-background-layer-consolidation-prd/) | 背景 5 层审计与整合（本 PRD 的背景层上下文） |
| [immersive-flow-background-prd](../20260611-muzero-immersive-flow-background-prd/) | 流光背景层（commit 边界取色也影响它） |
| [now-playing-switch-background-perf-prd](../20260613-muzero-now-playing-switch-background-perf-prd/) | 切歌背景性能（frame cadence / longtask 方法学来源） |
| [now-playing-cover-handoff-regression-prd](../20260612-muzero-now-playing-cover-handoff-regression-prd/) | 封面 handoff 闪烁历史回归 |

## 关键代码位置

| 关注点 | 位置 |
|--------|------|
| 拖拽编排 / settle / recenter / handoff | [`swipeable-cover-stage.tsx`](../../../src/components/player/swipeable-cover-stage.tsx) |
| 偏移重置 layoutEffect（RC-2 stale 帧源） | [`swipeable-cover-stage.tsx:272-278`](../../../src/components/player/swipeable-cover-stage.tsx#L272-L278) |
| 窗口内容推送 useEffect（晚一拍） | [`swipeable-cover-stage.tsx:234-249`](../../../src/components/player/swipeable-cover-stage.tsx#L234-L249) |
| 描边 endpoint begin / 方向门 | [`swipeable-cover-stage.tsx:418-450`](../../../src/components/player/swipeable-cover-stage.tsx#L418-L450) |
| 共享窗口/offset 通道 | [`cover-window-store.ts`](../../../src/components/player/cover-window-store.ts) |
| Pixi lockstep window（setWindow/Offset/clearWindow） | [`pixi-background-controller.ts`](../../../src/components/player/pixi-background-controller.ts) |
| 背景 window 订阅 | [`pixi-pixel-background.tsx:157-195`](../../../src/components/player/pixi-pixel-background.tsx#L157-L195) |
| 描边色每帧驱动（RC-1 闪回点） | [`App.tsx:434-487`](../../../src/App.tsx#L434-L487) |
| frozen-endpoint 描边 store | [`now-playing-transition.ts`](../../../src/lib/now-playing-transition.ts) |
| 取色 settle（650ms） | [`visualizer-color-store.ts`](../../../src/stores/visualizer-color-store.ts) |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | 单步 commit 先用「recenter 同步 re-base endpoint」最小修，还是直接上 §5.1 绝对色模型？ | Open | 倾向 Phase 1 先最小修止血，Phase 4 再收敛 |
| 2 | `playIndex` defer 与「commit-at-threshold」二选一还是都做？后者改动更大但能根除落定帧重活 | Open | Phase 0 指标出来后定 |
| 3 | recenter 时把 `setCoverWindow` 提升到 layout 阶段，是否会和 ResizeObserver/scroll rect 的 useEffect 时序冲突？ | Open | 实现时验证 |
| 4 | 多首连拖时描边/背景的取色对「尚未解码的远程封面」如何兜底（thumbhash 占位色已有，是否够） | Open | 复用 [`trackBorderRgb`](../../../src/components/player/swipeable-cover-stage.tsx#L74-L79) thumbhash 兜底 |

---

## 附录 A：已修复的相关 bug —— 切 tab 后封面 overlay 残留（portal 泄漏）

**症状**：从 `now` tab 切到「全部歌曲 / 专辑」等其它 tab 后，Now Playing 的大封面 coverflow 卡片仍浮在 library 页面之上（截图 2026-06-17）。

**根因**：coverflow overlay 通过 [`createPortal` 挂到 `<main>`](../../../src/components/player/swipeable-cover-stage.tsx#L599-L602)（为逃逸滚动容器的裁剪）；而 tab 用 [`TabPanel` 的 `display:none`](../../../src/App.tsx#L508-L510) 隐藏，`<main>` 在 TabPanel **之外** → portal 内容逃逸了 `display:none`。同时 `foregroundVisible` 只反映「沉浸模式」，**不反映当前是哪个 tab**，所以切 tab 时 overlay 的 teardown 从不触发。

**修复（已落地）**：把「`now` tab 是否可见」作为 `pageActive` 透传：
- [`App.tsx`](../../../src/App.tsx#L312-L314)：`<NowPlayingPage … pageActive={tab === "now"} />`
- [`now-playing-page.tsx`](../../../src/pages/now-playing-page.tsx#L80-L90)：`foregroundVisible={!foregroundHidden && pageActive}`

`tab !== "now"` 时 `foregroundVisible=false` → overlay 渲染条件同步短路（不再 portal）+ teardown 清 `active` 与 `clearCoverWindow()`。这与本 PRD 的「窗口/手势状态在不该活跃时必须干净下线」是同一纪律，故记录于此。

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-17 | Claude（调查）| 初稿：commit 边界 描边/背景闪烁 + 顿挫 三根因（RC-1/2/3）定位 + 分阶段修复计划 |
| 2026-06-17 | Claude | 附录 A：修复切 tab 后 coverflow overlay portal 泄漏（`pageActive` 透传） |

---

> **Note:** 本 PRD 强调修改现有代码（windowed coverflow 已实现），核心是消除「视觉落定」与「坐标/内容 re-base」的非原子帧，并收敛两套并行坐标系。所有代码引用用相对路径，行号可能随演进漂移。
