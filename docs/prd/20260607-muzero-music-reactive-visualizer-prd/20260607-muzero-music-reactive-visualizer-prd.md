# PRD: 音乐可视化系统（Poweramp 风频谱 + 随音乐波动的生成式画面）

**Status:** In Progress（Phase 1–3 ✅ · Phase 5 轻量收尾 ✅；Phase 4 延后 v2）
**Created:** 2026-06-07
**Author:** DoodleBear / MUZERO
**Module:** Player — Now Playing 可视化（可插拔 Visualizer registry：频谱样式库 + GPU shader 反应式场景），复用现有 `AudioEngine` AnalyserNode，承接 `--primary` 主题色

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | 可视化基础设施：`Visualizer` 接口 + registry + host（rAF 生命周期 / 可见性暂停 / reduced-motion / 共享 analyser）+ Settings 控件 + 把现有 aura 收编为第一个 renderer | ✅ Completed | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | 自研 canvas-2D 频谱样式包（bars / 八度对数 / radial / LED+reflex / waveform / aura），全部跟随 `--primary` | ✅ Completed | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | GPU shader 反应式场景（`twgl.js`，MIT）：液态 / 极光「画面随音乐波动」+ WebGL 探测 + canvas 回退 | ✅ Completed | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | **（已按 Open Q1 延后 v2）** Milkdrop 模式：`@webamp/butterchurn`（MIT）懒加载 + 精选 preset + WebGL2 gate + iOS 回退 | ⏸️ Deferred (v2) | [Phase 4 Checklist](#phase-4-checklist) |
| 5 | 打磨：i18n / a11y / 文档对齐 ✅（轻量收尾）；性能埋点 / bundle 预算 / 移动 30fps 延后 | 🔄 轻量收尾 | [Phase 5 Checklist](#phase-5-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

当前 Now Playing 已有一个**自研**的可视化：[`aura-visualizer.tsx`](../../../src/components/player/aura-visualizer.tsx) —— canvas + WebAudio `AnalyserNode` 的径向频率「光晕」，在 [`media-stage.tsx`](../../../src/components/player/media-stage.tsx) 里当 stage 内容是 cover/title（非视频）时垫在背后，也用于移动端 [`now-playing-sheet.tsx`](../../../src/components/player/now-playing-sheet.tsx)。它刚刚被改造为跟随 `--primary` 主题色（见 [`primary.ts`](../../../src/theme/primary.ts) + 本 PRD §2.4）。

产品诉求（来自所有者）：

> 「想要像 **Poweramp** 那样支持很多种炫酷的**频谱**样式，或者**画面随着音乐波动**的效果。」

也就是把「单一光晕」升级成一个**可视化系统**：
1. **频谱样式库（Poweramp 风）**——用户能从一组样式里挑（条形 / 八度对数 / 环形 / LED+倒影 / 波形 / 光晕…），即「支持很多种炫酷频谱」。
2. **随音乐波动的生成式画面**——GPU shader 的反应式背景（液态 / 极光 / 等离子），振幅/频率驱动 uniform，即「画面随音乐波动」。

### 1.2 为什么先做调研再落地

引入「炫酷可视化」最大的坑不是写不出效果，而是**选错依赖**：licence 不兼容（AGPL）、bundle 爆炸（11MB preset）、或库要自己抢 `AudioContext` 跟 MUZERO 已有的单一 `<video>` 媒体管线冲突。所以本 PRD 先做了 npm 横向对比（§2.3），再定架构。

> 本 PRD 适用模板的 **§3「Effect / Shader / 外部依赖类」** 与 **§4「性能 / realtime preview 类」** 两套附加要求（license 第一公民、curate 不穷举、不引入新 runtime owner、bundle 预算、观测先行、回退=git revert）。

### 1.3 Target Users

| Role | Description | 关注点 |
|------|-------------|--------|
| **桌面用户** | Tauri 桌面窗（默认 1180×780）/ 浏览器 `make dev` | 大屏沉浸、可挑样式、流畅不掉帧、跟随主题色 |
| **移动用户** | iOS / Android（布局已 responsive，后续打磨） | 全屏 Now Playing sheet 里好看、不烫手不耗电（30fps / 后台暂停） |
| **「音乐承载回忆」用户** | 上传自己的音视频 + tag/note/cover 混合歌单 | 听自己的歌时也能有炫酷氛围；视频集播放时可关画面只留频谱 |
| **a11y / 低动效用户** | 开了 `prefers-reduced-motion` | 自动降级为静态/近静态，不被高频闪动困扰 |

### 1.4 Core Value

1. **从「一个光晕」到「一个可视化系统」**：可插拔 registry + 样式库，第一眼就「这播放器很会玩」。
2. **零架构破坏 + 零 license 风险**：复用既有单一 `AnalyserNode` **和已在树中的 three+R3F**（Phase 1–3 零新增依赖）；明确**拒绝 AGPL 的 audioMotion**；唯一潜在新依赖 `butterchurn`(MIT) 延后 v2。
3. **承接主题色**：自研 renderer 全部从 `--primary` 派生调色板，与刚落地的主题色系统连续。
4. **本地优先不变**：可视化只读设备本地正在播放的音频，**零出站请求、零遥测**；开关是可见 Settings 控件（不引入 hidden flag）。

---

## 2. System Architecture

### 2.1 关键约束：单一媒体元素 + 单一 AnalyserNode（make-or-break）

[`MediaEngine`](../../../src/player/media-engine.ts) 用**一个常驻 `<video>`** 同时放音频和视频，并在首次播放（用户手势后）懒建 WebAudio 图：

```
<video> ──createMediaElementSource()──▶ source ──▶ AnalyserNode(fftSize 256) ──▶ destination
                                                         │
                                          getMediaEngine().getAnalyser()  ← 可视化在这里 tap
```

> ⚠️ **`createMediaElementSource()` 每个元素一生只能调用一次**，第二次会抛 `InvalidStateError` 并破坏音频路由（MDN / Chromium 确认）。**任何第三方可视化库若坚持自己从媒体元素建 source，就出局。** 正确范式（MDN 背书）：全 App 建**一个** source + analyser，把 analyser **fan-out** 给所有可视化。MUZERO 已经是这个形状。

这条约束直接决定了选型（§2.3）：只有「能接收一个**现成的** `AudioContext` / `AudioNode`」或「自己只读 `getByteFrequencyData` 设 uniform」的方案能用。

### 2.2 Technology Stack（选型结论）

| 维度 | 决策 | Rationale |
|------|------|-----------|
| **频谱样式库（广度）** | **自研 canvas-2D**（零依赖，clean-room 借鉴 audioMotion 的*技术*） | 「支持很多种」靠的是样式数量，不是某个库；自研零 bundle、零 license 风险、完全可跟随 `--primary`、可复用现有 aura 代码路径 |
| **反应式生成画面（深度）** | **`twgl.js`**（MIT, ~22KB, 懒加载） | 「画面随音乐波动」= 全屏 fragment shader。原计划复用 three+R3F,但**用户中途移除了 three（去依赖）**;遂二次横向对比（ogl/twgl/regl/raw/shadertoy-runner）→ 选 `twgl.js`（MIT 薄 helper,`setUniforms` 顺手,内置全屏 quad）;懒加载不进主 bundle。详见 §2.3a |
| **Milkdrop「炸裂」模式（可选）** | **`@webamp/butterchurn`**（MIT）懒加载 + 精选 preset | Poweramp 的「milk」可视化本质就是 Milkdrop；butterchurn 是它的 web 实现，audio 模型完美兼容（见 §2.3）。但 WebGL2 必需 + preset 体积 + iOS 风险，**门控/可延后** |
| **音频输入** | 复用 `getMediaEngine().getAnalyser()`；host 按当前样式设置 `analyser.fftSize` / `smoothingTimeConstant` | 单 analyser 足够（同时只有一个样式在渲染）；fftSize 运行时可改，无需多 tap |
| **调色** | 自研 renderer 从 `--primary` 派生（抽出 [`aura-visualizer.tsx`](../../../src/components/player/aura-visualizer.tsx) 的 `readPrimaryRgb`/`lighten` 到共享 util） | 与刚落地的主题色系统连续；scene/butterchurn 可选 tint |
| **状态** | 引擎 / rAF / registry 走**模块作用域单例**，不进 Zustand state | 遵守 CLAUDE.md #6：非响应式单例不进 store，避免每帧重渲染全树 |

### 2.3 npm 横向对比（调研结论，2026-06）

> 完整事实（stars / 周下载 / 最后发布 / SPDX / bundle / 音频模型）来自对 npm registry、GitHub 源码、bundlephobia 的核对。下表是**决策导向**摘要。

| 库 | License (SPDX) | 渲染 / Bundle | 能否接现成 AnalyserNode？ | 维护 | 结论 |
|----|----------------|---------------|--------------------------|------|------|
| **butterchurn / @webamp/butterchurn** | **MIT**（core 与 presets 皆 MIT）⚠️*单条 preset 原始作者授权未标注* | WebGL2（**无 WebGL1 回退**）/ core ~42KB gz；**presets 11MB 解包**（按 pack/单文件可懒加载） | ✅ **理想**：`createVisualizer(audioContext, canvas)` + `connectAudio(node)`，复用你的 ctx、非破坏性挂到你的 node、**自建内部 analyser、从不调 `createMediaElementSource`** | 低速但**未死**（`@webamp/butterchurn@3.0.0-beta.5`，2025-07） | ✅ **采纳（可选/懒加载/门控）**——「Milkdrop 炸裂」模式 |
| **audioMotion-analyzer** | **AGPL-3.0-or-later**（无双授权）🚫 | canvas-2D / ~12KB gz，0 dep | ✅ `audioCtx` + `connectInput(node)` + `connectSpeakers:false` | 活跃（v4.5.4，2026-01；v5 alpha） | 🚫 **拒绝依赖**——AGPL 对闭源分发的 Tauri App 是硬阻断；**仅作技术参考**（八度分带 / 感知加权，clean-room 重写） |
| **ogl** | Unlicense ✅ | WebGL / ~33KB gz（tree-shake ~8KB） | ✅ shader 路线天然只读 `getByteFrequencyData` 设 uniform | 活跃（~368k dl/wk） | ➖ **不采纳（曾是首选）**——若 three 未在树中，ogl 是最佳薄桥；但 three+R3F **已是依赖**，再加 ogl = 第二套 WebGL 运行时，故复用 three |
| **three.js + @react-three/fiber + @react-three/postprocessing** | MIT | WebGL / ~200KB gz | ✅（自己设 uniform） | 极活跃 | ✅ **采纳（已是依赖！）**——本仓库已为 Dither 背景引入，复用做音频反应式场景=**零新增依赖**，与 [`dither-background.tsx`](../../../src/components/player/dither-background.tsx) 管线一致 |
| **Vanta.js** | MIT（但拖入 three.js） | WebGL / 实际 ~120KB gz | 手动喂 `setOptions`（粒度粗、反应弱） | **停滞**（2022） | ❌ 停滞 + 交全额 three.js 税 + 反应式很浅 |
| **p5.js (+p5.sound)** | **LGPL-2.1** | canvas/WebGL / **~315KB gz** | ⚠️ p5.sound 想自己拥有 AudioContext，与单元素模型打架 | 活跃 | ❌ 体积大 + LGPL + 音频所有权冲突 |
| **Pts.js** | Apache-2.0 | canvas/SVG / ~30KB gz | 可绕过其 Sound，自己喂 bins | 安静（2024） | ➖ canvas 几何不错，但非 shader，做不出液态质感 |
| **wavesurfer.js / @wavesurfer/react** | BSD-3 | canvas | ❌ 静态/可拖拽**波形**，自管音频图 | 极活跃 | ❌ 类别错——是波形播放器控件，不是实时反应式频谱 |
| **react-audio-visualize / react-voice-visualizer / sound-visualizer** | MIT/ISC | canvas | ❌ 录音/MediaRecorder 取向，**不收现成 AnalyserNode** | 参差 | ❌ 类别错——录音可视化，非播放 tap |
| **vudio.js / @foobar404/wave / react-wavify** | MIT | canvas/SVG | ❌（自管 ctx）/ react-wavify 根本非音频 | 停滞/装饰 | ❌ 自管 ctx 与单 ctx 模型冲突 / 非反应式 |

**三句话结论：**
1. 「支持很多炫酷频谱」**不需要库**——自研 canvas-2D 样式包零成本、零风险、可跟随主题色；技术借鉴 audioMotion（八度对数分带 + 感知加权）但**不引入 AGPL 依赖**。
2. 「画面随音乐波动」用全屏 fragment shader，把 analyser 喂进 uniform。原拟复用本仓库的 three+R3F，但**用户中途移除了 three**；二次横向对比后选 **`twgl.js`**（MIT, ~22KB, 懒加载）——见下方「§2.3a WebGL 库二次对比」。
3. 真要「Milkdrop 炸裂」就上 **`@webamp/butterchurn`**（MIT，音频模型完美兼容），但**懒加载 + 精选 preset + WebGL2 门控 + iOS 回退**，且因它是「新 runtime owner」需先过依赖清单审查（见 §7 / §10），可延后到 v2。

### 2.3a WebGL 库二次横向对比（three 被移除后，2026-06）

用户在实现中途移除了 `three` / `@react-three/fiber`，故针对**「跑一个全屏音频反应式 fragment shader + 几个 uniform」**重新横向对比轻量 WebGL 方案：

| 库 | License | 体积(gz) | 维护 | 本用例适配 |
|----|---------|---------|------|-----------|
| **twgl.js ✅选用** | MIT | ~22KB | 活跃 v7(2025-07) | `setUniforms(对象)` 最顺手 + 内置全屏 quad + 0 deps + TS;薄 helper 不挟带 scene model |
| ogl | Unlicense | ~8–12KB(tree-shake) | 活跃 368k/wk | 内置 `Triangle` + `webgl:1`;ergonomics/KB 最佳(亚军) |
| regl | MIT | ~37KB | npm 停滞 | 声明式、最重、不 tree-shake;单 shader 过重 |
| raw WebGL | 0 依赖 | 0KB | 自研 | ~150 LOC,唯一难点 context-loss;契合自研传统(季军) |
| shadertoy-react | MIT | 6KB | **2021 弃坑** | API 正合用但已死=vendor 死代码 |
| gl-react | MIT | 重(7 依赖) | 活跃 | 唯一活跃 React 专用,但 compositor + 依赖多 |
| shader-web-background | **GPL-3.0** 🚫 | — | 活跃 | 闭源分发硬阻断 + 不在 npm |
| shader-doodle | MIT | — | 活跃 | **不支持自定义 uniform** → 做不了音频反应 |
| picogl / phenomenon / two.js / glslCanvas | 杂 | 杂 | 多 stale | stale / 形状不对(粒子/2D) |
| lygia(shader 片段库) | **Prosperity 非商用** 🚫 | — | 活跃 | 不可打包(可手抄函数) |

**结论**：drop-in shader runner 全军覆没（死 / 重 / GPL / 缺 uniform）；真正的决赛是 raw WebGL vs ogl vs twgl。用户选 **`twgl.js`**（MIT、`setUniforms` 顺手、内置全屏 quad、活跃维护），懒加载 → 不进主 bundle。

### 2.4 架构总览（可插拔 Visualizer registry，复刻 MusicGenProvider 模式）

参照 [`musicgen/registry.ts`](../../../src/musicgen/registry.ts) 的 DI + registry 范式（`resolveX(settings)` switch + id union + IDS 数组，**绝不在 UI/store 里散落 `if (style===...)`**）：

```
AppSettings.visualizerStyle ──▶ resolveVisualizer(settings) ──▶ Visualizer
                                                                   │ (id, kind, backend, caps)
                              ┌────────────────────────────────────┤
                              ▼                                     ▼
                    VisualizerHost (React)                 各 renderer 实现
                    - 收养一个 <canvas>                     - spectrum/* (canvas2d)
                    - rAF 生命周期（唯一循环）              - scene/*    (webgl, ogl)
                    - 可见性暂停（Page Visibility +         - milkdrop   (webgl2, butterchurn, lazy)
                      IntersectionObserver）
                    - dpr cap / reduced-motion gate
                    - 设 analyser.fftSize/smoothing
                    - 从 --primary 派生调色板
                              │
                              ▼
                    getMediaEngine().getAnalyser()  ← 复用既有单一 AnalyserNode
```

```ts
// src/visualizer/types.ts （形状示意，非最终代码）
export type VisualizerKind = "spectrum" | "scene" | "milkdrop";
export type VisualizerBackend = "canvas2d" | "webgl" | "webgl2";

export interface VisualizerContext {
  canvas: HTMLCanvasElement;
  analyser: AnalyserNode;        // 共享，host 已按样式设好 fftSize/smoothing
  primary: () => Rgb;            // 当前 --primary（随主题切换/用户改色实时变）
  prefersReducedMotion: () => boolean;
}

export interface Visualizer {
  id: VisualizerStyleId;
  kind: VisualizerKind;
  backend: VisualizerBackend;
  fftSize: 256 | 512 | 1024 | 2048 | 4096;
  smoothing: number;            // analyser.smoothingTimeConstant
  /** WebGL/WebGL2 样式声明能力位，host 据此探测 + 回退。 */
  caps: { webgl?: boolean; webgl2?: boolean; mobileOk: boolean };
  init(ctx: VisualizerContext): void;
  render(dtMs: number): void;   // host 的 rAF 调用；renderer 不自己起循环
  resize(w: number, h: number, dpr: number): void;
  destroy(): void;
}
```

### 2.5 Project Structure（只 append，遵守模板「不新增源码文件除非引入新 parser/lib bridge」）

```
src/
├── visualizer/                         # ★ 新目录（与 musicgen/ 同构）
│   ├── types.ts                        # Visualizer 接口 + id union
│   ├── registry.ts                     # resolveVisualizer(settings) + VISUALIZER_STYLE_IDS
│   ├── host.tsx                        # VisualizerHost：canvas 收养 + rAF + 可见性暂停 + 回退
│   ├── spectrum/                       # 自研 canvas-2D（Phase 2）
│   │   ├── aura.ts                     #   现有光晕收编于此
│   │   ├── bars.ts  radial.ts  led-reflex.ts  waveform.ts
│   │   └── bands.ts                    #   共享：FFT bin → 八度对数分带 + 感知加权（clean-room）
│   ├── scene/                          # GPU shader（Phase 3，复用 three + R3F + postprocessing）
│   │   ├── reactive-scene.tsx          #   R3F <Canvas>（镜像 dither-background.tsx 管线）
│   │   ├── liquid.frag  aurora.frag    #   每个场景一个 fragment shader（含统一 prelude）
│   │   └── audio-uniforms.ts           #   analyser 频段 → uniform（uAudio/uBass/uMid/uTreble/uPrimary）
│   └── milkdrop.ts                     # （Phase 4，可选）butterchurn 懒加载适配
├── lib/
│   └── visualizer-color.ts             # ★ 抽出 readPrimaryRgb/lighten（aura 与全 renderer 共用）
├── player/media-engine.ts              # 改：导出 source 以便（未来）多 tap；v1 仅复用现有 analyser
├── components/player/
│   ├── aura-visualizer.tsx             # 改：变成 VisualizerHost 的薄包装（保留对外名/用法）
│   ├── media-stage.tsx                 # 改：用 VisualizerHost 替换直接挂 AuraVisualizer
│   └── now-playing-sheet.tsx           # 改：同上
└── components/settings/
    └── visualizer-settings.tsx         # ★ Settings「外观」下的样式选择器 + 开关
```

---

## 3. Data Model Design

### 3.1 Core Concepts

可视化是**展示偏好**，不是持久领域数据；落在单例 `AppSettings`（`settings` 表 id=`"app"`）即可，**沿用 `backgroundMode` 那套「可选字段 + 读取处 `?? 默认值`」**，因此**无需 bump DB version、无需 migration**（与 [`types.ts`](../../../src/db/types.ts) 现有 `backgroundMode?` / `backgroundBlur?` 同模式）。

### 3.2 Database Schema（改 AppSettings，新增可选字段）

⚠️ 遵守模板：**优先改既有结构，不大改**。`AppSettings` 追加三个可选字段（[`src/db/types.ts`](../../../src/db/types.ts)）：

```ts
export type VisualizerStyleId =
  | "off" | "aura" | "bars" | "radial" | "led-reflex" | "waveform"  // Phase 1–2
  | "scene-liquid" | "scene-aurora"                                  // Phase 3
  | "milkdrop";                                                      // Phase 4（可选）

export interface AppSettings {
  // …既有字段不动…
  /** Now-Playing 可视化样式。默认 "aura"（即现状光晕）。 */
  visualizerStyle?: VisualizerStyleId;
  /** 把可视化用作 Now Playing 全屏背景（默认 false，省电）。 */
  visualizerAsBackground?: boolean;
}
export const DEFAULT_SETTINGS: AppSettings = {
  // …既有默认…
  visualizerStyle: "aura",          // 与当前行为一致：默认就是光晕
  visualizerAsBackground: false,
};
```

- **Constraints**：`visualizerStyle` 是 union，未知值在 `resolveVisualizer` 里回退到 `"aura"`（前向兼容老/新数据）。
- **Data Migration**：无（可选字段，读取处给默认值）。这是刻意选择——避免为一个展示开关 bump version。
- **codename 稳定**：不改表名 / id 前缀 / `muzero-db`（遵守硬规则 #4）。
- **Privacy & Retention**：偏好存本地 IndexedDB；不含 PII；无 TTL 需求。

### 3.3 Per-set / per-track override（明确 v1 不做）

`DjSession.displayMode`（[`types.ts`](../../../src/db/types.ts) 第 120 行）已是 per-set 的 video→cover→title 回退。**可视化 v1 走全局设置**，不加 `DjSession.visualizerStyle`（那需要 DB version bump + UI），列入 §7 Out of Scope，未来若做再单开迁移。

---

## 4. API Design

> 纯本地前端，**无 HTTP/后端 API**（硬规则 #1）。本节描述**模块/引擎契约**。

### 4.1 模块契约

| Symbol | 位置 | 说明 |
|--------|------|------|
| `resolveVisualizer(settings)` | `src/visualizer/registry.ts` | settings → `Visualizer` 实例；唯一裁决点（复刻 [`resolveMusicGenProvider`](../../../src/musicgen/registry.ts)） |
| `<VisualizerHost active={isPlaying} asBackground? />` | `src/visualizer/host.tsx` | 收养 canvas、跑唯一 rAF、可见性暂停、能力探测+回退、设 analyser 参数、注入 `--primary` |
| `getMediaEngine().getAnalyser()` | [`media-engine.ts`](../../../src/player/media-engine.ts) | 既有；host 唯一音频源 |
| `MediaEngine.getSource()` *(新增, 备未来多 tap)* | [`media-engine.ts`](../../../src/player/media-engine.ts) | 暴露内部 source node，便于未来「bars(256)+bloom(2048) 同屏」各自 tap；v1 不必用 |
| `readPrimary()/lighten()` | `src/lib/visualizer-color.ts` | 从 aura 抽出，全 renderer 共用（承接主题色） |

### 4.2 渲染数据流（每帧）

```ts
// VisualizerHost 内唯一 rAF（伪码）
function frame(t: number) {
  if (hidden || offscreen || reducedMotion) { /* 暂停或画静态帧 */ return scheduleNext(); }
  analyser.getByteFrequencyData(buf);   // buf 预分配，零每帧 alloc
  visualizer.render(t);                  // renderer 读 buf/analyser + primary()，画到 canvas
  scheduleNext();
}
```

### 4.3 Error / 边界

- **WebGL 不可用**：`scene-*` / `milkdrop` 在 `init` 探测失败 → host 回退到 `"aura"`（canvas-2D），并在 Settings 旁标注「此设备不支持」。
- **WebGL context lost**（移动端内存压力，尤其 iOS/WKWebView）：监听 `webglcontextlost`/`restored`，丢失即回退 cover/title stage，恢复后可重建。
- **analyser 尚未建**（首播前/无手势）：`getAnalyser()` 返回 null → 画 idle「呼吸」态（aura 已有此逻辑）。
- **无遥测**：错误只走 [`logger.ts`](../../../src/lib/logger.ts)（硬规则 #8），不上报。

---

## 5. Frontend Design

### 5.1 渲染位置（可视化出现在哪）

1. **media-stage 背景**（主战场）：[`media-stage.tsx`](../../../src/components/player/media-stage.tsx) 现在 `content !== "video"` 时挂 `AuraVisualizer`；改为挂 `VisualizerHost`，渲染用户选中的样式，垫在 cover/title 之后。回退链 **video → cover → title** 不变（[`resolveStageContent`](../../../src/lib/track-display.ts) 仍是唯一裁决）。
2. **Now Playing 全屏背景**（可选）：`visualizerAsBackground` 开启时，在 [`now-playing-background.tsx`](../../../src/components/player/now-playing-background.tsx) 同层加一个 `VisualizerHost`（与现有图片幻灯片二选一或叠加，见 §10 Q4）。
3. **移动端 sheet**：[`now-playing-sheet.tsx`](../../../src/components/player/now-playing-sheet.tsx) 同样用 `VisualizerHost`。
4. **`audioOnly`**：看视频集但只想听声音时（player-store 的临时开关），stage 不显示 video → 自然落到可视化，符合既有语义。

### 5.2 UI Components

- **`components/settings/visualizer-settings.tsx`**（新）：放进 Settings「外观」分区（紧邻主题色 / 背景，见 [`settings-page.tsx`](../../../src/pages/settings-page.tsx)）：
  - **样式选择器**：样式卡片网格（理想含每个样式的**实时迷你预览** canvas；最小可行先用静态缩略图 + 名称）。含 `off`（关闭，纯 cover）。
  - **「用作全屏背景」开关** → `visualizerAsBackground`。
  - **reduced-motion 提示**：检测到系统低动效时，标注「已按系统偏好降为静态」。
- **改 [`aura-visualizer.tsx`](../../../src/components/player/aura-visualizer.tsx)**：保留导出名与 `{active, className}` 用法，内部变成 `VisualizerHost` 薄包装（调用点零改动）。

### 5.3 调色：承接 `--primary`

- 抽 `readPrimary`/`lighten` 到 `src/lib/visualizer-color.ts`（即上一改动里在 aura 内实现的 1×1 scratch-canvas 光栅化法，支持 hex/oklch/named）。
- **所有自研 renderer 从 `--primary` 派生**（核心亮、边缘隐、环更亮），随主题切换 / 用户改色每 ~0.5s 实时跟随（沿用 aura 的「每 30 帧重读」节流）。
- shader 场景把 primary 作为 `uPrimary` uniform；butterchurn 不强求（其 preset 自带配色，可选 tint）。

### 5.4 State Management（遵守 CLAUDE.md #6）

- `VisualizerHost`、rAF 句柄、registry、当前 renderer 实例、预分配 `Uint8Array` 全部**模块作用域 / ref**，**不进 Zustand state**（避免每帧重渲染）。
- 组件只用最小 selector 订阅 `isPlaying` 等标量。
- 样式选择写 `AppSettings`（Dexie），UI 通过 `useSettings()` liveQuery 读，切样式时 host 在 effect 里 `destroy()` 旧 renderer、`init()` 新 renderer。

---

## 6. Implementation Plan

> **相位顺序遵守模板「基础设施先于覆盖广度」**：先 Phase 1 把 registry/host/可见性暂停/回退/Settings 地基打好，再 Phase 2 铺样式广度，再 Phase 3 上 shader，Phase 4 可选/可延后。

### Phase 1: 可视化基础设施 + 收编现有 aura

**Goal:** 立起 registry + host + Settings，把现状光晕无回归地收编为第一个 renderer。无新依赖。

**Tasks:**
- [x] `src/visualizer/types.ts`（接口 + id union）、`registry.ts`（`resolveVisualizerStyle` + `VISUALIZER_META`/IDS + `createVisualizer`）。
- [x] `src/visualizer/host.tsx`：canvas 收养、**唯一 rAF**、**Page Visibility + IntersectionObserver 暂停**、dpr cap(≤2)、reduced-motion gate（`shouldAnimate` 纯函数）、按样式设 `analyser.fftSize/smoothing`（懒设，兼容首播后建图）、注入 `primary()`。
- [x] 抽 `src/lib/visualizer-color.ts`（`lighten`/`darken`/`rgba`/`readPrimaryRgb`），aura 改用之。
- [x] `src/visualizer/spectrum/aura.ts`：把 aura 画法迁入 `Visualizer` 接口（verbatim port）。
- [x] `AppSettings` 加 `visualizerStyle?`/`visualizerAsBackground?` + 默认（[`types.ts`](../../../src/db/types.ts)）。
- [x] `components/settings/visualizer-settings.tsx`（含 `off`/`aura`）+ i18n **四语**（en/zh/ja/ko）键。
- [x] **无需改** [`media-stage.tsx`](../../../src/components/player/media-stage.tsx) / [`now-playing-sheet.tsx`](../../../src/components/player/now-playing-sheet.tsx)：[`aura-visualizer.tsx`](../../../src/components/player/aura-visualizer.tsx) 收编为 `VisualizerHost` 薄壳、保留 `AuraVisualizer` 名+props，调用点零改动即用上新系统。

### Phase 1 Checklist
- [x] 切样式无内存泄漏：cleanup 完整（`destroy()` + `cancelAnimationFrame` + 移除 visibility/mq 监听 + `IntersectionObserver.disconnect()`）。
- [x] rAF 暂停逻辑（visibility + IntersectionObserver + `shouldAnimate` 单测覆盖真值表）；「实测帧数=0」的运行时量化留 Phase 5 instrumentation。
- [x] reduced-motion 下冻结（`shouldAnimate` 返回 false → 只画一帧、不进循环）。
- [x] 默认 `aura` 与改造前一致（verbatim port + 保留 `AuraVisualizer` API → 无回归）。
- [x] `make check` 通过：typecheck ✓ / biome ✓ / **214 tests ✓**（含 26 新增：color 10 / registry 10 / host 6，均注入假 analyser/纯函数）。

### Phase 2: 自研 canvas-2D 频谱样式包（广度 = 「支持很多」）

**Goal:** 一组炫酷频谱样式，全部跟随 `--primary`，clean-room 借鉴 audioMotion 技术（不引入 AGPL 依赖）。

**Tasks:**
- [x] `spectrum/bands.ts`（纯函数）：FFT bin → **八度对数分带**(`octaveBands`) + **感知 tilt**(`tiltWeights`/`applyTilt`) + 每带取 max(`aggregateBands`) + EMA 平滑(`smoothBands`)；dB 幅度由 analyser byte 输出 + dB 窗口承担。解决线性 FFT「左挤右空」。
- [x] `spectrum/bars.ts`（八度条形）、`radial.ts`（环形频谱 + 旋转 + 镜像）、`led-reflex.ts`（LED 段 + 倒影）、`waveform.ts`（时域示波 + 镜像 + 辉光）——全部 `--primary` 派生。
- [x] 每个样式声明 `fftSize`（频谱/waveform 均 1024）+ **dB 窗口**（`minDecibels`/`maxDecibels`，host 应用、回退 -100/-30）；调色走 `visualizer-color.ts`。
- [x] Settings 样式下拉补齐 6 项（off/aura/bars/radial/led-reflex/waveform）+ i18n **四语**；UI 由 registry `VISUALIZER_META` 自动驱动（无硬编码）。

### Phase 2 Checklist
- [x] dB 窗口收紧（频谱 -85/-22、waveform -90/-10）让静音/小音量/大动态都可见；host 按样式应用、回退默认。
- [x] 改主题色后所有样式实时跟随（每 30 帧重读 `--primary`，复用 Phase 1 机制）。
- [ ] 桌面 60fps / 移动 30fps 不掉帧 → **运行时量化留 Phase 5 instrumentation**（逻辑上单 rAF + 预分配 buffer + dpr cap≤2 + EMA 已就位）。
- [x] 纯函数 `bands.ts` 穷举单测（15）+ 5 个 renderer 的 init/render 烟雾测试（10，stub ctx/analyser）；全套 **249 通过**。

### Phase 3: GPU shader 反应式场景（深度 = 「画面随音乐波动」）

**Goal:** 液态 / 极光两个生成式 shader 背景，振幅/频段驱动。**选型变更**：原计划复用 three+R3F，但用户中途移除了 three（去依赖）；经二次横向对比（ogl/twgl/regl/raw/shadertoy-runner）→ 选 **`twgl.js`（MIT, ~22KB, 懒加载）** 写 WebGL1 全屏 fragment shader；WebGL 探测 + canvas(`aura`) 回退。

**Tasks:**
- [x] `scene/scene-shaders.ts`：统一 uniform prelude（`uTime`/`uResolution`/`uAudio`/`uBass`/`uMid`/`uTreble`/`uPrimary`）+ `SCENE_VERT`(twgl attribute) + `LIQUID_FRAG`/`AURORA_FRAG`（自研，MIT (MUZERO)）。
- [x] `scene/reactive-scene.tsx`：twgl 全屏 quad + program；rAF 喂 uniform；`paused` 冻结单帧（off-screen / reduced-motion）；`webglcontextlost/restored` 重建。
- [x] `scene/audio-uniforms.ts`（纯函数）：analyser → bass/mid/treble/energy（穷举单测 6）。
- [x] host：`SceneHost` 能力探测（`hasWebGL`）→ 无 WebGL 回退 `aura`；IntersectionObserver + reduced-motion → `paused`；**动态 import**（twgl 不进主 bundle）。
- [x] registry 注册 scene-liquid/scene-aurora（kind=scene；`createVisualizer` 返回 null，host 走 `SceneHost`）+ i18n 四语。

### Phase 3 Checklist
- [x] **新增 1 个依赖 `twgl.js`(MIT, ~22KB)**——懒加载，仅选 scene 样式时拉起，不进主 bundle。（原「零依赖」前提随 three 被移除而失效）
- [x] WebGL 不可用自动回退 `aura`（jsdom 无 WebGL 的 host 测试已覆盖）；Settings 仍可选（回退透明）。
- [x] `webglcontextlost/restored` 重建 program；reduced-motion / off-screen → 冻结单帧。
- [x] scene 模块独立懒加载（非 scene 样式不加载 twgl）。
- [ ] 真机视觉确认（WebGL 在 jsdom 跑不了）+ 移动端帧率 → 留 **Phase 5 / 真机验证**。
- [ ] `visualizerAsBackground` 全屏背景接线 → **延后**（需改用户正在编辑的 [`now-playing-background.tsx`](../../../src/components/player/now-playing-background.tsx)，避免纠缠）；scene 现已在 stage 背景渲染。

### Phase 4: （可选 / 依赖审查门控）Milkdrop 模式

**Goal:** `@webamp/butterchurn`（MIT）的「炸裂」可视化，作为高阶可选样式。**先过依赖清单审查**（它是新 runtime owner），结论若是延后则整个 Phase 进 v2。

**Tasks:**
- [ ] 依赖清单审查 PRD：butterchurn(MIT) + butterchurn-presets(MIT，**单 preset 原作授权未标注**——只精选 ~10–15 个、维护 `THIRD-PARTY-LICENSES.md` per-preset 署名)。
- [ ] `visualizer/milkdrop.ts`：**动态 import** butterchurn；`createVisualizer(audioContext, canvas)` + `connectAudio(getAnalyser())`（复用既有 ctx/node，非破坏性）。
- [ ] `isButterchurnSupported()` **WebGL2 门控** + `webglcontextlost` + **iOS/WKWebView 回退** cover/title。
- [ ] FPS/分辨率封顶（`setRendererSize` 低内部分辨率）；首次 shader 编译预热避免卡顿。
- [ ] 精选 preset 子集 lazy `import()`（**绝不打包 11MB 全量**）。

### Phase 4 Checklist
- [ ] base bundle **不含** butterchurn/presets（仅用户启用时懒加载）。
- [ ] WebGL2 缺失 / iOS context-loss 有优雅回退，不崩。
- [ ] 懒加载块 gzip < 150KB（精选 preset）。
- [ ] `THIRD-PARTY-LICENSES.md` 列出所有 bundled preset 的署名/来源。

### Phase 5: 打磨（观测 / 预算 / i18n / a11y / 移动 / 文档）

> **本轮按用户选择「只轻量收尾」**：完成 i18n / a11y / 文档；性能埋点（frame cadence + longtask）/ bundle 预算 / 移动端显式 30fps 限频 **延后**（核心已交付，低风险打磨可后续单做）。

**Tasks:**
- [ ] **性能观测**（模板 §4）：host 内埋 `frame interval` + `PerformanceObserver(longtask)` —— **延后**。
- [ ] **bundle 预算**：`pnpm build` 量化增量 —— **延后**（twgl 已懒加载不进主 bundle；spectrum 零依赖）。
- [x] **i18n 四语**：样式名 / Settings 文案 en→zh/ja/ko 全量（[`i18n/locales`](../../../src/i18n/locales)）。
- [x] **a11y**：canvas `aria-hidden`；样式选择器原生 `<select>` 键盘可达；reduced-motion 实时订阅（matchMedia change）+ 冻结。
- [~] **移动/电量**：dpr cap≤2 ✅、Page Visibility + IntersectionObserver 暂停 ✅；显式 30fps 限频 **延后**。
- [x] **文档**：更新 [`CLAUDE.md`](../../../CLAUDE.md)（项目结构 + 导航口径「可视化」+ UI 库接入段），记录 registry + twgl + `--primary` 决策。

### Phase 5 Checklist
- [x] 四语齐全；a11y（aria-hidden / 键盘 / reduced-motion）通过。
- [x] 文档对齐 CLAUDE.md。
- [ ] 性能 `frame p99` / `longtask` 量化 + bundle 预算 + 移动 30fps —— **延后（非核心打磨）**。

---

## 7. Out of Scope

- **per-set / per-track 可视化样式**（v1 走全局；未来需 DB version bump + UI，单开 PRD）。
- **audioMotion-analyzer 作为依赖**——AGPL，明确拒绝（仅借鉴技术 clean-room 重写）。
- **节拍/BPM 检测、和声分析驱动**——v1 只用振幅/频段；beat tracking 是后续增强。
- **麦克风 / 外部音源可视化**——只可视化本地正在播放的曲目。
- **导出/录制可视化为视频**——非播放器职责。
- **真 3D 粒子/网格场景**——本期 scene 仅全屏 fragment shader（复用既有 R3F）；真 3D 几何留未来。
- **butterchurn（若依赖审查判定延后）**——则整个 Milkdrop 模式进 v2。

---

## 8. Security & Privacy Considerations

> MUZERO 无账号/权限/后端，本节按本地优先重写。

- **数据边界**：可视化只读设备本地 `AnalyserNode` 的频率数据；**零出站请求、零遥测**（硬规则 #1/#8）。新功能不引入 MUZERO 自有后端。
- **无 hidden flag**：开关全在可见 Settings；回退 = `git revert` + 重新发版，不是 runtime kill switch（硬规则 #3）。
- **License 第一公民**（模板 §3）：Phase 1–2 零依赖（自研 canvas）；Phase 3 新增 **`twgl.js`(MIT, ~22KB, 懒加载)**（用户移除 three 后二次选型）；唯一潜在新依赖 `butterchurn`(MIT，延后 v2)；**拒绝 AGPL(audioMotion) / LGPL(p5) / 非商用 Prosperity(lygia)**。自研 shader 标 `MIT (MUZERO)`。
- **不引入新 runtime owner**：自研 + `ogl` 薄桥优先；butterchurn 作为唯一「重」依赖需先过依赖清单审查。
- **codename 稳定**：不动 `muzero-db` / 表名 / id 前缀 / provider id（硬规则 #4）。

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [`aura-visualizer.tsx`](../../../src/components/player/aura-visualizer.tsx) | 现状自研光晕（本期收编 + 承接 `--primary`） |
| [`media-engine.ts`](../../../src/player/media-engine.ts) | 单一 `<video>` + 共享 `AnalyserNode`（可视化唯一音源） |
| [`musicgen/registry.ts`](../../../src/musicgen/registry.ts) | registry/DI 范式样板（visualizer registry 复刻它） |
| [`primary.ts`](../../../src/theme/primary.ts) | 主题色系统（可视化调色来源） |
| [20260607-muzero-player-shell-redesign-prd](../20260607-muzero-player-shell-redesign-prd/20260607-muzero-player-shell-redesign-prd.md) | Now Playing / media-stage 重构上下文 |
| [`prd-template.md`](../prd-template.md) §3/§4 | Effect/Shader/外部依赖 + 性能类附加要求 |

---

## 10. Open Questions

| # | Question | Status | Decision（按 best practice 拍板） |
|---|----------|--------|------|
| 1 | butterchurn Milkdrop 进 v1 还是 v2？ | ✅ Resolved | **v2 / 门控**。best practice = 先交许可净、跨端稳的能力；Milkdrop 是 WebGL2-only + 11MB preset + iOS context-loss 风险 + 新 runtime owner，需单独依赖审查。本实现轮**完成 Phase 1/2/3/5，Phase 4 延后 v2**（registry 已预留 `milkdrop` id） |
| 2 | 全局 vs per-set 样式？ | ✅ Resolved | **全局**。best practice = 最小数据面、不为展示开关 bump DB version；per-set 列 Out of Scope |
| 3 | 首次运行默认样式？ | ✅ Resolved | **`aura`**。= 现状，零感知回归；空安装也立刻有氛围 |
| 4 | `visualizerAsBackground` 与图片幻灯片背景的关系？ | ✅ Resolved | **互斥 + 默认关**。开了可视化背景则不跑图片幻灯片（省电、避免叠加抢戏）；与既有 Dither 效果遵循单一背景来源 |
| 5 | 同屏多 analyser tap？ | ✅ Resolved | **v1 不做**。同时只渲一个样式，运行时改 `analyser.fftSize` 即可；`MediaEngine.getSource()` 预留未来多 tap |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-07 | DoodleBear / MUZERO | 初稿：npm 横向对比（butterchurn/audioMotion/ogl/three/p5/wavesurfer…）+ 选型（自研频谱 + ogl 场景 + 可选 butterchurn，拒绝 AGPL）+ 可插拔 Visualizer registry 架构 + 5 阶段计划 |
| 2026-06-07 | DoodleBear / MUZERO | 解决全部 Open Questions（按 best practice）；**修正 Phase 3：复用已在树中的 three + R3F + postprocessing（不再引入 ogl）**——发现 [`dither-background.tsx`](../../../src/components/player/dither-background.tsx) 已用 R3F 做 Dither 背景。Phase 4(butterchurn) 按 Q1 延后 v2 |
| 2026-06-07 | DoodleBear / MUZERO | **Phase 1 ✅**：可插拔 Visualizer registry + host（rAF/可见性暂停/reduced-motion/dpr cap）+ `visualizer-color` 工具 + aura 收编 + AppSettings 字段 + 四语 Settings 控件。TDD：color/registry/host 共 26 单测，全套 214 通过 |
| 2026-06-07 | DoodleBear / MUZERO | **Phase 2 ✅**：自研频谱样式包 bands(纯) + bars/radial/led-reflex/waveform（全 `--primary`）+ dB 窗口 + 四语。TDD：bands(15) + renderer 烟雾(10)，全套 **249 通过** |
| 2026-06-07 | DoodleBear / MUZERO | **Phase 3 ✅**：GPU shader 反应式场景（液态/极光）。**用户中途移除 three → 二次横向对比 WebGL 库（ogl/twgl/regl/raw/shadertoy-runner）→ 选 `twgl.js`(MIT, 懒加载)**。audio-uniforms(纯) + reactive-scene(twgl, context-loss 重建) + host `SceneHost`(WebGL 探测 + 回退 aura)。TDD：audio-uniforms(6)，全套 **258 通过** |
| 2026-06-07 | DoodleBear / MUZERO | **Phase 5 轻量收尾 ✅**（按用户选择）：CLAUDE.md 文档对齐（registry + twgl + `--primary`）+ i18n 四语 + a11y 复核。性能埋点 / bundle 预算 / 移动 30fps 延后。Phase 4(butterchurn) 延后 v2 |

---

> **Note:** 本 PRD 强调**改造既有代码**（收编 aura、复用 AnalyserNode、复刻 registry 范式）而非另起炉灶；新文件仅限新基础设施（registry/host/bands）与第三方 lib 桥（ogl/butterchurn 适配）。
>
> **Exception Policy:** Phase 1–3 **不新增依赖**（three/R3F/postprocessing 已在树中）。唯一潜在新依赖是 Phase 4 的 `butterchurn`（新 runtime owner，须先过依赖清单审查），已按 Open Q1 延后 v2。
