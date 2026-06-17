# PRD: Now Playing 背景层审计与整合（Background Layer Consolidation）

**Status:** Draft
**Created:** 2026-06-15
**Author:** Claude (调查) / DoodleBears (拍板)
**Module:** Now Playing 沉浸式背景 —— 合成层架构梳理与去重

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 0 | 现状审计（本文档 §2-§3，无代码改动） | ✅ Completed | [§2 当前架构](#2-system-architecture) |
| 1 | 死代码 / bisect flag 清理（零行为变更） | 🔲 Pending | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | 抽离 source/policy hook（god-component 拆分） | 🔲 Pending | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | resting renderer 统一到单一 backend 接口 | 🔲 Pending | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | crossfade / hold-previous 机制收敛 | 🔲 Pending | [Phase 4 Checklist](#phase-4-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending
> **本 PRD 的硬约束：用户可见行为零变更。** 这是纯内部重构（去重 + 拆分 + 删死代码），不是新功能、不改设置项、不动 codename 层。任何 phase 都可独立 `git revert`。

---

## 1. Overview

### 1.1 Background

用户提出："调查我们的背景逻辑，到底有多少层，哪一些应该可以、需要重构整合。"

Now Playing 的「沉浸式背景」已经过 6 个 PRD 的迭代叠加（[immersive-flow-background](../20260611-muzero-immersive-flow-background-prd/)、[immersive-memory-moments](../20260610-muzero-immersive-memory-moments-prd/)、[slideshow-playback-settings](../20260607-muzero-slideshow-playback-settings-prd/)、[now-playing-cover-handoff-regression](../20260612-muzero-now-playing-cover-handoff-regression-prd/)、[now-playing-switch-background-perf](../20260613-muzero-now-playing-switch-background-perf-prd/)、[now-playing-switch-gc-closure](../20260615-muzero-now-playing-switch-gc-closure-prd/)）。每个 PRD 都向同一个组件追加一层 / 一条分支，**没有一次回头做整合**。

结果是 [`now-playing-background.tsx`](../../../src/components/player/now-playing-background.tsx) 变成一个 ~550 行的 god-component，混杂了三件互不相关的事：
1. **来源决策（policy）**：cover / slideshow / gallery / video 优先级 + local-cover 协议回退 + pixi-derivative 选择；
2. **媒体 URL 管线（plumbing）**：~10 个 `useLiveQuery` / `useObjectUrls` / `useLoadedImageUrl` + 多套 settle/hold 防闪；
3. **合成层装配（composition）**：5 个视觉层的 JSX 堆叠 + blend mode。

本 PRD 先**穷举清点**当前所有背景层（§2），再判定**哪些是真冗余、哪些是健康分层不要动**（§3），最后给出**分阶段、零行为变更**的整合计划（§6）。

### 1.2 Target Users

| Role | Description | 关注点 |
|------|-------------|--------|
| **维护者（本人）** | 后续要继续往背景上加功能（如新 flow effect、新 resting renderer） | 改一处不要踩三处；新人能看懂分层 |
| **终端用户** | 桌面播放器使用者 | **零感知** —— 重构后画面/设置完全一致 |

### 1.3 Core Value

1. **可维护性**：把 ~550 行 god-component 拆成「policy hook + 媒体 hook + 纯合成组件」，新增背景 backend / effect 时不再需要读懂全部分支。
2. **去重**：消除 3 套 resting-renderer 各自实现的 crossfade / hold-previous，收敛到单一原语；删掉永远为常量的 bisect flag。
3. **降风险**：每个 phase 都有现成单测护栏（§7 规则）+ 桌面可见验证，且可独立 revert —— 沿用 gc-closure PRD 的「staged-with-testing」节奏。

---

## 2. System Architecture

### 2.1 当前合成栈（从后到前，paint order）

`NowPlayingBackgroundContent`（[`now-playing-background.tsx:72-486`](../../../src/components/player/now-playing-background.tsx)）依靠 JSX 顺序 = paint order，外层 `isolate` 把 mix-blend-mode 圈在背景组内（[L58-66](../../../src/components/player/now-playing-background.tsx#L58-L66)）。**共 5 个视觉层**：

```
┌─ <div isolate overflow-hidden bg-background>  ← 容器（bg-background 兜底色）
│
│  L1  RESTING RENDERER  （三选一，互斥，由 settings.backgroundRenderer 决定）
│      ├─ "blur"            → CanvasBlurBackground      （canvas 降采样模糊，含 A/B 内部 crossfade）
│      ├─ pixel/ascii/crt/  → PixiPixelBackground       （Pixi WebGL，可纹理 cover/视频/slideshow）
│      │  dot/noise/x-hatch
│      └─ 其它（plain）     → CrossfadeBackgroundImage   （motion <img> crossfade，无特效）
│
│  L2  DragCrossfadeBackground   （两张 next/prev 模糊 cover canvas，随拖拽淡入；常驻挂载、静止 opacity 0）
│
│  L3  Cover Mask                 （<div bg-background>，opacity = backgroundMaskOpacity/100）
│
│  L4  Flow 层（flowEnabled 时）  （VisualizerHost styleId="scene-flow"，WebGL shader，14 effect）
│      └─ + Flow Dim              （<div bg-background>，opacity = flowDim/100）
│         mixBlendMode = flowBlendMode（默认 overlay）
│
│  L5  Visualizer 频谱（visualizerAsBackground 时）（VisualizerHost，canvas2d/webgl 频谱）
│      └─ + Visualizer Dim        （<div bg-background>，opacity = visualizerDim/100）
│         mixBlendMode = visualizerBlendMode（默认 screen）
└─
```

> 注意：MV/视频本身的播放画面 **不在**这个组件里 —— 它是 `MediaStage` 的持久 `<video>`（`z-10`），背景组是它身后的 `inset-0` backdrop。Pixi renderer 可以**额外**把视频当纹理画到背景（L1），与前景 video 是两回事。

### 2.2 每层的开关 / 来源 / 文件

| # | 层 | 组件 / 文件 | 渲染什么 | 开关（AppSettings） | blend |
|---|----|------------|----------|---------------------|-------|
| L1a | resting · blur | [`canvas-blur-background.tsx`](../../../src/components/player/canvas-blur-background.tsx) | 模糊封面（canvas 降采样，WKWebView 安全） | `backgroundRenderer==="blur"` | — |
| L1b | resting · pixi | [`pixi-pixel-background.tsx`](../../../src/components/player/pixi-pixel-background.tsx) + [`pixi-background-controller.ts`](../../../src/components/player/pixi-background-controller.ts) | pixel/ascii/cross-hatch/crt/dot/noise，可纹理视频 | `backgroundRenderer ∈ pixi 集` | — |
| L1c | resting · plain | [`now-playing-background.tsx:501-546`](../../../src/components/player/now-playing-background.tsx#L501-L546) `CrossfadeBackgroundImage` | 纯 `<img>` + motion crossfade | 其它 renderer 值 | — |
| L2 | drag crossfade | [`drag-crossfade-background.tsx`](../../../src/components/player/drag-crossfade-background.tsx) + 模型 [`background-crossfade.ts`](../../../src/lib/background-crossfade.ts) | next/prev 模糊封面，随拖拽淡入 | 常驻（拖拽时才可见） | — |
| L3 | cover mask | [`now-playing-background.tsx:411`](../../../src/components/player/now-playing-background.tsx#L411) | 压暗/提亮遮罩 | `backgroundMaskOpacity` | — |
| L4 | flow | [`host.tsx`](../../../src/visualizer/host.tsx) + [`scene/flow-shaders.ts`](../../../src/visualizer/scene/flow-shaders.ts)，配置 [`flow-config.ts`](../../../src/lib/flow-config.ts) | 14 个自研 GLSL ambient shader | `flowEnabled` (+ effect/opacity/dim/blend) | `flowBlendMode` |
| L5 | visualizer | [`host.tsx`](../../../src/visualizer/host.tsx) + [`spectrum/*`](../../../src/visualizer/spectrum/) / [`scene/reactive-scene.tsx`](../../../src/visualizer/scene/reactive-scene.tsx) | bars/radial/led-reflex/waveform 频谱 | `visualizerAsBackground && visualizerStyle!=="off"`（有歌词时自动收敛） | `visualizerBlendMode` |

### 2.3 支撑层（非视觉层，但属于「背景逻辑」）

- **来源决策（纯函数，已单测）**：[`background.ts`](../../../src/lib/background.ts) `resolveBackgroundSource` / `resolvePixiBackgroundMedia` / `trackHasBackgroundVideoMedia` / `settleBackgroundTarget`。
- **取色管线（两层，健康分层 —— 见 §3.2）**：
  - 高层 [`cover-palette.ts`](../../../src/lib/cover-palette.ts)（thumbhash 平均色 + crop + 持久化 + R2 同步），**委托**给
  - 低层 [`image-palette.ts`](../../../src/lib/image-palette.ts) `extractImagePalette` / `selectImagePalette`（零依赖 canvas 量化）。
  - 运行时色彩状态 [`visualizer-color-store.ts`](../../../src/stores/visualizer-color-store.ts)（650ms settle + palette 插值），flow 与频谱共享。
- **blend / dim / opacity 解析**：[`flow-config.ts`](../../../src/lib/flow-config.ts) `resolveFlowConfig`/`resolveFlowColors`、[`visualizer-effect-settings.ts`](../../../src/lib/visualizer-effect-settings.ts) `resolveVisualizerBackgroundCompositeOptions`。
- **共享模糊原语**：[`canvas-blur.ts`](../../../src/lib/canvas-blur.ts) `drawBlurFrame`（L1a 与 L2 **共用**，✅ 已去重）。

---

## 3. 审计结论：哪些该整合，哪些别动

### 3.1 真冗余 / 需整合（重构目标）

> 判据：**多处实现同一件事** 或 **死代码** 或 **关注点混在一起导致改一处要懂全部**。

| 编号 | 问题 | 证据 | 严重度 | 处理 |
|------|------|------|--------|------|
| **R1** | **死的 bisect flag** | [`now-playing-background.tsx:36-37`](../../../src/components/player/now-playing-background.tsx#L36-L37) `ENABLE_PIXI_BACKGROUND_FOR_BISECT = true` / `DISABLE_PIXI_TEXTURE_SOURCE_FOR_BISECT = false` 永远为常量，散落在 L389-401 的渲染条件里 | 低（噪音 + 轻微违反硬规则 #3「不藏 flag」精神） | 直接删，内联条件 |
| **R2** | **3 套 resting renderer 各自实现 crossfade + hold-previous** | L1a `CanvasBlurBackground` 有自己的 A/B canvas 淡入；L1c `CrossfadeBackgroundImage`（[L501-546](../../../src/components/player/now-playing-background.tsx#L501-L546)）有自己的 motion `<img>` 淡入；L1b Pixi 又有自己的 500ms swap。三者「切歌不闪」逻辑各写一份 | **高** | 收敛到单一 crossfade 原语（见 §3.1 R4），renderer 只负责「画一帧」 |
| **R3** | **god-component 混三种关注点** | [`now-playing-background.tsx:72-486`](../../../src/components/player/now-playing-background.tsx#L72-L486) 一个组件里：source 决策 + local-cover 协议回退 + pixi-derivative 选择 + slideshow 定时 + 多套 settle + 5 层 JSX 装配。~30 个 hook | **高** | 抽 `useNowPlayingBackgroundSource()`（policy）+ `useNowPlayingBackgroundMedia()`（plumbing），主组件只留 JSX 合成 |
| **R4** | **多套「别闪基础色」机制并存** | `settleBackgroundTarget`（[background.ts:100](../../../src/lib/background.ts#L100)）+ `useSettledBackgroundTarget`（[L488](../../../src/components/player/now-playing-background.tsx#L488)）+ `holdCoverBackgroundWhileLoading`（[L156](../../../src/components/player/now-playing-background.tsx#L156)）+ `useLoadedImageUrl` 的 `holdPreviousWhileLoading` + `CrossfadeBackgroundImage` 内部又 hold 一次。同一意图至少 4 个落点 | 中 | 梳理成单一「resolved frame」状态机，hold/settle 一处裁决 |
| **R5** | **3 个 dim 遮罩各写一份** | image mask（[L411](../../../src/components/player/now-playing-background.tsx#L411)）、flow dim（[L443-446](../../../src/components/player/now-playing-background.tsx#L443-L446)）、visualizer dim（[L477-480](../../../src/components/player/now-playing-background.tsx#L477-L480)）都是 `<div bg-background opacity>` | 低 | 抽一个 `<DimOverlay opacity transition>` 小组件（语义统一，非强制合并成一层 —— 它们 z 序不同） |

### 3.2 看似冗余、实则健康分层 —— **不要动**

| 项 | 为什么看着像重复 | 为什么其实是对的 |
|----|------------------|------------------|
| **`cover-palette.ts` vs `image-palette.ts`** | 都叫 palette，都产出 `Rgb[]` | **干净分层**：`image-palette` 是纯量化器（零依赖）；`cover-palette` 是业务包装（thumbhash 平均色回退 + crop + 持久化字段 + R2 import/export），**委托** `extractImagePalette` 做量化（[cover-palette.ts:5,27](../../../src/lib/cover-palette.ts#L5)）。删任何一个都会把无关职责糅在一起 |
| **Flow 与频谱都走 `VisualizerHost`** | 两个 `<VisualizerHost>` 实例 | **刻意复用**：flow 用 `styleId="scene-flow"`（registry 标 `hidden:true`，[registry.ts:94-104](../../../src/visualizer/registry.ts#L94-L104)）强制走 WebGL host，与频谱共享单 rAF / 可见性暂停 / 取色 store。这是「一个 host、多个 placement」的正确抽象，不是重复 |
| **`CanvasBlurBackground`（L1a）与 `DragCrossfadeBackground`（L2）都画模糊封面** | 都是模糊 cover canvas | **不同关注点**：L1a 是「当前歌静止背景」，L2 是「拖拽时邻歌淡入」（spatial）。且二者**已共享** `drawBlurFrame`（[canvas-blur.ts](../../../src/lib/canvas-blur.ts)），无实现重复。R2 整合后 L1a 可能并入统一 renderer，但 L2 的 drag-follow 语义保留 |
| **`CrossfadeBackgroundImage`（切歌）vs `DragCrossfadeBackground`（拖拽）** | 都叫 crossfade | 一个是 sequential（切歌时间轴淡入），一个是 spatial（拖拽位移淡入）。语义正交，**不合并**；但底层 opacity 数学可共用 [`background-crossfade.ts`](../../../src/lib/background-crossfade.ts) |
| **`scene-flow` 在 registry 里** | 一个「用不到」的 visualizer style | 它就是 flow 层的 WebGL 后端入口，`hidden` 让它不进频谱选择器但仍可被 host 渲染。删了 flow 就没后端 |

### 3.3 一句话结论

> **合成栈本身是干净的（5 层，每层一个真实视觉意图，没有「两层做同一件事」）。乱的是 L1 的 3 套并行实现、god-component 把 policy/plumbing/composition 揉在一起、以及 4 套防闪机制。整合目标 = 拆关注点 + 收敛 crossfade 原语 + 删死 flag，绝不是删层或改画面。**

---

## 4. 非目标 / API（本 PRD 无后端、无新 API）

不涉及网络 / DB schema / API。所有改动在 `src/components/player/` + `src/lib/` 前端层；`AppSettings` 字段、IndexedDB、codename 层（`muzero-db` / id 前缀 / provider id）**全部不动**。

---

## 5. Frontend Design

### 5.1 目标结构（重构后）

```
src/components/player/
├── now-playing-background.tsx          # 仅留：5 层 JSX 合成 + AnimatePresence（~150 行）
├── background/                         # （新目录，仅 append）
│   ├── use-background-source.ts        # R3：policy（cover/slideshow/gallery/video 优先级 + 回退）
│   ├── use-background-media.ts         # R3：plumbing（liveQuery + objectUrl + local-cover 协议 + settle/hold 单点）
│   ├── resting-renderer.tsx            # R2：单一 backend 接口，内部 switch blur/pixi/plain，统一 crossfade
│   └── dim-overlay.tsx                 # R5：<DimOverlay opacity transition>
├── canvas-blur-background.tsx          # 保留（被 resting-renderer 调用）
├── pixi-pixel-background.tsx           # 保留
└── drag-crossfade-background.tsx       # 保留（L2，语义独立）
```

> 遵循模板的「优先改现有、新建需理由」：新文件仅给**职责拆分**（hook / 小组件），不引入新依赖、新 runtime owner。

### 5.2 关键改动（描述 what，不规定 how）

- **R1**：删 `ENABLE_PIXI_BACKGROUND_FOR_BISECT` / `DISABLE_PIXI_TEXTURE_SOURCE_FOR_BISECT`，内联其条件。
- **R3**：把 [L73-379](../../../src/components/player/now-playing-background.tsx#L73-L379) 的非 JSX 逻辑迁进两个 hook，主组件改为消费 hook 返回的「已解析帧 + 各层开关」。
- **R2**：定义 `RestingBackgroundRenderer`（接口：吃 `{ target, blurPx, pixelSize, effect, effectSettings }`，吐一层），把 blur/pixi/plain 三分支收进去；crossfade/hold 不再每个 renderer 各写。
- **R4**：settle/hold 收敛到 `use-background-media.ts` 内一个状态机，对外只暴露 `resolvedTarget`。
- **R5**：三处 dim div → `<DimOverlay>`。

### 5.3 State Management

- 不新增 Zustand state（遵循硬规则 #6）。`visualizer-color-store` / `now-playing-drag` 等模块级单例不动。
- 新 hook 内部用 `useLiveQuery` / `useState` / `useMemo`，与现状一致，只是换了归属文件。

---

## 6. Implementation Plan

> 顺序原则：**先删死代码（最低风险）→ 再拆 hook（搬运，行为不变）→ 再统一 renderer（结构变）→ 最后收敛防闪（最易出回归，放最后）**。每 phase 独立 PR + 桌面可见验证 + 可 revert。

### Phase 1: 死代码 / bisect flag 清理

**Goal:** 删 R1，零行为变更，建立「背景重构」工作分支基线。

**Tasks:**
- [ ] 删 `ENABLE_PIXI_BACKGROUND_FOR_BISECT` / `DISABLE_PIXI_TEXTURE_SOURCE_FOR_BISECT`，内联渲染条件
- [ ] 全仓 grep 确认无其它 bisect-only 常量残留

#### Phase 1 Checklist
- [ ] `tsc` exit 0、Biome 通过
- [ ] `make test` 绿（背景相关纯函数单测不变）
- [ ] 桌面：blur / pixel / plain 三种 renderer 各切一次歌，画面与改前一致

### Phase 2: 抽离 source/media hook（R3 上半）

**Goal:** 把 policy + plumbing 搬进 `use-background-source.ts` / `use-background-media.ts`，主组件只消费。纯搬运，JSX 不动。

**Tasks:**
- [ ] 迁 source 决策（`resolveBackgroundSource` 调用 + local-cover 回退 + pixi-derivative 选择）
- [ ] 迁媒体 URL 管线（liveQuery / objectUrl / `useLoadedImageUrl`）
- [ ] 主组件 import 两个 hook，删除已迁出的 inline 逻辑

#### Phase 2 Checklist
- [ ] `tsc` / Biome / test 绿
- [ ] 桌面：cover / track-slideshow / gallery-slideshow / 视频纹理 / 无封面 五种来源逐一验证无差异
- [ ] Electron local-cover 协议路径（`localCover.url` 命中）仍走通

### Phase 3: resting renderer 统一接口（R2 + R3 下半）

**Goal:** blur/pixi/plain 收进 `resting-renderer.tsx` 单一接口；主组件 JSX 缩到 5 层合成 + `<DimOverlay>`（R5 一并做）。

**Tasks:**
- [ ] 定义 `RestingBackgroundRenderer` 接口，三分支内置
- [ ] R5：三处 dim div → `<DimOverlay>`
- [ ] 主组件 `now-playing-background.tsx` 降到 ~150 行

#### Phase 3 Checklist
- [ ] `tsc` / Biome / test 绿
- [ ] 桌面逐 renderer 验证 + flow/visualizer blend 叠加视觉一致
- [ ] 截图 before/after 对比（同一首歌、同设置）像素级接近

### Phase 4: crossfade / hold-previous 收敛（R4）

**Goal:** 切歌防闪逻辑收敛到 media hook 单一状态机，删除分散的 hold/settle 重复。**回归风险最高，单独 PR。**

**Tasks:**
- [ ] 把 `settleBackgroundTarget` / `useSettledBackgroundTarget` / `holdCoverBackgroundWhileLoading` / `CrossfadeBackgroundImage` 内部 hold 统一
- [ ] 补单测覆盖「快速连切」「remote cover pending」「local-cover 回退」三类不闪不变量

#### Phase 4 Checklist
- [ ] `tsc` / Biome / test 绿，新增防闪不变量单测
- [ ] 桌面：快速连点下一首 ×10，背景不闪基础色、不串歌
- [ ] gc-closure PRD 的 no-remount / churn 指标不回退

---

## 7. Out of Scope

- **任何用户可见行为 / 画面 / 设置变更** —— 本 PRD 是纯重构，新 effect/新 renderer/新设置项都不在内。
- **codename 层**：`AppSettings` 背景字段名、IndexedDB、id 前缀全部冻结（硬规则 #4）。
- **取色管线重写**：`cover-palette` / `image-palette` 分层保持（§3.2），不在本期合并或换库。
- **flow shader / 频谱 renderer 内部**：`flow-shaders.ts`、`spectrum/*`、`reactive-scene.tsx` 不动。
- **性能调优本身**：本 PRD 不承诺帧率/内存改善（那是 [switch-background-perf](../20260613-muzero-now-playing-switch-background-perf-prd/) / [gc-closure](../20260615-muzero-now-playing-switch-gc-closure-prd/) 的范畴）；但**不得让其指标回退**。
- **移动端全屏 sheet 背景**差异适配（如有，单开）。

---

## 8. Security Considerations

无新增出站请求、无密钥、无遥测。所有改动是前端组件内部重排。遵循硬规则 #3（不藏 flag）—— R1 删的正是违反该精神的编译常量；回退路径 = `git revert` 对应 phase，无 runtime kill switch。

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [immersive-flow-background](../20260611-muzero-immersive-flow-background-prd/) | L4 flow 层来源；本 PRD 不改其 shader/取色，仅复用其 VisualizerHost 复用结论 |
| [immersive-memory-moments](../20260610-muzero-immersive-memory-moments-prd/) | slideshow / gallery 背景来源 |
| [slideshow-playback-settings](../20260607-muzero-slideshow-playback-settings-prd/) | `backgroundMode` / slideshow 间隔设置 |
| [now-playing-cover-handoff-regression](../20260612-muzero-now-playing-cover-handoff-regression-prd/) | hold/settle 防闪机制来源（R4 收敛对象） |
| [now-playing-switch-background-perf](../20260613-muzero-now-playing-switch-background-perf-prd/) | 单时钟 / 节流；本 PRD 不得回退其指标 |
| [now-playing-switch-gc-closure](../20260615-muzero-now-playing-switch-gc-closure-prd/) | drag crossfade（L2）+ no-remount churn 不变量；R4 验证基线 |
| [electron-local-media-protocol](../20260614-muzero-electron-local-media-protocol-prd/) | local-cover 协议路径（Phase 2 必须保活） |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | 是否一并把 `backgroundRenderer` 的 blur 收成「pixi 的一个 effect」从而砍掉 L1a 独立实现？ | Open | 倾向**不**：blur 走 canvas 是 WKWebView 安全的刻意选择（[now-playing-background.tsx:42-44](../../../src/components/player/now-playing-background.tsx#L42-L44)），Pixi 在部分平台 WebGL 不稳。保留 blur 作为「无 GPU」兜底。待拍板 |
| 2 | R5 的三个 dim 是否合并成**一个**共享 dim 层（而非三个语义统一的小组件）？ | Open | 倾向不合并：三者 z 序不同（mask 在图上、flow dim 在 flow 上、viz dim 在频谱上），合并会改变叠加观感。只统一组件、不统一实例。待拍板 |
| 3 | 是否需要在 Phase 0 之后先补一个「背景层合成」的 component 测试（快照 5 层开关矩阵）再动手？ | Open | 推荐做（给 Phase 3/4 当 before/after 护栏），但属可选 |
| 4 | 整个 4 phase 是否按 gc-closure 的 staged-with-testing 节奏「每 phase 桌面验证后再续」？ | Open | 默认是（与既有节奏一致），等用户确认 |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-15 | Claude | 初稿：穷举 5 层合成栈 + 支撑层审计，区分真冗余（R1-R5）与健康分层（§3.2），给出 4 phase 零行为变更整合计划 |
