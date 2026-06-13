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
| 3 | GPU 后端 Settings 选项(auto / WebGPU / WebGL) | 🔲 Pending | [Phase 3](#phase-3-gpu-后端-settings-选项) |

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
  - 落定后(settledTrack 更新):持久 Pixi 把 settled 封面作纹理换上,crossfade 盖过即时 `<img>` 层。
  - **即时 `<img>` 层常驻底层(不淡出)**:单张已解码封面只是合成器里的一张静态纹理、无每帧开销,占用极低 → 让它常驻在 Pixi canvas 之下。好处:① 跳歌时永远有封面可看;② 充当 Pixi 还在升温 / WebGPU device-lost 恢复期的**兜底层**(见 §6 Phase 3 device-lost),用户永不见黑屏。
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

- `settledTrack`:在 `now-playing-background`(或一个小 hook `useSettledTrack(currentId, ms)`)里,对 `current?.id` 做尾随去抖。`current` 立即驱动 `<img>`;`settled` 驱动所有重计算。
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
- [ ] `AppSettings.backgroundGpuBackend` + `backgroundGpuPowerPreference`,二者 `DEFAULT_SETTINGS: "auto"`(§3.1)。
- [ ] `resolveGpuBackend(pref)`:`pref==="webgpu"` 或 `auto` 且 `navigator.gpu` 可用 → `"webgpu"`,否则 `"webgl"`;喂 Pixi `init({ preference })`。可单测(注入 `navigator.gpu` 存在与否)。
- [ ] `resolveGpuPower(pref)`:`auto` → `"high-performance"`(默认优先性能),`"low-power"` 用户显式才用;喂 Pixi `init({ powerPreference })`。可单测。
- [ ] Settings 背景面板加两个选择器(后端 / 性能档)+ i18n 文案 + 「已回退」副文案。
- [ ] 改后端/性能档 → 持久 Pixi app 重建一次(复用 Phase 1 的 effect 依赖 `backend`/`power`)。
- [ ] **device-lost 恢复(best practice):**
  - WebGPU:`await device.lost` → 若 `reason !== "destroyed"`,判为意外丢失 → 重建 app + 回灌当前 settled 纹理 + `render()` 一次;恢复期间显示常驻 `<img>` 兜底层(§5.1)。
  - WebGL:监听 `webglcontextlost`(`preventDefault()`)/ `webglcontextrestored` → 重建路径同上(对照现有 [`reactive-scene.tsx:135`](../../../src/visualizer/scene/reactive-scene.tsx#L135) 的处理)。
  - 重建只尝试有限次(如 1–2 次),仍失败则停留在 `<img>` 兜底,不无限重试、不报错弹窗。

**Checklist:**
- [ ] auto 在支持设备走 WebGPU + high-performance、不支持走 WebGL,均正常出图。
- [ ] 显式 WebGPU 在 WKWebView 不支持时回退且有提示,不崩。
- [ ] 切后端/性能档不影响切歌「只换纹理」的行为。
- [ ] 模拟 device-lost(或切换独显/集显)后能自动恢复出图,恢复期不黑屏。

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
| 2 | 即时 `<img>` 层落定后淡出还是常驻底层? | ✅ Resolved | **常驻底层**——单张静态封面合成开销极低,且充当 device-lost/升温期兜底(§5.1) |
| 3 | auto 是否也把 `powerPreference` 提到 high-performance? | ✅ Resolved | **是**。新增 `backgroundGpuPowerPreference`,auto→`high-performance`;后端与性能档都默认 auto=选性能好的,可手动覆盖(§3.1 / §5.2 / Phase 3) |
| 4 | WebGPU 的 device-lost 恢复路径? | ✅ Resolved | `device.lost`(非 destroyed)+ `webglcontextlost/restored` → 有限次重建 + 回灌纹理,恢复期回退 `<img>`(Phase 3) |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-13 | Claude | 初稿:持久化 Pixi + 切歌 settle 闸门 + GPU 后端可选 |
| 2026-06-13 | Claude | 拍板 4 个 Open Question:独立 settle 常量(不暴露)、`<img>` 常驻底层、新增性能档 auto→高性能、device-lost best-practice 恢复 |
| 2026-06-13 | Claude | Phase 1 代码完成:`pixi-background-controller`(DI + 持久 app + 纹理热替换)+ 组件重构 + 6 例单测;切歌不再重建 WebGL App。待桌面 GPU/视觉实测 |
| 2026-06-13 | Claude | Phase 2 代码完成:`useSettledValue` 去抖(纹理上传 debounce)+ 常驻即时 `<img>` + O1 backlight gate;9 例新单测。封面逐张即时、重计算落定才跑 |
