# PRD: Coverflow 连续拖拽跨步（recenter）边界的 border 闪回 + 背景闪封面

**Status:** Draft
**Created:** 2026-06-18
**Author:** DoodleBears / Claude
**Module:** Now Playing 封面 coverflow 连续拖拽的 recenter 边界（`SwipeableCoverStage` + Electron window border + Pixi lockstep 背景）

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | 观测/复现：harness 抓跨步边界的 border 颜色 + 背景帧 | ⏭️ Blocked-by-data（见下） | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | 修复 #1：recenter 时 re-base border 过渡对（1→2，不闪回 0） | ✅ Completed（1ada9e0） | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | 修复 #2：recenter 时 Pixi 背景窗口内容与 offset 重置同帧 | ✅ Completed（052cd39） | [Phase 3 Checklist](#phase-3-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending | ⏭️ Skipped/Blocked

> **实现说明（2026-06-18）**
> - **Phase 1（数据受限）**：复用了 CDP 真拖拽 harness 做「连续跨 ≥2 步」。但当前测试队列是**同一张专辑**（*Arrowmancer Vol. 1*），相邻封面**同色同图**——border 颜色整段拖拽恒为 `rgba(113,145,218,1)`、背景封面也无可视差异，所以 harness **看不到** #1 的颜色回跳 / #2 的错封面（黑帧那类靠尺寸特征能抓，这类同色/同图抓不到）。两个缺陷均为**用户实测报告 + 代码机制明确**，故直接修；**运行时视觉确认需在相邻封面颜色/图案不同的队列上手测**（已在 PRD/commit 标注此限制）。
> - **#1（1ada9e0）**：[`swipeable-cover-stage.tsx`](../../../src/components/player/swipeable-cover-stage.tsx) 的 border apply effect 在 recenter 重跑时（`beginBorderTransition` 闭包已含新 neighbour），只要有方向的拖拽在飞就 re-base 过渡对到新 `中心→邻居`。该 effect 注释本就写了「…or a recenter lands」，此前只接了 dir-flip 一半。残留：recenter 那一帧因 App 端 border 消费是被动 effect + 闭包取色，理论上仍可能有 ≤1 帧旧色微闪，但消除了「整段第二步用错对、回跳 0 色」的主症状。
> - **#2（052cd39）**：两处协同——(a) 控制器 `setWindow` 把**已存在 sprite 的 offset 重定向 + 重排**移到 `await` 之前**同步**完成（recenter 的邻居本就已加载，纯 offset 重定向；只有真正的新边缘封面才异步加载）；(b) [`swipeable-cover-stage.tsx`](../../../src/components/player/swipeable-cover-stage.tsx) 把 cover window 的发布从被动 `useEffect` 提为 `useLayoutEffect`（在 paint 前、且按源码顺序在 offset-reset effect 之前跑），使 sprite 在 offset 重置重新定位之前就已携带新 offset。
> - **验证**：`tsc` 干净；`pixi-background-controller` 20 测试 + `src/components/player` 全量 178 测试通过；Biome 干净。

> **#3 追加（e229d44）——commit（松手）后 border 闪回起点色再过渡**：用户复测 #1/#2 后报「1→4 连续拖、松手时 border 先回到起点色再过渡到 4」。这是 commit 边界（不是 recenter 边界）的 border reconciliation 问题，与 #1 同源但发生在松手时。
> - **harness 实证**（CDP 真拖拽 + 逐帧采 `--electron-window-border-color`，**diverse-cover 队列**才显现；同专辑队列同色看不到）：松手后 ~470ms border 跳到旧/暗色、再 ~650ms 后才回到 committed 色——**间隔 ≈ `COVER_COLOR_APPLY_SETTLE_MS`(650ms)**，铁证。
> - **根因**：settled border 读 [`visualizer-color-store`](../../../src/stores/visualizer-color-store.ts) 的 cover 色，而该 store 在切歌后**延迟 650ms** 才采用 committed 曲目的色（`transitionVisualizerCoverColor` 的 settle debounce，防切歌帧抖动）。drag-override 在 hand-off 释放时（早于 650ms）把 border 交还给 settled 路径，此刻 store 仍是 pre-drag 色 → 闪回。
> - **正解**：新增 `snapVisualizerCoverColor()`（立即应用、取消 pending settle），在 [`commitAndHandoff`](../../../src/components/player/swipeable-cover-stage.tsx) 用 committed 曲目的 palette 调用——让 settled 色在 commit 当下就等于 drag 落点。auto-advance/scrub 仍走原 debounce 路径。
> - **验证**：rebuild prod dist + CDP harness 实测，`[vcc:apply]` snap 在 commit 落地、border 松手后稳定停在 committed 色、**无闪回**（修复前：松手后 ~470ms 暗色闪、~650ms 后回正）。`tsc` 干净、187 测试（player + store）通过、Biome 干净。
> - **环境教训**：`make electron-profile` 跑的是 `vite build` 出的**生产 bundle**（`app://muzero`），不是 HMR dev server——改源码后必须**重新 `vite build` + reload** 才生效；`Page.reload` 只重载同一份旧 bundle。前几次"修了还闪"是测在旧 bundle 上。

