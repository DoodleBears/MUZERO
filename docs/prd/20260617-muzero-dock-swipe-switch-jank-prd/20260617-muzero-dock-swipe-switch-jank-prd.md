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
| 0 | 排查 + **CDP 实拖 harness**（`perf-gesture.mjs`）+ A/B 坐实 QA + 根因记录 | ✅ Completed（Dock switchToFrame 182ms vs 封面 123ms，+48%） | [§4](#4-性能测量方法学验收-ground-truth) |
| 1 | 移除孤儿 `layoutId="now-cover"`（每次重渲强制 reflow，无配对/无用） | ✅ Completed（switch longtask 786→353ms 减半、count 14→6、switchToFrame max 55→48ms） | [Phase 1](#phase-1) |
| 2 | external switch 同步遮罩 base（`useLayoutEffect` 提前 engage overlay）→ base 解码不再裸跑首帧 | ✅ Completed（Dock 实拖 frameMax 166→~127、fpsLow 6→~7.7；惠及所有 external 切歌） | [Phase 2](#phase-2) |
| 3 | （可选）Dock 拖拽复用 Now Playing 的「视觉先行 + 延后提交」范式 | 🔲 Pending | [Phase 3](#phase-3) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background / 症状

两处都能「拖拽切歌」，但顺滑度不同：

- **Now Playing 封面拖拽**（[`swipeable-cover-stage.tsx`](../../../src/components/player/swipeable-cover-stage.tsx)）：一个 **windowed coverflow**——视觉中心 `centerIndex` **领先**已提交的 `currentIndex`；拖动时只改一个共享 `coverWindowOffset` **MotionValue**（不每帧 React 重渲），`playIndex` 在手势 settle **之后**才提交，且重活（Pixi 背景 re-point / 可视化）被 hand-off **淡出遮罩**。→ 拖起来跟手、提交被遮，顺滑。
- **Dock 歌曲信息拖拽**（[`track-identity-row.tsx`](../../../src/components/player/track-identity-row.tsx)）：motion 原生 `drag` + `dragSnapToOrigin` + `dragElastic`，**松手 `onDragEnd` 立刻 `next()/skipPrev()`**（→ `playIndex`）。没有视觉先行、没有延后提交、没有遮罩。

### 1.2 根因（按 CDP 实拖量化后的贡献排序）

1. **【主因】松手即触发 Now Playing 的「冷」external switch 滑动**：Dock 的 `next()` → `playIndex` 改 `currentIndex`，但 Now Playing 的视觉中心 `centerIndexRef` 没动 → 触发「external (programmatic) switch」分支（[`swipeable-cover-stage.tsx:455`](../../../src/components/player/swipeable-cover-stage.tsx#L455)）从头跑一段 **0.62s coverflow 滑动**（`SWITCH_DURATION_SEC`）+ Pixi 背景 re-point + `updateOverlayRect`（`getBoundingClientRect`）。**对比**：封面**自身**拖拽提交时设了 `selfCommitRef`（[L348](../../../src/components/player/swipeable-cover-stage.tsx#L348)），external-switch effect 早返回（`currentIndex===centerIndex`）→ **不跑冷滑**，由手势自己平滑收尾。→ 这是 Dock 比封面卡的**根本不对称**：任何 external 切歌（Dock 拖拽 / 上一首下一首按钮 / Q/E / 队列点击）都吃这条冷滑，唯独封面自身手势被特判跳过。
2. **Dock 释放瞬间的并发动画**：`dragSnapToOrigin` 回弹 spring + 封面 crossfade 与上面的冷滑级联抢同几帧。
3. **孤儿 `layoutId="now-cover"`**（**已 Phase 1 修**）：全仓唯一、无 motion 配对、Dock→Now Playing 打开走原生 VT、封面无 `view-transition-name` → 零共享动画，纯每次重渲强制 reflow。贡献相对 1/2 较小，但低风险已先摘除（switch longtask 减半）。

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

### 4.1 两个驱动
- **`perf-drive switch`**（经 control endpoint → `playIndex`）：驱动**程序化切歌**，是 Dock 拖拽成本的**下界**（缺 snap-back spring / 连续手势）。用于 Phase 1 这种「重渲路径」改动。
- **`perf-gesture <dock|cover>`（新增）**：经 **CDP `Input.dispatchMouseEvent`** 合成**真实指针拖拽**（mousePressed → 每帧 mouseMoved → mouseReleased），覆盖**整条拖拽链**（motion drag / dragSnapToOrigin 回弹 / 封面 crossfade / external 冷滑）。靠 `data-testid="dock-song-drag"` / `"now-cover-drag"` 定位元素，markers 经 control endpoint 对齐切片。**这是之前缺的那一块**——能直接量化「Dock 拖拽 vs 封面拖拽」的不对称。
- **必测**：`switchToFrameAvg/Max`（切歌→下一帧主线程阻塞）、`fpsLowMin`/`frameMaxMs`、`longTaskCount/TotalMs`。
- 启动：`MUZERO_REMOTE_DEBUG_PORT=39222`（main.cjs 据此开 CDP）+ control endpoint；须 unset `ELECTRON_RUN_AS_NODE`。

### 4.2 CDP 实拖 A/B（@5983，now tab，×6 swipes，**已含 Phase 1**）
| 指标 | **Dock 拖拽** | **封面拖拽** | 差 |
|---|---|---|---|
| `switchToFrame` avg / max | **182 / 228 ms** | 123 / 140 ms | Dock 约 +48% |
| `frameMaxMs` | 166 | 108 | Dock 更差 |
| `fpsLowMin` | 6 | 9.2 | Dock 更差 |
| `longTaskTotalMs` | 1695 | 1769 | 相当 |
| 实际切歌 | 5/6 | 6/6 | — |

> 结论：**QA 报告被实拖数据坐实**。longtask 总量两者相当（都做了重活），但 Dock 的**切歌→下一帧阻塞**显著更高（单帧冷滑 + 并发回弹未被遮罩），而封面把重活摊进 windowed-lead + hand-off 淡出。差距主因 = §1.2 第 1 条的「冷 external 滑动」。

### 4.3 程序化 switch（Phase 1 before/after，下界参考）
`switch ×8 @5983 now tab`：`longTaskTotal 786→353ms 减半`、`count 14→6`、`switchToFrame max 55→48ms`。

---

## 5. Implementation Plan

### Phase 1
**Goal:** 移除孤儿 `layoutId="now-cover"`（无配对、无 VT 配对 = 零共享动画，纯 reflow 开销）。
- [x] 删 `layoutId` + 把封面容器从 `motion.span` 降为普通 `<span>`（无 animate 属性=零 motion 开销）；更新过时注释。
- [x] Dock→Now Playing 打开过渡不回退（走原生 VT `transitionState`，从不依赖该 layoutId）；track-identity-row 单测 3 个绿、tsc 0。
- [x] **harness `switch` ×8 @5983 now tab before→after**：`longTaskTotalMs 786→353（减半）`、`longTaskCount 14→6`、`switchToFrameMax 55→48ms`、`avg 44→42`。`fpsLow 13.3 / frameMax 75` 不变（=单帧封面解码成本，与 layoutId 无关，属 switch-fps PRD）。注：harness 是程序化切歌=Dock 拖拽成本下界，真实拖拽重渲更多、获益更大。

### Phase 2 ✅
**Goal:** 让 external switch 不在切歌**首帧裸跑 base 封面解码**（dock 拖拽 / 上一首下一首按钮 / Q/E / 队列点击 / 自动续播 共享受益）。

CDP profile（`perf-gesture dock --profile`）显示切歌成本以 **React 重渲/建元素**（`jsxDEV`+`createElement`）+ 持续可视化 `renderFrame` 为主。关键时序发现：那条「engage 遮罩 overlay」的 external-switch effect **原是 passive `useEffect`**，**晚一帧**才把 base 隐到 opacity 0——于是切歌**首帧 base 裸解码新封面**（封面自身手势的 overlay 已 active、不裸跑，这就是 Dock 比封面卡的那一帧）。

**改动**：把该 effect 改 `useLayoutEffect`，**首帧前**同步 engage 遮罩 → base 解码挪到 overlay 滑动之后、不阻塞关键帧。封面自身手势走 `currentIndex===centerIndex` 早返回、**不受影响**。
#### Phase 2 验收（CDP 实拖 ×6 @5983 now tab，before→after）
- [x] **Dock**：`frameMaxMs 166→~127（−24%）`、`fpsLowMin 6→~7.7（+29%）`（两次复测一致）——即 QA 报的「掉帧」直接缓解。代价：`switchToFrame avg 182→~194ms`（+12ms，亚帧切歌延迟，远不及掉帧可感）。
- [x] **封面无回退**：`switchToFrame 123→116`、`frameMax 108→92`、`fpsLow 9.2→10.9`（同等或更好）。
- [x] 178 player 组件单测绿、tsc 0。
- 说明：`switchToFrame`（切歌→首帧延迟）没降反微升，是因为遮罩 engage 现同步进切歌窗口；但**掉帧指标（frameMax/fpsLow）才是 QA 主诉**，已改善。进一步压 `switchToFrame` 需 Phase 3。

### Phase 3（可选，较大）
**Goal:** Dock 拖拽**期间**就驱动 Now Playing 的 `coverWindowOffset`（手指领着 now-stage 一起滑，等同封面自身手势），从根上对齐顺滑度。需共享手势通道 + 跨组件协调，投入大。

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
| 2026-06-17 | DoodleBear | **Phase 2 ✅**：CDP profile 定位切歌帧成本（React 重渲 + base 裸解码）。把 external-switch effect 从 passive `useEffect` 改 `useLayoutEffect`，**首帧前**同步 engage 遮罩 overlay → base 新封面解码不再裸跑关键帧。CDP 实拖 Dock：`frameMax 166→~127`、`fpsLow 6→~7.7`（掉帧缓解）；封面无回退；惠及所有 external 切歌（transport / 队列点击 / 自动续播）。代价 `switchToFrame +12ms`（亚帧）。178 单测绿、tsc 0。 |
| 2026-06-17 | DoodleBear | **CDP 实拖 harness（`perf-gesture.mjs`）+ A/B**：经 CDP `Input.dispatchMouseEvent` 合成真实指针拖拽（按 `data-testid` 定位 dock / cover），补上「程序化 switch 测不到拖拽」的缺口。实拖 ×6 @5983 now tab（已含 Phase 1）：**Dock `switchToFrame` avg 182/max 228ms vs 封面 123/140ms（+48%）**、frameMax 166 vs 108、fpsLow 6 vs 9.2 → **坐实 QA**。根因精确化：主因是 Dock 触发 Now Playing 的 external 冷滑（封面自身手势设 `selfCommitRef` 被特判跳过），冷滑在切歌帧新挂 coverflow overlay + reflow。Phase 2 改为收窄该冷滑成本。 |
| 2026-06-17 | DoodleBear | **Phase 1 ✅ 落地**：删孤儿 `layoutId="now-cover"`（降为普通 `<span>`）。harness switch ×8 @5983：`longtask 786→353ms 减半`、`count 14→6`、`switchToFrame max 55→48ms`。tsc 0、单测绿。Phase 2/3（收敛并发动画 / 对齐 windowed-lead 范式）待续。 |
| 2026-06-17 | DoodleBear | 初稿：QA 报 Dock 拖拽切歌比 Now Playing 封面拖拽掉帧严重。排查锁定差异——封面拖拽是 windowed-lead + 延后提交 + hand-off 遮罩；Dock 是松手即 `playIndex` + 并发 snap-back/crossfade + **孤儿 `layoutId="now-cover"`**（全仓唯一、无配对、打开走原生 VT、无 `view-transition-name` → 零共享动画，纯每次重渲强制 reflow）。before 基线 switch ×8 @5983：switchToFrame avg 44ms、fpsLow 13.3、longtask 786ms。3 phase（先删孤儿 layoutId 低风险，再收敛并发动画，可选对齐范式）。 |
