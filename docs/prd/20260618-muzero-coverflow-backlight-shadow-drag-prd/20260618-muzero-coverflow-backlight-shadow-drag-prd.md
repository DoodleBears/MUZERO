# PRD: Coverflow 封面 backlight / shadow 在拖拽期消失 + 同曲提交后不恢复

**Status:** Draft
**Created:** 2026-06-18
**Author:** DoodleBears / Claude
**Module:** Now Playing 封面 backlight / shadow（`MediaStage` + `SwipeableCoverStage` hand-off）

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | 观测/复现：harness 记录 `active` / hand-off 状态机的滞留 | ✅ Completed（harness 实测） | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | 修复 #2：同曲（drag 回原点）提交后 hand-off 不卡死、effect 恢复 | ✅ Completed（d10c120） | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | 修复 #1：拖拽期 backlight 不直接消失 | ✅ Completed（2384c46，方向 a 变体） | [Phase 3 Checklist](#phase-3-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

> **实现说明（2026-06-18）**
> - **#2（d10c120）**：`commitAndHandoff` 加一支——若 `baseCoverShownIdRef.current === targetTrack.id`（base 已显示提交曲目 = 同曲提交）就直接 `setTimeout(beginHandoffFade, HANDOFF_BASE_SETTLE_MS)`，不再等一个永不变化的 `baseCoverShownId`。新增 `baseCoverShownIdRef` 取实时值（`commitAndHandoff` 是 stable callback）。异曲提交仍走 base-ready effect（等 base 画好，不闪旧封面）。harness 实测：小幅 drag（snap 回原曲）后 `[active]` true → handoffFading → **false（恢复）**，修复前会卡 true。
> - **#1（2384c46，方向 a 变体）**：[`media-stage.tsx`](../../../src/components/player/media-stage.tsx) 加 `coverContentHidden` prop——只把封面容器（cover/video/title）opacity 置 0，**backlight 不在其中、保持渲染**。[`swipeable-cover-stage.tsx`](../../../src/components/player/swipeable-cover-stage.tsx) 把 base `motion.div` 的 `opacity:0` 门控改成给 MediaStage 传 `coverContentHidden={active && overlayRect && !handoffFading}` + `coverBacklightEnabled={foregroundVisible}`（去掉 `!active`）。于是拖拽期 backlight 在滑动 overlay 后面常驻（显示当前封面辉光），hand-off 时随 base 一起就位。harness 实测：拖拽途中 backlight 元素数 = **1**（修复前 0）。
> - **shadow 拖拽期**：本期 #1 只解决 backlight（用户明确点名）；shadow 仍随封面容器 opacity 0 在拖拽期隐藏（overlay slot 不带 shadow）。若后续要拖拽期保 shadow，按 Open Question #1 的方向 (b) 给 overlay 中心 slot 加 `album-cover-shadow`。
> - **验证**：`tsc` 干净、`src/components/player` 178 测试通过、Biome 干净；prod rebuild + CDP harness 实测两项。

---

## 1. Overview

### 1.1 Background

Now Playing 封面有两种可选效果（`AppSettings.nowPlayingCoverEffectMode`）：**backlight**（封面模糊辉光，[`NowPlayingCoverBacklight`](../../../src/components/player/media-stage.tsx)）和 **shadow**（`album-cover-shadow` CSS 投影）。正常切歌后两者都能 fade in，无问题。但在 coverflow **拖拽**场景下：

1. **拖拽一开始（drag start）backlight 就直接消失**——不应该消失（应在拖拽期保持）。
2. **同一次 drag `0 → 1 → 0` 最终提交回原曲（封面没换）时，backlight / shadow 不恢复**——只有真正切换封面才会恢复。

### 1.2 Target Users

| Role | Description | Permissions |
|------|-------------|-------------|
| **听歌用户（桌面 Electron）** | 在 Now Playing 拖拽封面切歌；开启 backlight 或 shadow 效果 | 纯本地 |

### 1.3 Core Value

1. **拖拽期视觉稳定**：backlight/shadow 不应在拖拽一开始就闪没。
2. **状态机不卡死**：任何 drag 提交（含回到原曲）后都要回到干净的 rest 态，effect 恢复。

---

