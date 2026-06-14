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
| 6 | 切歌 trace 仪表(逐首叙事:index/sourceKind/hasCover + 统计 flush)(诊断) | ✅ 代码完成(待抓 trace) | [Phase 6](#phase-6-切歌-trace-仪表) |
| 7 | 切歌限速(长按 next/prev 节流 ~5/s,治 firehose 错位)(#错位) | ✅ 代码完成(待实测) | [Phase 7](#phase-7-切歌限速) |
| 8 | 单一时钟:封面/背景/背光同源 live index(根治错位,QA#7) | ✅ 代码完成(待实测) | [Phase 8](#phase-8-单一时钟统一) |
| 9 | Pixi 背景换纹理分段 trace(新 log:QueuePanel 已排除,归因仍需拆段) | ✅ 代码完成(待抓 trace) | [Phase 9](#phase-9-pixi-背景换纹理分段-trace) |
| 10 | 保持 Pixi controller 穿过 streamed/local-cover URL pending 窗口 | ✅ Completed(trace verified) | [Phase 10](#phase-10-保持-pixi-controller-穿过-url-pending-窗口) |
| 11 | local-cover 协议 URL pending 时跳过 blob fallback | ✅ 代码完成(待 trace 验证) | [Phase 11](#phase-11-local-cover-协议-url-pending-时跳过-blob-fallback) |
| 12 | local-cover pending 时硬阻断上一帧 settled Pixi target | ✅ 代码完成(待 trace 验证) | [Phase 12](#phase-12-local-cover-pending-时硬阻断上一帧-settled-pixi-target) |
| 13 | local-cover liveQuery stale row guard | ✅ Completed(trace verified) | [Phase 13](#phase-13-local-cover-livequery-stale-row-guard) |
| 14 | coverflow/local cover preload burst jank | ✅ Completed(trace verified) | [Phase 14](#phase-14-coverflowlocal-cover-preload-去抖与可归因) |
| 15 | Pixi background texture downsample / decode budget | ✅ 代码完成(待 QA trace) | [Phase 15](#phase-15-pixi-background-texture-降采样预算) |
| 16 | Pixi ImageBitmap load substage trace | ✅ Completed(trace verified) | [Phase 16](#phase-16-pixi-imagebitmap-load-分段归因-trace) |
| 17 | Reuse fetched texture bytes for ImageBitmap header sizing | ✅ 代码完成(待 QA trace) | [Phase 17](#phase-17-reuse-fetched-texture-bytes-for-imagebitmap-header-sizing) |
| 18 | Abort stale Pixi background texture loads | ✅ Completed(trace verified) | [Phase 18](#phase-18-abort-stale-pixi-background-texture-loads) |
| 19 | Pixi texture load settle gate before fetch/decode | ✅ Completed(trace verified) | [Phase 19](#phase-19-pixi-texture-load-settle-gate-before-fetchdecode) |
| 20 | Delay non-current local cover preload reads during switch bursts | ✅ 代码完成(待 QA trace) | [Phase 20](#phase-20-delay-non-current-local-cover-preload-reads-during-switch-bursts) |
| 21 | Feed Pixi ambient cover from small derivative | ✅ 代码完成(trace verified) | [Phase 21](#phase-21-feed-pixi-ambient-cover-from-a-small-derivative-instead-of-the-local-original) |
| 22 | Stop active full-cover decode on Now Playing stage | ✅ 代码完成(trace verified) | [Phase 22](#phase-22-stop-active-full-cover-decode-on-the-now-playing-stage-and-trace-image-loaddecode) |
| 23 | Skip unused full-cover background decode when Pixi uses derivative | ✅ 代码完成(待 QA trace) | [Phase 23](#phase-23-skip-unused-full-cover-background-decode-when-pixi-uses-derivative) |
| 24 | Replace stage/dock preflight Image with DOM image load gate | ✅ 代码完成(待 QA trace) | [Phase 24](#phase-24-replace-stagedock-preflight-image-with-dom-image-load-gate) |

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

**实现(落地,经 QA#5 A/B 修正):**
- coverflow `TrackVisual` 封面 `<img>` + backlight `<img>`([`swipeable-media-stage.tsx`](../../../src/components/player/swipeable-media-stage.tsx)) + 共享 stage/library 封面([`cover-image.tsx`](../../../src/components/ui/cover-image.tsx) `CoverImage`)补 `decoding="async"`(**保留** —— 浏览器在 paint 时异步解码,廉价、无副作用)。
- **`warmDecode`(强制 `img.decode()` 预热)已回退**:见 QA#5。快切 burst 中它对每张新进缓存的封面强制整图解码(~939KB→解码 ~8–16MB 并被浏览器保留),~15 张新封面 → 堆 +227MB → GC 长任务 → FPS 104→27。改回原 `warmImage`(仅远端、只 set `src`、**不**强制 decode);本地封面不再预热(对象 URL 已在 `coverUrlCache`,paint 时解码即可)。删 `cover-warm-decode.ts`/test。

**Tasks:**
- [x] coverflow/backlight/`CoverImage` `<img>` 加 `decoding="async"`(**保留**)。
- [x] ~~`warmDecode` 预热解码~~ **回退**(QA#5):改回 `warmImage`(remote 仅 set src,不强制 decode),本地不预热;删 `cover-warm-decode.ts`/test。

**Checklist:**
- [x] `tsc`/Biome 通过;swipeable-media-stage(6)绿;无残留 `cover-warm-decode` 引用。
- [ ] **待抓 trace 验证(A/B)**:回退后连切带封面歌,堆不再 +200MB 暴涨、`longTask`/`fpsLow` 改善。

### QA#5(2026-06-14 第三轮 trace):heap churn 才是带封面快切的主凶,`warmDecode` 是放大器

带 Phase 4/5/6 的 build 实测连切(`playIndex` 已带 `hasCover:true`/`sourceKind:blob` —— 全是带封面本地 blob):**`fpsAvg 104→27`、`heapMb 289→516`(+227MB)、`longTaskMax 166ms`**,burst 停后回升。signature 是**内存暴涨 → GC 长任务**,非落定单帧。

- **量化吻合**:burst 中 `blobsCreated +15`(~15 张新封面 cache-miss),`cover.render.object-url-miss bytes:939170`(整图 ~939KB → 解码 ~8–16MB/张)→ 15×~15MB ≈ **+225MB**,与 heap +227MB 吻合。多数封面是 `cache-hit`(不重解),代价集中在这 ~15 张**新封面的整图解码 + 保留**。
- **Phase 4 已生效**:全程**无** `ImageSource … converting to canvas` 警告(对比前几轮)。
- **`warmDecode` 是放大器**:它对每张新进 `coverUrlCache` 的封面强制 `img.decode()`(整图、立即、浏览器保留解码结果),把「paint 时惰性解码(跳过的歌常常不解)」变成「每张缓存封面都立即整图解码并保留」→ 喂大 heap。**→ A/B 回退**(本 Phase 5 修正)。
- **根因仍是整图解码内存**:用户此前要求保持原图(不降采样)。但 QA#5 的内存账(~15MB/张 × N)表明**整图解码的内存**已是 binding constraint。回退 `warmDecode` 是第一步;若仍不足,需重开「stage/coverflow 用 512px 派生」(decode 内存 ~16×↓)的决定(归 cover-quality PRD Phase 3,见 Out of Scope)。

### Phase 6: 切歌 trace 仪表

**Goal:** 让一次切歌在 trace 里读成「逐首叙事」,把用户实测(**无背景特效** 120→115 / low≈30;**带封面** 120→60 / low 9~20)拆到每次切歌,确认开销归属。诊断性改动(不改性能行为),用现有 prod-silent 的 `log.debug` / `createDiagnosticLogger`,无隐藏 flag。

**归因(现有 + 新增 trace 实证):**
- **Q1 play index**:[`player.playIndex`](../../../src/stores/player-store.ts) 现补 `sourceKind`/`hasCover`/`from`/`to`/`kind`/`origin`(纯 helper [`describeTrackSwitch`](../../../src/player/switch-trace.ts))。一眼区分「**带封面**切歌(走解码/上传管线 → 掉帧)」vs「**无封面**切歌(廉价基线)」。
- **Q2 播放统计**:[`flushPlaybackListen`](../../../src/stores/player-store.ts) 现 emit `player.playback listen.flush`(trackId / listenedSec / counts)。证实统计写库**异步、离帧**:`flush` 是内存累加,`recordPlaybackListen` 被 `void` 掉(异步);快切时中间歌 `listenedSec≈0` → 不计 play、不写库(trace `dbRequeries:0` 佐证)→ **非切歌帧开销**。
- **Q3 背景/封面**:已有 `cover.render`(cache-hit/miss + `object-url-miss` bytes)、`cover.preload.batch`、`background.pixi textureSwap` 覆盖了“是否发生”。但 QA 新 log 证明它**不足以归因**:copy trace 的格式化层丢了 `textureSwap` context,且 Pixi 没拆 `media.load` / `Texture.from` / `resize+render`。→ Phase 9 补分段 trace。
- **基线(无封面 low≈30)**:来自切歌时 now-playing 树(歌词 / identity / coverflow 脚手架)的一次 React 重渲染(单帧 ~33ms),非 store / 统计;`performance.frame frameMaxMs` 已可见。Phase 4/5 落地后,带封面那档的 AVG/low 应向无封面档收敛。

**Tasks(TDD):**
- [x] 纯 helper [`describeTrackSwitch`](../../../src/player/switch-trace.ts)(4 例先红后绿:带 blob 封面 / 仅远端封面 / 无封面 / 空选区)。
- [x] `playIndex` 用其 enrich 日志;`flushPlaybackListen` 加 `listen.flush` trace。

**Checklist:**
- [x] `tsc`/Biome + switch-trace(4)+ player-store(17)全绿。
- [ ] **待抓 trace 验证**:带封面切歌行 `hasCover:true` 与紧随的 `cover.preload.batch`/`textureSwap` 大 ms + fps 掉帧对齐;无封面切歌 `hasCover:false` 仅基线小掉;快切时 `listen.flush counts:false` 且 `dbRequeries:0`。

### Phase 7: 切歌限速

**Goal:** 长按 next/prev(OS key-repeat ~30/s)远超 ~180ms 的 settle 窗口 → 封面与背景各自 settle 到**不同的中间曲** = QA#6 错位 bug;且每次按键都付一次封面解码。限速到 **~5/s** 让管线追得上(封面+背景同步、不错位)、每张封面**看得清**(用户靠封面认歌)、按键开销坍缩一个量级。用户拍板「设切换速度上限」。

**QA#6(错位 bug)根因:** 多层 async/settle 各自按自己的时钟收敛——`useSettledValue(currentIndex)`(180ms)→ `useLocalCoverUrl`/`useTrackCoverUrl`(async,stale-while-pending)→ `settleBackgroundTarget`(pending 时保留当前帧)→ Pixi 再 `useSettledValue(src)`(180ms)。每层 guard 单独正确,但 33/s 远快于 180ms,松手时某一层会卡在**中间曲**的 URL,另一层已到最终曲 → 封面/背景其一对不上。**限速到切歌间隔 > settle 窗口**即根除(管线每次都收敛完才接下一次)。

**实现(落地):**
- 纯 throttle 工厂 [`createTransportThrottle(minMs, clock)`](../../../src/shortcuts/transport-throttle.ts):**leading + trailing**——首按即发(单次切歌零延迟),冷却内的连按合并、**trailing 保证松手那次必落**(不会早停一首);clock 注入,确定性单测(4 例)。`TRANSPORT_SWITCH_MIN_INTERVAL_MS=200`(~5/s,> 180ms settle)。
- 接进 [`shortcuts/actions.ts`](../../../src/shortcuts/actions.ts):`playback.next`/`playback.prev` 走 throttle(只节流**键盘** firehose;swipe/按钮/托盘/programmatic 的 `next()` 契约不动 —— 选这里而非 store,既避开 `player-store` 又不改 async 契约)。
- 副作用红利:200ms 间隔 > 180ms 背景 settle → 背景 settle 现在**每次切歌都 emit**(而非只在停下时)→ 背景跟着切了(用户诉求);只是仍滞后 ~180ms,**收紧同步留作后续**(throttle 已 bound 速率,可降 settle)。

**Tasks(TDD):**
- [x] `transport-throttle.test.ts`(4 例先红后绿):首call即发、burst 合并为 leading+trailing(最后一次)、冷却后再即发、30Hz key-repeat 坍缩到 ~5 次。
- [x] 接 `actions.ts` next/prev;`actions.test.ts`(单次 dispatch 走 leading 即发)仍绿。

**Checklist:**
- [x] `tsc`/Biome 通过;transport-throttle(4)+ actions + system-shortcuts 全绿。
- [ ] **待实测**:长按 E 以 ~5/s 平稳切歌、每张封面可见、背景跟着变、松手后封面/背景与歌一致(无错位)。

**后续(未做,本 PRD 跟进):** ① **512px 派生**(用户已拍板)—— 单次切歌仍 +48MB/66ms 整图解码,降采样治本(归 cover-quality PRD Phase 3);② 收紧背景同步(降 settle,让背景与封面**同时**变而非滞后 180ms)。

### Phase 8: 单一时钟统一

**Goal:** 根治「封面 / 背景 / 背光显示不同曲」(QA#7)。根因:now-playing 有 **3+ 个各自独立的「当前曲」时钟**——封面+背光读 store **live** `currentIndex`([media-stage.tsx:35-53](../../../src/components/player/media-stage.tsx#L35));背景走 `useSettledValue`(180ms 延迟);Pixi 再叠一层 `useSettledValue(src)`;coverflow overlay 还有自己的状态机。没有任何机制强制它们「一起切」,所以快切后某一层卡在中间曲 → 错位。**唯一确定性保证 = 全部读同一个 live index,一起切**(throttle 已 bound 速率,跟 live 不再 flood)。用户拍板「类似 live index」。

**实现(落地):**
- [`now-playing-background.tsx`](../../../src/components/player/now-playing-background.tsx):`currentIndex` 从 `useSettledValue(liveCurrentIndex, …)` 改为直接读 store `currentIndex`(与 stage cover/backlight 同源);删 `useSettledValue`/`BACKGROUND_EFFECT_SETTLE_MS` import。
- [`pixi-pixel-background.tsx`](../../../src/components/player/pixi-pixel-background.tsx):纹理 effect 从 `setSource(settledSrc)` 改为 `setSource(src)`(跟封面同步换),删第二层 settle。
- 结果:封面(live)+ 背光(live,同 `current`)+ 背景(现 live)+ Pixi 纹理(现 live)= **全部同一 `currentIndex`** → 结构上不可能显示不同曲。`settleBackgroundTarget`(URL pending 时保留当前帧、防闪)保留 —— 那是 stale-while-pending、按解析自纠,非时钟分叉。

**为何不再需要原 settle:** 原 settle 是为了在 33/s firehose 下不给跳过的歌上传纹理(Phase 2)。Phase 7 throttle 已把速率压到 ~5/s,跟 live 的纹理上传次数 = 每次(节流后的)切歌一次,与原 settle emit 次数相同(throttle 200ms > settle 180ms,原本就每切歌 emit)——**所以去掉 settle 只消除「滞后」、不增加上传频率**(FPS 不变,正确性修好)。

**Tasks:**
- [x] 背景 + Pixi 改读 live `currentIndex`/`src`;删两处 settle + import。
- [x] now-playing-background / pixi-controller / swipeable 测试(18)全绿;`tsc`(本改动文件)/Biome 通过。

**Checklist:**
- [ ] **待实测**:快切 + 松手后,封面 / 背景 / 背光 **始终同曲**(无错位);背景与封面**同时**换(不再滞后 180ms)。

**后续(本 PRD 跟进):** ① **512px 派生**(用户已拍板,下一步)—— QA 实测「全 cache-hit 封面」下 heap 仍 +112MB/FPS→31,因 Pixi 每次切歌对**整图**重跑 `createImageBitmap`(~8–16MB),降采样治本;② (用户提的)切歌时**音频 fade out** 让声音也跟着切(当前音频 debounce、松手才载最终曲)—— 独立 audio transport 改动,后续评估。

### QA#8(2026-06-14 新 trace):QueuePanel 已排除,掉帧命中全局背景/Pixi

用户提供的新 trace 覆盖一次带封面本地 blob 快切。结论:这组 `AVG 120→70` / `fpsLow≈10` **不是 QueuePanel / system playlist**。

- **QueuePanel 信号缺席**:`queuePanel` / `systemPlaylist` 相关行 = 0。抽屉/system playlist work 没参与这次 jank;这也印证 queue/search PRD 里的「抽屉关闭切歌 baseline」要把背景成本单独扣出来。
- **切歌输入**:`playIndex` 8 次,全部 `sourceKind:"blob"` + `hasCover:true`;中间 `discard stale playback load` 7 次,说明音频加载被快切 supersede,但背景/封面管线仍在响应切歌。
- **背景信号活跃**:`background.pixi textureSwap` 12 次,`textureSwap.stale` 3 次。掉帧与 tab 无关,因为 [`NowPlayingBackground`](../../../src/App.tsx) 是固定全局层,tab 1 / tab 2 共享同一背景管线。
- **封面缓存不是主因**:`cover.render cache-hit` 59 次,`object-url-miss/cache-miss` 0;`cover.palette.track-metadata` 8 次,无 `cover.palette.start/success`,说明本轮没有现场 palette 抽取,也没有新建封面 object URL。
- **性能签名**:`fpsAvg 74.5→58.1→47.4→40.4`, `fpsLow≈10`, `frameMaxMs≈100`, `longTaskMaxMs≈198`;heap `167MB→390MB`(+223MB)。这像是整图解码/ImageBitmap/GPU texture upload/合成器压力或相关 GC,而不是 DB / 全库派生。
- **观测缺口**:trace 里只能看到 `background.pixi textureSwap textureSwap`,看不到已有 context 里的 `ms/mediaType/appInits` 等字段。根因不是 logger 没写,而是 [`formatTraceEntries`](../../../src/lib/trace.ts) 导出时只打印白名单字段,把自定义 perf context 丢了。

### Phase 9: Pixi 背景换纹理分段 trace

**Goal:** 不改变渲染行为,只把一次 Pixi 背景换纹理拆成可归因的 trace 段,让下一份 QA log 能回答“卡在取源/解码、Texture.from/GPU 上传、还是 resize/render/合成”。

**实现(落地):**
- [`trace.ts`](../../../src/lib/trace.ts):`formatTraceEntries()` 现在会在标准字段后输出所有已脱敏的自定义 context,例如 `mediaType=image loader=imageBitmap durationMs=42 loadMs=31 textureMs=4 renderMs=7 width=1600 height=1600`。这修复了 QA copy trace 中 `textureSwap` 只有事件名、没有耗时的导出缺口。
- [`pixi-background-controller.ts`](../../../src/components/player/pixi-background-controller.ts):`setSource()` 新增分段事件:
  - `background.pixi textureSwap.start`:每次换源开始,带 `sourceKind`(blob/data/http/muzfetch/other,不记录 raw URL)、`mediaType`、`swapSeq`。
  - `background.pixi media.load`:`deps.loadMedia` 耗时,带 `loader`、`bytes`、`width/height`。
  - `background.pixi texture.create`:`Texture.from` 或预建 texture 耗时,带 `textureSource=fromElement/prebuilt`。
  - `background.pixi textureSwap.apply`:sprite 替换、旧纹理释放、视频 attach、`resize()+render()` 耗时,带 `applyMs/renderMs`。
  - `background.pixi textureSwap`:最终汇总,带 `durationMs/loadMs/textureMs/applyMs/renderMs/appInits/textureSwaps`。
  - `textureSwap.stale` 同步补 `phase=skip` + `durationMs/loadMs/textureMs`,用于看快切废弃的背景工作是否仍然昂贵。
- [`background-texture.ts`](../../../src/lib/background-texture.ts):ImageBitmap loader 返回 `bytes/mime`,供 Pixi trace 标出本次整图源大小。

**Tasks(TDD):**
- [x] `trace.test.ts` 先红后绿:copy trace 必须输出自定义 structured context(`mediaType/loader/durationMs/loadMs/textureMs/renderMs/width/height`)。
- [x] `pixi-background-controller.test.ts` 先红后绿:一次 `setSource()` 必须 emit `textureSwap.start` / `media.load` / `texture.create` / `textureSwap.apply` / `textureSwap` 五段,并在 summary 带分段 ms 与尺寸/bytes。
- [x] `background-texture.test.ts`:ImageBitmap source 携带 `bytes/mime`。

**Checklist:**
- [x] `trace.test` / `pixi-background-controller.test` / `background-texture.test` 通过。
- [ ] **待抓 trace 验证**:下一轮 QA log 中,若 `loadMs` 高且 heap 增长 → decode/bitmap 源;若 `textureMs` 高 → Pixi/GPU upload;若 `renderMs/applyMs` 高 → resize/render/合成;若 `textureSwap.stale` 多且 ms 高 → 快切废弃工作仍需取消/降采样/限速。

### QA#9(2026-06-14 Phase 9 trace):真正的大头是 `appInit` 重新发生

用户提供的新 trace 已带 Phase 9 分段字段,结论比上一轮更明确:现在不是 `Texture.from` / render 重,而是 **Pixi App 在每次切歌重新 init**。

- **QueuePanel 继续排除**:本 trace 无 `queuePanel` / `systemPlaylist` 行。开头有 `listAllTracks requery` / `trackPlaybackStats requery` / `memoryNotesByTrack requery`,但发生在切歌前的既有 liveQuery 窗口,且无 queuePanel span。切歌后的 `trackPlaybackStats requery` 来自 `listen.flush` 统计写入,不是本次主帧开销。
- **第 1 次切歌(index 19→4)**:
  - `textureSwap.start` 10:29:14.835
  - `appInit backend=webgpu ms=853`
  - `media.load loader=imageBitmap bytes=398098 width=2000 height=2000 durationMs=73.3`
  - `texture.create durationMs=0.1`
  - `textureSwap.apply applyMs=5.1 renderMs=4.9`
  - summary `durationMs=931.9`,其中绝大多数是 app init。
- **第 2 次切歌(index 4→5)**:
  - `appInit ms=307`
  - `media.load durationMs=447.5`(ImageBitmap/fetch/decode 完成时间,不等同主线程全阻塞)
  - `texture.create=0`, `renderMs=1.6`
  - summary `durationMs=756.8`。
- **关键异常**:`swapSeq=1` 且 `appInits=1` 在两次切歌都从头开始,说明 `PixiPixelBackground` 的 controller 被卸载/重建了。Phase 1 的“持久 Pixi App,切歌只换 texture”不再成立。
- **根因推断(来自当前代码形态)**:streamed/local-cover 切歌时,为了避免 stale cover,`holdCoverBackgroundWhileLoading=false`;于是 cover URL pending 期间 `hasPendingImageBackground=false`,条件渲染 `(renderPixiTarget || hasPendingBackground) && pixiEffect` 变 false → `PixiPixelBackground` unmount → controller destroy → 下一张封面 ready 后 remount → `appInit`。

### Phase 10: 保持 Pixi controller 穿过 URL pending 窗口

**Goal:** streamed/local-cover 的新封面 URL pending 时,不要把 Pixi controller 卸载。视觉上仍然不喂 stale cover、不显示上一首背景;生命周期上让 controller 保持 mounted,下一张 URL ready 后只 `setSource()` 换纹理。

**实现(落地):**
- `now-playing-background.tsx`:
  - 引入 `hasPotentialImageBackground` / `shouldKeepPixiMounted`:当 `pixiEffect` 存在且当前 track 有潜在 Pixi source(例如 `source==="cover" && trackHasCover(current)`)时,即使 `renderPixiTarget` 暂时为 null,也继续挂载 `PixiPixelBackground`。
  - pending 且无 `renderPixiTarget` 时传 `src=null` 并把 Pixi host 设为 `opacity-0`,避免显示上一首 stale canvas。
  - target ready 后传真实 `src`,class 回到 `opacity-90`;controller 不重建,trace 应只出现 `media.load` / `texture.create` / `textureSwap.apply`,不再出现每首 `appInit`。
- 保持 stale 防护:不要把 `coverResource.url` 与 `targetKey` 不匹配的旧 URL 喂进 Pixi。

**Tasks(TDD):**
- [x] 给 `now-playing-background.test.tsx` 加一例:streamed/local-cover URL pending 时仍 mount Pixi shell,`src=null`,且不使用 stale URL。
- [x] 切到下一首 URL ready 后同一个 Pixi shell 接收新 `src`(无条件卸载)。
- [x] QA trace 验收:连续切歌时无独立 `background.pixi appInit` 事件;summary 里的 `appInits=1` 保持稳定,`swapSeq` 从 10 递增到 16。

**Checklist:**
- [x] `now-playing-background.test.tsx` 6 例通过。

### QA#10(2026-06-14 Phase 10 trace):App init 修好后,大头转为重复整图 decode

用户提供的新 trace 验证了 Phase 10 的生命周期修复,也暴露了下一层成本:

- **Phase 10 生效**:本轮 trace 无独立 `background.pixi appInit` 行;`textureSwap` summary 中 `appInits=1`,且 `swapSeq` 连续递增 `10 → 16`,说明 Pixi controller 不再在每首歌切换时 destroy/re-init。
- **QueuePanel/DB 继续排除**:无 `queuePanel/systemPlaylist` trace;`dbRequeries=1` 基本稳定。
- **掉帧仍存在**:`fpsAvg 113.7 → 86.1 → 69.9 → 31`, `fpsLow=2.4`, `frameMaxMs=408.4`, `longTaskMaxMs=696`,heap 曾到 `375MB`。
- **新主因是同一封面的重复 decode**:10:43:01.415 `textureSwap.start sourceKind=blob swapSeq=10`,10:43:01.907 又出现 `sourceKind=muzfetch swapSeq=11`;两者指向同一张 `16,569,025 bytes / 3000×3000` 封面。`blob` 这次 `media.load durationMs=1410.3` 后 `textureSwap.stale`,随后 `muzfetch` 又 `media.load durationMs=1105.8` 并成功上屏。`texture.create=0~0.1ms`,`renderMs=5.2ms`,所以不是 GPU upload/render 主导,而是取源/解码主导。
- **代码层推断**:[`useLocalCoverUrl`](../../../src/hooks/use-local-cover.ts) 之前只能返回 `string|null`,`null` 同时表示“协议 URL 还在 resolve”和“不可用”;[`now-playing-background.tsx`](../../../src/components/player/now-playing-background.tsx) 因此在 `localCoverUrl` resolve 前先调用 `useTrackCoverResource(current)` 启动 `blob:` object URL,随后 `muzfetch:` ready 又触发第二次纹理交换。

### Phase 11: local-cover 协议 URL pending 时跳过 blob fallback

**Goal:** 对 `electron-file` / local-cover 封面,协议 URL 仍在 pending 时不要启动 object URL fallback。Pixi shell 继续由 Phase 10 保持 mounted + hidden;待 `muzfetch:` URL ready 后只解码一次并换纹理。协议 URL 不可用或失败时再回退 object URL。

**实现(落地):**
- [`use-local-cover.ts`](../../../src/hooks/use-local-cover.ts):新增 `useLocalCoverResource()` 返回 `{ url, pending, pendingReason, canServe }`,用 `undefined/null` 区分 Dexie 行 pending 与查无此行,并用 `{ storageKey, failed, url }` 状态避免旧 URL 泄漏到新 track。
- [`now-playing-background.tsx`](../../../src/components/player/now-playing-background.tsx):当 `localCover.pending && !localCover.url` 时给 `useTrackCoverResource(undefined)`,不解析当前 track 的 object URL;`backgroundCoverUrl=null`,Pixi 保持 mounted 但 `src=null`/`opacity-0`。
- 新增 trace `background.cover localCover.wait category=performance phase=skip pendingReason=row|url fallback=object-url`,用于下一份 copy trace 证明 blob fallback 是否被跳过。

**Tasks(TDD):**
- [x] 新增 `now-playing-background.test.tsx`:local-cover URL pending、但 `coverResource` 已能给出 `blob:` 时,Pixi shell 仍 mounted hidden,`useTrackCoverResource` 不接收当前 track,不创建 `Image`,并 emit `background.cover localCover.wait`。
- [x] local-cover URL ready 后,同一个 Pixi shell 接收 `muzfetch:` `src` 并恢复 `opacity-90`,仍不走当前 track 的 blob fallback。
- [ ] QA trace 验收:同一首切歌不应再出现 `sourceKind=blob` stale 后紧跟同尺寸 `sourceKind=muzfetch`;预期只剩 `localCover.wait` → 单次 `textureSwap.start sourceKind=muzfetch`。

**Checklist:**
- [x] `now-playing-background.test.tsx` 7 例通过。

### QA#11(2026-06-14 Phase 11 trace):`localCover.wait` 之前仍启动了一次 blob decode

用户质疑“3000×3000 对现代电脑应该不大,即使解码两次也不该这么慢”,这个判断本身合理:问题不能只归因成“图片尺寸大”。新 trace 给出的更准确结论是:

- **不是单张图尺寸本身必然压垮机器**。3000×3000 JPEG 解成 RGBA 约 36MB,加上 ImageBitmap/纹理/旧纹理/浏览器 decode queue/GC,在 120Hz 的 8.3ms frame budget 里仍然可能造成 jank,但现代电脑通常应能处理离线吞吐。
- **真实异常是 stale 工作启动得太早且不可取消**:10:55:14.631 先 `textureSwap.start sourceKind=blob swapSeq=4`;10:55:14.728 才出现 `background.cover localCover.wait`;10:55:14.764 又 `sourceKind=muzfetch swapSeq=5`。也就是说 Phase 11 虽然让后续 render 知道要等协议 URL,但 [`useSettledBackgroundTarget`](../../../src/components/player/now-playing-background.tsx) 在同一次切换的首个 render 仍短暂返回上一帧 settled target,让 Pixi 先启动了 blob decode。
- **后果是 decode 队列被 stale 任务占住**:`blob` 3000×3000 `media.load=1325.1ms` 后 stale,`muzfetch` 同图 `media.load=1487.8ms` 后也 stale(因为用户已切到下一首),同时下一首 1440×1440 `blob` 成功 swap 也要 `loadMs=445.4ms`。这说明 `loadMs` 不是单纯 GPU 上传(`texture.create=0~0.2ms`,`renderMs=3.3ms`),而是取源/解码队列/内存压力主导。

### Phase 12: local-cover pending 时硬阻断上一帧 settled Pixi target

**Goal:** local-cover 协议 URL pending 期间,不仅不启动新的 object URL fallback,还要阻止 `useSettledBackgroundTarget` 残留的上一帧 target 在本次 render 被传给 Pixi。视觉上仍保持 Pixi shell mounted hidden,但 `src=null` 必须从切换首帧就生效。

**实现(落地):**
- [`now-playing-background.tsx`](../../../src/components/player/now-playing-background.tsx):新增 `suppressCoverTargetWhileLocalPending`,当 `source==="cover"`、Pixi 正在用 cover、且 `waitForLocalCoverUrl` 为 true 时,把 `renderImageTarget` / `renderPixiTarget` 外层压成 `null`。这绕过内部 settled state 的一帧滞后,让 Pixi 在 pending 首帧就收到 `src=null`。

**Tasks(TDD):**
- [x] 新增 `now-playing-background.test.tsx`:先让上一首 `blob:previous-cover` 成为 settled Pixi target,再切到 local-cover pending 的下一首;断言切换后的 Pixi render 历史不再包含上一首 `blob:`。
- [ ] QA trace 验收:`background.cover localCover.wait` 之前不应再出现同次切歌的 `textureSwap.start sourceKind=blob`;预期 pending 首帧直接 hidden/null,协议 URL ready 后才启动 `sourceKind=muzfetch`。

**Checklist:**
- [x] `now-playing-background.test.tsx` 8 例通过。

### QA#12(2026-06-14 Phase 12 trace):`localCover.wait` 仍晚于首个 blob start

新 trace 继续缩小了问题:

- **Phase 12 部分生效**:当 `localCover.wait` 已经发生后,后续会走 `sourceKind=muzfetch`。Pixi controller 仍保持稳定(`appInits=1`),没有回到 app-init churn。
- **但 wait 仍有时晚一帧**:例如 `trk_f783...` 在 10:59:16.213 切入,10:59:16.246 已启动 `textureSwap.start sourceKind=blob swapSeq=32`,到 10:59:16.442 才出现 `localCover.wait`。随后同一 16.5MB/3000×3000 图的 blob/muzfetch decode 仍都 stale。
- **更精确根因**:[`useLocalCoverResource`](../../../src/hooks/use-local-cover.ts) 用 `useLiveQuery(db.mediaBlobs.get(coverBlobId), [coverBlobId])`,但 Dexie/React 在 deps 切换后可能短暂保留上一条 `row`。旧代码只看 `row` 是否可 serve,没有校验 `row.id === coverBlobId`;如果拿到上一张 row,就会把当前 cover 误判为不需要等待或拿错 storageKey,让背景层首帧走 blob fallback。

### Phase 13: local-cover liveQuery stale row guard

**Goal:** `coverBlobId` 切换后,只接受 `row.id === coverBlobId` 的 mediaBlob 行。任何非空但 id 不匹配的 row 都视为当前 row pending,避免首帧误走 blob fallback 或取上一张 storageKey。

**实现(落地):**
- [`use-local-cover.ts`](../../../src/hooks/use-local-cover.ts):新增 `rowMatchesTrack = row?.id === coverBlobId`;`rowPending` 覆盖 `row === undefined` 和 `row !== null && !rowMatchesTrack`;`servableRow` 只从匹配当前 `coverBlobId` 的 row 派生。

**Tasks(TDD):**
- [x] 新增 `use-local-cover.test.tsx`:当当前 `coverBlobId=blb_current` 但 `useLiveQuery` 暂返 `blb_previous` electron-file row 时,`useLocalCoverResource` 返回 `pendingReason:"row"`,不调用 `localMediaUrlForStorageKey`,从而不允许背景层 blob fallback。
- [ ] QA trace 验收:local-cover track 的 `playIndex` 后不应再先出现同 track 的 `sourceKind=blob` 再 `localCover.wait`;wait 应在首帧就成立,然后只启动 `muzfetch` 或在 row 确认不可 serve 后合法 fallback blob。

**Checklist:**
- [x] `use-local-cover.test.tsx` 1 例通过。
- [x] `now-playing-background.test.tsx` 8 例通过。

### QA#13(2026-06-14 Phase 13 trace):local-cover 首帧已等 row,剩余掉帧转到 cover preload

11:03:55-11:04:01 新 trace 把问题继续分流:

- **Phase 13 验证通过**:切到 `trk_f783...` 时,11:03:59.065 `playIndex`,11:03:59.095 立即 `background.cover localCover.wait pendingReason=row`,11:03:59.198 进入 `pendingReason=url`。这说明 stale mediaBlob row 不再被当成当前 cover 使用;此前同一首 16.5MB/3000px 先 `sourceKind=blob` 再 `sourceKind=muzfetch` 的重复 decode 没有在这份 trace 复现。
- **Pixi 生命周期仍稳定**:`background.pixi textureSwap` 持续 `appInits=1`;没有回到 Phase 9/10 的 app re-init churn。`texture.create`/`renderMs` 仍是 0-3ms 级,不是 GPU app/init 或 shader 重编译。
- **仍然掉帧,但新的对齐点是 coverflow/local preload**:11:03:59.938 `cover.preload.batch lastMs=503 created=2 local=3 requests=3`,随后 11:04:00.260 FPS window 降到 `fpsAvg=46.9` / `fpsLow=7.5` / `frameMaxMs=133.4`,并且 image blob 计数升到 `created=24 live=18`。这比同窗口内 Pixi `swapSeq=7 loadMs=150.7` 更像剩余峰值的放大器。
- **当前 trace 仍缺一个字段**:`cover.preload.batch` 只告诉 batch 完成时的总量,没有区分 current/prev/next、cache-hit/object-url-created、effect 是否已 stale、是否与背景 Pixi 使用同一 cover key。因此下一步应先补可归因 trace,再决定是 latest-only、in-flight dedupe,还是在快速切歌期间只预加载 current cover。

### Phase 14: coverflow/local cover preload 去抖与可归因

**Goal:** 在快速切歌时,让 coverflow/local cover preload 不再为每个中间状态创建 2-3 个本地 cover object URL,同时补足 trace 能把 remaining jank 归因到 current/prev/next、stale/canceled、cache/inflight。

**Tasks(TDD):**
- [x] 为 `usePreloadedCoverUrls` 增加 latest-only / stale-before-work 测试:当 preload batch 尚未完成而 current index 再次变化时,旧 batch 不应继续创建新 object URL 或写入 state。✅ 新增 `cover-preload.test.ts` 覆盖 stale batch 在 blob resolve 后不创建 URL,且释放 `acquire()` 占位 ref。
- [x] 补 `cover.preload.batch` context:`stale/canceled`、`cacheHits`、`inflightHits`、`current/previous/next/stack/settle` request 分布、`maxSourceBytes`。✅ 不记录 raw cover key,只记录计数与最大源字节。
- [x] 评估并实现最小修复:✅ 抽出 `cover-preload.ts`;本地 cover preload 按 key 做 in-flight dedupe,相同 key 并发 batch 只 resolve/create 一次;hook 增加 batch sequence,stale batch 不再 set state 或创建 object URL。
- [ ] 如下一份 trace 证明 unique prev/next 才是主因:快速切歌窗口只预加载 current,prev/next 延后到 settle 后。
- [x] QA trace 验收:Phase 13 后的本地封面快切不再出现 `cover.preload.batch lastMs>300ms` 与 image `blobsCreated/live` 快速爬升;`fpsLow` 相对 Phase 13 trace 明显回升。✅ 11:35 trace 中 `cover.preload.batch` 为 `created=0`, `maxSourceBytes=0`, `cacheHits=0..3`, `lastMs≈14.8..27.6`;image blob 数稳定在 16 live。

### QA#14(2026-06-14 Phase 14 trace):preload 已收敛,剩余掉帧回到 Pixi ImageBitmap decode

11:35:20-11:35:25 最新 trace 证明 Phase 14 修复方向正确,但也把剩余大头推回 Pixi 背景纹理:

- **coverflow preload 已不再创建新 image blob**:`cover.preload.batch` 多次出现但均 `created=0`, `cropped=0`, `maxSourceBytes=0`;典型窗口为 `lastMs=14.8/23.4/27.6`,不再有上一轮 `lastMs=503 created=2 local=3`。image blob 计数也稳定:`blobsCreatedByKind.image=16`, `blobsLiveByKind.image=15`。
- **local-cover pending guard 仍有效**:每次 `playIndex` 后约 26-31ms 出现 `background.cover localCover.wait pendingReason=row`,没有回到“wait 晚于 blob start”的旧问题。
- **Pixi app 生命周期仍稳定**:`background.pixi textureSwap` summary 里 `appInits=1`, `swapSeq=11/12` 连续递增。`texture.create=0.1ms`, `renderMs=1.3-1.9ms`,所以不是 GPU app init / Pixi Texture.from / render 阶段。
- **剩余耗时集中在 `media.load`**:两次切歌分别 `media.load loader=imageBitmap bytes=257377 width=1500 height=1500 durationMs=172.1` 与 `bytes=70018 width=800 height=800 durationMs=254.3`。这说明即使压缩字节不大,ImageBitmap decode/bitmap 源准备仍可能跨过多个 120Hz frame budget,并与音频 blob load 同窗口叠加。对应 FPS window 仍有 `fpsAvg=75/62.3`, `fpsLow=15`, `frameMaxMs=66.7`。
- **结论**:Phase 14 排除了 coverflow preload 作为主因;下一步不应继续改 QueuePanel 或 preload,而应给 Pixi 背景纹理建立独立 decode budget/降采样策略。主 stage/coverflow 仍可保持原图;环境背景特效可以使用较小 bitmap,因为它经过 blur/noise/pixel/filter 合成,不是用户检查封面的主图。

### Phase 15: Pixi background texture 降采样预算

**Goal:** 只对 Pixi 环境背景纹理设定 decode/upload 预算,避免每次切歌为全屏特效解码 1500px+ 的整图 ImageBitmap。中央 stage / coverflow 封面仍保持原图显示。

**为何仍用 ImageBitmap,不是直接把 URL/`HTMLImageElement` 给 Pixi:**
- Pixi v8 可以吃多种 texture source,但 `Texture.from(url)` 不是资源加载路径,`Assets.load` 才是;而 `Assets.load` 会绕过现有 `getAppFetch` 桌面 bridge / CORS 路由,也引入 Pixi 全局缓存生命周期。
- 直接给 `HTMLImageElement` 能显示,但此前 trace/console 命中过 Pixi 的 image-element → canvas conversion 路径,这会把首帧成本推回主线程。
- `createImageBitmap(blob, { resizeWidth, resizeHeight })` 是这里需要的关键:它让**背景专用**纹理在进入 Pixi 前就按预算 decode,不影响 stage/coverflow 原图。若某个 WebView 不支持 resize option,实现会自动 retry 无 resize 的 ImageBitmap,保留线程外解码路径。

**实现(落地):**
- [`background-texture.ts`](../../../src/lib/background-texture.ts):`loadImageBitmapSource` 新增 `maxDimension`;先只读前 64KB 头部探测 PNG/JPEG/WebP 尺寸,超过预算时按比例向 `createImageBitmap` 传 `resizeWidth/resizeHeight/resizeQuality:"high"`。
- [`pixi-pixel-background.tsx`](../../../src/components/player/pixi-pixel-background.tsx):Pixi 环境背景图片分支传 `BACKGROUND_IMAGE_BITMAP_MAX_DIMENSION=1024`;该预算只作用于 ambient Pixi texture,不改变中央 stage / coverflow 的原图。
- [`pixi-background-controller.ts`](../../../src/components/player/pixi-background-controller.ts):`background.pixi media.load` / `textureSwap*` trace 增加 `sourceWidth/sourceHeight/resizeMaxDimension`;实际 `width/height` 仍记录传入 Pixi 的 decoded bitmap 尺寸。

**Tasks(TDD):**
- [x] 为 `loadImageBitmapSource` 增加可注入 `maxDimension` / resize option 测试:当调用方给背景预算时,应向 `createImageBitmap` 传入保持宽高比的 `resizeWidth/resizeHeight`。
- [x] 增加轻量图片尺寸探测(PNG/JPEG/WebP 常见路径),避免先解整图再降采样。
- [x] `pixi-pixel-background` 图片分支传入背景纹理预算(`1024`),trace 增加 `sourceWidth/sourceHeight/resizeMaxDimension`。
- [x] 相关测试通过:`background-texture.test.ts` + `pixi-background-controller.test.ts` + `pixi-pixel-background.test.ts` 共 25 例;`typecheck`/Biome 通过。
- [ ] QA trace 验收:`background.pixi media.load` 中 1500px/3000px 源图应出现 `sourceWidth/sourceHeight > width/height`,且 `resizeMaxDimension=1024`;`loadMs` 应下降。若 800px 图仍高 `loadMs`,说明瓶颈偏 fetch/bridge/decoder queue,不是像素预算。

### QA#15(2026-06-14 Phase 15 trace):1024 预算生效,但 `media.load` 仍是黑盒大头

11:53 trace 给出 Phase 15 的第一轮验证:

- **Phase 15 生效**:`background.pixi media.load` 已出现 `resizeMaxDimension=1024`,1500×1500 源图被 decode 成 1024×1024(`sourceWidth/sourceHeight=1500`,`width/height=1024`)。Pixi app lifecycle 仍稳定(`appInits=1`),`texture.create=0~0.1ms`,`renderMs=0.9~1.4ms`。
- **但 FPS 未改善**:窗口从 `fpsAvg=109 → 91.9 → 72.5 → 56.8/51.2`,`fpsLow≈10.9-17.2`,`frameMaxMs≈58-92ms`,并有历史 `longTaskMaxMs=320ms`。这说明“像素边长”不是主因,至少不是唯一主因。
- **剩余大头仍在 `media.load` 黑盒**:1500→1024 的两次仍 `loadMs=415.3/355ms`;一张原本 1024×1024 的图也 `loadMs=232ms`。当前 `media.load` 同时包含 `fetchTextureBlob(blob:)`、头部探测、`createImageBitmap` resize/decode,无法判断谁主导。
- **local-cover 路径仍有解释缺口**:每次 `playIndex` 后先 `background.cover localCover.wait pendingReason=row`,但随后 Pixi 仍 `textureSwap.start sourceKind=blob`。代码推断:row pending 结束后该 cover 不能走 local-media 协议 URL,于是合法回退 object URL;但 trace 没有记录“为什么 fallback”,容易误判为 Phase 11/12 回归。

### Phase 16: Pixi ImageBitmap load 分段归因 trace

**Goal:** 把 `background.pixi media.load` 拆成可归因子阶段,下一份 QA trace 能判断 200-400ms 是 blob fetch、图片头部探测、还是 `createImageBitmap` decode/resize。同步记录 local-cover object URL fallback 的原因。

**实现(落地):**
- [`background-texture.ts`](../../../src/lib/background-texture.ts):`loadImageBitmapSource` 增加可注入 `onStage` / `now`,分别 emit `fetch` / `header` / `decode` 阶段,携带 `durationMs/bytes/mime/sourceWidth/sourceHeight/resizeWidth/resizeHeight/resizeMaxDimension/width/height/retryWithoutResize`。
- [`pixi-pixel-background.tsx`](../../../src/components/player/pixi-pixel-background.tsx):把 `onStage` 接到 `background.texture` diagnostic scope,补 `sourceKind` 与 `mediaType=image`。下一份 trace 应出现 `DEBUG [background.texture] fetch/header/decode ...`。
- [`now-playing-background.tsx`](../../../src/components/player/now-playing-background.tsx):当 local-cover pending 结束但不能走协议 URL 时 emit `background.cover localCover.fallback`,记录 `reason=unservable-row|protocol-url-failed|unknown` 与 `fallback=object-url`,不记录 raw URL/path。

**Tasks(TDD):**
- [x] `background-texture.test.ts`:新增分段 trace 用例,用注入 clock 断言 `fetch/header/decode` 三段都有 context。
- [x] `now-playing-background.test.tsx`:新增 local-cover fallback 用例,确保不能走协议 URL时 emit `localCover.fallback reason=unservable-row`。
- [x] 相关测试通过:`background-texture.test.ts` 7 例、`now-playing-background.test.tsx` 9 例。
- [x] QA trace 验收:11:59 trace 已拆开 `fetch/header/decode`。结果显示首个 `muzfetch` 纹理为 `fetch=30.2ms/header=0.8ms/decode=51.7ms`,但后续两首出现 `header=84.2ms/decode=150ms` 与 `fetch=106.9ms/header=121.3ms/decode=111.6ms`;因此不是单纯 decode,尺寸探测的二次 Blob 读也可能落在切歌长帧里。

### QA#16(2026-06-14 Phase 16 trace):`header`/`fetch` 也会成为长帧来源

11:59 trace 证明 Phase 16 的分段埋点有效,也进一步缩小了下一步:

- **初始化噪声要排除**:12:04:19-12:04:21 有 visibility hidden/visible 与第一次 Pixi `appInit=209ms`,并出现 `frameMaxMs=549.9`;这不是正常切歌路径。
- **第一首切歌已明显改善**:`sourceKind=muzfetch bytes=5.8MB source=2048×2048 → 1024×1024`,`fetch=30.2ms/header=0.8ms/decode=51.7ms`,总 `media.load=83ms`;GPU 侧仍很小(`texture.create=0`,`renderMs=1.1`)。
- **第二首/第三首暴露新瓶颈**:一首 `blob` 图只有 231KB,但 `header=84.2ms`、`decode=150ms`、`media.load=307.6ms`;另一首 3000×3000 `muzfetch` 图为 `fetch=106.9ms/header=121.3ms/decode=111.6ms`,`media.load=340ms`。`header` 阶段本来只读前 64KB,却能超过 100ms,说明 `blob.slice(...).arrayBuffer()` 在当前 shell/协议下并非免费。
- **帧窗口仍与音频切换叠加**:12:04:24.874 的 `fpsAvg=91.9/fpsLow=8/frameMaxMs=125.1` 发生在 Pixi `media.load` 完成前,同窗口还有 audio blob load / media element `emptied/waiting/loadedmetadata`。下一阶段只先移除图片 header 的重复读,不把音频切换成本误归到 Pixi。

### Phase 17: Reuse fetched texture bytes for ImageBitmap header sizing

**Goal:** Pixi 背景图片已在 `fetchTextureBlob` 里读取完整压缩字节;尺寸探测不应再对生成出来的 Blob 做第二次 `slice(0,64KB).arrayBuffer()`。复用同一次读取拿到的 header bytes,并在 trace 中标明 `headerSource=fetched-bytes|blob-slice`。

**实现(落地):**
- [`background-texture.ts`](../../../src/lib/background-texture.ts):`fetchBlob` 可返回 `{ blob, headerBytes, headerSource }`;`loadImageBitmapSource` 会优先用随 fetch 带回的 `headerBytes` 解析 PNG/JPEG/WebP 尺寸,只有旧调用方返回裸 `Blob` 时才 fallback 到 `blob-slice`。
- [`pixi-pixel-background.tsx`](../../../src/components/player/pixi-pixel-background.tsx):新增 `readTextureBlobSource(response)`,对 `blob:`/`data:`/`muzfetch:`/remote fetch response 统一 `arrayBuffer()` 一次,生成 Blob 给 `createImageBitmap`,同时附带前 64KB header bytes 给尺寸探测。
- `background.texture header` trace 增加 `headerSource` 与 `headerBytes`;下一份 trace 中 Pixi 背景路径应主要看到 `headerSource=fetched-bytes`,且 `header` duration 应接近纯解析成本。

**Tasks(TDD):**
- [x] `background-texture.test.ts`:新增用例确保提供 `headerBytes` 时不会调用 `blob.slice()`,且 resize 仍按 header 尺寸计算;同时 trace 带 `headerSource=fetched-bytes`。
- [x] `pixi-pixel-background.test.ts`:新增 `readTextureBlobSource` 用例,确保 response bytes 转成 Blob 的同时保留 64KB header bytes,失败/空响应返回 `null`。
- [x] 相关测试通过:`background-texture.test.ts` 8 例、`pixi-pixel-background.test.ts` 11 例。
- [x] QA trace 验收:12:16 trace 中正常切歌的 `background.texture header` 已全部出现 `headerSource=fetched-bytes`,且 `header=0~0.1ms`。Phase 17 成功移除二次 Blob header 读;剩余大头转到 `fetch/decode`,尤其 stale `muzfetch`。

### QA#17(2026-06-14 Phase 17 trace):header 收敛,stale `muzfetch` fetch 成为新主因

12:16 trace 证明 Phase 17 生效,同时给出下一刀:

- **header 问题已收敛**:`swapSeq=12/13/15` 的 blob fallback 封面均为 `headerSource=fetched-bytes`, `header=0~0.1ms`;`swapSeq=14` 的 16.5MB `muzfetch` 也为 `header=0ms`。说明旧的 `blob.slice(0,64KB).arrayBuffer()` 二次读确实被移除了。
- **普通 blob fallback 仍有 decode 成本**:1425/1500px 源图压到 1024 后,`fetch≈75-102ms`,`decode≈70-193ms`,`media.load≈145-291ms`;Pixi 侧仍稳定,`texture.create/render≈0-3ms`,`appInits=1`。
- **最大掉帧来自 stale 16.5MB `muzfetch`**:`swapSeq=14` 在 12:16:22.978 开始,12:16:23.811 已切到下一首,但旧请求继续 `fetch=1830.2ms`、`decode=181ms`,最后才 `textureSwap.stale duration=2036.9ms`。这段期间 FPS window 跌到 `fpsAvg=48/46.3`, `fpsLow=3.6`, `frameMaxMs=275`, `heapMb=366`。
- **结论**:当前 stale guard 只在加载完成后丢弃,没有在被新 source supersede 时取消旧 fetch/decode。下一步优先级高于 cache/预算 A/B:给 Pixi texture load 加 `AbortSignal`,新 source 或 `src=null` 时立即 abort 上一个 in-flight load。

### Phase 18: Abort stale Pixi background texture loads

**Goal:** 当新的背景 source 到来、或 local-cover 进入 pending `src=null` 窗口时,立即取消上一条仍在进行的 Pixi 背景 texture load,避免 16.5MB stale `muzfetch` 继续占用 fetch/decode/heap 到完成后才被丢弃。

**实现(落地):**
- [`pixi-background-controller.ts`](../../../src/components/player/pixi-background-controller.ts):每次 `setSource` 创建新的 `AbortController`;新 source/null source/destroy/recover 会 abort 旧 in-flight load。`loadMedia` 收到 `{ signal }`;AbortError 记录为 `background.pixi media.load phase=skip reason=aborted`,不走 `onError`。
- [`background-texture.ts`](../../../src/lib/background-texture.ts):`loadImageBitmapSource` 支持 `signal`;pre-abort 不 fetch,fetch/header/decode 后检查 abort;AbortError 往上抛,不静默 fallback 到 `<img>`。
- [`pixi-pixel-background.tsx`](../../../src/components/player/pixi-pixel-background.tsx):把 signal 传到 `fetchTextureBlob` / `getAppFetch` / blob/data fetch / fallback image load,并在 response bytes 读取后检查 abort。

**Tasks(TDD):**
- [x] `pixi-background-controller.test.ts`:新增用例锁定新 source supersede 会 abort 旧 signal;destroy 会 abort 当前 signal;AbortError 不触发 `onError`。
- [x] `background-texture.test.ts`:新增用例锁定 pre-aborted signal 会 reject `AbortError`,且不会 fallback/继续 fetch stale source。
- [x] 相关测试通过:`pixi-background-controller.test.ts`、`background-texture.test.ts`、`pixi-pixel-background.test.ts` 共 31 例。
- [x] QA trace 验收:12:28 trace 中旧 `swapSeq=16/18` 已出现 `background.pixi media.load phase=skip reason=aborted`,且没有再看到 16.5MB `muzfetch fetch=1000ms+` 后才 stale。Phase 18 成功取消 stale fetch/load;剩余掉帧转到“load 启动过早 + audio/cover preload 同窗叠加”。

### QA#18(2026-06-14 Phase 18 trace):abort 生效,但快速切歌仍会过早启动 ImageBitmap 管线

12:28 trace 验证 Phase 18 方向正确,也暴露出下一层问题:

- **stale load 已能取消**:`swapSeq=16` / `swapSeq=18` 都出现 `background.pixi media.load phase=skip reason=aborted durationMs≈316ms`,同一份 trace 不再有 Phase 17 那种旧 16.5MB `muzfetch fetch=1830ms/decode=181ms` 完成后才 stale 的长尾。
- **但 abort 来得仍偏晚**:`swapSeq=16` 在 `fetch=80.5ms/header=0.1ms` 后,用户约 225ms 后切到下一首,最终 316ms 才 `aborted`;说明浏览器已进入后续 decode/bitmap 管线,不是每个阶段都能立即抢占。`swapSeq=18` 则在新歌到来后能 abort fetch,但也已经占用了约 316ms 的 load 窗口。
- **成功落地的 Pixi 仍是可见成本**:`swapSeq=20` 为 1500×1500→1024,`fetch=141.9ms`,`decode=200.3ms`,`media.load=342.7ms`,而 `texture.create=0.1ms`,`apply/render≈2.4ms`;瓶颈继续在 fetch/decode,不是 GPU upload / Pixi render。
- **FPS 仍有主线程尖峰**:窗口从基线 `fpsAvg=120/fpsLow=117.6` 跌到 `fpsAvg=67.5→50.5→49.4`,`fpsLow=3.6`,`frameMaxMs=274.9`,`heapMb=136→283`。尖峰与 Pixi load、音频 `loadedmetadata/loadeddata/canplay/playing` 事件、以及一次 `cover.preload.batch created=1 lastMs=273.7` 同窗叠加。
- **结论**:Phase 18 解决的是“旧任务不取消”;下一步要解决“任务太早启动”。因为 Pixi 子树上方已有即时 `<img>` reveal layer,背景特效可以晚 180ms 再开始昂贵 texture load,不影响主封面与标题同步。

### Phase 19: Pixi texture load settle gate before fetch/decode

**Goal:** 在 Pixi 背景 texture load 开始 fetch / `createImageBitmap` 前增加一个 abortable 的短稳定窗口。快速连切时,旧 source 在进入昂贵图片管线前就被新 source abort;正常单次切歌则由即时 `<img>` 先显示当前封面,Pixi 特效稍后接上。

**实现(落地):**
- [`pixi-background-controller.ts`](../../../src/components/player/pixi-background-controller.ts):新增 `loadDelayMs` controller option;`setSource()` 在 `media.load` 前调用 abortable delay。delay 被新 source/null/destroy/recover abort 时,记录 `background.pixi media.load phase=skip reason=aborted`,不触发 `onError`,也不调用 `loadMedia`。
- [`pixi-pixel-background.tsx`](../../../src/components/player/pixi-pixel-background.tsx):为 Pixi 背景纹理配置 `BACKGROUND_TEXTURE_LOAD_DELAY_MS=180`。这不是隐藏 flag,也不是用户设置;它只作用于环境背景特效层,中央 stage/coverflow 封面继续实时跟随当前歌。

**Tasks(TDD):**
- [x] `pixi-background-controller.test.ts`:先加红灯用例,锁定配置 `loadDelayMs=180` 时 `loadMedia` 不会立即调用,179ms 前仍不启动,180ms 后才启动。
- [x] `pixi-background-controller.test.ts`:新增 supersede 用例,锁定旧 source 在 delay 窗口内被新 source 取代时,旧 source 根本不进入 `loadMedia` / decode。
- [x] 相关测试通过:`pixi-background-controller.test.ts` 13 例。
- [x] QA trace 验收:13:15 trace 中快速切歌的旧 `swapSeq=30/32/34/36/40/42` 均只出现 `media.load phase=skip reason=aborted`,且没有对应 `background.texture fetch/header/decode`。Phase 19 成功阻断废弃 Pixi texture load 进入 fetch/decode。

### QA#19(2026-06-14 Phase 19 trace):废弃 Pixi decode 已挡住,剩余大头转到 non-current cover preload 与最终 16.5MB 成功落地

13:15 trace 证明 Phase 19 生效,但也把剩余问题缩小到两条仍读整图的路径:

- **Phase 19 生效**:`swapSeq=30/32/34/36/40/42` 在 `34.2ms~184.5ms` 内 `phase=skip reason=aborted`,没有任何对应的 `background.texture fetch/header/decode`。这说明 180ms gate 确实让快速 supersede 的 Pixi source 不再启动图片管线。
- **cover preload 仍会为 stale batch 读大封面**:同一轮里 `cover.preload.batch` 出现 `canceled=1/stale=1/created=0`,但 `maxSourceBytes=16569025`,耗时 `291.8ms` / `583.4ms`。这不是 object URL 创建问题,而是 stale batch 在知道自己 stale 前已经 `resolveMediaBlob()` 读完 16.5MB 本地封面。
- **同一张图又被最终 Pixi 成功加载**:最终落地的 `swapSeq=44` 是 3000×3000 / 16.5MB `muzfetch`,其中 `fetch=876.3ms`, `decode=178.6ms`, `media.load=1477.4ms`,但 `texture.create=0.1ms`, `renderMs=1.7ms`;GPU/Pixi render 仍不是主因。
- **同窗还有音频 source 切换**:最终曲 audio blob `7.29MB` 在 13:15:59.905 开始 load,13:16:00.369-00.370 连续触发 `loadedmetadata/loadeddata/canplay/playing/play.resolved`;FPS window 同期跌到 `fpsAvg=54`,随后 Pixi 成功上屏窗口跌到 `fpsAvg=46.3/fpsLow=4.4/frameMax=225.1`。
- **结论**:Phase 19 只剩“成功落地的大封面”和“非 current 预加载读整图”两类成本。先处理后者,因为它是纯 wasted work,且 Phase 14 原本就留有“快速切歌时 prev/next 延后”的待办。

### Phase 20: Delay non-current local cover preload reads during switch bursts

**Goal:** 快速切歌期间,只允许当前歌曲封面继续走较短 preload settle;`previous` / `next` / `stack-*` / `settle` 这些 coverflow 预加载在更长稳定窗口后才读取本地 cover blob。这样 stale batch 在窗口内被新 current supersede 时,不会先读完 16.5MB 再发现 stale。

**实现(落地):**
- [`cover-preload.ts`](../../../src/components/player/cover-preload.ts):`preloadCoverBatch` 新增 `nonCurrentLocalSettleMs`,并把 local miss settle 拆成 current / non-current 两个桶。non-current local miss 在读取 `resolveMediaBlob()` 前等待该窗口;若 batch 已 stale,直接 cancel 且释放占位 ref。`settleMs=0` 时不再额外排 `delay(0)` 宏任务。
- [`cover-preload.ts`](../../../src/components/player/cover-preload.ts):新增 `filterCoverPreloadRequestsForBurst()`,在 burst 期间过滤掉 non-current local 请求,但保留 current local 与 remote cover。
- [`swipeable-media-stage.tsx`](../../../src/components/player/swipeable-media-stage.tsx):保留 `COVER_PRELOAD_LOCAL_SETTLE_MS=140` 给 current,新增 `COVER_PRELOAD_NON_CURRENT_LOCAL_SETTLE_MS=420` 作为邻近/stack/settle 本地预加载放行窗口。hook 先发 current/remote 轻量批,420ms 后再放开 previous/next/stack 本地预加载,避免 current overlay 被 non-current 等待阻塞。主封面仍由 `useTrackCoverResource(current)` 负责,不影响当前曲可见性。

**Tasks(TDD):**
- [x] `cover-preload.test.ts`:先加红灯用例,锁定 non-current local cover 在 420ms 前不会调用 `resolveMediaBlob`;若 batch 在窗口内 stale,结果 `canceled=1`, `maxSourceBytes=0`,且 cache ref 释放。
- [x] 新增 burst filter 测试,锁定 burst 期间保留 current/remote、过滤 non-current local;更新 `swipeable-media-stage.test.tsx` 表达新的稳定窗口语义。
- [x] 实现 `nonCurrentLocalSettleMs`、burst filter 与 stage 两批接线。
- [x] `cover-preload.test.ts` + `swipeable-media-stage.test.tsx` 共 10 例通过。
- [x] QA trace 验收:13:32 trace 中 `cover.preload.batch` 每轮 `requests=1/roleCurrent=1/roleNext=0/rolePrevious=0/roleStack=0/maxSourceBytes=0`,未再出现 non-current stale/canceled 先读 16.5MB 的模式。

### QA#20(2026-06-14 Phase 20 trace):non-current preload 已收敛,剩余瓶颈是成功落地 Pixi 仍读本地原图

13:32 trace 验证 Phase 20 方向正确,同时把剩余低帧继续收窄:

- **Phase 20 生效**:`cover.preload.batch` 现在每轮都是 `requests=1`,且 `roleCurrent=1/roleNext=0/rolePrevious=0/roleStack=0`,`maxSourceBytes=0`。没有再看到 stale/canceled non-current batch 先读 16.5MB 的模式。
- **Phase 19 仍生效**:旧 Pixi swap 在 `42.4ms~217.1ms` 内 `phase=skip reason=aborted`,且无对应 `background.texture fetch/decode`;180ms settle gate 没退化。
- **剩余大头**:最终成功落地的 `swapSeq=42` 仍以 `sourceKind=muzfetch` 读整张本地 cover:`bytes=13360729`,源尺寸 `3874×3874`,随后才 resize 到 `1024×1024`;其中 `fetch=846.6ms`, `decode=189.1ms`, `media.load=1323.3ms`。`texture.create=0.1ms`, `renderMs=2.1ms`,所以 GPU/Pixi render 仍不是瓶颈。
- **FPS 对齐**:同窗 `fpsAvg=66.9/fpsLow=6.7/frameMax=150`,随后 `fpsAvg=56.5/fpsLow=5/frameMax=200`,Pixi 成功 apply 后仍 `fpsAvg=53.2/fpsLow=5/frameP99=183.4`。音频 `media.load.blob bytes=5393807` 与这段重叠,但背景图片 fetch/decode 是唯一新增的大图路径。
- **结论**:Phase 20 已砍掉 wasted preload。下一步不是继续调 GPU 或 preload,而是让 Pixi ambient cover 不再消费本地原图 URL。Stage/coverflow 仍保原图;只给全屏背景特效使用已有小 cover derivative。

### Phase 21: Feed Pixi ambient cover from a small derivative instead of the local original

**Goal:** 当 Pixi 背景 source 是 cover 且 track 有本地 cover blob 时,Pixi texture source 使用现有 `backlight` cover derivative 的 object URL,不再用 `muzfetch://...` 或 full-cover `blob:` 原图。Derivative 尚未 ready 时保持 Pixi shell mounted 但 hidden (`src=null`),避免回退到原图启动 13MB fetch/decode。

**实现(落地):**
- [`now-playing-background.tsx`](../../../src/components/player/now-playing-background.tsx):接入 `useCoverDerivativeUrl(current, "backlight")` 作为 Pixi cover texture source;仅在 `pixiEffect && pixiMedia.source==="cover" && source==="cover" && current.coverBlobId` 时启用。
- 对本地 cover derivative pending 的窗口,继续复用 Phase 10/12 的 hidden Pixi shell 行为;不要把 full cover URL 喂给 `PixiPixelBackground`。这意味着 derivative 首次生成时最多是背景特效短暂隐藏,而不是启动 13MB Pixi fetch/decode。
- 不改变 `CrossfadeBackgroundImage` / `CanvasBlurBackground` / stage coverflow 的原图展示质量;本 phase 只优化 Pixi ambient texture 输入字节。
- 新增 `background.cover pixiCover.derivative` trace,带 `derivativeKind`, `derivativeReady`, `derivativeState`, `fallbackToOriginal:false`,可在下一份 QA trace 直接确认是否仍回退原图。

**Tasks(TDD):**
- [x] `now-playing-background.test.tsx`:先加红灯用例,本地 `muzfetch://` cover ready 且 derivative ready 时,Pixi `data-src` 必须是 derivative URL,不是 `muzfetch://` 原图。
- [x] `now-playing-background.test.tsx`:derivative pending 时 Pixi shell 仍 mounted hidden,`data-src=""`,且不回退到 local protocol/full blob。
- [x] 实现 hook 接线与 render target 逻辑,并补 `pixiCover.derivative` trace。
- [x] 运行 `now-playing-background.test.tsx`、相关 cover preload/Pixi controller 测试、typecheck、本次 touched 源文件 Biome。
- [ ] QA trace 验收:成功落地 Pixi 不应再出现 `background.texture fetch bytes≈13MB sourceKind=muzfetch/blob`;预期 `bytes` 接近 backlight derivative 体量,或 derivative pending 时本轮无 Pixi texture load。

### QA#21(2026-06-14 Phase 21 trace):Pixi 原图输入已消失,剩余长帧转向 full-cover `<img>` decode/paint 缺口

13:45 trace 验证 Phase 21 生效,但低 FPS 仍在,且定位方向再次变化:

- **Phase 21 生效**:`pixiCover.derivative` 持续带 `fallbackToOriginal=false`;成功落地的 Pixi texture 已从 13.36MB `muzfetch` 变为 192×192 `image/webp` derivative,例如 `bytes=6598/14514`, `sourceWidth=192/sourceHeight=192`。`texture.create=0.1ms`, `renderMs=0.6~0.8ms`,GPU/Pixi apply 仍不是瓶颈。
- **preload 仍收敛**:`cover.preload.batch` 继续保持 `maxSourceBytes=0`;稳定后 previous/next 放开时也只是 `cacheHits`。
- **剩余异常**:即使 Pixi 只读 6~14KB,`background.texture decode` 仍可到 `124.5~129.9ms`,`media.load≈485ms`(含 180ms texture load delay)。但最重的 `fpsAvg=59→47.6→42.7/fpsLow=3.3/frameMax=299.9/longTaskMax=302` 出现在 Pixi 小图 fetch/decode 之外,且同窗 `heapMb` 从 `198→376` 暴涨。
- **trace 缺口**:`cover.render cache-hit` 只说明 full-cover object URL 命中,没有记录浏览器实际解码/paint `<img>`。Now Playing stage 的 [`cover-image.tsx`](../../../src/components/player/cover-image.tsx) 会通过 `useLoadedImageUrl()` 对 full-res cover 先 `new Image().decode()`,然后再渲染 `<motion.img>`。这条主动 full-cover decode 目前没有独立 trace,很可能解释「object URL cache-hit 但仍长帧」。
- **结论**:Pixi 原图输入不是当前主因。下一步先不改画质,只让 Now Playing stage 停止主动 full-res `image.decode()`;保留原图 `<img decoding="async">` 上屏,并补 `image.load/decode` trace,验证长帧是否来自这条过去未记录路径。

### Phase 22: Stop active full-cover decode on the Now Playing stage and trace image load/decode

**Goal:** Stage 主封面仍显示原图,但切歌窗口不再由 `useLoadedImageUrl()` 主动等待/触发 full-res `image.decode()`。默认 hook 语义不变(需要 decode 的调用方仍等 decode);Now Playing stage 显式 `decode:false`,让 `<img decoding="async">` 由浏览器调度。补 `image.load`/`image.decode` perf span,让下一份 trace 能区分 `surface=now-playing` 与 `surface=background`。

**实现(落地):**
- [`use-image-load.ts`](../../../src/hooks/use-image-load.ts):新增 `decode?: boolean` 选项。默认 `true` 保持旧语义;`false` 时 onload 后即可 expose `displayUrl`,不调用 `image.decode()`。
- [`use-image-load.ts`](../../../src/hooks/use-image-load.ts):缓存记录 `decoded` 状态;`decode:false` 的 load-only cache 不会被后续 decode-required 调用误用。
- [`use-image-load.ts`](../../../src/hooks/use-image-load.ts):新增 `image.load` / `image.decode` work spans,带 `surface`, `trackId`, `source`, `sourceKind`, `width/height`, `decode`。
- [`cover-image.tsx`](../../../src/components/player/cover-image.tsx) + [`media-stage.tsx`](../../../src/components/player/media-stage.tsx):Now Playing stage 传 `decode:false` 与 `trackId`,保留 `<motion.img>` 原图显示。
- [`now-playing-background.tsx`](../../../src/components/player/now-playing-background.tsx):给 ambient `useLoadedImageUrl` 补 `surface=background` trace context,不改其默认 decode 行为。

**Tasks(TDD):**
- [x] 新增 `use-image-load.test.tsx`:默认路径等待 `decode()` 后才 expose display URL。
- [x] 新增 `use-image-load.test.tsx`:显式 `decode:false` 时 onload 后 expose display URL,且不调用 `decode()`。
- [x] 新增 `use-image-load.test.tsx`:load-only cache 不满足后续 decode-required 请求。
- [x] 受影响测试: `use-image-load`, `cover-image`, `now-playing-background`, `swipeable-media-stage` 共 22 例通过;`typecheck` 与 touched-file Biome 通过。
- [x] QA trace 验收:13:57 trace 未再出现 `image.decode surface=now-playing`;Phase 22 排除了 active stage 主动 decode。

### QA#22(2026-06-14 Phase 22 trace):active stage decode 已排除,剩余浪费是 Pixi derivative 模式下未使用的 ambient full-cover decode

13:57 trace 把问题继续收窄:

- **Phase 22 生效**:trace 中不再出现 `image.decode surface=now-playing`,说明 Now Playing stage 已不再主动等待 full-res cover decode。
- **Pixi derivative 路径继续生效**:`pixiCover.derivative` 仍带 `fallbackToOriginal=false`;Pixi texture source 仍是 192px/几 KB derivative,不是本地原图。
- **剩余可归因开销**:同一切歌窗口仍出现多条 `image.load/decode surface=background decode=true`,且尺寸为 800/1024/1500px,例如 `image.decode surface=background height=1500 lastMs=54`、`height=800 lastMs=54.5`。
- **结构性原因**:[`now-playing-background.tsx`](../../../src/components/player/now-playing-background.tsx) 已经把 Pixi `pixiUrl` 切到 `backlight` derivative,但更早仍执行 `useLoadedImageUrl(backgroundCoverUrl, decode=true)`。在 Pixi cover derivative 模式下,这个 full-cover `backgroundUrl` 不会被 `PixiPixelBackground` 使用,也不会被 `CanvasBlurBackground`/`CrossfadeBackgroundImage` 渲染,但它仍会创建 `Image` 并主动 decode。
- **结论**:这不是 Pixi 纹理输入的问题,也不是 active stage 的问题,而是一个未使用 render path 的冗余工作。Phase 23 应只在 full-cover background 确实会被 image/blur renderer 消费时才调用 `useLoadedImageUrl`;Pixi derivative cover 分支应跳过这条 full-cover load/decode。

### Phase 23: Skip unused full-cover background decode when Pixi uses derivative

**Goal:** 当背景 renderer 是 Pixi effect 且 cover source 能使用 `backlight` derivative 时,不要再为未渲染的 full-cover ambient background 创建 `Image`/执行 `image.decode()`。保留 image/blur renderer 的原图背景行为;保留 Pixi derivative pending 时 hidden shell、不回退原图的规则。

**Tasks(TDD):**
- [x] 先加红灯断言:`now-playing-background.test.tsx` 中 derivative ready 时,Pixi `data-src` 是 derivative URL,且 `images.length===0`。
- [x] 调整 `now-playing-background.tsx` 的派生顺序,先计算 `pixiMedia` / `shouldUsePixiCoverDerivative`,再把 `null` 传给 ambient full-cover `useLoadedImageUrl`。
- [x] 更新 pending derivative / local protocol URL 相关测试,确认 hidden Pixi shell 不创建 full-cover `Image`。
- [x] QA trace 验收:14:06 trace 未再出现 `image.load/decode surface=background decode=true`;Phase 23 排除了未渲染的 ambient full-cover decode。

### QA#23(2026-06-14 Phase 23 trace):background full-cover decode 已排除,剩余 full-cover 消费者是 stage/dock preflight Image load

14:06 trace 验证 Phase 23 生效,但低 FPS 仍未完全恢复:

- **Phase 23 生效**:没有 `image.load/decode surface=background`;Pixi derivative 继续 `fallbackToOriginal=false`,最终成功 texture 仍为 `192×192 image/webp` derivative。
- **Pixi GPU/app 侧不是主因**:`appInits=1`,最终 `texture.create=0.1ms`, `renderMs=0.9ms`, `applyMs=1.2ms`。
- **仍有 full-cover load**:`image.load surface=now-playing decode=false` 在切歌窗口多次出现,尺寸包括 `1400×1400`, `1417×1417`, `2000×2000`,单次 `9.7~59.9ms`。虽然不再主动 `decode()`,但它仍用 `new Image()` 做 preflight load,随后真实 `<img>` 再参与显示,等于 full-cover 仍有额外消费者。
- **其他长 wall-time 不是主要 CPU 证据**:`cover.preload.batch lastMs=185~217ms` 多为 settle/cache-hit wall time(`maxSourceBytes=0`),Pixi `media.load=430ms` 也包含 180ms settle + 192px derivative fetch/decode;真正仍随每首发生且消费 full-cover 的是 `surface=now-playing` preflight load。
- **结论**:下一步不再继续压 Pixi 输入,而是让 stage/dock 的 crossfade gate 由真实 DOM `<img onLoad>` 承担,删除 `new Image()` preflight 消费者。这样仍保留“新图没 load 前旧图不闪”的 UX,但不额外创建 JS `Image`。

### Phase 24: Replace stage/dock preflight Image with DOM image load gate

**Goal:** Now Playing stage 与底部 dock 的封面不再通过 `useLoadedImageUrl(... decode:false)` 创建额外 `Image` 做 load gate。改为先把真实 DOM `<img>` 放进树里(透明),由它的 `onLoad` 切换显示状态并触发 crossfade;旧图在新图 load 前保持可见。

**Tasks(TDD):**
- [x] `cover-image.test.tsx`:先加红灯,`loadStrategy="dom"` 时不应创建 `global Image`,但 DOM 里应存在 pending `<img>`。
- [x] `CoverImage` 增加 `loadStrategy="dom" | "preload"`;默认保留旧策略,DOM 策略用真实 `<img onLoad/onError>` gate crossfade 与 aspect。
- [x] `media-stage.tsx` 与 `track-identity-row.tsx` 对 player 主封面启用 `loadStrategy="dom"`。
- [ ] QA trace 验收:切歌窗口不应再出现 `performance.work image.load surface=now-playing`;若 FPS 仍低,下一步集中看 browser compositor/audio blob load/Pixi 192px ImageBitmap decode queue。

### QA#24(2026-06-14 Phase 24 trace):主动 full-cover Image 消费者已排除,剩余掉帧需要用大块二分隔离

14:15 trace 继续收窄问题:

- **Phase 24 生效**:trace 中不再出现 `image.load/decode surface=now-playing` 或 `surface=background`,说明 active stage/dock/background 这三条过去可见的额外 `new Image()` full-cover 消费者已经移除。
- **Pixi 输入仍是小 derivative**:`background.texture` 成功路径继续是 `192×192 image/webp`,通常只有 `5~15KB`;`texture.create=0~0.2ms`,`applyMs/renderMs≈1ms`,`appInits=1`。这排除了 WebGL app 重建、shader 重编译、GPU texture apply 作为主因。
- **但 FPS 仍低**:同窗仍可见 `fpsAvg≈36~91`,`fpsLow≈5~15`,`frameMaxMs≈66~183ms`,`longTaskMaxMs≈214ms`,说明剩余主因已不在已补 span 的 full-cover JS Image decode。
- **剩余可疑层**:
  - Pixi derivative 的 `fetch/decode/media.load` wall time 偶发很高,例如 192px/几 KB 仍可出现 `decode≈49~299ms`,`media.load≈407~787ms`。这可能是浏览器 decoder/fetch queue 或 object URL 读取,不是像素/字节预算。
  - 快切时仍会启动并 abort 多个 Pixi load (`media.load phase=skip reason=aborted`),虽然不会 apply,但可能占用浏览器内部解码/IO 队列。
  - 全局背景的 flow / visualizer 是全屏 canvas/WebGL + `mix-blend-mode`,即使不切 texture,也可能让任何主线程/媒体事件更容易表现成 FPS low。
  - 音频 `media.load.blob` 每首仍加载 5~9MB audio blob;若背景层完全禁用后仍掉,需要转向 player/media load 与前景 React render。
- **结论**:继续微优化会变成猜。Phase 25 改用临时诊断分支做大块二分:一次移除一层功能,用同一 QA 手势测 `fpsAvg/fpsLow/frameMaxMs/frameP99Ms/longTaskMaxMs` 和关键 spans 是否消失。

### Phase 25: Temporary bisection branch for switch-jank isolation

**Goal:** 不引入 hidden flag,不把临时诊断代码合入产品分支。创建 `diag/switch-fps-bisect`,按原子 commit 大块禁用功能,让 QA 可逐个 checkout commit 复现同一切歌动作,用 FPS 是否恢复来确定剩余主因层级。

**测量纪律:**
- 每个实验从同一队列、同一播放状态、同一连续切歌节奏开始。
- 每次至少记录 3 个连续 `performance.frame` window,并保留 `background.texture`, `background.pixi`, `cover.render`, `cover.preload.batch`, `player.playback/media.load.blob` spans。
- 判定优先看差值:若某实验让 `fpsLow` 从个位数/十几恢复到接近 baseline,且 `frameMaxMs/frameP99Ms/longTaskMaxMs` 同步收敛,则该实验禁用的层就是主因或必要放大器。

**实验矩阵(临时 commit,不作为最终修复):**

| Experiment | Commit intent | Disabled surface | Expected signal |
|------------|---------------|------------------|-----------------|
| A | `diag(perf): disable ambient background` | 整个 `NowPlayingBackground` | 若 FPS 恢复,剩余主因在全局背景层;若不恢复,转查 audio/player/foreground |
| B | `diag(perf): disable pixi ambient layer` | 只禁 `PixiPixelBackground`,保留背景容器、flow、visualizer | 若 FPS 恢复,主因在 Pixi texture/decode/swap 或 Pixi canvas 合成 |
| C | `diag(perf): keep pixi shell but skip texture source` | Pixi app/shell 保留,`src=null`,不发 texture swap | 若 B 恢复且 C 恢复,锁定 texture load/decode/swap;若 C 仍掉,锁定 Pixi steady compositor/filter |
| D | `diag(perf): disable flow and visualizer layers` | flow + background visualizer | 若 A 恢复但 B/C 不恢复,优先查全屏 canvas/WebGL + mix-blend-mode 合成 |
| D | `diag(perf): disable cover resource hooks` | full cover URL、thumbnail/backlight derivative、cover palette/color | 若 FPS 恢复,主因在封面 object URL/DOM image/derivative/palette 生命周期 |
| E | `diag(perf): bypass media source reload` | audio blob/stream reload | 若 D 仍掉而 E 恢复,主因在每首 audio media load/decoder pipeline |

**Tasks:**
- [x] 创建临时诊断分支 `diag/switch-fps-bisect`。
- [x] Commit 0:记录本 Phase 与 QA 操作矩阵。
- [x] Commit A:禁用整个全局 `NowPlayingBackground`。
- [x] Commit B:在 A 的反向路径之外,禁用 Pixi ambient layer。
- [x] Commit C:保留 Pixi shell 但强制 `src=null`,不启动 texture source。
- [x] Commit D:禁用 cover resource hooks 与 cover-color/palette hook。
- [x] Commit E:跳过 audio media source reload。
- [ ] 最终修复必须回到产品分支实现,不得直接合并诊断 commit。

**Experiment A implementation:** [`App.tsx`](../../../src/App.tsx) 不再挂载 `NowPlayingBackground`;页面、dock、播放 transport、foreground stage、trace recorder/HUD 保持原样。若本 commit 下 `fpsLow/frameMaxMs` 明显恢复,则剩余主因位于全局背景层(包括 Pixi/flow/visualizer/compositor)。若仍不恢复,则应转向 audio blob load、foreground cover surfaces 或 React render churn。

**Experiment B implementation:** 在 A 之后恢复 [`App.tsx`](../../../src/App.tsx) 的 `NowPlayingBackground` 挂载,但 [`now-playing-background.tsx`](../../../src/components/player/now-playing-background.tsx) 用临时常量关闭 `PixiPixelBackground` 分支。Pixi renderer 模式下不 fallback 到 `CrossfadeBackgroundImage`,避免重新引入 full-cover ambient image decode;flow、background visualizer、mask、lyrics/background live queries 仍保留。若 A 恢复而 B 不恢复,主因更可能在 flow/visualizer/compositor 或背景查询;若 B 恢复,优先查 Pixi texture load/decode/swap 或 Pixi canvas 合成。

**Experiment C implementation:** 在 B 之后重新启用 `PixiPixelBackground` 组件挂载,但强制传入 `src=null`。这会保留 Pixi app/canvas/filter/shell 与背景层合成成本,同时阻断图片 `background.texture fetch/header/decode` 和 texture swap 输入。若 B 恢复但 C 又掉,说明 Pixi 稳态 canvas/filter/compositor 本身是必要放大器;若 B/C 都恢复,说明主因在 Pixi texture source 的 fetch/decode/swap 队列。

**Experiment D implementation:** 在 C 之后短路 [`use-media.ts`](../../../src/hooks/use-media.ts) 的 full-cover URL、thumbnail/backlight derivative、entity cover URL,并短路 [`visualizer-dynamic-color.tsx`](../../../src/components/player/visualizer-dynamic-color.tsx) 的 cover-color/palette hook。目标是让 `cover.render`, `cover.render.object-url-miss`, full cover DOM `<img>`, cover derivative worker/object URL、palette liveQuery 都不再随切歌启动。若 D 恢复,下一步正式修复应集中在“封面消费者去重/延后/按可见性禁用”,而不是 Pixi 或 audio。

**Experiment E implementation:** 在 D 之后短路 [`ensureLoadedAndPlay`](../../../src/stores/player-store.ts),保留 `playIndex`/store currentIndex 更新,但跳过 `getTrackBlob`, `mediaEngine.loadBlob/loadUrl`, `stream.resolve`, `mediaEngine.play`。trace 会出现 `player.playback media.load.skip sourceId=diag-bisect:*`,不会出现 `media.load.blob/stream/local-file`。若 E 恢复而 D 不恢复,主因在每首媒体源重新装载/音频 decoder pipeline;若 E 仍掉,剩余要转向 React render churn、trace recorder/HUD、页面列表或 transport state fan-out。

### QA#25(2026-06-14 Experiment E trace):FPS 明显恢复,主因转向 media source reload/audio decoder pipeline

14:59 trace 是 `3153bf9 diag(perf): bypass media source reload` 的结果,结论很强:

- **Experiment E 生效**:每次 `playIndex` 后都出现 `player.playback media.load.skip source=diag-bisect:blob`,且没有 `media.load.blob` / `media.load.stream` / `source.loaded` / `play.requested`。说明本轮切歌只更新 player store currentIndex 与 UI,没有让 media element 重新装载新音频源。
- **FPS 明显恢复**:在 5983 首超大队列中连续切歌,`fpsAvg` 稳在 `109.6 → 113.1 → 114.9`, `fpsLow` 从之前的个位数/十几提升到 `20 → 24`, `frameMaxMs` 从 6b987a3 的 `108.4ms` 收敛到 `41.7~50.1ms`, `frameP99Ms` 到 `25~41.5ms`。这说明背景/Pixi/cover resource 被砍掉后,真正决定“是否恢复”的是 media source reload 是否发生。
- **内存侧也收敛**:没有新 audio blob(`blobsCreatedByKind.audio=0`);image blob 只从 `40` 到 `43`,heap 维持 `169~207MB`,不再出现 6b987a3 的 `266→419MB` 增长与 `fpsAvg 45.6`。
- **仍有非主因残留**:`background.cover localCover.wait` / `pixiCover.derivative pending` 与少量 `cover.preload.batch` 仍会出现,但没有把 FPS 拉低。它们是后续清理项,不是当前决定性因子。
- **更新判断**:QueuePanel、SearchPage、NowPlayingBackground/Pixi、full-cover JS Image decode、cover object URL churn 都已经被二分排除为“决定性主因”。当前主因应细分为:
  - `getTrackBlob` / IndexedDB blob read;
  - `mediaEngine.loadBlob` 创建 object URL + `audio.src` 替换 + `audio.load()`;
  - Chromium/WebView audio decoder 在快速 source replacement 下的不可抢占工作;
  - `mediaEngine.play()` / media element event storm 触发的 frame pressure。

### Phase 26: Split media source reload into blob read, element source swap, and play request

**Goal:** 从 Experiment E 的“大跳过”继续细分,找出 production 修复的最小入口。不能把“跳过切歌播放”作为修复;需要区分是读取本地 blob、替换 media element source、还是立即 `play()` 造成掉帧。

**Candidate diagnostic commits:**

| Experiment | Commit intent | Disabled work | Expected signal |
|------------|---------------|---------------|-----------------|
| F | `diag(perf): read media blob without attaching` | 保留 `getTrackBlob`/stream resolve,跳过 `mediaEngine.loadBlob/loadUrl` 与 `play()` | 若 F 仍恢复,blob/stream resolve 不是主因;若 F 掉,主因在 DB/blob read |
| G | `diag(perf): attach media source without play` | 执行 `mediaEngine.loadBlob/loadUrl`,跳过 `mediaEngine.play()` | 若 G 掉,主因在 source swap/load/decoder;若 G 恢复,主因在 immediate play/media events |
| H | `diag(perf): play attached media without post-load work` | 执行 `mediaEngine.play()`,但仍跳过 metadata/presence 收尾 | 若 H 掉,主因在 `play()`/audio output start;若 H 恢复,主因在 post-load metadata/presence |
| I | `diag(perf): restore media session metadata after play` | 在 H 基础上只恢复 MediaSession metadata/artwork | 若 I 掉,主因在 OS now-playing artwork/metadata;若 I 稳,继续恢复 presence/lyrics/listen flush |
| J | `diag(perf): defer media source load after switch settle` | 真实播放路径,但 source load 延后到切歌停止后 | 若 J 恢复,正式修复应做 switch-settle/debounce + cancel stale media load |

**Tasks:**
- [x] Commit F:保留 blob read,不 attach media element。
- [x] Commit G:attach media source,但不调用 `play()`。
- [x] Commit H:attach 后调用 `play()`,但继续跳过 metadata/presence。
- [x] Commit I:在 H 基础上只恢复 MediaSession metadata/artwork,并补 `player.mediaSession.*` trace span。
- [ ] Commit J:把真实 media source load 延后到切歌 settle 后,验证是否能保留播放语义同时恢复 FPS。

**Experiment F implementation:** 在 `3153bf9` 的“大跳过”基础上,把 media reload 诊断 mode 调整为 `read`:当 `sourceKind==="blob"` 时执行 `getTrackBlob(track)`,并 emit `media.load.read-only sourceId=diag-bisect:blob-read bytes/mime`;随后仍不调用 `mediaEngine.loadBlob/loadUrl` 或 `play()`。若 F 仍接近 E 的 FPS,说明 IndexedDB/blob read 不是主因;若 F 重新掉帧,主因在 blob 读取/structured clone/内存分配。

**Experiment G implementation:** 在 F 之后把 media reload 诊断 mode 调整为 `attach-no-play`:当 `sourceKind==="blob"` 时执行 `getTrackBlob(track)`,emit `media.load.attach-only`,再调用 `mediaEngine.loadBlob(media.blob, track.kind)`,但仍不调用 `mediaEngine.play()`。若 G 重新掉帧,主因在 media element source replacement / `audio.load()` / decoder/event pipeline;若 G 仍恢复,主因更偏 `play()` 与播放态事件。

**Experiment H implementation:** 在 G 之后把 media reload 诊断 mode 调整为 `attach-and-play`:当 `sourceKind==="blob"` 时执行 `getTrackBlob(track)`,emit `media.load.attach-play`,调用 `mediaEngine.loadBlob(media.blob, track.kind)`,随后在 `wantPlay` 仍为 true 时只调用 `mediaEngine.play()` 并 emit `play.requested`;仍跳过 duration settle、MediaSession metadata、R2 presence、lyrics/palette 后续收尾。若 H 重新掉帧,说明决定性成本在 `play()` / audio output start / 播放态事件;若 H 仍稳,下一步再恢复 post-load metadata/presence 来细分。

**Experiment I implementation:** 在 H 之后把 media reload 诊断 mode 调整为 `attach-play-media-session`:仍执行 blob read、`mediaEngine.loadBlob`、`mediaEngine.play()`,然后只恢复 `updateMediaSessionMetadata(track, continueCurrent)`;继续跳过 R2 presence、lyrics auto-fetch、listen flush 等其他 post-load work。补充 `player.mediaSession.metadata`, `player.mediaSession.artwork.fetch`, `player.mediaSession.artwork.objectUrl`, `player.mediaSession.metadata.set` 四类 `performance.work` span,用于区分 cover blob 读取、object URL 创建、`navigator.mediaSession.metadata` 设置和总耗时。

### QA#26(2026-06-14 Experiment G trace):attach/source replacement 仍稳,下一步锁定 play()/audio output start

16:46 trace 是 `aade510 diag(perf): attach media source without play` 的结果:

- **Experiment G 生效**:每次切歌都有 `media.load.attach-only source=diag-bisect:blob-read`,随后出现 `source.loaded`, `emptied`, `loadstart`, `loadedmetadata`, `suspend`, `loadeddata`, `canplay`, `canplaythrough`;但没有 `play.requested` / `play.resolved`。
- **FPS 仍稳定**:`fpsAvg=112.5~113.7`, `fpsLow=20~24.1`, `frameMaxMs=41.5~50ms`, `frameP99Ms=33.3~49.9ms`,与 Experiment E 相近,远好于 6b987a3 的 `fpsAvg=45.6/fpsLow=9.2/frameMax=108.4ms`。
- **结论更新**:IndexedDB/blob read、`URL.createObjectURL`, `audio.src` replacement, `audio.load()`, metadata decode 与 canplay 事件都不足以复现掉帧。剩余决定性差异是 production path 中 `mediaEngine.play()` 以及由它触发的 audio output start / playing / timeupdate / audio graph / presence 之后的播放态事件。
- **下一步**:Experiment H 只在 attach 后调用 `mediaEngine.play()`,继续跳过 metadata/presence 等后续逻辑。如果 H 掉,主因就是 `play()`/audio output start;如果 H 稳,再恢复 metadata/presence/MediaSession 逐项细分。

### QA#27(2026-06-14 Experiment H trace):play() 仍稳,主因继续后移到 post-load metadata/presence

16:50 trace 是 `e8c9bfc diag(perf): play attached media without post-load work` 的结果:

- **Experiment H 生效**:每次切歌都有 `media.load.attach-play`,随后出现 `play.requested`, `play`, `loadedmetadata`, `playing`, `play.resolved`, `canplaythrough`;说明 media element 已经实际开始播放。
- **FPS 仍稳定**:切歌窗口 `fpsAvg=110.2~115.5`, `fpsLow=24`, `frameMaxMs=41.6~41.7ms`, `dbRequeries=0`;明显没有回到早先 production / 6b987a3 的 `fpsAvg~40-70`, `fpsLow~3-9`。
- **负面证据**:trace 同时仍有 `background.cover localCover.wait`, `pixiCover.derivative state=pending`, `cover.preload.batch maxMs~12-16ms`;这些背景/封面轻量路径在 H 中存在但没有导致掉帧。
- **结论更新**:`mediaEngine.play()` / audio output start 也不足以复现掉帧。剩余差异集中在 H 跳过的 production post-load work:MediaSession metadata/artwork、R2 presence、lyrics auto-fetch、listen flush/stat write。下一步优先恢复 MediaSession artwork,因为它会读取封面 blob、创建 image object URL,并交给 OS now-playing 控件,此前 trace 的 image blob 增长和 heap spike 与它的形态最吻合。

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
| 10 | QA#8:tab 无关的 `AVG 120→70` 是否仍是 QueuePanel? | ✅ Resolved(trace 实证) | **否**。新 trace 无 `queuePanel/systemPlaylist`,但有 `background.pixi textureSwap` 12 次、stale 3 次、heap +223MB;cover URL/palette 都命中缓存。归因转到全局 `NowPlayingBackground` / Pixi texture/decode/upload/合成管线。Phase 9 补分段 trace 与 copy-trace context 导出。 |
| 11 | QA#9:Phase 9 后为什么仍 `fpsLow≈10`? | ✅ Resolved(trace verified) | 分段 trace 显示 `texture.create/render` 很小,真正大头是每次切歌又 `appInit`(853ms/307ms)。controller 被 streamed/local-cover URL pending 窗口卸载。Phase 10 修生命周期;新 trace 已验证 `appInits=1` 稳定、`swapSeq` 递增。 |
| 12 | QA#10:Phase 10 后为什么仍 `fpsLow=2.4`? | 🔲 Root cause found | Pixi 不再重建后,剩余大头是 local-cover 协议 URL pending 期间先启 `blob:` fallback,随后 `muzfetch:` ready 又二次解码同一张 16.5MB/3000px 封面。Phase 11 让 pending 成为显式状态,跳过 blob fallback 并补 `background.cover localCover.wait` trace。 |
| 13 | QA#11:3000×3000 本身是否足以解释掉帧? | 🔲 Root cause refined | 不应只归因到尺寸。新 trace 显示 `localCover.wait` 前仍有一帧旧 settled `blob:` target 进入 Pixi,且 stale ImageBitmap decode 无法取消,把 3000px 图的旧 decode、muzfetch decode、下一首 decode 排到一起。Phase 12 硬阻断 pending 首帧的 settled target。 |
| 14 | QA#12:Phase 12 后为什么仍 wait 晚于 blob start? | 🔲 Root cause found | `useLiveQuery` 在 `coverBlobId` 切换后会短暂返回上一条 mediaBlob row;旧 hook 没校验 `row.id`,导致当前 cover 首帧误判并走 blob。Phase 13 只接受 id 匹配当前 cover 的 row,否则视为 row pending。 |
| 15 | QA#13:Phase 13 后为什么仍 `fpsLow≈7.5`? | ✅ Resolved(trace verified) | local-cover wait 已在首帧发生,Pixi app 也稳定(`appInits=1`),16.5MB 重复 decode 未复现。Phase 14 后新 trace 显示 `cover.preload.batch created=0 maxSourceBytes=0`,image blob 数稳定,preload 已收敛。 |
| 16 | QA#14:Phase 14 后为什么仍 `fpsAvg≈62-75`? | ✅ Phase 15 code done, QA trace pending | 剩余低 FPS 与 Pixi `media.load loader=imageBitmap` 对齐:1500px/800px 图片仍需 172-254ms 准备,而 `texture.create/renderMs` 仍仅 0-3ms。Phase 15 已给 Pixi 背景纹理加独立 decode budget(1024 max side)与 source/decoded 尺寸 trace;下一份 trace 判断像素预算是否足够,若 800px 仍慢则转查 fetch/bridge/decoder queue。 |
| 17 | QA#15:Phase 15 后为什么 `media.load` 仍 232-415ms? | ✅ Resolved(trace split) | Phase 16 已拆出 `fetch/header/decode`;11:59 trace 显示 `header` 与 `fetch` 也会到 80-120ms,不是单纯 decode。 |
| 18 | QA#16:为什么只读 64KB header 仍会 84-121ms? | ✅ Resolved(trace verified) | Phase 17 改为 fetch response `arrayBuffer()` 一次,复用前 64KB 做尺寸探测;12:16 trace 显示 `headerSource=fetched-bytes` 且 `header=0~0.1ms`。 |
| 19 | QA#17:为什么 Phase 17 后仍 `fpsLow=3.6/frameMax=275ms`? | ✅ Resolved(trace verified) | 最大掉帧来自 stale 16.5MB `muzfetch`:用户已切到下一首,旧 `swapSeq=14` 仍 fetch/decode 2s 后才 stale。Phase 18 加 `AbortSignal`;12:28 trace 已看到旧 `swapSeq=16/18` 以 `phase=skip reason=aborted` 退出,不再有 2s stale fetch。 |
| 20 | QA#18:Phase 18 abort 后为什么仍 `fpsLow=3.6/frameMax=275ms`? | ✅ Resolved(trace verified) | Abort 已取消旧长尾,但旧 load 在切歌后立即启动,用户 200-300ms 内再切时浏览器可能已进入不可立即抢占的 ImageBitmap/fetch 管线。Phase 19 在 Pixi texture `loadMedia` 前加 180ms abortable settle gate;13:15 trace 已验证旧 `swapSeq=30/32/34/36/40/42` 不再进入 `background.texture fetch/decode`。 |
| 21 | QA#19:Phase 19 后为什么仍 `fpsAvg≈46/fpsLow=4.4`? | 🔲 Phase 20 code done, QA trace pending | 废弃 Pixi decode 已挡住,剩余为两个整图读:non-current `cover.preload.batch` stale/canceled 仍读 16.5MB,以及最终落地 Pixi 成功 `muzfetch fetch=876ms/decode=178ms`。Phase 20 先砍纯 wasted work:non-current 本地预加载延后 420ms,stale batch 不读 blob。 |
| 22 | QA#20:Phase 20 后为什么仍 `fpsLow≈5`? | 🔲 Phase 21 code done, QA trace pending | 13:32 trace 验证 non-current preload 已收敛(`requests=1/roleCurrent=1/maxSourceBytes=0`),剩余大头是最终成功 Pixi 仍读本地原图:`muzfetch bytes=13.36MB/fetch=846.6ms/decode=189.1ms/media.load=1323.3ms`,而 `texture.create/render` 只有 0.1/2.1ms。Phase 21 让 Pixi ambient cover 使用 `backlight` derivative,derivative pending 时 hidden 且 `fallbackToOriginal:false`。 |
| 23 | QA#21:Phase 21 后为什么仍 `fpsLow=3.3`? | 🔲 Phase 22 code done, QA trace pending | Pixi 原图输入已消失(成功 texture 为 192px WebP,6~14KB),但 `frameMax=299.9/heapMb 198→376` 仍出现,且当前 trace 没记录 full-cover `<img>` 实际 decode/paint。Stage `CoverImage` 会主动 `image.decode()` full-res cover 后再渲染。Phase 22 保留原图但 stage 改 `decode:false`,并补 `image.load/decode` trace。 |
| 24 | QA#22:Phase 22 后为什么仍 `image.decode surface=background`? | 🔲 Phase 23 code done, QA trace pending | active stage decode 已排除,Pixi 也只消费 192px derivative;剩余是 `now-playing-background` 在 Pixi derivative 分支仍为未渲染的 full-cover background 调 `useLoadedImageUrl(... decode=true)`。Phase 23 跳过这条冗余 load/decode。 |
| 25 | QA#23:Phase 23 后为什么仍 `image.load surface=now-playing`? | 🔲 Phase 24 code done, QA trace pending | background full-cover decode 已消失;剩余 full-cover 消费者是 player `CoverImage` 用 `new Image()` 做 `decode:false` preflight load。Phase 24 改为 DOM `<img onLoad>` gate,删除额外 JS Image。 |
| 26 | QA#24:Phase 24 后为什么仍掉帧? | 🔲 Bisect in progress | 已补 span 的 full-cover `new Image` 消费者全部消失,但 FPS 仍低;剩余归因需要大块隔离。Phase 25 使用临时诊断分支,先禁整个 `NowPlayingBackground`,再拆 Pixi/flow/visualizer/foreground。 |

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
| 2026-06-14 | User+Claude | **Phase 6 切歌 trace 仪表**(诊断):用户提供实测(无封面 120→115/low≈30、带封面 120→60/low 9~20),要更细 trace 看切歌全过程。排查确认 Q2 统计写库异步离帧、非帧开销。新增纯 helper `describeTrackSwitch`(4 例 TDD)→ enrich `player.playIndex`(sourceKind/hasCover/from/to/kind/origin);`flushPlaybackListen` 加 `listen.flush` trace。switch-trace(4)+ player-store(17)全绿,`tsc`/Biome 通过 |
| 2026-06-14 | User+Claude | **Phase 8 单一时钟 + QA#7**:throttle 后封面/背景/背光仍可错位(松手后其一卡在别的曲)。定位根因 = 3+ 个独立「当前曲」时钟(封面/背光 live、背景 settle、Pixi 再 settle、coverflow 状态机),无机制强制同切。用户拍板「全部 live index 一起切」。背景 + Pixi 改读 live `currentIndex`/`src`(删两层 settle),与封面/背光同源 → 结构上不可能显示不同曲。throttle 已 bound 速率,去 settle 只消滞后、不增上传频率。测试 18 绿。后续:512px(全 cache-hit 仍 heap+112MB 因 Pixi 整图 createImageBitmap)、音频 fade-on-switch |
| 2026-06-14 | User+Claude | **Phase 7 切歌限速 + QA#6 错位 bug**:用户报「长按快切松手后封面/背景其一与歌对不上」+ 提议设切换速度上限。定位错位根因 = 33/s 远超 180ms settle、多层 async/settle 各卡在不同中间曲。新增 `createTransportThrottle`(leading+trailing,clock 注入,4 例 TDD)接 `shortcuts/actions.ts` next/prev,限速 ~5/s(>settle 窗口)→ 根除错位 + 背景每切歌都跟变 + 封面看得清。`tsc`/Biome + 相关测试全绿。后续:512px 派生(单次切歌成本)+ 收紧背景同步 |
| 2026-06-14 | User+Claude | **QA#5 + Phase 5 A/B 回退 `warmDecode`**:Phase 6 trace 显示带封面快切真凶是 **heap +227MB(289→516)→ GC 长任务(166ms)→ FPS 104→27**,量化吻合 ~15 张新封面整图解码(~15MB/张)。`warmDecode` 强制每张缓存封面立即整图解码并被保留 → 放大堆。**回退**:改回 `warmImage`(remote 仅 set src)、本地不预热、删 `cover-warm-decode.ts`/test,保留 `decoding="async"`。`tsc`/Biome + swipeable(6)绿。待抓 trace 验证;若不足则重开 512px 派生(cover-quality PRD Phase 3) |
| 2026-06-14 | User+Codex | **QA#8 新 log + Phase 9 trace 补强**:新 trace 排除 QueuePanel(`queuePanel/systemPlaylist=0`),确认 tab 无关掉帧来自全局背景层:8 次带封面 blob 切歌、`background.pixi textureSwap` 12 次、stale 3 次、heap 167→390MB,cover URL/palette 都命中缓存。修复 copy trace 丢自定义 context 的格式化缺口;Pixi `setSource()` 分段 emit `textureSwap.start` / `media.load` / `texture.create` / `textureSwap.apply` / summary,带 `sourceKind/loader/bytes/width/height/loadMs/textureMs/renderMs`。TDD:trace(7)+pixi-controller(10)+background-texture(5)绿。 |
| 2026-06-14 | User+Codex | **QA#9 Phase 9 trace 结论**:分段字段成功定位新大头:两次切歌分别 `appInit=853ms/307ms`,而 `texture.create=0~0.1ms`,`renderMs=1.6~4.9ms`;`swapSeq/appInits` 每次从 1 开始,证明 Pixi controller 在 streamed/local-cover URL pending 窗口被卸载重建。新增 Phase 10:pending 时保持 Pixi mounted 但隐藏且 `src=null`,URL ready 后只换 texture,不显示 stale cover。 |
| 2026-06-14 | User+Codex | **Phase 10 代码完成**(TDD):`now-playing-background` 将“pending 时是否保留 Pixi 生命周期”从“是否保留上一张 cover URL”里拆出来;streamed/local-cover URL pending 时 `PixiPixelBackground` 继续 mounted、`src=null`、`opacity-0`,URL ready 后同一 shell 收到新 `src` 并回 `opacity-90`。新增测试覆盖不喂 stale URL + 不卸载 Pixi shell;`now-playing-background.test` 6 绿。待 QA trace 验证切歌不再每首 `appInit`。 |
| 2026-06-14 | User+Codex | **QA#10 Phase 10 trace 验证 + Phase 11**:新 trace 证明 Pixi app init churn 已修(`appInits=1`, `swapSeq 10→16`),但同一 16.5MB/3000px local-cover 先 `sourceKind=blob` decode 1410ms 后 stale,再 `sourceKind=muzfetch` decode 1106ms 成功,导致 `fpsLow=2.4`/`frameMaxMs=408.4`。新增 Phase 11:local-cover URL pending 时跳过 object URL fallback,补 `background.cover localCover.wait` trace。 |
| 2026-06-14 | User+Codex | **Phase 11 代码完成**(TDD):`useLocalCoverResource` 区分 row/url pending 与不可用;`now-playing-background` 在 pending 时不给 `useTrackCoverResource` 当前 track,Pixi hidden mounted 且不创建 `blob:`/`Image`,URL ready 后同 shell 收 `muzfetch:`。`now-playing-background.test` 7 绿。待 QA trace 验证不再出现同尺寸 `blob` stale → `muzfetch` 二次 decode。 |
| 2026-06-14 | User+Codex | **QA#11 + Phase 12**:用户指出 3000×3000 对现代电脑不应单独构成巨大压力。复核 10:55 trace 后修正归因:问题不是尺寸单点,而是 `localCover.wait` 前仍有一帧旧 settled `blob:` target 先进入 Pixi,启动不可取消的 stale ImageBitmap decode,随后 `muzfetch` 和下一首 decode 叠加。Phase 12 在 local-cover pending 首帧硬压 `renderPixiTarget/renderImageTarget=null`;新增测试锁定不再 replay previous settled Pixi target。 |
| 2026-06-14 | User+Codex | **QA#12 + Phase 13**:10:59 trace 显示 `localCover.wait` 仍会晚于 `sourceKind=blob` start。定位到 `useLocalCoverResource` 的 Dexie `useLiveQuery` deps 切换窗口:可能暂返上一张 mediaBlob row,旧 hook 未校验 `row.id === coverBlobId`,导致首帧误走 blob fallback。新增 row-id guard 与 hook 测试,stale row 现在返回 `pendingReason=row` 且不请求协议 URL。 |
| 2026-06-14 | User+Codex | **QA#13 trace 记录 + Phase 14 待办**:11:03 trace 验证 Phase 13 生效(`localCover.wait` 首帧出现,16.5MB blob→muzfetch 重复 decode 未复现,Pixi `appInits=1`)。剩余 `fpsAvg=46.9/fpsLow=7.5` 与 `cover.preload.batch lastMs=503 created=2 local=3 requests=3`、image blob live 增长对齐。新增 Phase 14:coverflow/local cover preload latest-only、in-flight dedupe 与 stale/cancel trace。 |
| 2026-06-14 | User+Codex | **Phase 14 代码完成(TDD)**:新增 `cover-preload.ts` 把 coverflow preload 从组件内联 effect 抽成可测 helper;本地 cover preload 按 cache key 做 in-flight dedupe,并用 batch sequence 阻止 stale batch 创建 object URL / 写 state;修复 stale 后 `coverUrlCache.acquire()` 占位 ref 泄漏。`cover.preload.batch` trace 现在带 `cacheHits/inflightHits/stale/canceled/maxSourceBytes` 与 current/previous/next/stack/settle 分布。新增 2 例 helper 测试 + 原 swipeable stage 6 例全绿;`typecheck`/Biome 通过。 |
| 2026-06-14 | User+Codex | **QA#14 Phase 14 trace 验证 + Phase 15 待办**:11:35 trace 显示 Phase 14 生效(`cover.preload.batch created=0 maxSourceBytes=0`,image blob live 稳定),local-cover wait 与 Pixi app lifecycle 也稳定。剩余掉帧对齐 Pixi `media.load loader=imageBitmap`:1500px 图 `loadMs=172.1`,800px 图 `loadMs=254.3`,而 `texture.create/renderMs` 仍 0-3ms。新增 Phase 15:Pixi 背景纹理独立 decode budget/降采样,stage/coverflow 仍保原图。 |
| 2026-06-14 | User+Codex | **Phase 15 代码完成(TDD)**:`background-texture.ts` 为 ImageBitmap loader 增加 `maxDimension`、PNG/JPEG/WebP 头部尺寸探测、`createImageBitmap(...,{ resizeWidth, resizeHeight, resizeQuality:"high" })` 与 resize option 不支持时的无 resize retry;Pixi 背景图片分支传 `BACKGROUND_IMAGE_BITMAP_MAX_DIMENSION=1024`,只降 ambient texture,stage/coverflow 仍保原图。`background.pixi` trace 增加 `sourceWidth/sourceHeight/resizeMaxDimension`。相关 25 例测试 + `typecheck`/Biome 通过。 |
| 2026-06-14 | User+Codex | **QA#15 trace + Phase 16 代码完成(TDD)**:11:53 trace 证明 1500px 源图已降到 1024px,但 `media.load` 仍 355-415ms,1024px 源图也 232ms;瓶颈不是单纯像素边长。新增 `background.texture fetch/header/decode` 分段 trace,并补 `background.cover localCover.fallback` 解释 wait 后合法回退 object URL 的原因。TDD:background-texture 7 例、now-playing-background 9 例通过。 |
| 2026-06-14 | User+Codex | **QA#16 trace + Phase 17 代码完成(TDD)**:11:59 trace 显示 `header` 与 `fetch` 也会成为长帧来源(`header=84.2/121.3ms`,`fetch=106.9ms`),Pixi GPU 侧仍仅 0-2ms。`loadImageBitmapSource` 支持 `{ blob, headerBytes }`,优先复用 fetch bytes 做尺寸探测并 trace `headerSource`;`pixi-pixel-background` 改为 response `arrayBuffer()` 一次生成 Blob + header bytes,避免 `blob.slice(...).arrayBuffer()` 二次读。TDD:background-texture 8 例、pixi-pixel-background 11 例通过。 |
| 2026-06-14 | User+Codex | **QA#17 trace + Phase 18 代码完成(TDD)**:12:16 trace 验证 Phase 17 生效(`headerSource=fetched-bytes`,`header=0~0.1ms`),但发现 stale 16.5MB `muzfetch` 旧 `swapSeq=14` 在用户切到下一首后仍 `fetch=1830ms/decode=181ms`,最后才 `textureSwap.stale`,同时 `fpsLow=3.6/frameMax=275ms/heapMb=366`。Phase 18 给 Pixi texture load 加 `AbortSignal`:新 source/null/destroy/recover 取消旧 load;AbortError 记 `phase=skip reason=aborted` 且不触发 `onError`。TDD:pixi-controller/background-texture/pixi-pixel-background 31 例通过。 |
| 2026-06-14 | User+Codex | **QA#18 trace + Phase 19 代码完成(TDD)**:12:28 trace 验证 Phase 18 生效(旧 `swapSeq=16/18` 已 `phase=skip reason=aborted`,无 2s stale `muzfetch`),但剩余窗口仍跌到 `fpsAvg≈49-67/fpsLow=3.6/frameMax=274.9`,因为 Pixi texture load 仍在切歌后立即启动,被 200-300ms 内的新歌覆盖时可能已进入 fetch/ImageBitmap decode。Phase 19 在 controller `loadMedia` 前加入 180ms abortable settle gate;`PixiPixelBackground` 只对环境背景特效启用。TDD:pixi-background-controller 13 例通过。 |
| 2026-06-14 | User+Codex | **QA#19 trace + Phase 20 代码完成(TDD)**:13:15 trace 验证 Phase 19 生效(旧 `swapSeq=30/32/34/36/40/42` 均 abort 且无 `background.texture fetch/decode`),但 `cover.preload.batch canceled=1/stale=1` 仍读 16.5MB 并耗时 291-583ms。Phase 20 将 current 与 non-current 本地 preload settle 分离:current 仍 140ms,previous/next/stack/settle 延后 420ms,stale batch 在读 blob 前 cancel。TDD:cover-preload + swipeable stage 共 10 例通过。 |
| 2026-06-14 | User+Codex | **QA#20 trace + Phase 21 代码完成(TDD)**:13:32 trace 验证 Phase 20 生效(`cover.preload.batch requests=1/roleCurrent=1/maxSourceBytes=0`),剩余低帧对齐最终 Pixi 成功 `muzfetch` 原图输入(13.36MB/3874px,`fetch=846.6ms`,`decode=189.1ms`,`media.load=1323.3ms`)。Phase 21 让 Pixi ambient cover 改用现有 `backlight` derivative object URL;derivative pending 时 Pixi shell hidden、`fallbackToOriginal:false`,并新增 `background.cover pixiCover.derivative` trace。TDD:`now-playing-background` 11 例 + 相关 cover/Pixi 21 例通过,`typecheck` 与 touched-file Biome 通过。 |
| 2026-06-14 | User+Codex | **QA#21 trace + Phase 22 代码完成(TDD)**:13:45 trace 验证 Phase 21 生效(成功 Pixi texture 已变 `image/webp 192×192`,6~14KB,无原图 `muzfetch`),但 `fpsLow=3.3/frameMax=299.9/heapMb 198→376` 仍在,且发生在 Pixi 小图之外。定位 trace 缺口:stage full-cover `<img>` 的主动 `useLoadedImageUrl()->image.decode()` 未被记录。Phase 22 为 `useLoadedImageUrl` 增加 `decode:false` 与 `image.load/decode` spans;Now Playing stage 保留原图但不主动 decode。TDD:use-image-load 3 例新增 + 受影响测试 22 例通过,`typecheck`/touched-file Biome 通过。 |
| 2026-06-14 | User+Codex | **QA#22 trace + Phase 23 代码完成(TDD)**:13:57 trace 验证 stage decode 已排除,但仍有 `image.load/decode surface=background decode=true` 800/1024/1500px。定位到 Pixi derivative 分支虽然使用 192px backlight,仍提前为未渲染的 full-cover background 调 `useLoadedImageUrl`。Phase 23 先红灯锁定 derivative ready/pending 不创建 `Image`,再把 `pixiMedia/shouldUsePixiCoverDerivative` 前置并传 `null` 给 full-cover loader。`now-playing-background` 11 例通过;待 QA trace 验证 `surface=background` decode 消失。 |
| 2026-06-14 | User+Codex | **QA#23 trace + Phase 24 代码完成(TDD)**:14:06 trace 验证 Phase 23 生效(无 `surface=background` load/decode),剩余 `image.load surface=now-playing decode=false` 仍为 1400~2000px full-cover。Phase 24 给 player `CoverImage` 增加 DOM-load strategy,stage/dock 用真实 `<img onLoad>` gate crossfade,不再创建额外 JS `Image`。TDD:`cover-image` 新红灯转绿;待 QA trace 验证 `surface=now-playing` image.load 消失。 |
| 2026-06-14 | User+Codex | **QA#24 trace + Phase 25 二分开始**:14:15 trace 验证 Phase 24 生效(`surface=now-playing/background` 的 `image.load/decode` 均消失),但仍有 `fpsLow≈5~15/frameMax≈66~183ms/longTaskMax≈214ms`。剩余可疑层转向全局背景合成、Pixi 192px derivative 的浏览器 decode/fetch queue、flow/visualizer mix-blend-mode、audio blob load。创建临时诊断分支 `diag/switch-fps-bisect`,按大块禁用 commit 做 QA 二分,诊断代码不合入产品分支。 |
