# PRD: MUZERO Now Playing 切歌背景性能(持久化 Pixi + settle 闸门 + GPU 后端可选)

**Status:** Draft
**Created:** 2026-06-13
**Author:** Claude
**Module:** Player / Now Playing Background - Pixi 生命周期、切歌 settle 闸门、GPU 后端偏好

---

## Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | 持久化 Pixi App + settle 后换纹理(切歌核心修复) | ✅ 代码完成(待 GPU/视觉实测) | [Phase 1](#phase-1-持久化-pixi-app--settle-后换纹理) |
| 2 | 统一切歌 settle 闸门(封面 `<img>` 即时,重计算 debounce) | ✅ 代码完成(待 GPU/视觉实测) | [Phase 2](#phase-2-统一切歌-settle-闸门) |
| 3 | GPU 后端 Settings 选项(auto / WebGPU / WebGL) | ✅ 代码完成(待 GPU/视觉实测) | [Phase 3](#phase-3-gpu-后端-settings-选项) |
| 4 | 背景纹理 ImageBitmap 化(线程外解码 + 去 canvas 转换)(#4-A) | ✅ 代码完成(待 GPU/视觉实测) | [Phase 4](#phase-4-背景纹理-imagebitmap-化) |
| 5 | stage/coverflow 封面 `<img>` 异步解码(保持原图,不占 paint 主线程)(#4-B) | ✅ 代码完成(待 GPU/视觉实测) | [Phase 5](#phase-5-stagecoverflow-封面异步解码) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

切到「带封面」的下一首歌时,Now Playing 出现严重掉帧(120 → 85 FPS,`frameMaxMs` 150–216ms 的单帧长任务)。复核见 [`.logs/main-vs-cfab016b-switch-jank-audit-followup.md`](../../../.logs/main-vs-cfab016b-switch-jank-audit-followup.md)。结论拆成两层:

1. **基线大头(非本次回归,但绝对开销第一):**
   默认 `backgroundRenderer: "noise"`,而 [`now-playing-background.tsx:374`](../../../src/components/player/now-playing-background.tsx#L374) 的 `isPixiEffect()` 把 `"noise"` 也算 Pixi → 默认背景就是 `PixiPixelBackground`,以**当前封面**作纹理。[`pixi-pixel-background.tsx:37`](../../../src/components/player/pixi-pixel-background.tsx#L37) 的 `useEffect`(依赖含 `src`)在封面变化时**整段重来**:`import("pixi.js")` → `new Pixi.Application()` → `await init()`(创建 GPU device/context)→ `loadBackgroundMedia` → `createPixiFilter`(shader 编译)→ 旧 app `destroy()`。**每次切到封面不同的歌 = 整个 WebGL App 拆/建 + 纹理上传 + shader 重编译。** `git diff cfab016b main` 此文件为空 → 确属基线、未变。

2. **回归放大器(已在复核里枚举):** 系统歌单 live query(仅队列抽屉打开时)、默认 `shadow` 模式仍无条件生成 backlight 派生、默认合成值翻转(`visualizerBackgroundOpacity 100→70`、`visualizerBackgroundDim 0→30`)。这些归 §7「Out of Scope / 交叉引用」,本 PRD 不重复处理。

### 1.2 本 PRD 要解决的产品问题

- **切歌要丝滑,且能看到每一张封面。** 高频 next/next 时,封面 `<img>` 应**逐张即时**显示(廉价),而 Pixi 特效、**封面取色**、backlight 派生、裁剪这些**重计算**应 debounce 到「切歌落定」后再做一次,跳过的歌一次都不付重计算。
- **落定后只换纹理,不重建 App。** 持久化 `Pixi.Application`,shader 只编译一次,切歌只做 `sprite.texture = newTexture`。
- **GPU 后端可配置。** 能力强的设备可用 WebGPU 获得更好体验;Settings 提供「自动 / WebGPU / WebGL」,默认自动。

### 1.3 Target Users

| Role | Description |
|------|-------------|
| 桌面听众 | 带封面播放,Now Playing 有 Pixi 环境背景 + 取色流光 + 可视化;会连续跳歌 |
| 高性能设备用户 | 独显/Apple Silicon,愿意用 WebGPU 换更顺滑的背景 |
| 低端/WKWebView 用户 | 需要稳定回退到 WebGL,且切歌不卡 |

### 1.4 Core Value

1. **切歌丝滑**:封面逐张即时显示,重计算让位给「落定后一次」。
2. **零重建**:持久化 Pixi,消除每切歌的 WebGL App 重建 + shader 重编译。
3. **可控的 GPU 后端**:auto 默认,高性能设备可选 WebGPU,低端/WKWebView 稳回退 WebGL。
4. **可度量**:每项改动都有切歌 `frameMaxMs` / `fpsLow` / 重建次数 / 纹理上传次数的前后对比。

---

## 2. System Architecture

### 2.1 现状(每次切歌)

```
currentTrack 变 (player-store)
        │
        ▼
now-playing-background: pixiUrl = 新封面 URL
        │  useSettledBackgroundTarget 只等 blob URL resolve(近瞬时,不防抖)
        ▼
PixiPixelBackground  src 变 → useEffect 整段重来
        │
        ├─ import("pixi.js") + new Application() + await init()   ← 重:建 GPU context
        ├─ loadBackgroundMedia(src) + Texture.from               ← 中:纹理上传
        ├─ createPixiFilter(effect)                              ← 重:shader 编译(其实只依赖 effect,却随歌重跑)
        └─ 旧 app.destroy()
并行(各自的封面派生,部分已 worker 化):
   取色 extractCoverMetadataViaWorker(900ms idle settle)
   backlight 派生(media-stage:43 无条件请求,即使 shadow 模式不展示)
   裁剪 getCroppedBlob(仅开启裁剪+缓存未命中)
```

### 2.2 目标(切歌)

```
currentTrack 变 (即时,廉价)
        │
        ├─▶ 封面 <img> 逐张 crossfade(stage 已是 <img>;环境背景新增即时 <img> 层)
        │
        └─▶ settledTrack(去抖:同一首稳定 N ms 后才 emit) ── 高频跳歌时只 emit 最后一首
                │
                ▼  以下全部 gated 在 settledTrack
        持久 Pixi.Application(只建一次)
                ├─ sprite.texture = newTexture(只上传纹理,旧纹理 destroy)
                └─ filter 复用(effect/effectOptions 变才重编译)
        取色 / backlight 派生 / 裁剪 ── 同一闸门,跳过的歌不触发
```

### 2.3 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| 环境背景渲染 | pixi.js v8(已用,懒加载) | 复用现有效果(noise/pixel/crt/ascii/dot/cross-hatch),只改生命周期 |
| GPU 后端 | Pixi `preference: "webgl" | "webgpu"` + 能力探测 | WebGPU 仅在可用时启用,WKWebView/驱动不支持则回退 WebGL |
| 去抖信号 | 复用 store `LOCAL_BLOB_PLAYBACK_SETTLE_MS`(180ms)或独立常量 | 让背景特效与音频/blob 落定同拍 |
| 设置存储 | Dexie `settings` 行(`AppSettings`) | 与现有设置一致,本地、BYOK 之外无出站 |

---

## 3. Data Model Design

### 3.1 新增设置字段(`src/db/types.ts` `AppSettings` + `DEFAULT_SETTINGS`)

⚠️ 仅**增量可选字段**,不 bump DB version(`AppSettings` 是设置行,读取时与默认合并;codename 层不变)。

```ts
/** 背景 GPU 后端偏好。auto = 可用则 WebGPU,否则 WebGL。 */
backgroundGpuBackend?: "auto" | "webgpu" | "webgl";              // DEFAULT_SETTINGS: "auto"
/** 背景 GPU 性能档。auto = 优先 high-performance(选性能好的)。 */
backgroundGpuPowerPreference?: "auto" | "high-performance" | "low-power"; // DEFAULT_SETTINGS: "auto"
```

- **两个旋钮都默认 `auto`,且 auto = 选性能好的那条**(后端 auto → 可用即 WebGPU;性能 auto → `high-performance`),用户可在 Settings 手动覆盖。详见 §5.2 / Phase 3。
- **不**新增任何隐藏 flag(遵守硬规则 3):两个偏好都必须是可见的 Settings 控件。

### 3.2 切歌特效去抖常量(非设置项)

- 在 [`background.ts`](../../../src/lib/background.ts)(或 `now-playing-background`)引入**独立命名常量** `BACKGROUND_EFFECT_SETTLE_MS`,初值 `180`(对齐播放落定节奏),**与 [`player-store`](../../../src/stores/player-store.ts) 的 `LOCAL_BLOB_PLAYBACK_SETTLE_MS` 在语义上解耦**(背景特效去抖 ≠ 音频/blob 落定,各自可独立调)。
- **best practice 决定:不暴露成用户设置**——避免设置膨胀;它是内部时序常量,QA 实测有需要再考虑暴露。

### 3.3 不涉及的存储

- 不动 `mediaBlobs` / `coverDerivatives` / `tracks` 表结构(封面派生表归 cover-render-pipeline PRD)。
- 不引入新表、不引入后端。

---

## 4. API / 模块边界

本特性纯前端,无网络 API。关键模块契约:

| 模块 | 改动 | 说明 |
|------|------|------|
| [`pixi-pixel-background.tsx`](../../../src/components/player/pixi-pixel-background.tsx) | 拆分 effect 生命周期 | App init/filter 只依赖 `effect`/`effectOptions`/`backend`;`src`/纹理走独立 effect 只换 texture |
| [`now-playing-background.tsx`](../../../src/components/player/now-playing-background.tsx) | 引入 settledTrack;新增即时 `<img>` 层 | 当前帧显示廉价封面,Pixi 显示 settled 帧 |
| [`background.ts`](../../../src/lib/background.ts) | 新增 settle/去抖纯函数 | `settleBackgroundTarget` 之外,加「track 稳定去抖」纯逻辑(可单测) |
| [`db/types.ts`](../../../src/db/types.ts) | `backgroundGpuBackend` 字段 + 默认 | 见 §3.1 |
| Settings 背景面板 | 新增后端选择器 | 见 §5.2 |
| `lib/platform` 或新 `lib/gpu-capability.ts` | `detectGpuBackend()` | `navigator.gpu` 探测 + Pixi preference 解析(可单测) |

---

## 5. Frontend Design

### 5.1 交互口径

- **Now Playing stage 主封面**:已是 `<img>`([`media-stage.tsx`](../../../src/components/player/media-stage.tsx) `CoverImage`),已即时,无需改;只把它的 backlight 派生纳入 settle 闸门(见 Phase 2)。
- **环境背景(ambient)**:
  - 高频跳歌中(`currentTrack !== settledTrack`):显示 `CrossfadeBackgroundImage`([`now-playing-background.tsx:336`](../../../src/components/player/now-playing-background.tsx#L336))的**当前封面**,逐张滑过(廉价 `<img>` + 已有 crossfade)。
  - 落定后(settledTrack 更新):持久 Pixi 把 settled 封面作纹理换上;Pixi 内部那张 `<img>`(z-10 在 canvas z-0 之上)在纹理就绪后淡出 → 漏出 Pixi 特效。**flow / visualizer 本就跟随调色板 900ms 插值 glide,不 pop**(只有 Pixi canvas 纹理是瞬切),所以只需平滑 Pixi 一层。
  - **真正的修正(QA trace 之后):整个 ambient 背景按 settledTrack 去抖**。见 §5.3 + Q5/Q6。
    > 教训:试过「顶层全屏 reveal veil」,反而引入**封面错位**(veil 渲染了 `useTrackCoverResource` 的 stale-while-pending URL,放 B 显示 A 的封面)且**每跳一首都解码一张全屏封面**加剧堆churn。已移除。flow/viz 不 pop,无需顶层 veil;Pixi 单层用内部 `<img>` reveal 足矣(半透明 flow/viz 下仍可见)。
  - 视觉:跳歌时看到一串清晰封面快速划过;停下后该首的 noise/pixel 特效「长」出来盖在封面上。用户已确认接受此体验。
- **GPU 后端切换**:改设置后,持久 Pixi app 以新 `preference` 重建一次(仅这一次,非每切歌)。

### 5.2 Settings UI

- 位置:背景 / 可视化设置面板(与 `backgroundRenderer` 等同组),归到一个「图形 / GPU」小节。
- **控件一「图形后端」**:三选一 = 自动(默认)/ WebGPU / WebGL。
- **控件二「性能档」**:三选一 = 自动(默认)/ 高性能 / 省电。
- **两者默认都是「自动 = 选性能好的」**(后端 auto → 可用即 WebGPU;性能 auto → 高性能);用户可手动覆盖,比如笔电用户想省电就选「省电」。
- 帮助文案(走 i18n,先 en 再 zh/ja/ko):
  - 后端·自动:「可用时使用 WebGPU 获得更顺滑的背景,否则回退 WebGL。」
  - 后端·WebGPU:「需要设备与系统支持;部分 WebView(如 macOS WKWebView)可能不支持,会自动回退。」
  - 性能·自动:「默认优先高性能 GPU;笔电省电可手动切到省电。」
- 选中 WebGPU 但探测不可用 → 显示「当前设备不支持,已回退 WebGL」副文案(不报错)。

### 5.3 State / 信号

- **(QA 后落地)`now-playing-background` 整体按 settledTrack 去抖**:`currentIndex = useSettledValue(liveCurrentIndex, BACKGROUND_EFFECT_SETTLE_MS)`,`current` 由它派生。于是 ambient 背景的**所有**派生(封面 URL+解码、palette、Pixi 纹理、flow、视频背景)只在落定那首跑一次——快切时不再每首解码封面 → 堆不再 churn(QA#1),也不会在 blob 未 resolve 时串号(QA 错位)。中央 stage 封面仍读实时 index。
- 去抖时长用**独立常量** `BACKGROUND_EFFECT_SETTLE_MS`(初值 180,语义独立于播放落定;见 §3.2),不暴露为用户设置。

---

## 6. Implementation Plan

### Phase 1: 持久化 Pixi App + settle 后换纹理

**Goal:** 消除每次切歌的 WebGL App 重建 + shader 重编译;落定后只换纹理。

**Tasks:**
- [x] 抽出 [`pixi-background-controller.ts`](../../../src/components/player/pixi-background-controller.ts):注入式 Pixi runtime(`loadPixi`/`loadMedia`/`loadFilter`/`attachVideo`),App+sprite+filter 只建一次,`setSource()` 只 `sprite.texture = next` + 旧纹理 `destroy(true)`;带 stale-token 守卫与 `stats.{appInits,textureSwaps}` 自省。
- [x] 重构 [`pixi-pixel-background.tsx`](../../../src/components/player/pixi-pixel-background.tsx):App 生命周期 effect 只依赖 `[effect, effectOptions, pixelSize]`(设置级,非切歌);纹理 effect 依赖 `[controller, src, mediaType]`,切歌只调 `controller.setSource`。视频 `attachVideo` 复用原 ticker/seek/订阅逻辑。
- [x] 保留 `autoStart:false` 的按需渲染;纹理换上后 `resize()` 内 `render()` 一次。
- [x] 诊断/可测性:`controller.stats`(appInits/textureSwaps)作为「切歌只换纹理、不重建」的可断言不变量,由单测锁定(见下)。
- [ ] (移交 Phase 2)`now-playing-background` 用 `settledTrack` 喂 Pixi 的 `src`,`currentTrack` 喂即时 `<img>` 层。

**Checklist:**
- [x] 单测 [`pixi-background-controller.test.ts`](../../../src/components/player/pixi-background-controller.test.ts)(注入 fake Pixi,6 例全绿):多次 `setSource` 只 `init` 一次(`appInits===1`)、每次换纹理并销毁旧纹理、传入正确的 backend/power、null src 保持当前层、stale 源被丢弃、`destroy()` 拆 app。
- [x] `tsc --noEmit` 通过;Biome 通过;`src/` 全量单测 2363 例通过(6 个 `scripts/*.mjs` 失败是既有的 rolldown shebang 转换问题,与本改动无关)。
- [ ] **待实测(本环境无 GPU,需手动跑桌面)**:连续跳 10 首 `appInits` 不增长;切歌 `frameMaxMs` < 60ms、`fpsLow` 回升;WKWebView(Tauri macOS)与 Electron 均不黑屏/不丢背景;视频背景播放/暂停/seek 跟随正常。

### Phase 2: 统一切歌 settle 闸门

**Goal:** 封面 `<img>` 即时;所有「从封面派生」的重计算只在落定后做一次。

**实现说明(对原方案的精化):** debounce 闸门**localize 进了 [`PixiPixelBackground`](../../../src/components/player/pixi-pixel-background.tsx)**,而非在 `now-playing-background` 重构 `settledTrack` 喂下游——因为该组件**已内置**一张跟随 `src` 的即时封面 `<img>`,只需把它从「Pixi 就绪即淡出」改成「与已上屏纹理一致才淡出」即可同时拿到「即时封面 + 重计算去抖」,改动面更小、风险更低。取色(`visualizer-dynamic-color`)**本就已 900ms idle-deferred**,天然跳过快切,无需再接同一闸门。

**Tasks:**
- [x] 抽通用尾随去抖 hook [`useSettledValue`](../../../src/hooks/use-settled-value.ts) + 内部常量 [`BACKGROUND_EFFECT_SETTLE_MS=180`](../../../src/lib/background.ts)(§3.2,解耦、不暴露);4 例单测覆盖初值即时/落定/快切跳过中间值/回弹取消。
- [x] 即时 `<img>` 常驻层:`PixiPixelBackground` 用 `useSettledValue(src)` 喂纹理,跳过的歌不上传纹理;`<img>` 跟随原始 `src`、`src === displayedSrc` 才淡出 → 跳歌逐张可见、落定才显特效。
- [x] O1:`media-stage.tsx` 用 [`shouldRequestCoverBacklightDerivative(mode, enabled)`](../../../src/lib/album-cover-appearance.ts) 把 `useCoverDerivativeUrl(..., "backlight")` gate 起来,默认 `shadow` 不再请求 backlight 派生(5 例单测)。
- [x] 取色已 900ms idle-deferred(无需改);裁剪 `getCroppedBlob` 仅裁剪开启+缓存未命中(niche,留待需要时)。

**Checklist:**
- [x] 单测:`useSettledValue`(4 例)+ `shouldRequestCoverBacklightDerivative`(5 例)+ Phase 1 控制器(6 例)全绿;`src/` 全量 2359 例通过;`tsc`/Biome 通过。
- [ ] **待实测(桌面)**:跳 10 首落定 1 首时只 1 次纹理上传;跳歌逐张看到封面 `<img>` 无卡顿;`shadow` 模式下 `coverDerivatives` 不再写 backlight 行。

### Phase 3: GPU 后端 Settings 选项

**Goal:** auto/webgpu/webgl 可选,默认 auto,稳定回退。

**Tasks:**
- [x] `AppSettings.backgroundGpuBackend` + `backgroundGpuPowerPreference`,二者 `DEFAULT_SETTINGS: "auto"`([`db/types.ts`](../../../src/db/types.ts))。
- [x] 纯解析器 [`gpu-backend.ts`](../../../src/lib/gpu-backend.ts):`resolveGpuBackend(pref, hasWebGpu)`(显式 webgl 不升级;其余可用即 webgpu、否则回退 webgl)、`resolveGpuPower(pref)`(auto/high-performance → high-performance,显式 low-power 才省电)、`hasWebGpuSupport()` 探测;9 例单测。
- [x] 喂进 Pixi `init({ preference, powerPreference })`([`pixi-pixel-background.tsx`](../../../src/components/player/pixi-pixel-background.tsx) 读 settings → 解析 → 控制器),后端/性能档变化纳入 app 生命周期 effect 依赖 → 改设置重建一次,切歌仍只换纹理。
- [x] Settings 背景面板([`background-effect-controls.tsx`](../../../src/components/settings/background-effect-controls.tsx))加两个选择器(后端 / 性能档,仅 Pixi 渲染器显示)+ en/zh/ja/ko 文案 + WebGPU 不支持时「已回退」副文案。
- [x] **device-lost 恢复(best practice):** 控制器 `recover()` —— 重建 app + 回灌 `lastSource`,有限次(`MAX_RECOVER_ATTEMPTS=2`,成功落帧即重置)。事件接线 `wireContextLossRecovery`:WebGL `webglcontextlost`(`preventDefault`)+ WebGPU `device.lost`(`reason !== "destroyed"`)→ `recover()`;恢复期常驻 `<img>` 兜底(Phase 2)。`recover()` 由 2 例单测直接覆盖(真实 GPU 丢失无法在 jsdom 触发)。

**Checklist:**
- [x] 单测:`resolveGpuBackend`/`resolveGpuPower`(9 例)+ 控制器 `recover()`(2 例)全绿;`src/` 全量 2370 例通过;`tsc`/Biome 通过。
- [ ] **待实测(桌面)**:auto 在支持设备走 WebGPU + high-performance、不支持走 WebGL 均正常出图;显式 WebGPU 在 WKWebView 回退且有提示不崩;切后端/性能档不影响「只换纹理」;模拟 device-lost(切独显/集显)后自动恢复、恢复期不黑屏。

### QA#4(2026-06-14 第二轮 trace):ambient 已稳,剩 coverflow 原图解码 + Pixi canvas 转换

连切 6 首(index 4572→4577,~0.93s)实测仍 `fpsAvg 120→56`、`longTaskMaxMs 283`、`frameMaxMs 341.8`。trace 定位:

- **Phase 1–3 生效、无回归**:整个 burst 仅 **1 条 `textureSwap`、0 条 `appInit`**;音频只有最后一首落 blob(前 5 首 `discard stale playback load`);[`now-playing-background.tsx:75`](../../../src/components/player/now-playing-background.tsx#L75) 的 ambient 去抖(`useSettledValue`)工作正常。
- **剩余开销 (A)——中央 coverflow/stage 原图解码**:[`SwipeableMediaStage`](../../../src/components/player/swipeable-media-stage.tsx#L124) 读**实时** `currentIndex`(设计:逐张滑过),[`useTrackCoverResource`](../../../src/hooks/use-media.ts#L222) + [`usePreloadedCoverUrls`](../../../src/components/player/swipeable-media-stage.tsx#L1069) 对每首跳过的歌都 `resolveMediaBlob`→`createObjectURL`**整张原图**(`cover.render.object-url-miss bytes:891699`),`<img>` 主线程解码;coverflow 动画同时挂 prev/current/next 三张原图。
- **剩余开销 (B)——Pixi 落定 canvas 转换**:[`pixi-background-controller.ts:284`](../../../src/components/player/pixi-background-controller.ts#L284) `Texture.from(HTMLImageElement)` → `render()` 里触发 `ImageSource: Image element passed, converting to canvas and replacing resource`,一次整张原图主线程 canvas 拷贝(叠加 Windows WebGPU 首传)。
- **非卡顿**:`frameMaxMs 6374.8`(@18:44:07)正好跨 `visibilitychange hidden→visible`(00.906→07.263),rAF 暂停被 FPS 表当成一帧,忽略。

**方向(用户拍板):保持原图**(不降采样派生),但 (A)(B) 的解码移出主线程——Pixi 走 ImageBitmap(免 canvas、线程外解码),stage/coverflow `<img>` 异步解码。→ Phase 4 / Phase 5。

### Phase 4: 背景纹理 ImageBitmap 化

**Goal:** Pixi 图片背景纹理改用 `createImageBitmap` 解出的 `ImageBitmap` 直接作纹理源,**消除** `Texture.from(HTMLImageElement)` 在 `render()` 触发的「`ImageSource: Image element passed, converting to canvas`」——那是落定时一次整张原图的**主线程 canvas 拷贝**(QA#4 (B))。`createImageBitmap` 的解码在主线程外完成。**保持原图分辨率,不降采样。**

**为何不进 Worker:** `createImageBitmap(blob)` 本身就在主线程外解码;GPU 上传必须在持有 WebGL/WebGPU context 的主线程做,Worker 解出 `ImageBitmap` 再 transfer 回来只增加传输开销、不省解码。故主线程 `createImageBitmap` 即满足「解码不占主线程」。视频路径必须用 `<video>` element,不动。

**为何 ImageBitmap 而非 `Assets.load`(查 Pixi v8 文档后):** Pixi 文档([textures#texture-types](https://pixijs.com/8.x/guides/components/textures#texture-types))明确 `ImageSource` 一类**直接接受 `ImageBitmap`**——这正是「不转 canvas」的路径(而 `HTMLImageElement` 在 WebGPU/部分浏览器无法直传,故 Pixi 在 `render()` 里转 canvas)。[`Assets.load`](https://pixijs.com/8.x/guides/components/assets) 是更高层 loader(内部也用 `createImageBitmap`),但它走 Pixi 自带 fetch(**绕过** `getAppFetch` 桌面 bridge → 远端封面 CORS 会断)、且按 URL 缓存 + `Assets.unload` 自管纹理生命周期(与现有控制器的 `texture.destroy` + `media.unload` 双轨会冲突)。故选「自取字节(走 bridge)→ `createImageBitmap` → 喂 ImageBitmap 给现有控制器」,既拿到线程外解码 + 免 canvas,又不动 CORS 路由与已测的纹理生命周期。

**实现(落地):**
- 新增可单测纯模块 [`background-texture.ts`](../../../src/lib/background-texture.ts) `loadImageBitmapSource(src, deps)`:注入 `fetchBlob`(取 src→Blob)+ 可选 `createImageBitmap`;成功返回 `{ bitmap, width, height, unload: () => bitmap.close() }`;不支持/取不到/解码抛错 → `null`(调用方回退)。
- [`pixi-pixel-background.tsx`](../../../src/components/player/pixi-pixel-background.tsx) `loadBackgroundMedia` 图片分支:先试 `loadImageBitmapSource`(注入 `fetchTextureBlob`:blob:/data: 走 `fetch`,其余走 `getAppFetch`),失败回退 `loadImage`(<img>);`element` 联合类型加 `ImageBitmap`。
- [`pixi-background-controller.ts`](../../../src/components/player/pixi-background-controller.ts):`LoadedBackgroundMedia.element`/`CurrentMedia.element` 联合加 `ImageBitmap`;`Texture.from(media.element)` 直接吃 ImageBitmap(无 canvas 转换);清理沿用 `media.unload`(close bitmap),disposeMedia 逻辑不变。

**Tasks(TDD):**
- [x] 先写 [`background-texture.test.ts`](../../../src/lib/background-texture.test.ts)(5 例):mock `createImageBitmap`+`fetchBlob` → 返回 bitmap 源(width/height/unload→close);解码抛错 → null;不支持(不 fetch)→ null;空 blob(不解码)→ null;fetch 失败 → null。
- [x] 实现 `loadImageBitmapSource` 至测试绿。
- [x] `loadBackgroundMedia` 接 ImageBitmap + `fetchTextureBlob` + 回退;控制器类型放宽 + 一例控制器测试(ImageBitmap element 被 `Texture.from` 原样收到、swap/destroy 调 unload→close)。

**Checklist:**
- [x] 新单测(5)+ 控制器测试(9,含新增 ImageBitmap 1 例)全绿(共 14);`tsc`/Biome 通过。
- [ ] **待实测(桌面)**:切到带封面的歌不再出 `ImageSource … converting to canvas` 警告;落定 `frameMaxMs` 较修前下降;背景出图正常、无黑屏;远端/streamed(https)封面仍出图。

### Phase 5: stage/coverflow 封面异步解码

**Goal:** 中央 coverflow/stage 封面**仍用原图**(读实时 index 是设计,要逐张滑过),但把整图解码移出 paint 关键路径:`<img decoding="async">` + 预热解码,快切时 `<img>` 上屏不再同步解码整张原图(QA#4 (A))。

**实现(落地):**
- coverflow `TrackVisual` 封面 `<img>` + backlight `<img>`([`swipeable-media-stage.tsx`](../../../src/components/player/swipeable-media-stage.tsx)) + 共享 stage/library 封面([`cover-image.tsx`](../../../src/components/ui/cover-image.tsx) `CoverImage`,`MediaStage` 经此渲染)补 `decoding="async"`。
- 把原 `warmImage`(仅远端、只 set src)替换为可注入的 [`warmDecode(url, createImage?)`](../../../src/lib/cover-warm-decode.ts):`Image` + `decoding="async"` + `img.decode()`(主线程外解码、reject/无 decode 静默、无 `Image` noop);[`usePreloadedCoverUrls`](../../../src/components/player/swipeable-media-stage.tsx) 远端 **和** 本地封面(`createObjectURL` 后)都 warm-decode 一次,使 coverflow `<img>` 命中已解码缓存。**保持原图。**

**Tasks(TDD):**
- [x] 先写 [`cover-warm-decode.test.ts`](../../../src/lib/cover-warm-decode.test.ts)(4 例,先红):set src+`decoding=async`+触发 `decode()`;`decode()` reject 不抛;无 `decode()` 仍 warm src;无 factory noop。
- [x] 实现 `warmDecode` 至绿 + 接入 `usePreloadedCoverUrls`(远端+本地);coverflow/backlight/CoverImage `<img>` 加 `decoding="async"`。

**Checklist:**
- [x] `cover-warm-decode`(4)绿;player 组件 105 例 + use-media/cover-image 15 例全绿;`tsc`/Biome 通过。
- [ ] **待实测(桌面)**:连切 6+ 首,coverflow 滑动 `frameMaxMs`/`fpsLow` 较修前改善;封面逐张可见无明显卡顿。

---

## 7. Out of Scope(交叉引用,本 PRD 不处理)

- **封面派生管线本身**(palette/thumbnail/backlight worker 化、render-by-reference、repair UX):见 [`20260613-muzero-cover-render-pipeline-performance-prd`](../20260613-muzero-cover-render-pipeline-performance-prd/20260613-muzero-cover-render-pipeline-performance-prd.md)。本 PRD 只「在落定后触发」它,不改它的内部实现。
- **系统歌单 live query / `useMemo`(O4)**:属 system-playlists 范畴;复核里记为回归放大器,单独跟进。
- **默认合成值翻转(O2:`visualizerBackgroundOpacity`/`Dim`)**:属可视化 tuning,单独评估。
- **托盘 IPC 每切歌重建(O3)**:属 system-tray PRD。
- **WebGPU 在可视化频谱 / 流光 scene(twgl)层的启用**:本 PRD 只覆盖 Pixi 环境背景;可视化 registry 的后端是另一摊。

---

## 8. Security / 本地优先

- 无新增出站请求、无后端、无遥测(遵守硬规则 1)。
- 后端偏好仅存 `settings` 行(设备本地),非隐藏 flag(硬规则 3)。
- codename 层不变(无表名/id 前缀/provider 改动,硬规则 4)。

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [`.logs/main-vs-cfab016b-switch-jank-audit-followup.md`](../../../.logs/main-vs-cfab016b-switch-jank-audit-followup.md) | 本特性的根因复核(校正 + 遗漏 + 杠杆排序) |
| [`.logs/main-vs-cfab016b-switch-jank-audit.md`](../../../.logs/main-vs-cfab016b-switch-jank-audit.md) | Codex 原始切歌掉帧审计 |
| [cover-render-pipeline-performance PRD](../20260613-muzero-cover-render-pipeline-performance-prd/20260613-muzero-cover-render-pipeline-performance-prd.md) | 封面派生管线(本 PRD 的上游,负责重计算本身) |
| [immersive-flow-background PRD](../20260611-muzero-immersive-flow-background-prd/) | 流光层取色,消费同一封面调色板 |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | settle 时长用 180ms 复用还是独立可调? | ✅ Resolved | 独立常量 `BACKGROUND_EFFECT_SETTLE_MS`(初值 180,语义解耦),**不**暴露为用户设置(§3.2) |
| 2 | 即时 `<img>` 层落定后淡出还是常驻底层? | ✅ Resolved(QA#3 修正) | **上层 reveal + 淡出**:`<img>` `z-10` 在 canvas `z-0` 之上,纹理就绪后淡出漏出特效(不 pop)。早先「常驻底层」会被不透明 canvas 完全遮住,失效(§5.1) |
| 5 | QA#1:切歌**按键瞬间**就掉帧,且**省电预设(无 Pixi)同样掉** | ✅ Resolved(trace 实证) | **trace 实测**:`background.pixi` 全程仅 1 条 `textureSwap`(burst 结束后)、**0 条 `appInit`** → 与 Pixi 无关。真因:连切 11 首时每首都被**多个封面消费者解码整张封面**(`cover.render` 6~8×/首 + `object-url-miss` ~860KB/首),`heapMb` 183→311(+128MB)、`longTaskMaxMs` 83ms → **GC 长任务掉帧**;burst 一停 fps 立刻回 120。**修法:ambient 背景按 settledTrack 去抖**(§5.3),跳过的歌不再解码封面/重渲染 |
| 6 | QA#2:落定后 Pixi 仍掉帧——是否 app 反复 re-init? | ✅ Resolved(trace 否定) | trace 证明**没有 re-init**(0 `appInit`),settle 去抖也生效(1 `textureSwap`)。落定那一刻的小掉帧来自该首封面解码 + 纹理上传(slow cover 见 `cover.preload.batch lastMs 249ms`),非 Pixi 机制问题 |
| 7 | QA:连切后封面与标题错位(放 B 显示 A 封面) | ✅ Resolved | 顶层 reveal veil 渲染了 `useTrackCoverResource` 的 **stale-while-pending** URL(blob 未 resolve 时回退上一张)。已移除 veil;ambient 背景去抖到 settledTrack → 背景只显示落定那首,不再串号。中央 stage 封面仍跟随实时 index(短暂 stale-while-pending 由其 crossfade 吸收) |
| 3 | auto 是否也把 `powerPreference` 提到 high-performance? | ✅ Resolved | **是**。新增 `backgroundGpuPowerPreference`,auto→`high-performance`;后端与性能档都默认 auto=选性能好的,可手动覆盖(§3.1 / §5.2 / Phase 3) |
| 4 | WebGPU 的 device-lost 恢复路径? | ✅ Resolved | `device.lost`(非 destroyed)+ `webglcontextlost/restored` → 有限次重建 + 回灌纹理,恢复期回退 `<img>`(Phase 3) |
| 8 | QA#4:ambient 已稳但快切仍 120→56 FPS(`longTask 283ms`) | 🔲 定位完成,Phase 4/5 修复中 | 剩余两处主线程整图解码:**(A)** coverflow/stage 读实时 index 解码原图(设计);**(B)** Pixi `Texture.from(<img>)` 转 canvas。**保持原图**,Pixi 走 ImageBitmap(线程外、免 canvas)+ `<img>` 异步解码。`frameMaxMs 6374.8` 是 visibilitychange 空档,非卡顿。详见 §6 QA#4 |
| 9 | #4-A 是否把 coverflow 也降采样到 512px 派生? | ✅ Resolved(用户拍板) | **否**。用户要求**保持原图**;只把解码移出主线程(ImageBitmap / 异步 decode),不引降采样派生(那是 cover-quality PRD 的 Phase 3) |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-13 | Claude | 初稿:持久化 Pixi + 切歌 settle 闸门 + GPU 后端可选 |
| 2026-06-13 | Claude | 拍板 4 个 Open Question:独立 settle 常量(不暴露)、`<img>` 常驻底层、新增性能档 auto→高性能、device-lost best-practice 恢复 |
| 2026-06-13 | Claude | Phase 1 代码完成:`pixi-background-controller`(DI + 持久 app + 纹理热替换)+ 组件重构 + 6 例单测;切歌不再重建 WebGL App。待桌面 GPU/视觉实测 |
| 2026-06-13 | Claude | Phase 2 代码完成:`useSettledValue` 去抖(纹理上传 debounce)+ 常驻即时 `<img>` + O1 backlight gate;9 例新单测。封面逐张即时、重计算落定才跑 |
| 2026-06-13 | Claude | Phase 3 代码完成:`gpu-backend` 解析器(9 例)+ `backgroundGpuBackend`/`PowerPreference` 设置(默认 auto=性能优先)+ Settings 双选择器 + en/zh/ja/ko + 控制器 `recover()` device-lost 恢复(2 例)。三个 Phase 代码全部完成,待桌面 GPU/视觉实测 |
| 2026-06-13 | Claude | QA 跟进:#3 修正 `<img>` 为上层 reveal+淡出(消除特效 pop);为 #1/#2 加 `background.pixi.appInit/textureSwap(ms)` 诊断 trace(`Settings→Trace`/perf HUD 可见)。#1/#2 根因待 QA 抓 trace 确认(§9 Q5/Q6) |
| 2026-06-14 | Claude | QA#3 二次修正:reveal veil 提到 flow/visualizer 之上的最顶层——之前放 Pixi 子树内仍被 flow/viz 盖住,故「还会跳」 |
| 2026-06-14 | Claude | **QA trace 实证 + 重定向**:trace 证明 Pixi 无 re-init、settle 生效(Q5/Q6),#1 真因是快切时**每首封面被多消费者解码 → 堆 churn → GC 掉帧**。**移除顶层 reveal veil**(引入封面错位 + 加剧解码)。改为 **ambient 背景按 settledTrack 去抖**:跳过的歌不再解码封面/重渲染,同时修掉封面错位 |
| 2026-06-14 | Claude | **QA#4 第二轮 trace + 新增 Phase 4/5**:ambient 去抖已稳(burst 仅 1 `textureSwap`/0 `appInit`),但快切仍 120→56 FPS、`longTask 283ms`。定位剩余两处主线程整图解码:(A) coverflow/stage 读实时 index 解码原图、(B) Pixi `Texture.from(<img>)` 转 canvas。用户拍板**保持原图**,新增 Phase 4(背景纹理 ImageBitmap,线程外解码+免 canvas)、Phase 5(stage/coverflow `<img>` 异步解码)。`frameMaxMs 6374.8` 判定为 visibilitychange 空档非卡顿 |
| 2026-06-14 | Claude | **Phase 4 代码完成**(TDD):新增 `background-texture.ts` `loadImageBitmapSource`(注入 fetchBlob/createImageBitmap,5 例单测先红后绿)+ `pixi-pixel-background` `loadBackgroundMedia` 优先 ImageBitmap(`fetchTextureBlob` 走 bridge,失败回退 `<img>`)+ 控制器 element 联合放宽 + 1 例 ImageBitmap 控制器测试(直传不转 canvas、swap/destroy close)。查 Pixi 文档确认 `ImageSource` 直接吃 ImageBitmap;未用 `Assets.load`(绕过 getAppFetch CORS + 纹理生命周期冲突)。14 例全绿、`tsc`/Biome 通过 |
| 2026-06-14 | Claude | **Phase 5 代码完成**(TDD):新增 `cover-warm-decode.ts` `warmDecode`(可注入 Image,4 例先红后绿)替换原 `warmImage`,`usePreloadedCoverUrls` 远端+本地封面均 off-thread 预热解码;coverflow/backlight/`CoverImage` `<img>` 加 `decoding="async"`(保持原图,解码移出 paint 主线程)。player 105 + use-media/cover-image 15 + warmDecode 4 全绿;`tsc`/Biome 通过。**Phase 4/5 代码全部完成,待桌面 GPU/视觉实测** |
