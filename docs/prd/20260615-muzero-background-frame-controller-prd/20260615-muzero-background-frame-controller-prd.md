# PRD: Now Playing 背景帧控制器（Background Frame Controller）

**Status:** Draft（设计待评审，**未动代码**）
**Created:** 2026-06-15
**Author:** Claude（设计）/ DoodleBears（拍板）
**Module:** Now Playing 沉浸式背景 —— 统一切换编排控制器

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 0 | 设计评审（本文档，零代码） | 🔄 待评审 | [§2 架构](#2-system-architecture) |
| 1 | 纯状态机 + 帧解析器（TDD，零 DOM） | 🔲 Pending | [Phase 1](#phase-1-纯状态机--帧解析器) |
| 2 | ready-gate：吸收 QA#7–24 防闪不变量 | 🔲 Pending | [Phase 2](#phase-2-ready-gate吸收防闪不变量) |
| 3 | 层消费者改造（renderer/flow/viz/dim 吃统一帧 + 单 crossfade 时钟） | 🔲 Pending | [Phase 3](#phase-3-层消费者改造) |
| 4 | drag-follow 接入控制器（D.2 重构为消费者） | 🔲 Pending | [Phase 4](#phase-4-drag-follow-接入控制器) |
| 5 | 验收：三不变量 + 不回退 gc-closure 指标 | 🔲 Pending | [Phase 5](#phase-5-验收) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending
>
> **本 PRD 是行为影响型（behavior-affecting），不是「零行为变更」重构。** 它**统一**切换过渡时序（这正是要的改进），故与 [background-layer-consolidation PRD](../20260615-muzero-now-playing-background-layer-consolidation-prd/) 的「零变更」承诺不同：本 PRD **实现**该 PRD 的 R2（收敛 crossfade 原语）+ R4（单一 hold/settle 状态机），把它们升格为一个显式 Controller。consolidation 的 R1（删死 flag）/R3（抽 source hook）/R5（dim 组件）仍作为**前置/并行的安全重构**保留在那份 PRD。

---

## 1. Overview

### 1.1 Background

用户 QA 在当前 Now Playing 背景上观察到三类问题：

1. **切歌后不同层（背景图 / Pixi 特效 / 流光 / 频谱 filter）在不同时间上屏**，不是一体化 smooth crossfade。
2. **过渡中出现错误封面**：A-B-C 三首，C→B 时上层浮现半透明 A；A→B 时出现 C。
3. **过渡不丝滑**：闪烁、闪黑、闪白。

根因（与 [consolidation 审计](../20260615-muzero-now-playing-background-layer-consolidation-prd/#3-审计结论哪些该整合哪些别动) R2/R4 一致）：**「背景显示什么 + 何时切」这件事没有单一 owner**，被摊在 ~4 套 hold/settle 机制（`settleBackgroundTarget` / `useSettledBackgroundTarget` / `holdCoverBackgroundWhileLoading` / `useLoadedImageUrl` 的 hold）+ 3 套 per-renderer crossfade（blur 的 A/B canvas、`CrossfadeBackgroundImage` 的 motion img、Pixi 的 texture swap）+ palette 的 650ms 独立 glide + drag-follow 层里。每套各自判「该不该换、换没换好」，于是时序不同步（问题 1）、stale 帧漏出（问题 2）、加载空档露底色（问题 3）。

> 注：问题 2 的 drag-follow 分支已在 [gc-closure](../20260615-muzero-now-playing-switch-gc-closure-prd/) commit `a4608ca` 用「仅活动拖拽时跟随」修掉一例；但那是局部补丁，**温度切换（切歌）过渡本身的 stale/desync 仍需 Controller 根治**。

### 1.2 Core Value（= 用户三要求 → 三机制）

| # | 用户要求 | Controller 机制 |
|---|----------|----------------|
| 1 | 切到某歌 = 显示该歌的封面/背景 | **单一事实源**：一处 `resolveBackgroundFrame(track)` 产出「帧规格」，任何层不再自行决定封面 |
| 2 | 过渡不串歌（A-B 不冒 C） | **generation 守卫**：每次切目标 `generation++`；异步解析（decode / 协议 URL）带 generation；**只有最新 generation 的帧能上屏**，旧的丢弃（复刻音频 requestId 模式） |
| 3 | 丝滑、不闪黑闪白 | **ready-gate + 单一 crossfade 时钟**：**未就绪绝不换帧**（hold 上一帧到 incoming 解码完成），再 crossfade；所有层读**同一** `crossfadeProgress` → 一体化、无加载空档露底色 |

### 1.3 Target Users

| Role | 关注点 |
|------|--------|
| 维护者 | 背景「切换正确性 + 平滑」收敛到一个可测状态机；加新 renderer/effect 只需实现「画一帧」，不碰时序 |
| 终端用户 | 切歌背景**一体化平滑过渡**、永不串歌、永不闪黑白 |

---

## 2. System Architecture

### 2.1 控制器职责边界

```
            ┌─────────────────────────────────────────────────┐
 track ───▶ │  resolveBackgroundFrame(track, settings, …)      │  纯：track → 帧规格（source/renderer/coverUrl/palette）
            └───────────────────┬─────────────────────────────┘
                                ▼
            ┌─────────────────────────────────────────────────┐
            │  BackgroundFrameController  (状态机)              │
            │   state {displayed, incoming, generation, phase, │
            │          crossfadeProgress}                      │
            │   - setTarget(frame)   → gen++, incoming, HOLD    │  ← 不变量 1/2
            │   - markReady(gen)     → 仅最新 gen 触发 crossfade│  ← 不变量 2/3
            │   - advance/commit     → displayed=incoming        │
            └───────────────────┬─────────────────────────────┘
                                ▼  {displayed, incoming, crossfadeProgress}
            ┌──────────┬──────────┬──────────┬──────────┬───────┐
            │ resting  │  flow    │ visualizer│  dims    │ drag- │  全部「哑」消费者：
            │ renderer │ (palette)│ (palette) │          │ follow│  只画给定帧/进度，不决定何时
            └──────────┴──────────┴──────────┴──────────┴───────┘
```

### 2.2 状态机（纯函数，可穷举单测）

```ts
type Phase = "idle" | "preparing" | "crossfading";
interface Composition {
  displayed: BackgroundFrame | null;  // 当前已上屏，永远 ready
  incoming:  BackgroundFrame | null;  // 下一帧（准备中 / crossfade 中）
  generation: number;                 // 每次 setTarget 自增
  phase: Phase;
  crossfadeProgress: number;          // 0..1，驱动所有层
}

reduce(state, event):
  TARGET_CHANGED(spec):
    // 同一首且无 pending → noop；否则 gen++、incoming=spec@gen、phase="preparing"
    // displayed 不动（HOLD）→ 不闪
  INCOMING_READY(gen):
    if gen === state.generation && phase === "preparing":
      phase = "crossfading"; crossfadeProgress = 0
    // gen 过期 → 忽略（不变量 2：旧帧绝不上屏）
  ADVANCE(progress):
    crossfadeProgress = clamp(progress); if >=1 → COMMIT
  COMMIT:
    displayed = incoming; incoming = null; phase="idle"; crossfadeProgress=0
```

**关键边界（单测必覆盖）：**
- **准备中再切**：`preparing` 时来新 `TARGET_CHANGED` → gen 再 +1、替换 incoming、仍 `preparing`；旧 incoming 的 `INCOMING_READY` 带旧 gen → 被忽略。→ 狂切不串歌。
- **crossfade 中再切**：`crossfading` 时来新目标 → 放弃当前 crossfade，`displayed` 保持上一已 commit 帧（不 commit 半截的 incoming），incoming=新、回 `preparing`。半截 incoming 淡出。（已知折中：~300ms crossfade 中途被打断会回弹，记 Open Q#1。）
- **同帧重复 setTarget**：noop（不触发无谓 crossfade）。

### 2.3 「就绪」判定（ready-gate）—— 吸收 QA#7–24 防闪不变量

`INCOMING_READY` 只有当该帧**真的能无缝画出来**才 fire。`ready = AND(下列适用项)`：

| 输入 | 来源 / 既有不变量 | 不满足时 |
|------|------------------|----------|
| cover URL 已解析**且 key 匹配当前 track** | stale liveQuery row guard（[gc-closure QA#12-13](../20260615-muzero-now-playing-switch-gc-closure-prd/)） | 视为未就绪（不上屏 stale row） |
| local-cover 协议 URL pending 时**不回退 blob** | [electron-local-media](../20260614-muzero-electron-local-media-protocol-prd/) / QA#11-13 | 等协议 URL，hold 上一帧 |
| streamed/remote cover「加载中清空」语义 | `clearCoverBackgroundWhileLoading`（QA） | hold 上一帧（不露底色） |
| 图像**已 decode**（bitmap 就绪） | `useLoadedImageUrl` decode span（Phase 22） | 等 decode 完成再 crossfade |
| Pixi：app mounted + texture 已 swap | 持久 Pixi 生命周期（Phase 1/10） | 等 textureSwap 成功 |
| Pixi derivative（若用 backlight 派生） | Phase 21-23 | 等 derivative ready |

> **这是本 Controller 最关键、最易出回归的面。** 每一项都对应父 PRD 一个已修 bug；Controller 把它们从「散落的 hold 分支」收成「ready 的合取输入」。Phase 2 专做这件事，单测逐项覆盖。

### 2.4 单一 crossfade 时钟（解问题 1 + 3）

- Controller 持一个 `crossfadeProgress`（rAF 或 motion 驱动，统一 duration，如 `BACKGROUND_CROSSFADE_MS`）。
- **所有层读同一进度**：
  - resting renderer：画 `displayed`（opacity 1）+ `incoming`（opacity=progress）。DOM/canvas renderer 用两实例叠加；**Pixi 例外**（单 WebGL context 持久，不能开两个）→ Pixi 内部用两 sprite/texture 按 progress 做 alpha crossfade（controller 只给 from/to texture + progress）。**统一的是时钟，不是实现**。
  - flow / visualizer：palette 由 `displayed.palette → incoming.palette` 按**同一 progress** 插值（取代现在独立的 650ms glide）→ 颜色与封面同步过渡。
  - dims：保持各自 z 序（[consolidation Open Q#2](../20260615-muzero-now-playing-background-layer-consolidation-prd/#10-open-questions) 决定不合并实例），但 opacity 过渡也挂同一时钟。
- **无加载空档**：因为 `incoming` 只在 ready 后才进入 crossfade，`displayed` 一直 hold 到那一刻 → 永不出现某层短暂空白露 `bg-background`（闪黑/闪白根因）。

### 2.5 drag-follow 与 Controller 的关系（正交但协同）

- **温度（切歌）过渡 = Controller**；**空间（拖拽）预览 = drag-follow 层**。二者正交。
- drag-follow 的「prev/cur/next 封面 ring」改为**读 Controller 暴露的帧**（`displayed` + 邻居规格），保证与温度过渡同源、不串歌。
- 拖拽 commit（越过阈值）= 把该方向邻居设为 Controller 的新 `target` → 交给统一温度过渡接管，drag 层在 release 时归 0（已实现，commit `a4608ca`）。
- 故 [gc-closure D.2](../20260615-muzero-now-playing-switch-gc-closure-prd/) 的 `now-playing-drag.ts` / `drag-crossfade-background.tsx` 在 Phase 4 **重构为 Controller 消费者**（不删，接入）。

---

## 3. Data Model

**无 DB / schema / codename 改动。** 纯前端运行时状态。

```ts
/** 一个 track 的「背景帧规格」—— resolveBackgroundFrame 的产物，Controller 的货币。 */
interface BackgroundFrame {
  trackId: string;
  source: "cover" | "track-slideshow" | "gallery-slideshow" | "video";
  renderer: BackgroundRenderer;          // blur | noise | pixel | … | plain
  coverUrl: string | null;               // 已解析（object-url / muzfetch / 协议）
  videoUrl: string | null;
  palette: Rgb[] | null;                 // 供 flow/viz 同步插值
  // readiness 输入在 Controller 侧聚合，不进 Frame 本身（Frame 是「规格」，ready 是「状态」）
}
```

- `AppSettings` 背景字段、IndexedDB、id 前缀**全部不动**（硬规则 #4）。
- 不新增 Zustand 持久 state（硬规则 #6）；Controller 状态是组件内 `useReducer` + 模块级单例（drag-follow 那种），按既有约定。

---

## 4. API / 模块边界

纯前端，无网络 API。新增/改动模块：

| 模块 | 职责 | 新建/改 |
|------|------|--------|
| `lib/background-frame.ts` | `resolveBackgroundFrame(track, settings, …)` 纯解析（吸收现 `resolveBackgroundSource`/`resolvePixiBackgroundMedia` 调用编排） | 新（纯函数 + 单测） |
| `lib/background-composition.ts` | 状态机 `reduce` + 类型（§2.2） | 新（纯函数 + 单测） |
| `components/player/background/use-background-controller.ts` | hook：聚合 ready 输入（§2.3）→ 喂状态机；驱动 crossfade 时钟 | 新 |
| `now-playing-background.tsx` | 降为「消费 controller 输出 + 装配层」 | 改（瘦身） |
| renderer / flow / viz / dim | 改为吃 `{displayed, incoming, progress}` | 改 |
| `drag-crossfade-background.tsx` / `now-playing-drag.ts` | 接入 controller 帧源 | 改（Phase 4） |

> 遵循模板「优先改现有、新建需理由」：新文件仅给**纯逻辑（resolver/状态机）+ 编排 hook**，不引入新依赖、新 runtime owner。

---

## 5. Frontend Design

### 5.1 目标结构

```
src/lib/
├── background-frame.ts            # resolveBackgroundFrame（纯，单测）
├── background-composition.ts      # 状态机 reduce（纯，单测）
└── background-crossfade.ts        # 既有（drag 用），保留
src/components/player/
├── now-playing-background.tsx     # 仅装配：consume controller → 层叠加（~150 行）
├── background/
│   └── use-background-controller.ts  # ready 聚合 + 时钟驱动
├── canvas-blur-background.tsx     # 保留；改为「画给定帧」
├── pixi-pixel-background.tsx      # 保留；扩「两 texture alpha crossfade by progress」
└── drag-crossfade-background.tsx  # 保留；Phase 4 接 controller 帧
```

### 5.2 关键改动（what，非 how）

- resolver 把现散落的 source/cover-url/derivative 决策收成一处纯函数。
- Controller hook 聚合 ready 输入（§2.3）→ 状态机；统一 crossfade 时钟。
- renderer 三分支 + flow + viz + dim 改吃统一帧/进度。
- palette 改为按 crossfade 进度插值（取代 650ms 独立 glide）。
- drag-follow 改读 controller 帧（Phase 4）。

### 5.3 State Management

- Controller 用 `useReducer`（组件内），不进全局 store。
- `visualizer-color-store` 的 palette **改由 controller 进度驱动插值**（或 controller 写入它）——这是 Bug 1 的核心改动点，需保证 flow/viz 仍共享同一色。

---

## 6. Implementation Plan

> 节奏：纯逻辑先行（可单测）→ ready-gate（吸收不变量）→ 层接入（桌面验证）→ drag 接入 → 验收。沿用 gc-closure 的 staged-with-testing：每 phase 独立 commit + 桌面验证 + 可 revert。

### Phase 1: 纯状态机 + 帧解析器

**Goal:** `background-composition.ts`（reduce）+ `background-frame.ts`（resolver）纯函数，零 DOM、零行为接入。

**Checklist:**
- [ ] reduce 穷举单测：HOLD 不闪 / generation 守卫（准备中再切、crossfade 中再切、stale ready 忽略）/ 同帧 noop / commit。
- [ ] resolver 单测：cover/slideshow/gallery/video/无封面 五来源 + 各 renderer 映射，与现有 `resolveBackgroundSource` 行为对齐（快照对比）。
- [ ] `tsc`/Biome 绿。**无运行时接入** → 桌面无变化。

### Phase 2: ready-gate（吸收防闪不变量）

**Goal:** `use-background-controller.ts` 聚合 §2.3 六项 ready 输入，逐项对齐父 PRD 已修 bug。

**Checklist:**
- [ ] 单测覆盖：stale row / local-cover pending / streamed clear-while-loading / decode 未完 / Pixi 未 swap / derivative pending —— 每项「未就绪 → hold，不上屏」。
- [ ] 仍**未接 JSX**（controller 输出先和现有渲染并行跑、对照日志），桌面无变化。

### Phase 3: 层消费者改造

**Goal:** renderer/flow/viz/dim 改吃 `{displayed, incoming, progress}`，单 crossfade 时钟。主组件瘦身。

**Checklist:**
- [ ] Pixi 扩两-texture alpha crossfade（持久单 app 不破）。
- [ ] palette 按进度插值，flow/viz 仍共享同色。
- [ ] 桌面逐 renderer（blur/noise/pixel/plain）+ 有/无 flow + 有/无 viz：切歌**一体化平滑**、不串歌、不闪黑白。
- [ ] **不回退** gc-closure no-remount / churn 指标、switch-background-perf 帧率指标。

### Phase 4: drag-follow 接入控制器

**Goal:** drag-follow ring 读 controller 帧；commit 设 controller target。

**Checklist:**
- [ ] 拖拽预览与温度过渡同源、不串歌；release 交接平滑。
- [ ] 桌面：均衡 / 画质优先两预设下拖拽 + 切歌都对。

### Phase 5: 验收

**Checklist:**
- [ ] 三不变量桌面复测：① 切歌即对应封面 ② A-B-C 任意切不冒第三首 ③ 全程无闪黑/闪白、各层同步。
- [ ] 快速连切 ×10：不串歌、不闪、帧率/heap 不回退（对照 gc-closure 基线）。
- [ ] before/after 同设置截图：稳态一致，过渡更统一。

---

## 7. Out of Scope

- **flow shader / 频谱 renderer 内部**（`flow-shaders.ts` / `spectrum/*` / `reactive-scene.tsx`）不动。
- **取色量化算法**（`image-palette.ts`）不动；只改「palette 何时/如何过渡」。
- **新 renderer / 新 effect / 新设置项**：不在内。
- **codename 层 / DB / 网络**：冻结。
- **consolidation PRD 的 R1/R3/R5**（删 flag / 抽 source hook / dim 组件）：可并行的安全前置，归那份 PRD；本 PRD 聚焦 R2/R4 的 Controller 化。
- **移动端全屏 sheet 背景**差异：如有单开。

---

## 8. Security Considerations

无新增出站请求、无密钥、无遥测。纯前端组件内部重排。回退 = `git revert` 对应 phase，无 runtime flag（硬规则 #3）。

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [background-layer-consolidation](../20260615-muzero-now-playing-background-layer-consolidation-prd/) | 5 层审计 + R1-R5；本 PRD 实现其 R2+R4（Controller 化），R1/R3/R5 留那边 |
| [now-playing-switch-gc-closure](../20260615-muzero-now-playing-switch-gc-closure-prd/) | drag-follow（D.2）来源；Phase 4 接入对象；no-remount/churn 不回退基线 |
| [now-playing-switch-background-perf](../20260613-muzero-now-playing-switch-background-perf-prd/) | 单时钟 / Pixi 持久 / 防闪 QA#7-24 来源；本 PRD ready-gate 吸收其不变量；帧率不回退 |
| [now-playing-cover-handoff-regression](../20260612-muzero-now-playing-cover-handoff-regression-prd/) | hold/settle 防闪机制来源（Controller 收敛对象） |
| [electron-local-media-protocol](../20260614-muzero-electron-local-media-protocol-prd/) | local-cover 协议 ready 输入（§2.3 必须保活） |

---

## 10. Open Questions

| # | Question | Status | 倾向 |
|---|----------|--------|------|
| 1 | crossfade 进行中被新切打断 → 半截 incoming 回弹是否可接受？还是要做三层（保留半截 + 新 incoming）？ | Open | 倾向**接受回弹**（v1 简单，狂切本就被 throttle 限速）；若桌面观感差再做三层 |
| 2 | palette 过渡是否**完全**改挂 crossfade 时钟，还是保留一点「颜色稍慢于图」的 glide（现 650ms）？ | Open | 倾向**完全同步**（用户要一体化）；保留可选 `paletteGlideMs` 微调留待实测 |
| 3 | crossfade duration 统一取值（现 blur 300 / plain 350 / Pixi swap 各异）？是否做成可见设置还是内部常量？ | Open | 倾向**内部常量 `BACKGROUND_CROSSFADE_MS`**（不暴露设置，避免膨胀；硬规则 #3 不藏 flag —— 它是时序常量非行为门控） |
| 4 | Phase 2「并行对照」阶段是否值得（controller 输出 vs 现渲染对照日志），还是直接 Phase 3 接入？ | Open | 倾向做轻量对照（给 Phase 3 当 before/after 护栏），但可选 |
| 5 | 是否先落 consolidation R3（抽 source hook）再做本 Controller，避免两处同时改 god-component？ | Open | **强烈倾向先 R3**（或本 PRD Phase 1 的 resolver 即承担 R3 的 source 抽离），避免与 consolidation 撞车 |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-15 | Claude | 初稿（设计待评审）：把用户三要求（对应封面 / 不串歌 / 不闪）映射为统一 Background Frame Controller —— 单一事实源 + generation 守卫 + ready-gate + 单 crossfade 时钟；状态机 §2.2、ready-gate 吸收 QA#7-24 §2.3、层消费者 §2.4、drag-follow 协同 §2.5；5 phase 计划。实现 consolidation PRD 的 R2+R4。**未动代码。** |