---

## 1. Overview

### 1.1 Background

承接 [`20260618-coverflow-commit-flicker-and-3d-fallback`](../20260618-muzero-coverflow-commit-flicker-and-3d-fallback-prd/)（已修 commit 时的标题闪、3D 退化、背景闪黑）。本期是**连续 chained 拖拽**里**跨过一个整步（recenter）边界**时的两个新缺陷。

场景：队列 `[-2, -1, 0, 1, 2]`，当前在 `0`，**连续往一个方向拖**（不松手），拖过 `1` 这个整步、继续朝 `2` 去。在跨过 `1` 的那一刻（一次 recenter）：

1. **Electron window border 颜色闪回到 0 的颜色**，而不是从 `1` 的颜色朝 `2` 的颜色丝滑渐变。
2. **背景在跨过 `1` 的瞬间闪一下**——不是变黑（区别于上一个 PRD 的 #3），而像是**切到了另一张封面**（疑似漏出/切回了 `0` 的封面），观感与 #1 同源。

两者都只在 **recenter 边界那一帧**发生，本质是同一个根因家族。

### 1.2 Target Users

| Role | Description | Permissions |
|------|-------------|-------------|
| **听歌用户（桌面 Electron / Windows）** | 在 Now Playing 连续拖封面快速跨多首切歌；开启「封面色」window border | 纯本地 |

### 1.3 Core Value

1. **连续拖拽全程视觉连续**：border 颜色与背景都应随手指**单调地** A→B→C 过渡，跨步处不回跳、不漏帧。
2. **不回退既有修复**：本期是 recenter 边界的补丁，不得破坏上一个 PRD 的 commit-handoff 修复。

---

## 2. 现状机制（定位用）

### 2.1 连续拖拽的 recenter（offset 重置）

[`swipeable-cover-stage.tsx`](../../../src/components/player/swipeable-cover-stage.tsx)：

