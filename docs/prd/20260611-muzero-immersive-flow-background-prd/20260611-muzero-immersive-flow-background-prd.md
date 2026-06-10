# PRD: 沉浸式「流光」动态背景（封面取色多色流光 + 可配置颜色组合）

**Status:** Draft（Open Questions 已定稿，待实现）
**Created:** 2026-06-11
**Author:** DoodleBear / MUZERO
**Module:** Player — Now Playing 沉浸式背景。新增 `scene-flow` 流光可视化（复用既有 twgl scene registry + `now-playing-background` 背景层 + 封面取色管线），把现在的「单一主色光晕」升级为「多色封面取色 / 自定义多色流光」，并在 Settings 新增独立「流光背景」面板（效果 / 取色源 / 颜色组合 / 压暗 / 透明度）

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | 取色基础设施：把 `image-palette.ts` 的单色取色扩成**多色调色板**（`extractImagePalette` 返回 N 个去重色），扩 `visualizer-color-store` 持有 palette + 平滑过渡 | 🔲 Pending | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | 渲染：在既有 twgl scene registry 新增 `scene-flow` 流光 shader（自研 mesh-gradient，多色 `uColors[N]` uniform，calm 时间流 + 可选轻度音频调制），WebGL 探测 + aura/CSS 回退 | 🔲 Pending | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | 取色源模型：`flowColorSource: "cover" \| "custom"`（默认 cover，无封面回退 custom）+ 始终存在的 `flowCustomColors[]`，把 palette 喂进 shader uniform | 🔲 Pending | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | Settings：在 Appearance 段新增独立 sidebar item「流光背景」面板（效果选择 / 取色源切换 / 多色编辑器 + 预设 / 压暗 / 透明度 / 动态强度），i18n 四语全量 | 🔲 Pending | [Phase 4 Checklist](#phase-4-checklist) |
| 5 | 打磨：reduced-motion / 移动 30fps / bundle 预算复测 / 无封面与切歌过渡 / 文档对齐 | 🔲 Pending | [Phase 5 Checklist](#phase-5-checklist) |

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

**结论：流光 = 新增一个 scene 样式 `scene-flow`**，自动继承上面**全部**生命周期/背景/透明度/压暗设施。我们只需补两件**新**东西：(1) 多色取色 + 多色 store；(2) flow 自己的配置面板。

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
uniform int   uEffect;                   // 效果变体 0=aurora-drift 1=liquid-mesh 2=soft-blobs（flowEffect）
```

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

### 3.3 取色算法（多色，纯函数，穷举单测）

`extractImagePalette(blob, { count, skipDark })` 复用 [`image-palette.ts`](../../../src/lib/image-palette.ts) 的下采样（≤96px）+ HSL 过滤（跳近黑/近白/低饱和）+ `QUANTIZE_STEP=16` 分桶逻辑，但**返回 top-N**：

1. 量化分桶（同现有）；
2. 每桶算 `score = count * (0.65 + sat*1.4) * lightBalance`（同现有单色打分）；
3. 按 score 降序取桶，**去重**（HSL 距离 < 阈值的近似色合并，避免「5 个都是同一个紫」）；
4. 取前 `count`（默认 4，范围 2..5），不足 2 个 → 返回 `[]`（调用方回退 custom）。

`extractDominantImageColor` 保留为 `extractImagePalette(...)[0]`（单色场景不回归）。

### 3.4 颜色解析纯函数 `flow-config.ts`

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
| `extractImagePalette` | [`lib/image-palette.ts`](../../../src/lib/image-palette.ts) | `(blob: Blob, opts?) => Promise<Rgb[]>` | 多色取色（top-N 去重，亮色优先） |
| `extractDominantImageColor` | 同上 | 不变 | `= palette[0]`，单色调用方不回归 |
| `resolveFlowColors` | `lib/flow-config.ts` 🆕 | `(source, palette, custom) => Rgb[]` | 取色源回退裁决（纯，穷举单测） |
| `FLOW_PRESETS` / `FLOW_DEFAULT_COLORS` | 同上 | 常量 | 预设色组 + 默认自定义色 |
| store `palette` | [`visualizer-color-store.ts`](../../../src/stores/visualizer-color-store.ts) | `Rgb[]` + 过渡 | scene-flow 读取 |
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

### Phase 1: 多色取色基础设施

**Goal:** `image-palette.ts` 出 N 色；store 持 palette 并平滑过渡。

**Tasks:**
- [ ] `extractImagePalette(blob, {count=4, skipDark=true})`：top-N 去重桶（复用现有量化 + HSL 过滤 + 打分）。
- [ ] `extractDominantImageColor = palette[0]`，保证单色调用方零回归。
- [ ] `visualizer-color-store` 加 `palette: Rgb[]` + 逐色 `mixRgb` 过渡；缓存改存 `{rgb, palette}`。
- [ ] `visualizer-dynamic-color` 取 palette 写 store（保留单色写入）。

### Phase 1 Checklist
- [ ] `image-palette.test.ts` 扩：纯黑白图→`[]`、多彩图→去重 N 色、近似色合并、count 边界。
- [ ] 单色 `extractDominantImageColor` 既有测试全绿（无回归）。
- [ ] store palette 过渡单测（长度不一对齐、空→非空）。
- [ ] `make check` 绿。

### Phase 2: `scene-flow` shader + registry

**Goal:** 新增一个 calm 多色流光 scene 样式，跑在既有 SceneHost 上。

**Tasks:**
- [ ] `FLOW_FRAG`（自研 mesh-gradient：N 个漂移 radial blob 绑 `uColors[i]`，soft-min 混合，`uTime*uFlowSpeed` 流动，`uFlowScale` 尺度）。header 标 `MIT (MUZERO)`。**v1 curate 3 个效果变体** `aurora-drift / liquid-mesh / soft-blobs`（一个 `uEffect` int uniform 分支，避免编 3 个 program）。
- [ ] `reactive-scene.tsx`：`scene-flow` 分支选 `FLOW_FRAG`，`setUniforms` 补 `uColors/uColorCount/uFlowSpeed/uFlowScale/uEffect` + 轻度音频调制（按 `flowAudioReactivity`）。`scene-flow` 同时支持 surface（小尺寸预览）与 background placement（Open Q3 已定）。
- [ ] `types.ts` 加 `"scene-flow"`；`registry.ts` META + `labelKey: "visualizer.styleSceneFlow"`。
- [ ] WebGL 失败回退 aura（既有）；context-lost 复用既有处理。

### Phase 2 Checklist
- [ ] `registry.test.ts`：`scene-flow` 注册、kind=scene、resolve 不回退、labelKey 存在。
- [ ] 视觉验证（`make dev` / 截图）：多色流动、calm（默认低反应）、跟 `uColors` 变色。
- [ ] 无 WebGL（mock）→ 回退 aura，不崩。
- [ ] `make check` 绿。

### Phase 3: 取色源回退模型

**Goal:** `flowColorSource` + `flowCustomColors` 同时生效，无封面回退（需求 1+2）。

**Tasks:**
- [ ] `flow-config.ts`：`resolveFlowColors` + `FLOW_PRESETS` + `FLOW_DEFAULT_COLORS` + hex 规范化/校验。
- [ ] `db/types.ts` 加 `flow*` 可选字段（additive，无 DB bump）。
- [ ] `scene-flow` 渲染读 `resolveFlowColors(source, store.palette, customColors)` → `uColors`。

### Phase 3 Checklist
- [ ] `flow-config.test.ts` 穷举：cover+palette、cover+空palette→custom、custom 模式、非法 hex 过滤、<2 色处理、去重。
- [ ] 手测：删当前曲封面 → 流光不黑屏、回退到自定义色。
- [ ] 切 source=custom → 忽略封面、用自定义。
- [ ] `make check` 绿。

### Phase 4: Settings「流光背景」面板 + i18n

**Goal:** 需求 3 的独立 sidebar item 与全部配置控件。

**Tasks:**
- [ ] `settings-nav.ts` 加 `{ id:"flow", labelKey:"settings.navFlow" }`（Appearance 段）。
- [ ] `flow-settings.tsx`：效果 / 取色源 / 多色编辑器(+预设) / 动态强度 / 速度 / 尺度 / 压暗 / 透明度（复用既有字段）+ 内嵌实时预览 + 「设为沉浸背景」快捷开关。
- [ ] `settings-page.tsx` 路由 `"flow"`。
- [ ] i18n 四语（en 类型源 → zh/ja/ko）：`settings.navFlow`、`flow.*`、`visualizer.styleSceneFlow`。

### Phase 4 Checklist
- [ ] `settings-nav` 测试含 `flow` id（stale fallback 不破）。
- [ ] 四语 catalog 全量（缺则 PR 标 pending translation + followup issue）。
- [ ] 无硬编码用户可见字符串（全 `t()`）。
- [ ] 面板改值即时生效（saveSettings）+ 预览同步。
- [ ] `make check` 绿。

### Phase 5: 打磨 / 性能 / 文档

**Goal:** reduced-motion、移动、bundle、过渡、文档。

**Tasks:**
- [ ] reduced-motion → flow 冻结静态帧（SceneHost 既有）；`flowAudioReactivity` 不放大闪动。
- [ ] 移动 30fps / 可见性暂停复测（既有 IO + visibility）。
- [ ] `pnpm build` bundle 增量复测（目标 < 30KB gz；shader 字符串 + flow-config + 面板）。
- [ ] 切歌 palette 过渡顺滑（900ms）；pending→ready 封面到位时平滑接管。
- [ ] CLAUDE.md「可视化样式」段补 `scene-flow` + 取色多色化；本 PRD 状态更新。

### Phase 5 Checklist
- [ ] reduced-motion 下静态、无高频闪。
- [ ] prod build（非 dev）下帧节奏稳，无明显掉帧。
- [ ] bundle 增量达标或分项说明。
- [ ] 文档/索引对齐。

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
| 1 | 流光效果变体数量？ | ✅ Resolved | **按 best practice curate：v1 上 3 个**精选效果 `aurora-drift / liquid-mesh / soft-blobs`（用户诉求是「不同的流光效果」，3 个给真实选择又不穷举；更多变体进 v2 backlog） |
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

---

> **Note:** 本 PRD 强调**改既有**（扩 `image-palette` / `visualizer-color-store` / registry / settings-nav）而非新建；唯二新文件 `flow-settings.tsx`（新面板）与 `flow-config.ts`（新纯逻辑域），`FLOW_FRAG` append 进既有 shader 文件。
>
> **Exception Policy:** 引入任何第三方依赖（color4bg/ogl/node-vibrant）需另开 dependency-manifest-review PRD 并经 tech lead 批准——本期刻意零新依赖。
