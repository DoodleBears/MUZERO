# PRD: Dock 歌曲信息拖拽切歌掉帧（对齐 Now Playing 封面拖拽的顺滑度）

**Status:** Draft
**Created:** 2026-06-17
**Author:** DoodleBear
**Module:** `src/components/player/track-identity-row.tsx`（Dock 行1 拖拽切歌）· 对照 `src/components/player/swipeable-cover-stage.tsx`（Now Playing 封面 windowed 拖拽）

> QA：在 **Dock 栏歌曲信息区**拖拽（左滑/上滑 → 下一首，右滑/下滑 → 上一首）切歌时，**掉帧明显比在 tab 1（Now Playing）直接拖封面切歌严重**。应是既有问题，非本次回归。本 PRD 用 harness 思路排查 + 记录 + 优化。

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 0 | 排查 + 基线测量（harness）+ 根因记录 | ✅ Completed | [§4](#4-性能测量方法学验收-ground-truth) |
| 1 | 移除孤儿 `layoutId="now-cover"`（每次重渲强制 reflow，无配对/无用） | ✅ Completed（switch longtask 786→353ms 减半、count 14→6、switchToFrame max 55→48ms） | [Phase 1](#phase-1) |
| 2 | Dock 释放即切的并发动画收敛（snap-back / 封面 crossfade 与切歌级联抢帧） | 🔲 Pending | [Phase 2](#phase-2) |
| 3 | （可选）Dock 拖拽复用 Now Playing 的「视觉先行 + 延后提交」范式 | 🔲 Pending | [Phase 3](#phase-3) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background / 症状

两处都能「拖拽切歌」，但顺滑度不同：

- **Now Playing 封面拖拽**（[`swipeable-cover-stage.tsx`](../../../src/components/player/swipeable-cover-stage.tsx)）：一个 **windowed coverflow**——视觉中心 `centerIndex` **领先**已提交的 `currentIndex`；拖动时只改一个共享 `coverWindowOffset` **MotionValue**（不每帧 React 重渲），`playIndex` 在手势 settle **之后**才提交，且重活（Pixi 背景 re-point / 可视化）被 hand-off **淡出遮罩**。→ 拖起来跟手、提交被遮，顺滑。
- **Dock 歌曲信息拖拽**（[`track-identity-row.tsx`](../../../src/components/player/track-identity-row.tsx)）：motion 原生 `drag` + `dragSnapToOrigin` + `dragElastic`，**松手 `onDragEnd` 立刻 `next()/skipPrev()`**（→ `playIndex`）。没有视觉先行、没有延后提交、没有遮罩。

### 1.2 根因（按嫌疑排序）

1. **孤儿 `layoutId="now-cover"`**（[`track-identity-row.tsx:250`](../../../src/components/player/track-identity-row.tsx#L250)）：全仓**只有这一个** `now-cover` layoutId（无配对元素），且 Dock→Now Playing 打开走的是**原生 View Transition**（`transitionState` → `startViewTransition`），封面也**没有 `view-transition-name`**。即这个 layoutId **既无 motion 配对、又无原生 VT 配对 = 不产生任何共享元素动画**，纯粹让 motion 每次重渲对该元素做 `getBoundingClientRect` **强制 reflow**。切歌时 Dock 重渲（换封面/标题）+ snap-back 重渲都会触发它。
2. **松手即触发「冷」程序化切歌**：Dock 的 `next()` → `playIndex` → Now Playing 的「external (programmatic) switch」分支（[`swipeable-cover-stage.tsx:455`](../../../src/components/player/swipeable-cover-stage.tsx#L455)）从头跑一段 **0.62s coverflow 滑动**（`SWITCH_DURATION_SEC`）+ 背景 re-point——**不是**手指领着滑的那条顺滑路径。同时 Dock 自己还在跑 `dragSnapToOrigin` 回弹 spring + 封面 crossfade。多条动画在切歌级联的同几帧抢主线程。
3. **无遮罩/无延后**：封面拖拽把背景 re-point 藏在 hand-off 淡出后；Dock 切歌的背景/可视化 re-point 直接发生、可见。

> 关键对照：**封面拖拽 = 视觉先行 + MotionValue 驱动（不重渲）+ settle 后提交 + 淡出遮罩**；**Dock 拖拽 = 立即提交 + 多条并发 React 动画 + 每帧孤儿 layoutId reflow**。同样调 `playIndex`，但编排不同 → Dock 更卡。

---

## 2. System Architecture（差异定位）

```
Now Playing 封面拖拽（顺）          Dock 歌曲区拖拽（卡）
─────────────────────              ─────────────────────
onDrag → coverWindowOffset(MV)     drag(motion) → 元素 transform(MV)
  视觉中心领先、不 React 重渲          松手 onDragEnd ↓ 立即
settle → animate snap               next()/skipPrev() → playIndex
  → playIndex（延后提交）              ├─ Now Playing external-switch：从头 0.62s 滑 + 背景 re-point
  → 背景 re-point 藏在 hand-off 淡出    ├─ dragSnapToOrigin 回弹 spring（并发）
  → 顺                                ├─ 封面 crossfade（并发）
                                      └─ 孤儿 layoutId reflow（每次重渲）
```

---

## 3. 受影响处

- [`track-identity-row.tsx`](../../../src/components/player/track-identity-row.tsx)：`layoutId="now-cover"`（孤儿）+ `drag/dragSnapToOrigin/dragElastic` + `onDragEnd` 立即 `next()/skipPrev()`。
- 对照（不改，作范式参考）：[`swipeable-cover-stage.tsx`](../../../src/components/player/swipeable-cover-stage.tsx) 的 windowed-lead + 延后提交 + hand-off。

---

## 4. 性能测量方法学（验收 ground truth）

- **驱动**：`perf-drive switch`（经 control endpoint → `playIndex`，= Dock `next()` 的下游级联）@ **Now Playing tab + 5983 队列**。注意：harness 只能驱动**程序化切歌**，覆盖「下游级联 + Dock 重渲（含孤儿 layoutId reflow）」；**拖拽特有的 snap-back spring / 连续手势**无法经 store 端点驱动 → 是 Dock 真实拖拽成本的**下界**。
- **必测**：`switchToFrameAvg/Max`（切歌→下一帧主线程阻塞）、`fpsLowMin`/`frameMaxMs`、`longTaskCount/TotalMs`。
- **before 基线（已采，now tab，switch ×8 @5983）**：`switchToFrame avg 44ms / max 55ms`、`fpsLowMin 13.3`、`frameMaxMs 75`、`longTaskCount 14 / total 786ms`。
- **after 目标**：移除孤儿 layoutId 后，切歌重渲不再强制 reflow → `switchToFrame`/`longtask` 下降；Phase 2/3 进一步压低并发动画抢帧。CDP flame graph 待 debug port 恢复后补 `renderFrame`/layout 归因。
- **环境**：dev（StrictMode/HMR 噪声已知）；启动 harness 须 unset `ELECTRON_RUN_AS_NODE`。

---

## 5. Implementation Plan

### Phase 1
**Goal:** 移除孤儿 `layoutId="now-cover"`（无配对、无 VT 配对 = 零共享动画，纯 reflow 开销）。
- [x] 删 `layoutId` + 把封面容器从 `motion.span` 降为普通 `<span>`（无 animate 属性=零 motion 开销）；更新过时注释。
- [x] Dock→Now Playing 打开过渡不回退（走原生 VT `transitionState`，从不依赖该 layoutId）；track-identity-row 单测 3 个绿、tsc 0。
- [x] **harness `switch` ×8 @5983 now tab before→after**：`longTaskTotalMs 786→353（减半）`、`longTaskCount 14→6`、`switchToFrameMax 55→48ms`、`avg 44→42`。`fpsLow 13.3 / frameMax 75` 不变（=单帧封面解码成本，与 layoutId 无关，属 switch-fps PRD）。注：harness 是程序化切歌=Dock 拖拽成本下界，真实拖拽重渲更多、获益更大。

### Phase 2
**Goal:** 收敛 Dock 释放瞬间的并发动画抢帧。
- [ ] 评估 `dragSnapToOrigin` 回弹 spring 与切歌级联同帧的成本；可改为更便宜的瞬时复位 / 让封面 crossfade 承担视觉收尾。
- [ ] 评估把 `next()/skipPrev()` 调度到 snap 起始的下一帧（让回弹先上屏、再触发重级联），harness 验证是否降 `frameMax`。

### Phase 3（可选，较大）
**Goal:** Dock 拖拽复用 Now Playing 的「视觉先行 + 延后提交 + hand-off 遮罩」范式（或至少共享 `coverWindowOffset` 通道），从根上对齐顺滑度。需评估投入产出。

---

## 6. Out of Scope

- Now Playing 封面拖拽本身（已顺，作参考范式）。
- 切歌封面解码/Pixi 背景 re-point 的绝对成本（属 switch-fps / now-playing-background PRD）——本 PRD 只治「Dock 路径比封面路径多付的那部分」。
- 移动端触摸手势细节打磨。

---

## 7. Related Documents

| Document | Description |
|----------|-------------|
| [`swipeable-cover-stage.tsx`](../../../src/components/player/swipeable-cover-stage.tsx) | Now Playing windowed-lead 拖拽（顺滑范式参考） |
| [[perf-control-endpoint-harness]]（memory） | harness scenario + 启动坑（unset ELECTRON_RUN_AS_NODE） |
| [scalable-track-list-reactivity PRD](../20260617-muzero-scalable-track-list-reactivity-prd/20260617-muzero-scalable-track-list-reactivity-prd.md) | 同期 harness-driven 性能重构（方法学一致） |

---

## 8. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-17 | DoodleBear | **Phase 1 ✅ 落地**：删孤儿 `layoutId="now-cover"`（降为普通 `<span>`）。harness switch ×8 @5983：`longtask 786→353ms 减半`、`count 14→6`、`switchToFrame max 55→48ms`。tsc 0、单测绿。Phase 2/3（收敛并发动画 / 对齐 windowed-lead 范式）待续。 |
| 2026-06-17 | DoodleBear | 初稿：QA 报 Dock 拖拽切歌比 Now Playing 封面拖拽掉帧严重。排查锁定差异——封面拖拽是 windowed-lead + 延后提交 + hand-off 遮罩；Dock 是松手即 `playIndex` + 并发 snap-back/crossfade + **孤儿 `layoutId="now-cover"`**（全仓唯一、无配对、打开走原生 VT、无 `view-transition-name` → 零共享动画，纯每次重渲强制 reflow）。before 基线 switch ×8 @5983：switchToFrame avg 44ms、fpsLow 13.3、longtask 786ms。3 phase（先删孤儿 layoutId 低风险，再收敛并发动画，可选对齐范式）。 |