## 2. 现状机制（定位）

### 2.1 backlight / shadow 的渲染与门控

[`media-stage.tsx`](../../../src/components/player/media-stage.tsx)：
- backlight：`showCoverBacklight = coverBacklightEnabled && showCover && mode==="backlight" && coverBacklightUrl` → `<NowPlayingCoverBacklight active={...} fadeIn>`（[L144-L168](../../../src/components/player/media-stage.tsx#L144-L168)）。
- shadow：base 封面容器上的 `album-cover-shadow` class（`useCoverShadow = mode==="shadow"`，[L176](../../../src/components/player/media-stage.tsx#L176)）。

[`swipeable-cover-stage.tsx`](../../../src/components/player/swipeable-cover-stage.tsx)：
- base `MediaStage` 的 prop：**`coverBacklightEnabled={foregroundVisible && !active}`**（[L720](../../../src/components/player/swipeable-cover-stage.tsx#L720)）→ **拖拽期（`active`）backlight 不渲染**。
- base 整个 `motion.div` 在拖拽期 **`opacity: active && overlayRect && !handoffFading ? 0 : 1`**（[L715](../../../src/components/player/swipeable-cover-stage.tsx#L715)）→ 拖拽期 base 整体隐藏，**shadow（在 base 容器上）随之不可见**。
- 拖拽期可见的是 overlay coverflow（[`cover-pager-strip`](../../../src/components/player/cover-pager-strip.tsx) 的 slot），其 `SLOT_BASE` 只有 `album-cover-radius`，**没有 shadow、没有 backlight**。

### 2.2 #1 — 拖拽期 backlight/shadow 消失

**根因**：拖拽期 `active=true` →（a）backlight 被 `!active` 门控关掉；（b）base 整体 `opacity:0`，其 shadow 隐藏；（c）顶上的 overlay coverflow slot 不带 backlight/shadow。三者叠加 → 拖一开始两种效果都没了。设计上 `!active` 门控本意是「拖拽时 base 让位给 overlay」，但没有把 backlight/shadow 迁移到拖拽期可见层。

### 2.3 #2 — 同曲提交后 effect 不恢复（hand-off 卡死）

提交回原曲（`0→1→0`，net 不变）的时序（[`commitAndHandoff`](../../../src/components/player/swipeable-cover-stage.tsx#L359-L395) + base-ready effect [L402-L411](../../../src/components/player/swipeable-cover-stage.tsx#L402-L411)）：
- `target = centerIndexRef = 0`，`target === currentIndex(0)` → **不调 `playIndex`**（store 不变，封面不换）。
- `awaitingHandoffRef = true`；因 target 有封面（`trackHasCover` true），**不设** fallback timer——改为依赖 base-ready effect：等 `baseCoverShownId === target.id` 时再 `beginHandoffFade`。
- 但 base **从未离开过 track 0**，`baseCoverShownId` 一直是 0（= target），且 `active` 在拖拽期已是 true。提交时 **base-ready effect 的依赖 `[active, handoffFading, baseCoverShownId]` 没有一个变化** → effect **不重跑** → `beginHandoffFade` **永不触发** → `active` **一直卡在 true** → backlight（`!active`）与 shadow（base `opacity:0`）持续关闭，**直到下一次真正切歌**（`baseCoverShownId` 变化 → effect 重跑）才恢复。这正是「只有切换封面才恢复」。

**根因 #2**：hand-off 完成条件是「等 `baseCoverShownId` 变成 target」，但同曲提交时该值**本就等于 target、不会再变**，于是完成信号永不到来，`active` 卡死，rest 态的 effect 无法恢复。

---

## 3. 验收信号

沿用本轮 harness 方法学（CDP 真拖拽 + prod rebuild + 控制台埋点；`make electron-profile` 是 prod bundle，改码要 rebuild）：

- **#2**：脚本驱动一次 `0→1→0` 同曲提交，断言提交后 `active` 在合理时间内回到 false（埋点）、backlight `showCoverBacklight` 恢复 true、base `opacity` 回 1。回归：正常异曲提交、coverless 目标、far-jump/burst 不受影响。
- **#1**：拖拽期截图/埋点确认 backlight（或其替身）+ shadow 在拖拽全程可见、不在 drag start 消失；松手后无闪烁。
- prod-preview 复测（dev StrictMode 双 effect 改变时序）。

---

## 4. Implementation Plan

### Phase 1: 观测
- [ ] 埋点 `active` / `awaitingHandoffRef` / `baseCoverShownId` / `beginHandoffFade` 调用，harness 驱动同曲提交，确认 `active` 卡死的 before 证据。

### Phase 1 Checklist
- [ ] 同曲提交后 `active` 卡 true 有可量化证据
- [ ] 拖拽期 backlight/shadow 缺失有据

### Phase 2: 修复 #2（hand-off 不卡死）
**Goal:** 同曲提交后照常 hand-off、`active` 复位、effect 恢复。

**候选（推荐 A）：**
- (A) `commitAndHandoff` 里：若 **base 已经显示 target 封面**（`baseCoverShownId === targetTrack.id`，用 ref 取实时值），直接 `awaitingHandoffRef=false` + 调度 `beginHandoffFade`（带 settle 延时），不再等一个不会来的 `baseCoverShownId` 变化。
- (B) 给覆盖态目标也设一个 fallback timer（兜底），但需避免异曲提交的「松手闪旧封面」回归——故首选 (A) 的精确判定。

**Tasks:**
- [ ] 提交时检测「base 已在 target」并直接调度 fade（加 `baseCoverShownIdRef` 取实时值）
- [ ] 回归异曲提交（仍等 base 画好再 fade，不闪旧封面）

### Phase 2 Checklist
- [ ] `0→1→0` 同曲提交后 backlight/shadow 恢复
- [ ] 异曲提交无「闪旧封面」回归

### Phase 3: 修复 #1（拖拽期 backlight/shadow 保持）
**Goal:** 拖拽一开始 backlight（/shadow）不消失。

**候选（Phase 1/2 后定）：**
- (a) 解除 backlight 的 `!active` 门控（`coverBacklightEnabled={foregroundVisible}`）**并**把 `NowPlayingCoverBacklight` 移出拖拽期 `opacity:0` 的 base 包裹（它是 `fixed -z-10`，但受祖先 opacity 影响），使其在拖拽期仍可见（显示当前/中心封面的辉光，类似 Pixi 背景的 lockstep）。
- (b) 给 overlay coverflow 的**中心 slot** 加上 shadow（`album-cover-shadow`）+ 可选 backlight，使拖拽期可见层自带效果。
- (c) 让 backlight 跟随拖拽中心（lockstep，类似背景）——效果最好但成本最高，按需。

**Tasks:**
- [ ] 选定方向；确保拖拽全程 backlight/shadow 可见、松手 hand-off 无闪
- [ ] 不回退已修的 commit/recenter/border 一系列行为

### Phase 3 Checklist
- [ ] drag start 后 backlight/shadow 不消失
- [ ] 松手 hand-off 平滑、无闪

---

## 5. Out of Scope

- backlight 跟随拖拽逐帧 lockstep（方向 c）若成本过高可后置。
- 移动端触摸专属调优。
- hidden flag（硬规则 3，回退用 `git revert`）。

---

## 6. Related Documents

| Document | Description |
|----------|-------------|
| [20260618 recenter-boundary PRD](../20260618-muzero-coverflow-recenter-boundary-flicker-prd/) | 同一 hand-off 状态机的 border/bg/commit/external-switch 修复（含 harness 方法学、prod-bundle 教训） |
| [20260617 dock-swipe-switch-jank PRD](../20260617-muzero-dock-swipe-switch-jank-prd/) | overlay 遮罩 / base opacity 门控来历 |

---

## 7. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | #1 用 (a) 迁移 backlight 出 base，还是 (b) 给 overlay 中心 slot 加效果？ | Open | 看哪个改动小且松手无闪 |
| 2 | 拖拽期 backlight 显示「拖拽中心」还是「起拖那首」的辉光？ | Open | 起拖那首（静态）最省；lockstep 最佳但贵 |

---

## 8. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-18 | DoodleBears / Claude | 初稿：拖拽期 backlight/shadow 消失（base 隐藏 + `!active` 门控 + overlay 无效果）+ 同曲提交 hand-off 卡死致 effect 不恢复 |
