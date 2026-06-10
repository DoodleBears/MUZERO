# PRD: 沉浸式「流光」动态背景（封面取色多色流光 + 可配置颜色组合）

**Status:** Implemented（Phase 1–5 ✅ 已落地并提交；真实 app 视觉/交互验证待人工）
**Created:** 2026-06-11
**Author:** DoodleBear / MUZERO
**Module:** Player — Now Playing 沉浸式背景。新增 `scene-flow` 流光可视化（复用既有 twgl scene registry + `now-playing-background` 背景层 + 封面取色管线），把现在的「单一主色光晕」升级为「多色封面取色 / 自定义多色流光」，并在 Settings 新增独立「流光背景」面板（效果 / 取色源 / 颜色组合 / 压暗 / 透明度）

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | 取色基础设施：把 `image-palette.ts` 的单色取色扩成**多色调色板**（`extractImagePalette` 返回 N 个去重色），扩 `visualizer-color-store` 持有 palette + 平滑过渡 | ✅ Completed | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | 渲染：在既有 twgl scene registry 新增 `scene-flow` 流光 shader（自研 mesh-gradient，多色 `uColors[N]` uniform，calm 时间流 + 可选轻度音频调制），WebGL 探测 + aura 回退 | ✅ Completed | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | 取色源模型：`flowColorSource: "cover" \| "custom"`（默认 cover，无封面回退 custom）+ 始终存在的 `flowCustomColors[]`，把 palette 喂进 shader uniform | ✅ Completed | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | Settings：在 Appearance 段新增独立 sidebar item「流光背景」面板（效果选择 / 取色源切换 / 多色编辑器 + 预设 / 压暗 / 透明度 / 动态强度），i18n 四语全量 | ✅ Completed | [Phase 4 Checklist](#phase-4-checklist) |
| 5 | 打磨：reduced-motion / 移动 30fps / bundle 预算复测 / 无封面与切歌过渡 / 文档对齐 | ✅ Completed（运行时行为继承自 SceneHost；视觉验证待人工） | [Phase 5 Checklist](#phase-5-checklist) |
| 6 | **设计修正**：流光改为**独立合成层**（背景图/视频 → 流光 → 频谱，**不互斥**），独立 `flowEnabled` 开关 + `flowOpacity`/`flowDim`；`scene-flow` 从频谱选择器隐藏（`hidden:true`，仍作图层强制 styleId 渲染） | ✅ Completed | [Phase 6 Checklist](#phase-6-checklist) |
| 7 | **全 color4bg 效果对齐**（owner：「支持这个包所有类型」）：14 个自研 flow shader（`flow-shaders.ts`，ambient-light/aesthetic-fluid/big-blob/blur-dot/blur-gradient/wavy-waves/chaos-waves/swirling-curves/curve-gradient/step-gradient/grid-array/triangles-mosaic/random-cubes/abstract-shape），`FlowEffectId` 扩成 14、每效果一 shader 按需编译 | ✅ Completed | [Phase 7 Checklist](#phase-7-checklist) |
| 8 | **过渡自然化**（owner）：切**效果**时 flow 层按 `flowEffect` 做 `key` → AnimatePresence 淡出/淡入**交叉淡化**（不再 recompile 硬切）；切**歌曲**时颜色复用既有封面取色 store 的 900ms `mixPalette` 插值（与频谱同机制，同一 canvas 不重挂） | ✅ Completed | [Phase 8 Checklist](#phase-8-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending
> 本 PRD 适用 [`prd-create.md`](../../../.cursor/commands/prd-create.md) 的 **§3「Effect / Shader / 外部依赖类」** 附加要求（license 第一公民、curate 不穷举、**不引入新 runtime owner**、bundle 预算、自研优先、i18n 四语、不散落硬编码、shader uniform prelude 约定、基础设施先于覆盖广度、回退=`git revert`）与 **§4「realtime preview 性能类」**（reduced-motion / 可见性暂停 / prod build 复测）。

---

## 1. Overview

### 1.1 Background — 需求来源

所有者诉求（口径原话）：

> 调查 anysoul 项目里我们是怎么「用图片颜色做 immersive 模式的动态流光背景」的，用了哪个 package；然后为 MUZERO 落地一个 best practice 版本：
> 1. 允许自己设置**复数个**流光颜色；
> 2. 或者默认**跟随封面颜色**，没有封面则 fallback 到设置的复数个流光颜色（所以两者要**同时**设置）；
> 3. 在可视化设置里支持一个**新的 sidebar item**，可设置不同的流光效果、不同的颜色组合（压暗、透明度）。

本 PRD 先做 anysoul 实现的逆向（§1.2 / §2.2），再选型（§2.3），最后给出贴合 MUZERO 既有架构的落地方案（§2.4 起）。

### 1.2 anysoul 是怎么做的（调查结论）

逆向 [`/Users/doodlebear/Documents/code/anysoul`](file:///Users/doodlebear/Documents/code/anysoul)（`packages/web`）的「immersive mode」动态流光背景，三段式：

**(a) 取色 — `node-vibrant` v4.0.4**（`packages/web/package.json:101`）。Hook [`use-image-palette.ts`](file:///Users/doodlebear/Documents/code/anysoul/packages/web/src/hooks/use-image-palette.ts) `import { Vibrant } from 'node-vibrant/browser'`，对头像/封面 URL 跑 `Vibrant.from(url).quality(1).getPalette()`，拿 **6 个语义色板**：`Vibrant / DarkVibrant / LightVibrant / Muted / DarkMuted / LightMuted`（各取 `.hex`）。`paletteToColors(palette, count=5, {skipDark:true})` 把它们**滤成数组**：默认**跳过暗色板**（避免背景塌成近黑），亮色优先，最多取 5 个。远程 URL 会拼一个 `_palette=1` 的 cache-buster 强制 CORS 请求，避免 `<img>` 缓存污染 canvas（`getImageData` 会 taint）。

**(b) 流光渲染 — `@color4bg/react` v0.1.2 → `color4bg` v0.1.1**（`winterx`，**MIT**，基于 `ogl` 这个小型 WebGL 库）。`<Color4Bg style="ambient-light" colors={bgColors} loop seed={42} />`。`color4bg` 内置 14 个 WebGL shader 背景类（`AmbientLightBg / AestheticFluidBg / BlurGradientBg / SwirlingCurvesBg / BigBlobBg / WavyWavesBg…`），`"ambient-light"` 即 `AmbientLightBg`——一个 fragment-shader 的有机流动 mesh-gradient，颜色由传入 `colors[]` 数组驱动，`loop` 无限循环、`seed` 固定可复现的图样。**它不是音频反应式**，纯时间流（这正是「流光氛围」想要的 calm 质感）。

**(c) 包装 / wiring：**
- [`LazyColor4Bg.tsx`](file:///Users/doodlebear/Documents/code/anysoul/packages/web/src/components/shared/LazyColor4Bg.tsx)：`IntersectionObserver` 可见才挂载 + **WebGL context 预算**（[`webgl-context-pool.ts`](file:///Users/doodlebear/Documents/code/anysoul/packages/web/src/lib/webgl-context-pool.ts)，`MAX=6`，给 pixi 时间线/知识图谱留位）+ `webglcontextlost` 释放 slot；拿不到 slot 时 **CSS `radial-gradient` 回退**（`${c0}88 → ${c1}66 → ${c2}44`）。
- Zustand `useWorkspace`：`immersiveBackgroundMode: 'avatar' | 'custom'`（自动取色 vs 手填），`immersiveCustomColors: string[]`（默认 `['#38bdf8','#22c55e','#f59e0b','#ec4899']`），`immersiveRhythmOpacity`（流光层透明度 0–1），`immersiveBgImageOpacity`。
- 决策 `bgColors`：mode=custom 用 `immersiveCustomColors`（≥2 个才生效，取前 5），否则 `paletteToColors(palette, 5)`；都 `<2` 则不渲染。
- 可读性：流光层 `immersiveRhythmOpacity` slider 整体压暗；表情背景图叠 `bg-black/20` scrim；`framer-motion` 0.8s opacity 淡入淡出避免切换突兀。
- Settings 面板 [`ImmersiveDisplaySettings.tsx`](file:///Users/doodlebear/Documents/code/anysoul/packages/web/src/components/settings/ImmersiveDisplaySettings.tsx)：背景模式切换、预设色组（Nordic/Ocean/Sunset/Forest）、4 个 hex 选择器、多个透明度 slider。

> 一句话：**`node-vibrant` 取多色 → `@color4bg/react`(ambient-light WebGL shader) 渲流光 → Zustand 存 avatar/custom 模式 + 透明度 → IntersectionObserver + WebGL 预算 + CSS 回退**。

### 1.3 MUZERO 现状（已经有一半地基）

MUZERO **不需要从零搭**——关键管线都已存在，本 PRD 是「升维 + 配置化」而非新建：

| 能力 | anysoul | MUZERO 现状 | 本 PRD 动作 |
|---|---|---|---|
| 取色 | `node-vibrant`（6 语义板） | [`image-palette.ts`](../../../src/lib/image-palette.ts) `extractDominantImageColor` —— **自研、零依赖** canvas 量化，但**只出 1 个主色**（文件里已写注释「anysoul 用 node-vibrant；MUZERO 保持本地零依赖」） | **扩成多色** `extractImagePalette()`（top-N 去重桶） |
| 流光渲染 | `@color4bg/react`(ogl) | [`scene/reactive-scene.tsx`](../../../src/visualizer/scene/reactive-scene.tsx) —— **自研 twgl.js**(MIT) fragment-shader scene（已有 `scene-aurora` / `scene-liquid`），可插拔 [registry](../../../src/visualizer/registry.ts) | **新增 `scene-flow`** scene（多色 uniform） |
| 取色 wiring | Zustand `useWorkspace` | [`visualizer-color-store.ts`](../../../src/stores/visualizer-color-store.ts) + [`visualizer-dynamic-color.tsx`](../../../src/components/player/visualizer-dynamic-color.tsx) —— 已把封面主色平滑过渡进 `--primary` | **扩 store 持 palette** |
| 背景层 + 透明度/压暗 | 自建 motion 层 | [`now-playing-background.tsx`](../../../src/components/player/now-playing-background.tsx) —— 已有 `visualizerAsBackground` + 透明度/压暗/歌词压低/AnimatePresence 淡入 | **直接复用**，flow 作为一种 background scene |
| 可见性/暂停/回退 | IntersectionObserver + WebGL 池 | [`host.tsx`](../../../src/visualizer/host.tsx) `SceneHost` —— 已有 IO 暂停 + reduced-motion + `hasWebGL()` 回退 aura + context-lost 处理 | **直接复用** |
| Settings sidebar | 单面板 | [`settings-nav.ts`](../../../src/components/settings/settings-nav.ts) 两栏 IA + [`settings-sidebar.tsx`](../../../src/components/settings/settings-sidebar.tsx) | **加一个 nav item + 面板** |

### 1.4 Target Users

| Role | Description | 关注点 |
|------|-------------|--------|
| **桌面沉浸用户** | Electron/Tauri 桌面（默认 1180×780）/ 浏览器 `make dev` | 大屏 Now Playing 流光氛围、跟封面变色、可挑效果与配色、流畅不掉帧 |
| **「音乐承载回忆」用户** | 上传自己音视频 + tag/note/cover 混合歌单 | 听自己的歌时封面取色流光；自传封面也能驱动氛围 |
| **无封面 / 生成中用户** | DJ 续歌的 pending track、未设封面的上传 | 没封面时**不塌成黑屏**，回退到自己设的多色流光 |
| **重度自定义用户** | 想要固定主题氛围 | 设一组自己的流光颜色（synthwave / 海洋…），全程固定 |
| **a11y / 低动效 / 移动用户** | `prefers-reduced-motion` / iOS WebView | 静态/近静态回退、可见性暂停、不烫手不耗电 |

### 1.5 Core Value

1. **封面承载回忆 → 颜色也承载回忆**：流光跟随当前封面取色（多色），每首歌的氛围都不同；这正契合 MUZERO「音乐承载回忆」的产品内核。
2. **同时配置、永不塌黑**：默认跟封面，无封面/取色失败自动回退到用户设的多色 —— 二者**同时存在**，沉浸背景在任何 track 状态下都成立（pending / 无封面 / 纯标题）。
3. **零新 runtime owner、零 license 风险**：复用**已在树中**的 twgl + 自研取色，**不引入** `color4bg`/`ogl`/`node-vibrant`（§2.3 决策）；自研 shader = `MIT (MUZERO)`，bundle 增量目标 < 30KB gz。
4. **配置化但不散落**：流光样式走既有 visualizer registry（不 `if (style===…)`）；取色源/配色/压暗/透明度集中在新 Settings 面板，全部是**可见控件**（不引入 hidden flag）。
5. **本地优先不变**：只读设备本地封面字节做取色，**零出站、零遥测**；颜色值永不进日志/上报。

---

## 2. System Architecture

### 2.1 关键约束：复用单一 scene 管线，flow 是「又一种 scene 样式」

MUZERO 的可视化已是可插拔 registry（[`src/visualizer/`](../../../src/visualizer/)）：`VisualizerHost` 按 `AppSettings.visualizerStyle` 选样式，scene kind 走 `SceneHost` → lazy `ReactiveScene`（twgl 单 fragment shader，IO 暂停 / reduced-motion / WebGL 回退 aura）。`now-playing-background.tsx` 在 `visualizerAsBackground` 打开时把 `VisualizerHost` 垫成 Now Playing 背景，且**已有**透明度（`visualizerBackgroundOpacity`）、压暗（`visualizerBackgroundDim`）、歌词时压低（`visualizerBgOpacityLyrics`/`Dim`）、`AnimatePresence` 淡入淡出。

**结论：流光复用 `scene-flow` shader 的渲染机制（继承 `SceneHost` 全部生命周期），但落地为一个独立图层。** 补三件**新**东西：(1) 多色取色 + 多色 store；(2) flow 自己的配置面板；(3) flow 独立合成层。

> ⚠️ **Phase 6 设计修正（owner 反馈）**：流光**不是**可视化频谱的「又一种样式」（早期实现误把它做成 `visualizerStyle` 选项，与频谱互斥）。正确模型是**独立合成层**：[`now-playing-background.tsx`](../../../src/components/player/now-playing-background.tsx) 里 **背景图/视频 → 流光层 → 可视化频谱** 三层叠加，流光由独立 `flowEnabled` 开关 + `flowOpacity`/`flowDim` 控制（强制 `styleId="scene-flow"` 渲染），与频谱**并存不互斥**。`scene-flow` 在 registry 标 `hidden:true` → 不进频谱选择器（`VISUALIZER_PICKER_META`），只作图层渲染载体。下文 §2.1–§5 中「flow 作为 visualizer 样式」的表述以本修正为准。

```
封面 Blob ──extractImagePalette()──▶ Rgb[]（top-N 去重，亮色优先）
                                         │  flowColorSource=cover → 用它；为空则回退 flowCustomColors
                                         ▼
            visualizer-color-store（扩展：rgb 单色 + palette 多色，900ms 平滑过渡）
                                         │  注入 CSS vars / 直接读
                                         ▼
  VisualizerHost(style=scene-flow) ─▶ SceneHost ─▶ ReactiveScene(twgl)
        uColors[N] uniform  ◀───────────────────────┘
                                         │  mesh-gradient flow shader（uTime 流动 + 可选轻度 uBass/uEnergy 调制）
                                         ▼
            now-playing-background 背景层（已有透明度/压暗/歌词压低/淡入）
                                         ▼
            WebGL 失败 → SceneHost 已回退 aura；取色失败/无封面 → flowCustomColors
```

### 2.2 anysoul 关键代码引用（落地参照）

| 关注点 | anysoul 文件 | 我们要照搬的「思想」（非代码） |
|---|---|---|
| 多色滤取 + 跳暗色 | `use-image-palette.ts` `paletteToColors(skipDark)` | 亮色优先、跳近黑、`≥2` 个才成立、去重、上限 N |
| CORS / canvas taint | `use-image-palette.ts` cache-buster | MUZERO 取的是**本地 Blob**（`URL.createObjectURL`），无 CORS 问题（[`image-palette.ts:23`](../../../src/lib/image-palette.ts) 已这么做）✅ |
| 流光 shader | `color4bg` `AmbientLightBg` | calm 时间流 mesh-gradient（**不**强绑音频）；我们用自研 twgl shader 复刻质感 |
| avatar/custom 模式 + 默认色 | `useWorkspace` `immersiveBackgroundMode` / `immersiveCustomColors` | → `flowColorSource` + `flowCustomColors`（默认给一组好看的预设） |
| 透明度 / scrim | `immersiveRhythmOpacity` + `bg-black/20` | MUZERO **已有** `visualizerBackgroundOpacity`/`Dim`，复用，不重造 |
| 可见性 + WebGL 回退 | `LazyColor4Bg` + `webgl-context-pool` | MUZERO `SceneHost` **已有** IO 暂停 + `hasWebGL()` 回退 ✅ |

### 2.3 选型决策（License 第一公民 + 不引入新 runtime owner）

按模板 §3，逐个第三方依赖做 ship/no-ship 判定：

| 候选 | License | 体积/依赖 | 决策 | 理由 |
|---|---|---|---|---|
| **`@color4bg/react` + `color4bg`** | **MIT** ✅ | 拉入 **`ogl`**（第二个 WebGL runtime，MUZERO 已有 twgl） | ❌ **不引入** | 违反「不引入新 runtime owner」：项目已用 `twgl.js` 跑 scene shader，再加 `ogl` = 两套 WebGL 事实来源；14 个 bg 类大部分用不上（curate 成本）；其 `Color4Bg` 自管 canvas/rAF，与 `SceneHost` 的可见性/暂停/context 生命周期重叠打架 |
| **`node-vibrant` v4** | MIT | 中等（含 quantizer + worker） | ❌ **不引入** | MUZERO 已自研 [`image-palette.ts`](../../../src/lib/image-palette.ts) 量化取色（文件注释明确「保持本地零依赖」）；单色扩多色只需 ~30 LOC，无需引第三方；保持零依赖 + bundle 预算 |
| **`extract-colors` / `colorthief`** | MIT | 小 | ❌ **不引入** | 同上，自研已覆盖 |
| **自研 twgl `scene-flow` shader** | `MIT (MUZERO)` | 复用已在树的 twgl，新增 1 个 `.frag` 字符串 | ✅ **采用** | 复用 registry + SceneHost 全套生命周期；与现有 `scene-aurora`/`scene-liquid` 同一 uniform prelude；零新依赖；bundle 增量 ~shader 字符串体积 |
| **自研多色 `extractImagePalette`** | `MIT (MUZERO)` | 复用已有 canvas 量化 | ✅ **采用** | 把现有单桶 argmax 改成 top-N 去重桶；与单色 `extractDominantImageColor` 同文件共用 HSL 过滤逻辑 |

> **决策：全部自研、零新依赖。** color4bg/node-vibrant 仅作为「灵感来源」记录，不进 `package.json`。这与模板「典型 100–200 LOC 自研覆盖 80% 用例，避免 vendor lock-in」一致，也与 [`feedback_no_hidden_backend_flags`] / 「不引入新 runtime owner」一致。
>
> **若未来确实要 color4bg 的高级图样**（如 `AestheticFluidBg` 的流体感），再开独立 dependency-manifest-review PRD（评估 ogl 与 twgl 的共存策略），不在本期。

### 2.4 Shader uniform prelude 约定（沿用既有 scene 约定）

新增 `scene-flow` 的 fragment shader **复用** [`scene-shaders.ts`](../../../src/visualizer/scene/scene-shaders.ts) 既有 prelude（`uTime / uResolution / uAudio / uBass / uMid / uTreble / uGlow / uIntensity / uSpread`），**新增**多色 uniform：

```glsl
// scene-flow prelude 增量（MUZERO，MIT）
#define FLOW_MAX_COLORS 5
uniform vec3  uColors[FLOW_MAX_COLORS];  // 取色/自定义调色板（sRGB 0..1），未用槽位填最后一个色
uniform int   uColorCount;               // 实际颜色数（2..5）
uniform float uFlowSpeed;                // 流动速度（来自 flowMotion 设置）
uniform float uFlowScale;                // mesh 斑块尺度
uniform float uReactivity;               // 音频调制强度（来自 flowAudioReactivity，calm 默认低）
uniform int   uEffect;                   // 效果变体 0=aurora-drift 1=liquid-mesh 2=soft-blobs（flowEffect）
```

> ✅ **已实现** [`scene-shaders.ts`](../../../src/visualizer/scene/scene-shaders.ts) `FLOW_FRAG` + [`reactive-scene.tsx`](../../../src/visualizer/scene/reactive-scene.tsx)。blob 用 Gaussian 权重 `exp(-d²/r²)` 归一化混合（`col/wsum`）得到全屏 melt 流光场，`uReactivity` 让 bass/energy 只做**轻度**调制。

shader 主体：以多个**动态漂移的 radial blob**（每个 blob 绑一个 `uColors[i]`，圆心随 `uTime*uFlowSpeed` 做低频 Lissajous 漂移）做 soft-min 混合，得到 anysoul ambient-light 那种「多色互相渗透的流动 mesh」。音频是**可选轻度**调制（`uBass` 微推 blob 半径 / `uEnergy` 微调亮度），**默认很弱**，保证「氛围 calm」而非「蹦迪频谱」——这是 flow 与既有 `scene-aurora`（强音频反应）的产品区分。

> uniform 命名走 MUZERO prelude，不依赖任何原 lib 命名（满足「跨 lib 切换」约定）。`.frag` 文件 header 标注 `Self-authored — MIT (MUZERO)`。

### 2.5 Project Structure（增量；以改既有为主）

```
src/
├── lib/
│   ├── image-palette.ts              # ✏️ 新增 extractImagePalette()（多色 top-N）；保留 extractDominantImageColor
│   └── visualizer-color.ts           # ✏️（可选）补 palette→CSS helper
├── stores/
│   └── visualizer-color-store.ts     # ✏️ 扩 state：palette: Rgb[] + 平滑过渡；保留单色 rgb
├── components/player/
│   ├── visualizer-dynamic-color.tsx  # ✏️ 取 palette（不只单色），写入 store
│   └── now-playing-background.tsx    # ✏️（小）确保 scene-flow 在背景层正确接 palette + 透明度/压暗（多数已通）
├── visualizer/
│   ├── types.ts                      # ✏️ VisualizerStyleId 加 "scene-flow"
│   ├── registry.ts                   # ✏️ META 加 scene-flow（kind:"scene"）+ labelKey
│   └── scene/
│       ├── scene-shaders.ts          # ✏️ 新增 FLOW_FRAG（自研 mesh-gradient）
│       └── reactive-scene.tsx        # ✏️ scene-flow 分支：选 FLOW_FRAG + setUniforms(uColors/uColorCount/...)
├── components/settings/
│   ├── settings-nav.ts               # ✏️ Appearance 段加 { id:"flow", labelKey:"settings.navFlow" }
│   ├── flow-settings.tsx             # 🆕 流光背景面板（效果/取色源/多色编辑/压暗/透明度/动态强度）
│   └── (settings-page.tsx)           # ✏️ 路由 "flow" → <FlowSettings/>
├── lib/flow-config.ts                # 🆕 纯函数：resolveFlowColors(source, palette, custom) + 预设色组 + 校验（穷举单测）
├── db/types.ts                       # ✏️ AppSettings 加可选 flow* 字段（additive，无 DB bump）
└── i18n/locales/{en,zh,ja,ko}/common.json  # ✏️ 新增 flow.* / settings.navFlow（en 为类型源）
```

> 🆕 仅 2 个新文件：`flow-settings.tsx`（新面板）、`flow-config.ts`（新纯函数 + 预设）。满足「不新增源码文件，除非新 lib bridge / parser / 新 shader 源」——`flow-config` 是新纯逻辑域，`FLOW_FRAG` 是新 shader 源（append 进 `scene-shaders.ts`）。

---

## 3. Data Model Design

### 3.1 AppSettings 增量（全部 additive、optional、非索引 → **无需 Dexie version bump**）

`settings` 表是单行（`settings: "id"`），新增可选字段不动 schema（与 `visualizerUseCoverColor` / `backgroundMaskOpacity` 等历史新增同路径，最新版本 v20 不需 +1）。在 [`db/types.ts`](../../../src/db/types.ts) `AppSettings` 追加：

```typescript
/** 流光背景取色源：跟随当前封面取色，或固定用户自定义多色。默认 "cover"。 */
flowColorSource?: "cover" | "custom";
/** 用户自定义流光颜色（hex 数组，2..5 个）。即使 source="cover" 也始终保留——
 *  作为「无封面 / 取色失败」的回退（需求 2：二者同时设置）。默认见 FLOW_DEFAULT_COLORS。 */
flowCustomColors?: string[];
/** 流光效果变体 id（aurora-drift / liquid-mesh / soft-blobs …），由 scene-flow shader 分支消费。默认 "aurora-drift"。 */
flowEffect?: FlowEffectId;
/** 流动速度 0–100（→ uFlowSpeed）。默认 40（calm）。 */
flowMotion?: number;
/** 斑块尺度 0–100（→ uFlowScale）。默认 50。 */
flowScale?: number;
/** 音频对流光的调制强度 0–100（0=纯氛围不反应，100=明显随乐起伏）。默认 20（轻度）。 */
flowAudioReactivity?: number;
```

> **复用既有压暗/透明度**：流光作为 `scene-flow` 走背景层时，沿用 [`now-playing-background.tsx`](../../../src/components/player/now-playing-background.tsx) 已有的 `visualizerBackgroundOpacity` / `visualizerBackgroundDim` / `visualizerBgOpacityLyrics` / `visualizerBgDimLyrics`——**不新造**透明度字段，避免「两套压暗事实来源」。Settings flow 面板把这几个已有控件**也镜像**呈现（同 saveSettings 字段），用户在一个面板里完成需求 3 的「压暗、透明度」。

### 3.2 取色 store 增量

[`visualizer-color-store.ts`](../../../src/stores/visualizer-color-store.ts) 当前持单色 `rgb / css / coverBlobId` + 900ms 过渡。扩展为同时持 palette：

```typescript
interface VisualizerCoverColorState {
  coverBlobId: string | null;
  rgb: Rgb | null;          // 既有：单色（spectrum / --primary 用），不变
  css: string | null;       // 既有
  palette: Rgb[];           // 🆕 多色（scene-flow 用），随封面平滑过渡（逐色 mix）
}
```

切歌时 palette 与单色一同过渡（逐元素 `mixRgb`，长度不一时按 min 对齐 + 末色补齐），避免突变。缓存键沿用 `cover.id`（[`visualizer-dynamic-color.tsx:57`](../../../src/components/player/visualizer-dynamic-color.tsx) 的 `colorCache`，改存 `{rgb, palette}`）。

### 3.3 取色算法（多色，纯函数，穷举单测）✅

**已实现** [`image-palette.ts`](../../../src/lib/image-palette.ts)。`extractImagePalette(blob, count = 4): Promise<Rgb[]>` 复用既有下采样（≤96px）+ HSL 过滤（跳近黑/近白/低饱和）+ `QUANTIZE_STEP=16` 分桶逻辑，但**返回 top-N**：

1. 量化分桶（同现有）；
2. 每桶算 `score = count * (0.65 + sat*1.4) * lightBalance`（同现有单色打分），按 score 降序；
3. 贪心选桶，**去重**：跳过与已选色 sRGB 欧氏距离 `< MIN_SWATCH_DISTANCE`(=64) 的近似色（避免「5 个都是同一个紫」）；
4. 取前 `count`（默认 4），无可用色 → 返回 `[]`（调用方回退 custom）。

> **实现微调（vs 原 PRD）**：去掉了 `skipDark` 入参——既有 HSL `lightness` 过滤（`< 0.1` 跳近黑）已覆盖「不要暗色」，多一个 knob 是 YAGNI。去重改用 sRGB 欧氏距离（比 HSL 距离实现更简单、对专辑图够用，已穷举单测锁定）。`extractDominantImageColor(blob)` / 纯函数 `selectDominantImageColor(pixels)` 保留为 `…Palette(…, 1)[0] ?? null`（单色调用方零回归，既有测试全绿）。

### 3.4 颜色解析纯函数 `flow-config.ts` ✅

**已实现** [`flow-config.ts`](../../../src/lib/flow-config.ts)（14 测试穷举）。实际导出：`resolveFlowColors` + `resolveFlowConfig`（AppSettings→shader 值映射）+ `normalizeHexColor`/`hexToRgb`/`normalizeFlowColors` + `FLOW_DEFAULT_COLORS`/`FLOW_PRESETS`/`FLOW_EFFECTS`/`FLOW_MIN_COLORS`/`FLOW_MAX_COLORS`。`resolveFlowColors(source, palette, custom)` 三个参数都是 `Rgb[]`（hex→Rgb 解析在 `resolveFlowConfig`/`normalizeFlowColors`，让取色裁决保持纯 RGB）。`resolveFlowConfig` 把 `flowMotion/Scale/AudioReactivity`(0–100) clamp 成 0–1、`flowEffect`→shader branch index、`flowCustomColors` 解析且 `<2` 个有效时回退 `FLOW_DEFAULT_COLORS`。wiring：[`host.tsx`](../../../src/visualizer/host.tsx) `VisualizerHost` memo `resolveFlowConfig(settings)` → `SceneHost` → [`reactive-scene.tsx`](../../../src/visualizer/scene/reactive-scene.tsx) 用 `flowRef`（读取不重启 GL loop）+ `resolveFlowColors` 喂 `uColors`/`uEffect`/`uFlowSpeed`/`uFlowScale`/`uReactivity`。



```typescript
export const FLOW_DEFAULT_COLORS = ["#7c5cff", "#22d3ee", "#f472b6", "#fbbf24"]; // synthwave-ish
export const FLOW_PRESETS: { id: string; labelKey: string; colors: string[] }[] = [
  { id: "aurora",    labelKey: "flow.presetAurora",    colors: ["#22d3ee","#34d399","#a78bfa"] },
  { id: "sunset",    labelKey: "flow.presetSunset",    colors: ["#fb7185","#f59e0b","#7c3aed"] },
  { id: "ocean",     labelKey: "flow.presetOcean",     colors: ["#0ea5e9","#2563eb","#14b8a6"] },
  { id: "synthwave", labelKey: "flow.presetSynthwave", colors: ["#7c5cff","#ff2e97","#22d3ee"] },
];

/** 单一裁决：决定喂给 shader 的颜色（穷举单测）。 */
export function resolveFlowColors(
  source: "cover" | "custom",
  palette: Rgb[],            // 当前封面取色（可能为空）
  custom: string[],          // 用户自定义（始终 ≥2）
): Rgb[] {
  if (source === "cover" && palette.length >= 2) return palette;
  return custom.map(hexToRgb).filter(Boolean); // 回退：无封面/取色失败 → 自定义（需求 2）
}
```

> `resolveFlowColors` 是「video→cover→title」式的**唯一回退裁决**，单测穷举：cover 有/无 palette、custom 合法/非法 hex、空数组、单色不足 2 个等。规范化 hex（trim/补 #/校验）与去重同址。

---

## 4. Module Surface（无后端；纯前端模块契约）

> 本项目无后端、无 API endpoint（本地优先）。本节列「模块函数契约」替代 §4 API。

| 符号 | 文件 | 签名 | 说明 |
|---|---|---|---|
| `extractImagePalette` ✅ | [`lib/image-palette.ts`](../../../src/lib/image-palette.ts) | `(blob: Blob, count = 4) => Promise<Rgb[]>` | 多色取色（top-N 去重，dominant first） |
| `selectImagePalette` ✅ | 同上 | `(pixels, count = 4) => Rgb[]` | 纯函数（穷举单测） |
| `extractDominantImageColor` / `selectDominantImageColor` ✅ | 同上 | 不变 | `= …Palette(…,1)[0] ?? null`，单色调用方不回归 |
| store `palette` + `getVisualizerCoverPalette()` ✅ | [`visualizer-color-store.ts`](../../../src/stores/visualizer-color-store.ts) | `Rgb[]`，随封面 900ms 过渡 | scene-flow 读取 |
| `mixPalette` ✅ | 同上 | `(from, to, t) => Rgb[]` | 逐色插值，结果长度对齐 target（穷举单测） |
| `resolveFlowColors` | `lib/flow-config.ts` 🆕 | `(source, palette, custom) => Rgb[]` | 取色源回退裁决（纯，穷举单测） |
| `FLOW_PRESETS` / `FLOW_DEFAULT_COLORS` | 同上 | 常量 | 预设色组 + 默认自定义色 |
| `scene-flow` META | [`registry.ts`](../../../src/visualizer/registry.ts) | `{ id:"scene-flow", kind:"scene", backend:"webgl", labelKey, fftSize, smoothing }` | 注册即出现在 Visualizer 样式选择 |
| `FLOW_FRAG` | [`scene/scene-shaders.ts`](../../../src/visualizer/scene/scene-shaders.ts) | GLSL 字符串 | 自研 mesh-gradient，MIT (MUZERO) |

### 4.1 错误 / 边界

- **取色失败 / 非图片 / canvas taint**：`extractImagePalette` 返回 `[]` → `resolveFlowColors` 回退 custom → 永不黑屏。
- **WebGL 不可用**：`SceneHost` 既有逻辑回退 `aura` spectrum（[`host.tsx:234`](../../../src/visualizer/host.tsx)）即可——**不额外造 CSS `radial-gradient` 流光回退**（Open Q2 已定：我们这里不需要）。
- **context lost**（移动 WebView 内存压力）：`reactive-scene.tsx` 既有 `onLost/onRestored` 处理，flow 复用。
- **空/单色封面**（纯黑白专辑图）：HSL 过滤后 < 2 色 → 回退 custom。

---

## 5. Frontend Design

### 5.1 Settings：新增 sidebar item「流光背景」（需求 3）

在 [`settings-nav.ts`](../../../src/components/settings/settings-nav.ts) 的 **Appearance** 段插入（紧跟 `visualizer` 之后）：

```typescript
{ labelKey: "settings.navSecAppearance", items: [
  { id: "appearance", labelKey: "settings.appearance" },
  { id: "background",  labelKey: "settings.navBackground" },
  { id: "visualizer",  labelKey: "settings.navVisualizer" },
  { id: "flow",        labelKey: "settings.navFlow" },        // 🆕 流光背景
  { id: "lyrics",      labelKey: "settings.navLyrics" },
]},
```

`settings-page.tsx` 路由 `"flow" → <FlowSettings/>`。Sidebar 搜索（拼音/假名）自动覆盖（[`settings-sidebar.tsx`](../../../src/components/settings/settings-sidebar.tsx) 用 `freeTextMatches`，无需改）。

### 5.2 `flow-settings.tsx` 面板控件（全部 `t()`、即时 `saveSettings`）

| 控件 | 字段 | 说明 |
|---|---|---|
| **效果** Select | `flowEffect` | **v1 curate 3 个**：aurora-drift / liquid-mesh / soft-blobs（Open Q1 已定；`flow.effect*` i18n，更多变体进 v2 backlog） |
| **取色源** Radio/Segmented | `flowColorSource` | 「跟随封面」(cover) / 「自定义颜色」(custom)。提示文案说明 cover 无封面时回退自定义（需求 2） |
| **自定义颜色** 多色编辑器 | `flowCustomColors` | 2..5 个 `ColorPicker`（复用既有 [`ui/color-picker`](../../../src/components/ui/color-picker.tsx)），可加/删色块（min 2 / max 5）；一排预设色组按钮（`FLOW_PRESETS`）一键填入。**始终可编辑**（即便 source=cover，因为是回退源）（需求 1+2） |
| **实时预览** | — | 面板内一个小尺寸 `VisualizerHost styleId="scene-flow"` 即时反映当前配置（cover 模式显示当前曲封面取色 or 回退） |
| **动态强度** Slider | `flowAudioReactivity` | 0=纯氛围 calm，100=明显随乐 |
| **流动速度 / 尺度** Slider | `flowMotion` / `flowScale` | 调流动节奏与斑块大小 |
| **压暗** Slider | `visualizerBackgroundDim`(+`…Lyrics`) | **复用既有字段**（需求 3 的「压暗」），不新造 |
| **透明度** Slider | `visualizerBackgroundOpacity`(+`…Lyrics`) | **复用既有字段**（需求 3 的「透明度」） |

> 入口联动：选 `scene-flow` 为可视化样式 + 开 `visualizerAsBackground` 时流光铺满 Now Playing 背景。flow 面板顶部给一个「设为沉浸背景」快捷开关（写 `visualizerStyle="scene-flow"` + `visualizerAsBackground=true`），降低用户找开关的成本。

### 5.3 取色 wiring（需求 2 的核心）

[`visualizer-dynamic-color.tsx`](../../../src/components/player/visualizer-dynamic-color.tsx) 当前对当前曲封面跑 `extractDominantImageColor` 写单色。扩展：同时跑 `extractImagePalette` 写 `palette` 到 store；`scene-flow` 渲染时读 `store.palette` → `resolveFlowColors(flowColorSource, palette, flowCustomColors)` → `uColors`。无封面/取色失败时 `palette=[]`，`resolveFlowColors` 自动回退 `flowCustomColors`。`source="custom"` 时直接用 `flowCustomColors`（忽略封面）。

### 5.4 State Management（Zustand 纪律）

- 取色单例（缓存 + 过渡 rAF）留模块作用域，不进 React state（沿用现状）。
- 组件用最小 selector；`palette` 经 store + CSS/uniform 注入，不每帧 setState（沿用 spectrum/scene 的 `readPrimaryRgb` 每帧读法，改成读 store palette）。
- 满足 `feedback-zustand-state-decoupling` memory：不让流光配置更新波及无关组件。

---

## 6. Implementation Plan

> **Phase 顺序遵循「基础设施先于覆盖广度」**：取色多色化 + store（P1）→ shader（P2）→ 取色源回退（P3）→ Settings UI（P4）→ 打磨（P5）。每 phase 独立可 `make check` 通过、可单独 PR。

### Phase 1: 多色取色基础设施 ✅

**Goal:** `image-palette.ts` 出 N 色；store 持 palette 并平滑过渡。

**Tasks:**
- [x] `extractImagePalette(blob, count = 4)` + 纯函数 `selectImagePalette(pixels, count = 4)`：top-N 去重桶（复用现有量化 + HSL 过滤 + 打分；sRGB 距离去重）。
- [x] `extractDominantImageColor` / `selectDominantImageColor = …Palette(…,1)[0]`，保证单色调用方零回归。
- [x] `visualizer-color-store` 加 `palette: Rgb[]` + `mixPalette` 逐色过渡 + `getVisualizerCoverPalette()`；`transitionVisualizerCoverColor(coverBlobId, next, nextPalette=[])`。
- [x] `visualizer-dynamic-color` 取 palette 写 store（缓存改存 `{rgb, palette}`，保留单色写入）。

### Phase 1 Checklist
- [x] `image-palette.test.ts` 扩：纯黑白图→`[]`、多彩图→去重 N 色、近似色合并、count 边界、`= palette[0]`。
- [x] 单色 `selectDominantImageColor` 既有测试全绿（无回归）。
- [x] `visualizer-color-store.test.ts` `mixPalette` 过渡单测（t=0/0.5/1、长度增/减对齐、空 from、空 to）。
- [x] typecheck + biome（touched files）绿；无其它 importer 破坏。

### Phase 2: `scene-flow` shader + registry ✅

**Goal:** 新增一个 calm 多色流光 scene 样式，跑在既有 SceneHost 上。

**Tasks:**
- [x] `FLOW_FRAG`（自研 mesh-gradient：N 个漂移 radial blob 绑 `uColors[i]`，Gaussian 权重归一化混合，`uTime*uFlowSpeed` 流动，`uFlowScale` 尺度）。header 标 `MIT (MUZERO)`。**v1 curate 3 个效果变体** `aurora-drift / liquid-mesh / soft-blobs`（一个 `uEffect` int uniform 分支，避免编 3 个 program）。
- [x] `reactive-scene.tsx`：`scene-flow` 分支选 `FLOW_FRAG`，`setUniforms` 补 `uColors/uColorCount/uFlowSpeed/uFlowScale/uReactivity/uEffect` + 轻度音频调制（`uReactivity`）。color buffer 复用（`Float32Array` 不每帧分配）。`isFlow` 入 render-loop deps（切样式重启循环）。
- [x] `types.ts` 加 `"scene-flow"`；`registry.ts` META（kind scene / backend webgl / smoothing 0.88）+ `labelKey: "visualizer.styleSceneFlow"` + createVisualizer scene case。
- [x] i18n 四语 `visualizer.styleSceneFlow`（en 类型源 + zh/ja/ko）。
- [x] WebGL 失败回退 aura（既有 `SceneHost`）；context-lost 复用既有 `onLost/onRestored`。

> **Phase 2 取色来源（临时）**：scene-flow 当前读 `getVisualizerCoverPalette()`（封面取色），≥2 色用它，否则用 `uPrimary` 派生的色调 spread 兜底。**Phase 3 会把兜底换成 `resolveFlowColors(custom)`**，并把 `uFlowSpeed/uFlowScale/uReactivity/uEffect` 从硬编码默认接到 flow 设置。`scene-flow` 走既有 host，surface + background placement 自然都支持（Open Q3）。

### Phase 2 Checklist
- [x] `registry.test.ts`：`scene-flow` 注册、kind=scene、backend=webgl、resolve 不回退、createVisualizer→null。
- [x] typecheck（whole tree）+ biome（5 files）绿。
- [ ] 视觉验证（真实 app / `make dev`）：多色流动、calm、跟 `uColors` 变色——**预览沙箱 WebGL rAF 冻结，留真实窗口/Phase 5 人工确认**（见 `preview-hidden-tab-gotcha` memory）。
- [x] 无 WebGL → `SceneHost` 既有逻辑回退 aura（沿用，不新增路径）。

### Phase 3: 取色源回退模型 ✅

**Goal:** `flowColorSource` + `flowCustomColors` 同时生效，无封面回退（需求 1+2）。

**Tasks:**
- [x] `flow-config.ts`：`resolveFlowColors` + `resolveFlowConfig`(settings→shader 值) + `FLOW_PRESETS` + `FLOW_DEFAULT_COLORS` + `FLOW_EFFECTS` + `normalizeHexColor`/`hexToRgb` 规范化/校验。
- [x] `db/types.ts` 加 `flowColorSource`/`flowCustomColors`/`flowEffect`/`flowMotion`/`flowScale`/`flowAudioReactivity` + `FlowColorSource`/`FlowEffectId` 类型（additive 可选，无 DB bump）。
- [x] `scene-flow` 渲染读 `resolveFlowColors(source, store.palette, customColors)` → `uColors` + flow 参数 uniform；host 经 `flowRef` 接线（不重启 GL loop）。

### Phase 3 Checklist
- [x] `flow-config.test.ts` 穷举（14）：cover+palette、cover+空palette→custom、custom 模式、非法 hex 过滤、<2 色回退默认、effect 映射、0–100 clamp。
- [x] typecheck（whole tree，含 host/scene/types）+ biome 绿。
- [ ] 手测（真实 app）：删当前曲封面 → 流光不黑屏、回退自定义色；切 source=custom → 忽略封面 —— **留 Phase 4 接好 UI 后人工确认**。

### Phase 4: Settings「流光背景」面板 + i18n ✅

**Goal:** 需求 3 的独立 sidebar item 与全部配置控件。

**Tasks:**
- [x] `settings-nav.ts` 加 `{ id:"flow", labelKey:"settings.navFlow" }`（Appearance 段，visualizer 之后）。
- [x] `flow-settings.tsx`：效果 Select / 取色源 segmented(cover|custom) / 多色编辑器(ColorPicker + add/remove min2 max5 + `FLOW_PRESETS` 一键) / 速度·尺度·动态强度 slider / 压暗·透明度（复用 `visualizerBackground*`）+ 内嵌 `VisualizerHost styleId="scene-flow"` 实时预览 + 「设为沉浸背景」快捷开关。
- [x] `settings-page.tsx` 路由 `{activeItem === "flow" && <FlowSettings />}`。
- [x] i18n 四语（en 类型源 → zh/ja/ko）：`settings.navFlow`、`flow.*`(title/intro/effect×3/colorSource/source×2/customColors/presets×4/tuning…)、`visualizer.styleSceneFlow`(Phase 2)。

### Phase 4 Checklist
- [x] `settings-nav.test.ts` 含 `flow` id（4 测试绿，stale fallback 不破）。
- [x] 四语 catalog 全量（en/zh/ja/ko 各 27 个 flow.* + navFlow；JSON 校验通过）。
- [x] 无硬编码用户可见字符串（全 `t()`）；biome + whole-tree typecheck 绿。
- [ ] 手测（真实 app）：面板改值即时生效 + 预览同步 + sidebar 搜索命中——**留人工/Phase 5 确认**。

> **并发分支说明**：本 phase 落在多 agent 共享 working tree 上。`flow-settings.tsx`/`settings-nav.ts`/`settings-nav.test.ts` 是 mine-only 正常提交；`settings-page.tsx`（smooth-scroll agent 活跃 WIP）与 4 个 locale（globalSearch/lyrics agent）是 co-modified，用 `git apply --cached` 只暂存我的 hunk（不动 working tree，保护他人 WIP），单独提交。

### Phase 5: 打磨 / 性能 / 文档 ✅

**Goal:** reduced-motion、移动、bundle、过渡、文档。

**Tasks:**
- [x] reduced-motion → flow 冻结静态帧：**继承** `SceneHost`（`paused = !onscreen || reduce` → `ReactiveScene` 单帧冻结），无新代码；`flowAudioReactivity` 默认低（0.2）不放大闪动。
- [x] 移动 30fps / 可见性暂停：**继承** `SceneHost` 的 `IntersectionObserver` + `visibilitychange` 暂停，flow 自动获得。
- [x] 切歌 palette 过渡顺滑（900ms `mixPalette` 逐色），无封面/取色失败回退自定义色（`resolveFlowColors`），永不黑屏。
- [x] `CLAUDE.md`「可视化样式」段补 `scene-flow` + 多色取色 + 取色源回退 + 「不引入 color4bg/ogl/node-vibrant」；本 PRD 状态 → Implemented。
- [~] bundle 增量：新增全是小体量（`FLOW_FRAG` shader 字符串折进已 lazy 的 scene chunk；`flow-config` ~3KB / `flow-settings` ~7KB 源码，进 settings chunk），远 < 30KB gz 目标。**未单独跑 `pnpm build`**（共享 working tree 含他人 WIP，整包构建噪声大）——估算达标，留 CI/人工实测。

### Phase 5 Checklist
- [x] reduced-motion / 可见性暂停 / WebGL 回退 aura / context-lost —— 全部走 `SceneHost`+`ReactiveScene` 既有路径（scene-flow 是「又一种 scene 样式」，零新增生命周期代码）。
- [x] 文档/索引对齐（CLAUDE.md + PRD + memory）。
- [ ] **真实 app 人工验证**（预览沙箱冻结 WebGL，需真实窗口）：多色流动 calm、跟封面变色、删封面回退自定义、三种效果差异、Settings 面板即时生效 + 预览同步、reduced-motion 静态、prod build 帧节奏。
- [ ] bundle 增量 CI 实测（估算 < 30KB gz）。

### Phase 6: 独立合成层（设计修正）✅

**Goal:** 流光不是频谱样式，而是 **背景图/视频 → 流光 → 频谱** 的独立中间层（owner 反馈）。

**Tasks:**
- [x] `registry.ts`：`VisualizerMeta.hidden?` + `scene-flow` 标 `hidden:true` + `VISUALIZER_PICKER_META`（过滤 hidden）；`registry.test` 断言 scene-flow 注册但不进 picker。
- [x] `visualizer-settings.tsx`：频谱选择器用 `VISUALIZER_PICKER_META`（scene-flow 不再出现，消除「选它=替换频谱」的互斥）。
- [x] `db/types.ts`：加 `flowEnabled`/`flowOpacity`/`flowDim`（additive 无 DB bump）。
- [x] `now-playing-background.tsx`：在 image-mask 与 visualizer `AnimatePresence` **之间**插独立流光层 `<VisualizerHost styleId="scene-flow" coverColor placement="background" style={{opacity:flowOpacity}}>` + dim 叠层，`flowEnabled` gate + `AnimatePresence` 淡入。
- [x] `flow-settings.tsx`：「设为背景」按钮 → `flowEnabled` 复选开关；composite 段从 `visualizerBackground*` 改 `flowOpacity`/`flowDim`（流光层自己的透明度/压暗）。
- [x] i18n 四语：`flow.enable`/`enableHint`/`opacity`/`dim`。

### Phase 6 Checklist
- [x] registry 测试（13）含 scene-flow `hidden` + 不在 picker。
- [x] JSON 四语校验 + biome（6 files）+ whole-tree typecheck 绿。
- [x] CLAUDE.md / PRD 修正层级模型。
- [ ] **真实 app 人工验证**：流光层与频谱**同时**显示（不互斥）、垫在背景图之上频谱之下、`flowOpacity` 调透出底图、关 `flowEnabled` 只去流光层不影响频谱。

### Phase 7: 全 color4bg 效果对齐（14 效果）✅

**Goal:** owner 要求「支持这个包（color4bg）所有类型」——把 flow 效果从 3 个扩到 color4bg 全 14 种风格，**仍零依赖**（自研 shader，不引 color4bg/ogl）。

**color4bg 14 style → 自研 shader 对应**（`flow-shaders.ts`，每个一段 GLSL，共享 `FLOW_PRELUDE` 的 noise/fbm/`ramp()` 多色映射）：

| family | color4bg style → flow effect | 技法（自研复刻） |
|---|---|---|
| Blob/metaball（calm） | `ambient-light` / `aesthetic-fluid` / `big-blob` / `blur-dot` | 漂移 blob Gaussian/metaball 混合，封面多色逐 blob |
| Gradient/band | `blur-gradient` / `step-gradient` / `curve-gradient` | 旋转/正弦扭曲渐变、网格涟漪、三角递归曲线 → `ramp()` |
| Wave/flow-field | `wavy-waves` / `chaos-waves` / `swirling-curves` | 矢量场迭代 / 嵌套 FBM / FBM domain-warp marble |
| Geometric/tiling | `grid-array` / `triangles-mosaic` / `random-cubes` / `abstract-shape` | SDF 圆角格 / 三角点阵 / 散布旋转方块(伪深度雾，3D 的 2D 近似) / voronoi |

**Tasks:**
- [x] `flow-shaders.ts`（🆕 shader 源文件）：`FLOW_PRELUDE` + 14 段 main + `FLOW_FRAGS: Record<FlowEffectId,string>`（TS 强制 14 个 id 齐全）。GLSL ES 1.0（仅 loop-index 数组访问、常量循环界）。
- [x] `db/types.ts` `FlowEffectId` 扩成 14 个 color4bg style id；`flow-config.ts` `FLOW_EFFECTS`(14) + `FlowConfig.effect: FlowEffectId`（不再是 index）+ `resolveFlowConfig` 校验回退 `ambient-light`。
- [x] `reactive-scene.tsx`：按 `flow.effect` 选 `FLOW_FRAGS[effect]`（换效果=重编译该 shader，颜色/速度仍走 `flowRef` 不重启循环）；移除 `uEffect` uniform。
- [x] `scene-shaders.ts` 删除旧 `FLOW_FRAG`（被 `flow-shaders.ts` 取代）。
- [x] i18n 四语 14 个 `flow.effect*` 标签（替换旧 3 个）。

### Phase 7 Checklist
- [x] `FLOW_FRAGS` 类型完整性（`Record<FlowEffectId,string>` 编译通过 = 14 齐全）；`flow-config.test` 改 effect=id（41 测试绿）。
- [x] JSON 四语校验 + biome + whole-tree typecheck 净。
- [x] 优雅降级：`ReactiveScene` 既有 try/catch —— 某个 shader 万一编译失败 → 该效果不渲染（透明），不崩树。
- [ ] **真实 app 人工验证**：14 效果逐个观感（blob/wave/gradient/geometric 各家族明显不同）+ 跟封面多色 + calm。random-cubes/abstract-shape 是 color4bg 3D/canvas 原版的 **2D 近似**，观感对齐度待人工确认。

> **curate vs 全量**：模板默认「curate 不穷举」，但 owner 明确要「所有类型」——本期按指示全 14。geometric 家族（grid/triangles/cubes/abstract）偏「图案」非纯「流光」，但属 color4bg 类型集，一并支持；用户可在面板自选。

### Phase 8: 切换过渡自然化 ✅

**Goal:** owner 反馈切效果 / 切歌时流光「突变」，要像频谱一样自然过渡或淡入淡出。

**两类过渡，两种机制：**
- **切效果**（`flowEffect` 变）：[`now-playing-background.tsx`](../../../src/components/player/now-playing-background.tsx) 流光层 `motion.div` 的 `key` 改为 `flow-${flowEffect}`。AnimatePresence 检测到 key 变 → 旧 shader canvas 淡出、新的淡入（**交叉淡化** 0.5s），取代「换 shader 即重编译硬切」。
- **切歌**（封面取色变）：**不动**——颜色已走既有封面取色 store（[`visualizer-color-store.ts`](../../../src/stores/visualizer-color-store.ts) `transitionVisualizerCoverColor` + `mixPalette`）的 **900ms 逐色插值**，flow 每帧 `getVisualizerCoverPalette()` 读到的是插值中的 palette，与频谱**同一机制**。key 不含 song → 切歌不重挂 canvas，颜色平滑 glide（不被淡入淡出打断）。

**Tasks:**
- [x] flow 层 `key="flow-layer"` → `key={\`flow-${settings.flowEffect ?? "ambient-light"}\`}`；duration 0.4→0.5s。
- [x] 确认切歌颜色过渡复用 store 插值（无需改动 reactive-scene 的 `fillFlowColors`，它每帧读插值 palette）。

### Phase 8 Checklist
- [x] biome + whole-tree typecheck 净。
- [ ] **真实 app 人工验证**：切效果有交叉淡化不闪；切歌颜色 glide 不硬跳；切歌时不会因 key 变而误触发淡入淡出。

---

## 7. Out of Scope

- **引入 `color4bg` / `ogl` / `node-vibrant`**：本期全自研（§2.3）；若要 color4bg 高级流体图样另开 dependency-manifest-review PRD。
- **逐 track / 逐 set 持久化流光配置**：本期是全局 Settings；per-set 流光偏好留 v2。
- **导出 / 录制流光为视频**：MUZERO 无导出管线（与 ClipCombo 不同），不涉及 renderer parity 导出态。
- **CSS `radial-gradient` 流光回退**：不做（Open Q2 已定）。WebGL 失败用既有 aura 回退即可。
- **butterchurn / milkdrop**：属既有 visualizer PRD 的 v2，不在本期。
- **流光跟随专辑/艺人实体封面**（非当前曲封面）：本期只跟当前播放曲封面。
- **遥测 / A-B 实验**：MUZERO 无后端无遥测，不上报任何颜色/配置。

---

## 8. Security / Privacy Considerations

- **本地优先不变**：取色只读设备本地封面 Blob（`URL.createObjectURL`），**零出站请求**；不像 anysoul 那样需要 CORS cache-buster（我们不取远程 URL）。远程 stream 封面若仅有 URL，走既有 `getAppFetch()` 取字节后再本地取色，不在渲染层设 Cookie/UA（沿用 `external-streaming-sources` memory 红线）。
- **无密钥涉及**：纯视觉特征，无 BYOK key 接触。
- **不写日志/遥测**：颜色值、palette、自定义配色**永不进** `logger`/任何上报（与模板 telemetry whitelist 一致；MUZERO 本就无遥测）。
- **无 hidden flag**：所有开关是可见 Settings 控件；回退 = `git revert` 注册表条目 + 重发版（[`feedback_no_hidden_backend_flags`]）。
- **codename 层不变**：不动 db 名 / id 前缀 / provider id；新增的是 brand/feature 层 settings 字段（additive）。

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [音乐可视化系统 PRD](../20260607-muzero-music-reactive-visualizer-prd/20260607-muzero-music-reactive-visualizer-prd.md) | 本 PRD 复用的 Visualizer registry / SceneHost / twgl scene 基础设施 |
| [沉浸式记忆瞬间 PRD](../20260610-muzero-immersive-memory-moments-prd/) | `immersiveMemoryOverlay` / idle 沉浸态，与流光背景共存 |
| [`image-palette.ts`](../../../src/lib/image-palette.ts) | 现有自研单色取色（本期扩多色的基底） |
| [`visualizer-color-store.ts`](../../../src/stores/visualizer-color-store.ts) | 现有封面色平滑过渡 store（本期加 palette） |
| anysoul `use-image-palette.ts` / `LazyColor4Bg.tsx` / `ImmersiveDisplaySettings.tsx` | 灵感来源（node-vibrant + color4bg），**不引入**，仅参照思想 |
| `theming-architecture` memory | `--primary` / 注入 `<style>` 覆盖机制，与封面取色协同 |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | 流光效果变体数量？ | ✅ Resolved（Phase 7 改判） | 初判 curate 3 个；**owner 后续要求「支持 color4bg 所有类型」→ Phase 7 全量 14 个自研 shader**（见 Phase 7）。旧 3 id（aurora-drift/liquid-mesh/soft-blobs）被 14 个 color4bg style id 取代 |
| 2 | WebGL 失败时是否再做 CSS `radial-gradient` 流光回退（anysoul 有）？ | ✅ Resolved | **不做。** 「我们这里不需要回退」——`SceneHost` 既有的 aura 回退是免费现成行为，保留即可，不额外造 CSS flow 回退 |
| 3 | `scene-flow` 是否也提供给非背景的 stage 表面（小尺寸）？ | ✅ Resolved | **可以。** host 已 placement-aware，surface（小尺寸）与 background 都支持；Settings 预览面板正好用 surface 小尺寸 |
| 4 | 多色取色默认 N：4 还是 5？ | ✅ Resolved | **默认 4**（按 best practice：去重后常 2–4 个有效色，过多糊成灰），shader `FLOW_MAX_COLORS=5` 留余量 |
| 5 | `flowAudioReactivity` 默认强度？ | ✅ Resolved | **默认低（calm，~20）+ 用户可自定义**：保留 0–100 slider，基调 calm 氛围，用户想要明显随乐可自行拉高 |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-11 | DoodleBear / MUZERO | Initial draft：anysoul 调查（node-vibrant + @color4bg/react）+ MUZERO 自研落地方案（扩多色取色 + scene-flow twgl shader + 取色源回退 + 流光 Settings 面板），5 phase |
| 2026-06-11 | DoodleBear / MUZERO | Open Questions 全部定稿：Q1 v1 curate 3 个效果（aurora-drift/liquid-mesh/soft-blobs，`uEffect` 分支）；Q2 不做额外 CSS 回退；Q3 surface+background 都支持；Q4 默认取 4 色（max 5）；Q5 默认 calm ~20 + 用户可自定义 |
| 2026-06-11 | DoodleBear / MUZERO | **Phase 1 ✅ 实现**（TDD）：`extractImagePalette`/`selectImagePalette` 多色去重取色（sRGB 距离）、`extractDominantImageColor=palette[0]` 零回归；store `palette`+`mixPalette`+`getVisualizerCoverPalette`；`visualizer-dynamic-color` 写 palette。14 测试绿、typecheck/biome 净。去掉 `skipDark` 入参（YAGNI） |
| 2026-06-11 | DoodleBear / MUZERO | **Phase 2 ✅ 实现**：`scene-flow` 注册（types/registry/i18n 四语）+ 自研 `FLOW_FRAG` mesh-gradient（多色 `uColors[5]` + `uEffect` 3 变体 + `uReactivity` 轻度音频）+ `reactive-scene` 接线（封面 palette / primary 兜底，复用 color buffer）。registry.test 12 绿、typecheck/biome 净。新增 `uReactivity` uniform。视觉验证留真实窗口（预览沙箱冻结 WebGL） |
| 2026-06-11 | DoodleBear / MUZERO | **Phase 3 ✅ 实现**（TDD）：`flow-config.ts`（`resolveFlowColors` 回退裁决 + `resolveFlowConfig` settings→shader 映射 + presets/effects/hex utils，14 测试）；`db/types.ts` 加 6 个 flow* 字段 + `FlowColorSource`/`FlowEffectId`（additive 无 DB bump）；host→SceneHost→reactive-scene 经 `flowRef` 接线，shader 改用真实取色源 + flow 参数。40 测试绿、whole-tree typecheck/biome 净。`resolveFlowColors` 三参全 `Rgb[]`（hex 解析上移到 config 层） |
| 2026-06-11 | DoodleBear / MUZERO | **Phase 4 ✅ 实现**：`flow-settings.tsx`（效果/取色源/多色编辑+预设/速度·尺度·反应/压暗·透明度/实时预览/快捷开关）+ `settings-nav` 加 flow item（测试）+ `settings-page` 路由 + 四语 i18n（navFlow + flow.* 27 keys）。settings-nav 测试 + JSON 校验 + biome 绿。co-modified（settings-page + locale）用 `git apply --cached` hunk 隔离提交（共享 working tree 不动他人 WIP）。修正 `t(dynamicKey)` 需 `defaultValue` |
| 2026-06-11 | DoodleBear / MUZERO | **Phase 5 ✅ 收尾**：reduced-motion/可见性暂停/WebGL 回退/context-lost 全继承 `SceneHost`（零新增）；palette 900ms 过渡 + 无封面回退；`CLAUDE.md` 可视化段补 scene-flow/多色取色/取色源回退；状态 → Implemented。bundle 估算 < 30KB gz（未单独 build，留 CI）；真实 app 视觉/交互验证待人工。全套 PRD 5 phase 完成 |
| 2026-06-11 | DoodleBear / MUZERO | **Phase 6 ✅ 设计修正**（owner 反馈：流光与频谱**不互斥**）：流光改为**独立合成层**（背景图/视频 → 流光 → 频谱），独立 `flowEnabled` 开关 + `flowOpacity`/`flowDim`；`scene-flow` 标 `hidden:true` 从频谱选择器隐藏（仍作图层 `VISUALIZER_PICKER_META`）。registry 测试 13 绿 + 四语 i18n + biome + whole-tree typecheck 净。确认全程**零** color4bg/ogl/node-vibrant |
| 2026-06-11 | DoodleBear / MUZERO | **Phase 7 ✅ 全 color4bg 效果对齐**（owner：「支持这个包所有类型」）：新建 `flow-shaders.ts` 14 段自研 GLSL（color4bg 全 14 style 的自研复刻，含 3D/canvas 的 2D 近似），`FlowEffectId` 扩 14、每效果一 shader 按需编译、移除 `uEffect`，删旧 `FLOW_FRAG`，四语 14 标签。**仍零依赖**（不引 color4bg/ogl）。41 测试绿 + typecheck/biome/JSON 净 |
| 2026-06-11 | DoodleBear / MUZERO | **Phase 8 ✅ 切换过渡自然化**（owner）：切效果 → flow 层 `key={flow-${effect}}` 触发 AnimatePresence 交叉淡化（0.5s，取代 recompile 硬切）；切歌颜色复用既有封面取色 store 900ms `mixPalette` 插值（同频谱，canvas 不重挂）。biome/typecheck 净 |

---

> **Note:** 本 PRD 强调**改既有**（扩 `image-palette` / `visualizer-color-store` / registry / settings-nav）而非新建；唯二新文件 `flow-settings.tsx`（新面板）与 `flow-config.ts`（新纯逻辑域），`FLOW_FRAG` append 进既有 shader 文件。
>
> **Exception Policy:** 引入任何第三方依赖（color4bg/ogl/node-vibrant）需另开 dependency-manifest-review PRD 并经 tech lead 批准——本期刻意零新依赖。