- 拖拽中 `driveOffset(offset)` 把 `coverWindowOffset` 设为连续值；跨过一个整步时 `pendingRecenterSteps(offset)≠0` → `recenterBy(±1)`（[L302-L311](../../../src/components/player/swipeable-cover-stage.tsx#L302-L311)）。
- `recenterBy` → `setCenterIndex(new)` + `pendingResetRef += step`（[L280-L286](../../../src/components/player/swipeable-cover-stage.tsx#L280-L286)）。
- **offset 重置在一个 `useLayoutEffect`（dep `[centerIndex]`）里**：`coverWindowOffset.set(get() - delta)`——把 offset 从 ~1 减回 ~0 残量，让拖拽无缝延续（[L272-L278](../../../src/components/player/swipeable-cover-stage.tsx#L272-L278)）。

**前景 coverflow（`cover-pager-strip`）没有问题**，因为它的 slot 内容是 React prop（`slots`，与 layout effect 同一次 commit 更新），transform 由 `coverWindowOffset.on("change")` 同步施加——内容 + offset 同帧落地（该文件注释明确说明这是为了避免"per-crossing flicker"）。问题出在两个**次级消费者**没有跟着 recenter 同帧 re-base。

### 2.2 #1 — Electron border 颜色

- border 颜色 = `lerp(fromColor, toColor, transitionProgress)`，`from/toColor` 在 `useNowPlayingTransition.begin()` 时**冻结**，`transitionProgress = abs(offset)`（[App.tsx useWindowBorderDragColor L457-L510](../../../src/App.tsx#L457-L510) + [now-playing-transition.ts](../../../src/lib/now-playing-transition.ts)）。
- 过渡对只在**方向翻转**时 re-begin：stage 的 apply effect `if (dir !== 0 && dir !== borderDirRef.current) beginBorderTransition(dir)`（[L435-L450](../../../src/components/player/swipeable-cover-stage.tsx#L435-L450)）。**recenter 不翻转方向**（仍朝同一方向），所以**不会 re-begin**，过渡对停在旧的 `(0色 → 1色)`。
- recenter 那一刻 `coverWindowOffset` 被重置回 ~0 → `transitionProgress` 同步变 ~0 → border = `lerp(0色, 1色, 0)` = **0 色**。继续拖时又从 0色→1色 lerp（错的对，应是 1色→2色）。

**根因 #1（code-confirmed）**：recenter 重置了 offset/progress，但**没有把 border 过渡对 re-base 到 `(1色 → 2色)`**，于是 progress 归零把 border 闪回旧对的起点（0 色）。

### 2.3 #2 — Pixi lockstep 背景闪封面

- Pixi 背景镜像 cover window：offset 由 `coverWindowOffset.on("change")` **同步**驱动（[pixi-pixel-background.tsx L167-L173](../../../src/components/player/pixi-pixel-background.tsx#L167-L173)）；窗口**内容**由 `setCoverWindow` 推送，经 `subscribeWindow` → `controller.setWindow` 重定向各 sprite 的 offsetSteps。
- 但 stage 推送窗口内容的 `setCoverWindow` 在一个**被动 `useEffect`（dep `[…, slots]`）**里（[L244-L249](../../../src/components/player/swipeable-cover-stage.tsx#L244-L249)），**晚于** offset 重置那个 `useLayoutEffect` 一帧（passive effect 在 paint 之后跑）。
- recenter commit 的时序：render → **layout effect 重置 offset（paint 前）→ Pixi `applyOffset` 同步用旧窗口内容重新布局** → **paint（旧中心=0 的封面被摆到中心 = 闪一下 0 的封面）** → 被动 effect `setCoverWindow` → `controller.setWindow` 重定向 offsets → 修正。

**根因 #2（强假设，待 harness 确认）**：recenter 时 Pixi 背景的 **offset 重置是同步的、而窗口内容重定向是异步/被动的**，二者差一帧 → 有一帧"用新 offset 摆旧内容"，把上一个中心（0）的封面摆到中心 → 一帧错封面闪现。前景不闪正因其内容+offset 同帧。

> ⚠️ #2 是依据代码时序的强推断；鉴于上一个 PRD 的背景闪黑曾两次误判、最终靠 harness（CDP 真拖拽 + 截图突发 + 控制台埋点、黑帧 ≈130KB vs 图像帧 ≈450KB）才定位，**#2 必须先用同样的 harness 在"连续多步拖拽跨边界"场景下复现确认**，再动手。

### 2.4 共同根因

> **recenter 把共享的 `coverWindowOffset` 同步重置了，但依赖它的两个次级视觉状态（border 过渡对、Pixi 窗口内容）没有在同一帧被 re-base。** 前景 coverflow 已通过"内容(prop)+offset(layout effect)同帧"避开；border 与 Pixi 背景走的是滞后/陈旧路径。

---

## 3. 验收信号（measurement-first）

沿用 `prd-create.md` 第 4 节与上一个 PRD 的 harness 方法学：

- **#1**：CDP 合成**一次跨 ≥2 步的连续拖拽**，每帧采 `--electron-window-border-color`（或 computed style）。验收：跨步处颜色**单调**从 1 色趋向 2 色，无回跳到 0 色的样本。
- **#2**：跨边界处截图突发（≥30fps），比对帧内容 / 文件大小特征。验收：跨步处**无**"中心摆出上一中心封面"的帧（可对 centre 区域做封面指纹/直方图比对）。
- prod-preview 复测（dev StrictMode 双 effect 会改变 passive/layout 时序，污染 #2）。

---

## 4. Implementation Plan

### Phase 1: 观测/复现
**Tasks:**
- [ ] 复活上一个 PRD 用过的 CDP 拖拽 harness，新增「连续跨 ≥2 步」场景，采 border 颜色序列 + 跨边界截图突发。
- [ ] 确认 #1 的颜色回跳样本、确认 #2 的错封面帧（指纹/大小）。

### Phase 1 Checklist
- [ ] #1 颜色回跳有可量化 before 证据
- [ ] #2 错封面帧有可量化 before 证据（确认是 0 的封面而非黑）

### Phase 2: 修复 #1（border 过渡对 re-base on recenter）
**Goal:** recenter 后 border 从 `1色` 朝 `2色` 续渐变，不闪回 0。

**候选：**
- (A 推荐) 在 recenter 落地处（`recenterBy` 或 centerIndex 的 layout effect）**重置 `borderDirRef = 0`** 并立即以新 `(center, 方向上的 neighbour)` 调 `beginBorderTransition`，使过渡对变为 `(1色 → 2色)`；此时 offset 重置回 ~0 恰好对应新对的起点，progress 续走即丝滑。
- (B) 让 `transitionProgress` 不在 recenter 归零跳变，而是把"已消费步"纳入一个累计进度模型（更大改动）。

**Tasks:**
- [ ] recenter 时以新中心/邻居 re-begin 过渡对
- [ ] 确认方向翻转、commit handoff 两条老路径不回归（[L463-L502](../../../src/components/player/swipeable-cover-stage.tsx#L463-L502)、上一个 PRD 的 commit fade）

### Phase 2 Checklist
- [ ] 连续跨多步：border 颜色单调过渡，无回跳 0
- [ ] 单步松手 commit 的 border 行为不变

### Phase 3: 修复 #2（Pixi 窗口内容与 offset 重置同帧）
**Goal:** recenter 跨步处背景不闪上一中心封面。

**候选（Phase 1 确认后定）：**
- (a) 把 `setCoverWindow` 从被动 `useEffect` 提升到 `useLayoutEffect`，并保证 existing-sprite 的 offsetSteps 重定向**同步**发生（`controller.setWindow` 对已存在 sprite 的 `windowSrcOffset.set` + `restackWindow` + `applyWindowLayout` 不经 `await`，把 `ensureApp` 的微任务从已就绪路径上摘掉），使其与 offset 重置同帧。
- (b) 像前景那样给 Pixi 也做"内容就绪后再施加 offset 重置"的 deferred reset（让 `applyOffset` 在窗口重定向后才用新 offset 布局）。
- (c) `setWindowOffset` 在 recenter 帧检测到"内容尚未重定向"时跳过这一帧的重布局（最小补丁，治标）。

**Tasks:**
- [ ] 选定方向实现，确保连续拖拽全程仍在 compositor、无新增每帧 React 渲染
- [ ] 不回退上一个 PRD 的 #3（window active 期背景常驻可见）与 commit handoff 的 clearWindow 中心 texture 移交

### Phase 3 Checklist
- [ ] 连续跨多步：背景无错封面帧
- [ ] commit、far-jump、burst 三条老路径背景不回归

---

## 5. Out of Scope

- 移动端触摸专属调优（桌面优先）。
- 把整套 overlay/base/Pixi 三层 hand-off 收敛成单一 source-of-truth pager 引擎的**重构**（embla-carousel 风格）——已 clone [reference-repo/embla-carousel](../../../reference-repo/) 作参考，但本期只做边界补丁；重构另起 PRD。
- 任何 hidden flag / runtime kill switch（硬规则 3，回退用 `git revert`）。

---

## 6. Related Documents

| Document | Description |
|----------|-------------|
| [20260618 coverflow-commit-flicker-and-3d-fallback PRD](../20260618-muzero-coverflow-commit-flicker-and-3d-fallback-prd/) | 直接上游：commit 时标题闪 / 3D 退化 / 背景闪黑，及 harness 方法学 |
| [20260617 coverflow-commit-boundary-flicker PRD](../20260617-muzero-coverflow-commit-boundary-flicker-prd/) | commit 边界闪烁（本期是 recenter 边界，区分） |
| [20260615 background-frame-controller PRD](../20260615-muzero-background-frame-controller-prd/) | Transition Driver / frozen-endpoints 设计来历 |

---

## 7. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | #2 确为 Pixi 窗口内容/offset 差一帧，而非 now-playing-transition 的 cover URL（blur 路径）？ | Open | Phase 1 harness 确认用户实为 Pixi 路径 + 错封面=上一中心 |
| 2 | #1 用方案 A（recenter re-begin）是否会在极快多步拖拽里频繁 re-begin 造成颜色跳变？ | Open | Phase 1 采颜色序列评估；必要时平滑 |
| 3 | 是否值得借此把 border + 背景的 recenter re-base 统一到一处（共同根因）？ | Open | Phase 2/3 实现后回看 |

---

## 8. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-18 | DoodleBears / Claude | 初稿：recenter 跨步边界的 border 闪回 0 + 背景闪上一中心封面，共同根因 + 三 Phase |
