# PRD: MUZERO 移动端原生移植（全原生双栈 SwiftUI + Jetpack Compose + 语言中立契约规格）

**Status:** Draft
**Created:** 2026-06-16
**Author:** DoodleBear / MUZERO
**Module:** Mobile（iOS / Android）—— 在 web 端成熟后，把 MUZERO 移植为**两套全原生 App**：**iOS = Swift/SwiftUI、Android = Kotlin/Jetpack Compose**，**不用 KMP/跨端共享代码**；仅把 **`TrackBrief` 契约 + 少数正确性关键逻辑**以**语言中立规格**（JSON Schema codegen + golden 测试向量）作单一真源防漂移（= **Option C + spec guard**，2026-06-16 经四轮 deep research 比选 A/B/C + AI 编程效率 + 生态人才后定，见 §2.1）。复现桌面/web 已有的播放、特效、可视化、DJ 续歌与「音乐承载回忆」体验。

> 决策历程：A（KMP+CMP 全共享 UI）→ B（KMP 共享逻辑+原生 UI）→ **C+spec guard（全原生+契约规格）**。逐步右移的原因：我们的硬骨头本就平台专属、shader 在任何方案都是两份、**而 builder 是 solo + 重度 AI 辅助**——KMP 的工具链/interop/构建税对单人无团队摊薄，AI 在主流原生上更熟更少错，可共享面又只有 ~1,500 LOC。详见 §2.1。

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 0 | **地基 + 双高风险 spike**：建两套原生工程骨架（iOS/Android）+ **契约规格**（`TrackBrief` JSON Schema → 双语 codegen）+ **golden 测试向量**雏形；**先 de-risk**：(a) 1 个 flow shader 在 iOS=Metal / Android=AGSL 双端跑通；(b) iOS/Android FFT tap 双端取实时频谱 | 🔲 Pending | [Phase 0 Checklist](#phase-0-checklist) |
| 1 | **数据层 + 契约**：iOS GRDB / Android Room（各自原生 DB，codename 不变）+ 媒体字节落文件系统；`TrackBrief` 双语类型从 JSON Schema 生成 | 🔲 Pending | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | **音频引擎**：Media3/ExoPlayer(Android) + AVPlayer/AVAudioEngine(iOS) + 后台音频 + 锁屏；**队列数学双语实现 + golden 向量守护** | 🔲 Pending | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | **DJ 续歌循环**：LLM brain（Android 可用官方 anthropic/openai-java；iOS 用 Swift SDK/REST）+ musicgen cloud provider（双语实现轮询）+ BYOK 安全存储；**DJ 决策/brief 校验 golden 向量** | 🔲 Pending | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | **2D 频谱可视化**：FFT → 八度分带（双语实现 + golden 向量）→ Android Compose Canvas / iOS SwiftUI Canvas 画 bars/radial/led-reflex/waveform | 🔲 Pending | [Phase 4 Checklist](#phase-4-checklist) |
| 5 | **流光背景（着色器）**：curate 子集 flow shader（iOS=Metal / Android=AGSL，GLSL 作 spec）+ 多色取色（双语量化 + golden 向量）+ 合成/混合模式 | 🔲 Pending | [Phase 5 Checklist](#phase-5-checklist) |
| 6 | **Now Playing + 歌词 + 取色**：同步歌词（各端原生 + 共享动效参数/解析向量）、封面（Coil/AsyncImage）、palette glide | 🔲 Pending | [Phase 6 Checklist](#phase-6-checklist) |
| 7 | **打磨 / 设备分级 / i18n / 性能 CI 门禁 / v1 裁剪复核** | 🔲 Pending | [Phase 7 Checklist](#phase-7-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending
>
> 本 PRD 适用 [`prd-create.md`](../../../../.cursor/commands/prd-create.md) 的 **§3「Effect / Shader / 外部依赖类」**（license 第一公民、curate 不穷举、bundle 预算、i18n 四语、不散落硬编码、shader uniform prelude 约定、**基础设施先于覆盖广度**、回退=`git revert`）与 **§4「realtime preview 性能类」**（先定**测量方法学**、prod build 复测、reduced-motion / 可见性暂停）。这是**新平台**而非在既有 web 树上改，「不引入新 runtime owner」按「每个原生依赖逐个 license/维护度 ship 判定」执行（§2.4）。

---

## 1. Overview

### 1.1 Background — 需求来源

PM：web 端完善后开发移动端，要**原生体验**。最初设想 KMP；经四轮 deep research（架构/库映射/OSS 佐证/AI 效率/生态人才，来源见 §9）+ 仓库三路 Explore 清单，**结论右移到「全原生双栈 + 语言中立契约规格」（C + spec guard）**：对一个 **solo + 重度 AI 辅助** 的 builder，KMP 的收益（共享 ~1,500 LOC 纯逻辑）不足以抵其工具链/interop/构建/学习税，而原生有**更大的 AI 语料 + 社区 Q&A + day-one 平台 API + 最简工具链**。唯一要防的「逻辑漂移」用**契约规格 + golden 测试向量**这层薄机制解决，无需 KMP。

> 研究已核验项标引用；未核验/团队判断标 ⚠️，入 §10 Open Questions——不混淆事实与推断。

### 1.2 现状盘点（要被复现的特效 / 功能 + 当前渲染技术）

MUZERO 当前是 **Electron + Tauri 2 + React 19 + TS**，整个 App 是前端，重度依赖浏览器图形/音频 API。要复现清单（含当前技术）：

| 能力 | 当前实现 | 关键 web API / 库 |
|---|---|---|
| **音频播放** | 单持久 `<audio>`/`<video>`（[`media-engine.ts`](../../../../src/player/media-engine.ts)），object-URL revoke-before-replace | `HTMLMediaElement`、`AudioContext` |
| **音频分析** | `AnalyserNode` FFT → 八度对数分带（[`spectrum/bands.ts`](../../../../src/visualizer/spectrum/bands.ts)）+ bass/mid/treble/energy（[`audio-uniforms.ts`](../../../../src/visualizer/scene/audio-uniforms.ts)） | Web Audio `AnalyserNode` |
| **2D 频谱** | bars/radial/led-reflex(倒影)/waveform，Canvas 2D（渐变/路径/阴影），~60fps，跟随 `--primary`（[`src/visualizer/spectrum/`](../../../../src/visualizer/spectrum/)） | Canvas 2D |
| **流光背景** | **14 个自研 GLSL ES 1.0 fragment shader**（fbm/noise/voronoi/metaball/gradient，[`flow-shaders.ts`](../../../../src/visualizer/scene/flow-shaders.ts)），多色 `uColors[5]` + 轻度音频，twgl WebGL，独立合成层 + CSS `mix-blend-mode` | WebGL + `twgl.js` + CSS blend |
| **背景滤镜 + 封面交叉淡化** | pixel/ASCII/CRT/cross-hatch/dot/noise（[`pixi-pixel-background.tsx`](../../../../src/components/player/pixi-pixel-background.tsx)），常驻 filter 下 cover→cover 360ms crossfade | `pixi.js` v8 + `pixi-filters` |
| **封面取色** | 零依赖 canvas 量化（[`image-palette.ts`](../../../../src/lib/image-palette.ts)）→ 多色 palette → 900ms EMA 过渡（[`visualizer-color-store.ts`](../../../../src/stores/visualizer-color-store.ts)） | Canvas `getImageData` |
| **同步歌词** | AMLL/Apple-Music 风：DOM 行 + spring/tween 跟随，3 动效（classic/inertial/cascade，[`lyric-motion.ts`](../../../../src/lyrics/lyric-motion.ts)），Lenis 动量，beat-exact 高亮 | DOM + `motion` + `lenis` |
| **动画/转场/列表** | View Transitions API + Framer Motion 共享元素；TanStack Virtual | VT API / `motion` / virtual |
| **本地数据** | IndexedDB（Dexie，25 版；`tracks`/`sessions`/`mediaBlobs`…blob 进 `mediaBlobs`）+ `useLiveQuery` | IndexedDB + `dexie` |
| **DJ 续歌** | LLM（Vercel AI SDK `generateObject` 结构化）写 Zod 校验的 `TrackBrief`（[`dj-brief-schema.ts`](../../../../src/dj/dj-brief-schema.ts)）→ 可插拔 provider submit→poll→download（[`cloud-job.ts`](../../../../src/musicgen/cloud-job.ts)）；BYOK 本地 | `ai` SDK + `zod` |
| **出站 HTTP** | BYOK LLM + musicgen，桌面经 `muzfetch://`/Tauri http 绕 CORS（[`platform.ts`](../../../../src/lib/platform.ts)） | bridge fetch |

### 1.3 关键认知（决定整份 PRD 的判断基准）

> **① 全原生 = 逻辑各端各写一遍（Swift + Kotlin），但「危险的部分」用规格单源守护。** 不再用 KMP 共享 Kotlin。纯「皇冠逻辑」（队列/DJ/brief/分带/取色）在 iOS 与 Android **各实现一份**，靠**语言中立的 golden 测试向量**（同一份 JSON 输入→期望输出，两端都必须通过）锁定行为一致；`TrackBrief` 契约由 **JSON Schema 单源 codegen** 出 Swift `Codable` + Kotlin `@Serializable`，杜绝契约漂移。

> **② 为什么不是 KMP（B）**：solo + 重度 AI 的 profile 下，KMP 的「共享 ~1,500 LOC」省不过它的税——Kotlin/Native 构建慢、Kotlin→Obj-C→Swift interop 有损（idiomatic Swift Export 仍 Alpha、2026 才计划 stable，需 SKIE 兜）、iOS 工具链 DX JetBrains 自己承认「仍有改进空间」、CMP-iOS 2025-05 才 stable；而 AI 对主流 SwiftUI/Compose 语料更厚、更少出 CMP 专属错误（如在 commonMain 误引只有 Android 产物的库）。无团队可摊薄学习/工具链税（§2.1）。

> **③ 原生反而消两类 web 包袱**：(a) **无 CORS**——native HTTP 直连 BYOK API，`muzfetch://` 代理可删；(b) **后台音频/锁屏是平台一等公民**（MediaSession / MPNowPlayingInfoCenter）。**且因 Android 现在是独立 JVM/Kotlin**（非 KMP），DJ brain 可直接用**官方 anthropic-java / openai-java**（JVM）——不再受「必须全 KMP 才能喂 iOS」约束（§2.3）。

> **④ 代价（诚实）**：逻辑写两遍 = 双倍逻辑工 + 漂移风险。缓解 = §2.5 的契约规格 + golden 向量；但「AI 能否长期把两份实现保持同步」**本研究无基准、是决定性未知**（§10 Q1）。**翻盘条件**：若共享逻辑面**变大且高频 churn**，或编码**难以 golden 测试的微妙不变量**，应回到 KMP（B）。

### 1.4 Target Users

| Role | Description | 关注点 |
|------|-------------|--------|
| **移动沉浸用户** | iOS/Android 手持，竖屏为主 | Now Playing 流光氛围、跟封面变色、流畅不烫手不掉电；后台播放 + 锁屏控制 |
| **「音乐承载回忆」用户** | 上传音视频 + tag/note/cover 混合歌单 | 移动端也能听自己的歌、看注释、喂进 DJ |
| **DJ 续歌用户** | 配 BYOK key 让 LLM+musicgen 续歌 | 移动端发起/继续 DJ 集，密钥安全存设备 |
| **低端机/省电用户** | 老旧 Android/弱 GPU | 设备分级降级特效，reduced-motion，不卡不烫 |
| **跨端用户** | 同时用桌面+移动 | 体验一致；数据各端本地（已知限制，§3.5） |

### 1.5 Core Value

1. **真原生体验 + 最高 AI 编码效率**：UI/特效全用各端最成熟、AI 语料最厚的栈（SwiftUI / Jetpack Compose）——day-one 拿新平台 API，最简工具链，AI 出错率最低。
2. **本地优先不变**：移动端依然「存储层无后端无云」——iOS GRDB / Android Room 本地库 + 文件系统，仅 BYOK LLM/musicgen 出站。codename 层（`muzero-db` 语义 / id 前缀 / `TrackBrief` 字段 / provider id）不变（§3.5）。
3. **危险部分单源守护**：`TrackBrief` 契约 = JSON Schema 单源 codegen；队列/DJ/分带/取色 = 语言中立 golden 测试向量两端共守——**不引入 KMP 机器也能防漂移**。
4. **特效有取舍地复现**：高价值（流光/频谱/取色/歌词）原生复现；高成本低收益（Pixi 滤镜全家桶、Lenis、exotic blend）**v1 裁剪/简化**（§7）。
5. **架构最简、可回退**：两套独立原生工程，无跨端抽象泄漏；回退=`git revert`，不藏 runtime flag。

---

## 2. System Architecture

### 2.1 选型决策：A / B / C 比选（四轮 research）+ 为什么 solo+AI 落在 C

**决策（2026-06-16）：Option C + spec guard——两套全原生 App + 语言中立契约规格。**

| 方案 | 共享什么 | iOS 手感 | shader | 关键逻辑 | AI 编码友好 | 工具链税 | 对 solo 判定 |
|---|---|---|---|---|---|---|---|
| **A**：KMP + CMP 共享 UI | 逻辑 + UI | ⚠️ Material 默认/无 Cupertino/滚动 parity 证伪 [^cm18] | ✅ 一份 SkSL（Skiko） | ✅ 单源 | ⚠️ CMP idiom AI 更易错 [^composeai] | KMP+Skiko | ❌ |
| **B**：KMP 共享逻辑 + 原生 UI | 仅逻辑 | ✅ 真原生 | ❌ Metal+AGSL 两份 | ✅ 单源 | ✅ 主流 UI / ⚠️ interop idiom | KMP+SKIE，**solo 难摊薄** | ⛔ 次选 |
| **C**：全原生两套 + **spec guard** | **仅契约+测试向量** | ✅ 真原生 | ❌ Metal+AGSL 两份 | ⚠️ 各写一遍，**golden 向量守护** | ✅✅ 最熟最少错 | **最简**（无 KMP） | ✅ **采用** |

**支撑 C 的核验证据（第四轮 research，solo+AI 视角）**：
- **生态/语料**：KMP 仅占 Kotlin 开发者 **18%（2025，2024 为 7%）**[^deveco]；Swift 5.4% vs Kotlin 10.8%（SO 2025，⚠️ Kotlin 含大量后端，非 mobile 净值，仅**界定**非测量）[^so2025]。原生语料/Q&A ≫ KMP → **AI 在原生上更熟**。
- **AI 专属错误**：AI 在 CMP 会犯**单端原生不可能触发**的结构性错（在 commonMain 引只有 Android 产物的库、破 iOS 编译）[^composeai]；AI 是主流工作流（62–85% 开发者用 AI [^deveco]）→ **以 solo+AI 为决策透镜成立**。
- **KMP 税（JetBrains 自认，2025-08）**[^kmproadmap]：Kotlin/Native 构建慢；iOS interop 经 Obj-C 有损、idiomatic Swift Export 仍 Alpha（2026 才计划 stable，故需 SKIE）；「iOS DX 仍有改进空间」。CMP-iOS 2025-05 才 stable [^cm18]，SwiftUI(2019)/Compose(2021) 远更成熟；原生 **day-one 新平台 API**[^swiftuiwhatsnew]。
- **可共享面小**：~1,500 LOC 纯逻辑；硬骨头（音频/FFT/DB/shader/安全存储）**三方案都平台专属**——B 能多省的有限。

**唯一真实代价 + 缓解**：逻辑写两遍有漂移风险；用 **§2.5 契约规格 + golden 向量**把「危险部分」单源化。**决定性未知**（§10 Q1）：AI 能否长期把两份实现保持同步——本研究无基准，故 C 为**中等置信**。**翻盘回 B**：共享逻辑变大/高频 churn，或微妙不变量难以 golden 测试。

> ⚠️ **诚实标注**：「KMP 是 niche、纯属更难」这类 skill-tax 框架在对抗核验中**被证伪**——反对 KMP **不靠**「KMP 难」，而靠上述具体 friction（interop/构建/DX/API 滞后）+ 小共享面经济性。KMP 在快速改进（Swift Export 2026 计划 stable、构建已快 40%）——若移动端开工在 2026 末后，**重新复核本结论**（§10 Q4）。

### 2.2 模块结构：两套独立原生工程 + 一个「规格」目录（无 KMP）

```
muzero-mobile/                       # 可与 web 同仓子目录 or 独立仓（Open Q）
├── shared-spec/                     # ★ 语言中立单源（不是 KMP 模块，只是数据+脚本）
│   ├── track-brief.schema.json      #   TrackBrief 契约（唯一真源）→ codegen 双语类型
│   ├── codegen/                     #   quicktype/openapi-generator 脚本：→ Swift Codable + Kotlin @Serializable
│   └── golden/                      #   golden 测试向量（JSON 输入→期望输出）：
│                                    #     queue（next/prev/shuffle/refill）、dj（brief 应用）、bands（分带）、palette（取色）
├── iosApp/                          # iOS 全原生（Swift/SwiftUI）
│   ├── UI（SwiftUI）/ Audio（AVPlayer+AVAudioEngine）/ FFT（vDSP）/ Shader（Metal）
│   ├── DB（GRDB）/ Net（URLSession）/ Image（AsyncImage·Kingfisher）/ KeychainBYOK
│   └── Core（queue/dj/bands/palette 的 Swift 实现，受 golden 向量约束）
└── androidApp/                      # Android 全原生（Kotlin/Jetpack Compose）
    ├── UI（Compose）/ Audio（Media3）/ FFT（AudioProcessor+KissFFT）/ Shader（AGSL）
    ├── DB（Room）/ Net（OkHttp/Ktor）/ Image（Coil 3）/ KeystoreBYOK
    └── Core（queue/dj/bands/palette 的 Kotlin 实现，受 golden 向量约束）
```

- **没有 commonMain / 没有 SKIE / 没有 KMP Gradle 跨端**。两套工程各自最简：Xcode + SwiftPM；Gradle + AGP。
- **唯一「共享」是 `shared-spec/`**：纯数据（JSON Schema + golden 向量）+ 一个 codegen 步骤。CI 在两端各跑 golden 向量，任一端实现偏离即 fail。
- **DI**：各端原生（iOS 手动/Factory/Swinject；Android Hilt 或手动）。
- **状态**：iOS `@Observable`/`@State`；Android `StateFlow`+`collectAsState`。沿用 CLAUDE.md 规则 6 纪律（最小订阅、非响应式单例不进 state）。

### 2.3 技术栈总映射表（web → 各端原生）

> 每行附**可行性**（High/Medium/Hard）与**可信度**（✅=research 核验；⚠️=团队判断/未覆盖，见 §10）。

| 子系统 | 当前 web | iOS（Swift） | Android（Kotlin） | 可行性 | 可信度 |
|---|---|---|---|---|---|
| UI 框架 | React+DOM | **SwiftUI** | **Jetpack Compose** | High | ✅ [^cm18][^swiftuiwhatsnew] |
| 契约类型 | Zod `TrackBrief` | `Codable`（codegen） | `@Serializable`（codegen） | High | ⚠️（JSON Schema 单源） |
| 关键逻辑守护 | 单测 | **golden 向量** | **golden 向量** | High | ⚠️ |
| 音频播放 | `HTMLMediaElement` | **AVPlayer/AVAudioEngine** | **Media3/ExoPlayer** | High | ✅(机制)/⚠️(封装) |
| 后台/锁屏 | （无） | **AVAudioSession+MPNowPlayingInfoCenter/MPRemoteCommandCenter** | **MediaSessionService** | High（净收益） | ⚠️ |
| 音频 FFT | `AnalyserNode` | **AVAudioEngine installTap + vDSP** | **Media3 AudioProcessor PCM tap + KissFFT** | iOS High / Android Medium | iOS ✅ [^tempi][^vdsp] / And ✅(机制) [^media3] |
| 分带数学 | `bands.ts` | Swift 实现 | Kotlin 实现（**golden 向量同守**） | High | ✅(八度机制) [^tempi] |
| 2D 频谱 | Canvas 2D | **SwiftUI `Canvas`/Metal** | **Compose `Canvas`(DrawScope)** | High | ⚠️ |
| 流光 shader | GLSL+twgl | **Metal(MSL)** | **AGSL `RuntimeShader`**（AGSL≈SkSL，GLSL 作 spec） | Medium（最大风险） | ✅(机制) [^skiareadme] |
| 混合模式 | CSS blend | SwiftUI `.blendMode`/Metal | Compose `BlendMode`/`RenderEffect` | Medium | ⚠️ |
| Pixi 滤镜 | pixi-filters | Metal 逐个 | AGSL/`RenderEffect` 逐个 | Hard | ⚠️（v2） |
| 取色 | canvas 量化 | Swift 量化（`CGImage`） | Kotlin 量化（`Bitmap`）（**golden 向量同守**） | High | ⚠️ |
| 同步歌词 | DOM+motion | SwiftUI `ScrollViewReader`/`LazyVStack`+原生动画 | Compose `LazyColumn`+`Animatable`（**共享动效参数/解析向量**） | Medium | ⚠️ |
| 动量滚动 | Lenis | 原生 | 原生 | High（简化） | ⚠️ |
| 转场/共享元素 | VT+Framer | `matchedGeometryEffect`/`.transition` | Compose shared-element | Medium | ⚠️ |
| 虚拟列表 | TanStack Virtual | `List`/`LazyVStack` | `LazyColumn` | High | ⚠️ |
| 本地 DB | Dexie/IndexedDB | **GRDB.swift**（SQLite+响应式） | **Room**（Flow 响应式） | Medium | ⚠️ |
| 响应式读 | `useLiveQuery` | GRDB `ValueObservation` | Room `Flow` | High | ⚠️ |
| 媒体字节 | `mediaBlobs` blob | 文件系统 + DB 存路径 | 同 | High | ⚠️ |
| DJ LLM brain | Vercel AI `generateObject` | Swift Anthropic/OpenAI SDK 或 URLSession+REST | **官方 anthropic-java/openai-java（JVM 可用！）** 或 Koog | High | ✅(SDK 存在) [^kotlinai][^koog] |
| 结构化输出 | Zod | `Codable` + tool-use JSON schema | `@Serializable` + tool-use | High | ✅(机制) [^xemantic] |
| 出站 HTTP | `getAppFetch`/muzfetch | **URLSession**（无 CORS） | **OkHttp/Ktor**（无 CORS） | High | ⚠️(常识) |
| 图片加载 | `<img>`/objectURL | **AsyncImage/Kingfisher/Nuke** | **Coil 3** | High | ✅(Android) [^coil] |
| i18n | i18next | String Catalogs(`.xcstrings`) | `strings.xml`（en 源） | High | ⚠️ |

### 2.4 依赖 license / 维护度清单（license 第一公民）

| 库/技术 | 用途 | 端 | License | ship 判定 |
|---|---|---|---|---|
| SwiftUI / Jetpack Compose | UI | iOS/And | Apple / Apache-2.0 | ✅（系统/官方） |
| AVFoundation / Accelerate(vDSP) | 播放/FFT | iOS | Apple | ✅ |
| AndroidX Media3 / ExoPlayer | 播放/FFT tap | And | Apache-2.0 | ✅ |
| Metal / AGSL `RuntimeShader` | shader | iOS/And | Apple / Apache-2.0 | ✅ |
| GRDB.swift | iOS DB | iOS | MIT | ✅ |
| Room | Android DB | And | Apache-2.0 | ✅ |
| URLSession / OkHttp / Ktor | HTTP | iOS/And | Apple / Apache-2.0 | ✅ |
| Coil 3 (+coil-network-ktor3) | 图片 | And | Apache-2.0 | ✅ |
| Kingfisher / Nuke | 图片 | iOS | MIT | ✅（择一） |
| KissFFT / Noise | Android FFT | And | MIT/类 MIT | ⚠️ Android FFT 待 spike（§5.2） |
| **官方 anthropic-java / openai-java** | DJ brain | And | MIT/Apache | ✅（**Android 现可用**，非 KMP 约束解除）[^kotlinai] |
| Koog | DJ brain（备选） | And | Apache-2.0 | ✅ [^koog] |
| Swift LLM SDK / 直连 REST | DJ brain | iOS | 各异 | ⚠️ 选型待定（或 URLSession+Codable 直连） |
| quicktype / openapi-generator | 契约 codegen | spec | Apache-2.0 | ✅ |
| kotlinx.serialization | 序列化 | And | Apache-2.0 | ✅ |

> **不再需要**：KMP、Skiko、SKIE、Koin-KMP、SQLDelight/Room-KMP 跨端、ktor-darwin——全原生不引入这些跨端机器。版本快速演进的（Coil/Media3/Koog/GRDB）在 PR 锁版本。

### 2.5 现有「皇冠逻辑」如何不漂移地双语实现（spec guard 核心）

下列纯逻辑（无 DOM/浏览器 API）是 App 命脉。**C 不共享代码 → 各端各写一份 + 语言中立 golden 向量守护**：

| 模块 | 当前文件 | ~LOC | spec guard 做法 |
|---|---|---|---|
| 队列数学 | [`queue.ts`](../../../../src/player/queue.ts)+[`play-queue.ts`](../../../../src/player/play-queue.ts) | ~185 | golden 向量：序列输入→`next/prev/shuffle/insertNext/refill` 期望结果 |
| DJ 编排 | [`dj-engine.ts`](../../../../src/dj/dj-engine.ts)+[`dj-prompt.ts`](../../../../src/dj/dj-prompt.ts) | ~270 | 向量：context→draft/refill 决策；`shouldAutoExtend` 真值表 |
| **brief 契约** | [`dj-brief-schema.ts`](../../../../src/dj/dj-brief-schema.ts) | ~48 | **JSON Schema 单源 → codegen 双语类型**（最关键，零漂移） |
| 轮询状态机 | [`cloud-job.ts`](../../../../src/musicgen/cloud-job.ts) | ~78 | 向量：注入 now/sleep 序列→状态迁移 |
| provider 映射 | [`cloud-provider.ts`](../../../../src/musicgen/cloud-provider.ts) 三纯函数 | ~40 | 向量：brief→body / json→parsed |
| 搜索 | [`track-search.ts`](../../../../src/lib/track-search.ts) | ~100+ | 向量：query+曲库→命中集（CJK 转写各端用原生库） |
| 显示回退 | [`track-display.ts`](../../../../src/lib/track-display.ts) | ~93 | 向量：track→stage（video→cover→title） |
| 流光配置 | [`flow-config.ts`](../../../../src/lib/flow-config.ts) | ~174 | 向量：source+palette+custom→colors |
| 分带数学 | [`bands.ts`](../../../../src/visualizer/spectrum/bands.ts) | ~80 | 向量：FFT bins→bands（八度/tilt/decay） |
| 取色量化 | [`image-palette.ts`](../../../../src/lib/image-palette.ts) `selectImagePalette` | ~100 | 向量：像素数组→palette |
| palette 过渡 | [`visualizer-color-store.ts`](../../../../src/stores/visualizer-color-store.ts) `mixPalette` | ~30 | 向量：from+to+t→插值 |

> **golden 向量 = 桌面 TS 单测的「输入/期望输出」抽成语言中立 JSON**（从现有 [`*.test.ts`](../../../../src/player/play-queue.test.ts) 导出），iOS Swift 与 Android Kotlin 各跑同一份向量。改 `TrackBrief` 字段 = 改 JSON Schema 单源 → 双语 codegen 自动对齐 + 桌面 Zod 三处仍各自校验（跨端契约不漂移）。**这层就是 C 相对「纯 C」多出的、也是 KMP「单一真源」价值的轻量替代。**

### 2.6 参考开源项目（按 Option C 校准）

四轮 research 找的同类 OSS：

| repo | 是什么 | License | 对 C 的用法 |
|---|---|---|---|
| **FoedusProgramme/Gramophone** [^gramo] | **原生 Android** 音乐播放器（Media3 + LRC/TTML/SRT 逐词卡拉OK） | GPL-3.0 | **Android 端最贴的模板**（原生 Kotlin+Media3+歌词）；仅学模式，GPL 勿抄码 |
| **androidx/media** + **dzolnai/ExoVisualizer** [^media3] | Media3 官方 + AudioProcessor 可视化 | Apache-2.0 | Android FFT tap（`TeeAudioProcessor`→PCM）一等机制 |
| **jscalo/tempi-fft** [^tempi] | iOS 实时 FFT（vDSP+八度分带） | CC0 | iOS FFT 技法（⚠️ 取麦克风，播放节点 tap 见 §10） |
| **SimpMusic / music-assistant** [^simp][^ma] | **KMP/CMP** 音乐 App | GPL / Apache | 现在**仅佐证 Android 侧库选**（Media3/Coil/Room/OkHttp）；**不抄其 KMP 共享 UI**（我们不走 KMP） |
| **Kicks** [^kicks] | KMM expect/actual ExoPlayer/AVPlayer | null | 仅参考「Media3 vs AVPlayer 各端 API 形状」（不取 KMP 部分） |
| Shader-Animation-CMP / KMPLiquidGlass [^shadercmp] | CMP shader | 无 / Apache | **AGSL 移植参考**（AGSL≈SkSL）；iOS 改 Metal |
| AMLL [^amll] | Apple Music 风歌词（web TS+Pixi） | AGPL | 仅**行为参考**（不可复用） |

> **license 红线**：GPL/AGPL/无 license（Gramophone/SimpMusic/AMLL/Shader-Animation-CMP）只学模式不抄码。可借代码=Media3/tempi-fft(CC0)/Coil/GRDB/Kingfisher(MIT)。
> **覆盖缺口**：无单一 OSS 同时做「本地优先+音频+FFT+shader+iOS」——分散在各 repo；MUZERO 是集成别人分散做过的事。Android 侧有 Gramophone 这种强原生范本；iOS 侧无等价开源全功能范本（自建为主）。

---

## 3. Data Model Design（数据层）

### 3.1 各端原生 DB（无共享 DB）

C 不共享 DB → **iOS = GRDB.swift**（SQLite + `ValueObservation` 响应式，贴合我们关系型心智）；**Android = Room**（`Flow` 响应式）。两端 schema 形状一致（以桌面 Dexie v25 等价目标建初始 schema，不重放 25 次迁移），但各自原生迁移。

> ⚠️ 团队判断（§10）：iOS DB 也可选 SQLite.swift / SwiftData；GRDB 因成熟 + 响应式 + SQLite 直观推荐。Phase 0 各搭一个响应式查询 demo 确认。

### 3.2 codename 不变（规则 4）

DB 名沿用 **`muzero-db`** 语义；表名 `tracks`/`sessions`/`mediaBlobs`/`settings`/`playQueue`/`memories`/`lyrics`…一致；id 前缀 **`trk_`/`ses_`/`blb_`/`mem_`/`pqe_`** 不变（双端各实现 `newId()`，golden 向量校验格式）；`kind`/`origin`/`displayMode`/`autoExtend` 枚举值不变；**`TrackBrief` 字段名由 JSON Schema 单源保证**。

### 3.3 媒体字节落文件系统

大字节（音频/视频/封面）落 app 文件目录（iOS `Documents`/`Caches`，Android `filesDir`/`cacheDir`），DB 只存元数据 + 相对路径 + role。手机内存/DB 敏感，文件系统天然支持流式 + LRU 淘汰。⚠️ 小缩略图可留 DB，大音频必走 FS，Phase 1 复测。

### 3.4 响应式读 + codename

Dexie `useLiveQuery` → iOS GRDB `ValueObservation` / Android Room `Flow`。列表/集合走响应式查询，不把可派生数据塞进 UI state（规则 6）。虚拟化用各端原生（`LazyColumn`/`List`）。

### 3.5 已知限制

移动 App 独立本地库，**切端不迁移数据**（与桌面 Electron↔Tauri 同限制）。跨端同步是后续独立 phase（复用已有 R2/WebDAV 云盘机制）。

---

## 4. Module Surface（无后端；各端原生）

> 无后端、无 API endpoint（本地优先）。本节列各端原生的关键能力契约（每端自建，无跨端接口层）。

| 能力 | iOS | Android | 备注 |
|---|---|---|---|
| HTTP | URLSession | OkHttp/Ktor | **native 无 CORS**，删 muzfetch |
| 媒体文件存储 | FileManager（Documents/Caches） | filesDir/cacheDir | 大字节落 FS（§3.3） |
| 文件导入 | `UIDocumentPicker`/PhotosPicker | SAF `ACTION_OPEN_DOCUMENT` | 单/多文件，无整目录 |
| 密钥安全存储 | **Keychain** | **Keystore/EncryptedSharedPreferences** | BYOK（§8） |
| FFT tap | AVAudioEngine tap + vDSP | Media3 AudioProcessor PCM→FFT | §5.2 |
| 打开外链 | `UIApplication.open` | Intent | |
| 分享/导出 | `UIActivityViewController` | `ACTION_SEND` | |
| DJ brain / provider | Swift SDK/REST + Swift `cloud-job` 实现 | java SDK/Koog + Kotlin `cloud-job` 实现 | golden 向量守护轮询/决策 |

### 4.1 错误 / 边界
- **shader 编译失败/低端 GPU**：流光回退静态多色渐变（SwiftUI `LinearGradient`/Compose `Brush`），不黑屏。
- **FFT tap 不可用/无权限**：可视化回退「无音频反应」时间流（uAudio=0）。
- **取色失败**：回退 `flowCustomColors`。
- **BYOK key 缺失**：DJ/musicgen 优雅停摆 + 引导 Settings 录入。

---

## 5. Frontend / Effects Design —— 逐特性可行性

### 5.1 音频播放 + 后台 + 锁屏
- 播放：Android Media3/ExoPlayer、iOS AVPlayer（或 AVAudioEngine player node，与 FFT tap 同图）。单一持久 player。
- 后台 + 锁屏（净收益）：Android `MediaSessionService`+MediaSession；iOS `AVAudioSession(playback)`+`MPNowPlayingInfoCenter`+`MPRemoteCommandCenter`。High，⚠️ 常识级未专项核验。

### 5.2 音频分析（FFT）
- **iOS（✅ High）**：`AVAudioEngine` 在 **`mainMixerNode`** `installTap`（混音后信号）+ **vDSP** FFT（`vDSP_fft_zrip`）；八度分带纯数学层喂频谱 + bass/mid/treble/energy [^tempi][^vdsp]。
- **Android（Medium，spike）**：Media3 自定义 `AudioProcessor` 取 PCM 自做 FFT（KissFFT）；机制由 `TeeAudioProcessor`/ExoVisualizer 佐证 [^media3]；**60fps 可靠性/延迟/权限 Phase 0 验**（§10）。
- 分带数学双语实现 + golden 向量同守。

### 5.3 2D 频谱可视化（各端原生 Canvas）
bars/radial/led-reflex(倒影)/waveform：Android Compose `Canvas`(DrawScope)、iOS SwiftUI `Canvas`（或 Metal）——渐变/路径/阴影，跟随主色，FFT 驱动重绘。**分带/选色/平滑逻辑各端实现 + golden 向量守护，绘制各端原生（很薄）**。⚠️ 60fps 复杂路径性能未独立核验（§10），按 §4 先补帧指标。

### 5.4 流光背景（着色器）—— iOS Metal / Android AGSL【最大风险】
- **GLSL 作 spec 真源**（沿用桌面 `flow-shaders.ts` 的 `FLOW_PRELUDE`/`FLOW_FRAGS`），**Android=AGSL**（API 33+，AGSL≈SkSL，移植差异同 [^skiareadme]）、**iOS=Metal(MSL)**（`MTKView`/`CAMetalLayer`）各实现 + 截图比对防漂移。
- 移植差异（逐项）：纹理 `eval/sample`、precision、向量类型、坐标非归一化/(0,0) 左上；`hash21/vnoise/fbm/ramp/uColors[5]` 可移植，逐个验。
- **风险 + 裁剪**：14 shader 移植是单一最大风险（现多一门 Metal）。⚠️ **v1 curate 4–6 个**（chaos-waves/ambient-light/big-blob/wavy-waves…），余 v2。**Phase 0 先移 1 个 AGSL+Metal 双端比对**。低端/无 GPU 回退静态多色渐变。
- 混合模式：iOS `.blendMode`/Metal blend、Android `BlendMode`/`RenderEffect`（v1 先 screen/normal）。

### 5.5 背景滤镜（Pixi）—— v1 裁剪
pixi-filters 全家桶移动端重写成本高（每个 = iOS Metal + Android AGSL/`RenderEffect`），属锦上添花，**v1 裁剪**（§7），v2 逐个。封面 cover→cover crossfade 各端原生过渡。

### 5.6 取色调色板
`image-palette.ts` 纯量化器各端实现（iOS `CGImage`+像素 / Android `Bitmap`+`getPixels`），**golden 向量（像素数组→palette）两端同守，保证一致**。`mixPalette` 900ms EMA 双语实现。High，⚠️ 未核验（§10）。

### 5.7 同步歌词 + 三动效模式
- **共享（spec 层）**：`lyric-motion.ts` 三套 stiffness/damping/mass 参数 + LRC/TTML 解析 + beat-exact 行号计算 → golden 向量（含解析向量）两端同守。
- **绘制各端原生**：Android Compose `LazyColumn`+`Animatable`；iOS SwiftUI `ScrollViewReader`/`LazyVStack`+原生 spring。活动行用共享参数驱动；高亮读 player 精确 `currentTime`。
- 动量滚动各端原生（不移植 Lenis）——native 反而拿到真原生手感（消掉 KMP 方案 CMP scroll-parity 隐患 [^cm18]）；三动效逐端调参（§10）。

### 5.8 动画 / 转场 / 虚拟列表
- 转场/共享元素：各端原生（iOS `matchedGeometryEffect`/`.transition`；Android Compose shared-element）。
- 虚拟列表：iOS `List`/`LazyVStack`、Android `LazyColumn`（内建）。
- 减动效：各端读系统 reduced-motion → 冻结流光、降频频谱。

### 5.9 逐特性可行性矩阵

| 特性 | 可行性 | iOS / Android 技术 | v1 |
|---|---|---|---|
| 本地/云音频播放 | **High** | AVPlayer / Media3 | ✅ |
| 后台+锁屏 | **High**（净收益） | MPNowPlayingInfoCenter / MediaSession | ✅ |
| iOS FFT | **High** | AVAudioEngine+vDSP | ✅ |
| Android FFT | **Medium**（spike） | Media3 AudioProcessor+KissFFT | ✅（P0 验） |
| 2D 频谱 | **High** | SwiftUI Canvas / Compose Canvas（逻辑 golden 守护） | ✅ |
| 流光 shader（子集） | **Medium**（最大风险） | Metal / AGSL（GLSL 作 spec） | ⚠️ curate |
| 混合模式 | **Medium** | .blendMode / BlendMode | ⚠️ 基础 |
| Pixi 滤镜 | **Hard** | Metal / AGSL 逐个 | ❌ v2 |
| 取色+glide | **High** | 双语量化 + golden 守护 | ✅ |
| 同步歌词+动效 | **Medium** | 原生绘制 + 共享参数/解析向量 | ✅（手感调） |
| 转场/虚拟列表 | **High** | 各端原生 | ✅ |
| 本地 DB+响应式 | **Medium** | GRDB / Room | ✅ |
| DJ LLM 续歌 | **High** | Swift SDK·REST / java SDK·Koog | ✅ |
| BYOK HTTP | **High** | URLSession / OkHttp（无 CORS） | ✅ |
| 图片加载 | **High** | AsyncImage·Kingfisher / Coil 3 | ✅ |
| **契约/逻辑防漂移** | **High** | JSON Schema codegen + golden 向量 | ✅ |

### 5.10 性能 / 自动化测试 Harness（验收方法学，镜像 Electron CDP+控制端点）

> 对齐 [`prd-create.md`](../../../../.cursor/commands/prd-create.md) §4。桌面已有 harness（[`20260615-...dev-control-endpoint`](../../20260615-muzero-dev-control-endpoint-automation-harness-prd/20260615-muzero-dev-control-endpoint-automation-harness-prd.md) + [`20260616-...cpu-profiling`](../../20260616-muzero-agent-cpu-profiling-harness-prd/20260616-muzero-agent-cpu-profiling-harness-prd.md)）：localhost 控制端点（token+loopback）派发进 action 层，`perf-drive.mjs` 跑场景，`perf-profile.mjs` 用 CDP 抓 flame graph；指标=帧节奏+longtask+heap+blob+trace+marker。

**无「KMP/原生版 CDP」**——CDP 因 Electron=Chromium 而存在。三层映射（C 下控制端点也各端原生，但场景脚本仍复用）：

| Electron 部件 | iOS | Android | 共享 |
|---|---|---|---|
| 控制端点（HTTP+token+loopback+dev-gate） | Swift 内嵌 HTTP（Network.framework/Swift-NIO/Telegraph）或 XCUITest deeplink | Kotlin 内嵌 HTTP（NanoHTTPD/Ktor）或 `adb am broadcast` | **场景脚本 `perf-drive.mjs` 不改**（HTTP/JSON 契约，换 base-URL） |
| action 派发 | 进各端原生 store/action | 同 | 行为由 golden 向量保证一致 |
| flame graph 抓取 | **Instruments + `xcrun xctrace`** | **Macrobenchmark + Perfetto** | ❌ 各端 |
| 帧节奏（rAF PerfWindow） | `CADisplayLink` hitch | `Choreographer`/`FrameMetrics`/JankStats | `PerfWindow` 百分位逻辑各端实现（薄） |
| longtask（PerformanceObserver） | 帧超预算 hitch + Instruments | 帧超预算 + JankStats + Macrobenchmark `FrameTimingMetric` | 概念共享 |
| trace section / `notePerfWork` | `os_signpost`（Instruments 可见+XCTest 可测） | `androidx.tracing.trace`（Perfetto 可见+`TraceSectionMetric`） | 同名 section，各端 viewer |
| heap | `os_proc_available_memory`/footprint | Runtime/`MemoryUsageMetric` | 各端 |
| CI 门禁 | **XCTest `measure(metrics:)` baseline** | **Macrobenchmark JSON 预算** | 同场景同预算口径 |

**iOS 深度 profiling 需 macOS runner**；**移动预算**注意 120Hz ProMotion=8.3ms vs 60Hz=16.7ms + 热降频 → 多跑取中位 + warm-up（沿用桌面「第二轮复测」）。同场景（switch/pingpong/counted/like/idle）驱动两端，超预算 fail build。

---

## 6. Implementation Plan

> **基础设施先于覆盖广度**：P0 立两套骨架 + 契约规格/golden 雏形 + 验掉两个最大未知（shader/FFT）。每 phase 独立可编译可测、可单独 PR。

### Phase 0: 地基 + 双高风险 spike
**Tasks:**
- [ ] 两套原生工程骨架（iOS Xcode/SwiftUI、Android Gradle/Compose）+ 各自最简 DI/导航。
- [ ] `shared-spec/`：`TrackBrief` JSON Schema 单源 + codegen 出 Swift `Codable` & Kotlin `@Serializable`（CI 校验生成物）。
- [ ] **golden 向量雏形**：从桌面 `queue`/`bands` 单测导出语言中立 JSON 向量 + 两端各跑通（建立防漂移机制）。
- [ ] **Shader spike**：1 个 flow shader（如 `ambient-light`）iOS Metal + Android AGSL 双端跑通（含 uColors[5]+uTime），记录移植差异清单。
- [ ] **FFT spike**：iOS（AVAudioEngine+vDSP）+ Android（Media3 AudioProcessor）双端取稳定频谱，跑 `bands` golden 向量。
- [ ] **Harness 地基**：各端 dev-only 控制端点 skeleton（`/health`/`/state`/`/player/playIndex`，token+loopback+dev-gate）+ 帧源（CADisplayLink/Choreographer）；用现有 `perf-drive.mjs` `switch` 场景打通。
- [ ] iOS DB 选型（GRDB vs SwiftData）+ Android Room：各搭最小响应式查询 demo。

### Phase 0 Checklist
- [ ] 两端 app 启动；`TrackBrief` codegen 双语类型一致；golden 向量两端绿。
- [ ] 1 个 shader iOS Metal + Android AGSL 真机渲染正确（截图存档）+ 差异清单。
- [ ] 双端 FFT 取频谱驱动最简 bar；Android tap 延迟/帧率可接受结论记录。
- [ ] 控制端点双端可被 `perf-drive.mjs` 驱动切歌；帧源出数。
- [ ] iOS DB 选型拍板。

### Phase 1: 数据层 + 契约
- [ ] iOS GRDB / Android Room schema（桌面 v25 等价；codename/id 前缀不变，§3.2）。
- [ ] repositories（双语实现业务逻辑；`newId()` golden 校验）。
- [ ] 媒体字节落 FS + DB 存路径。
- [ ] 响应式查询（GRDB ValueObservation / Room Flow）；导入→落库→刷新打通。

### Phase 1 Checklist
- [ ] 导入本地音频→落 FS+DB→列表响应式刷新（双端）。
- [ ] codename + `TrackBrief` 形状一致（golden + codegen 校验）。

### Phase 2: 音频引擎
- [ ] AVPlayer(iOS)/Media3(Android) 播放 + 后台 + 锁屏 + 远程控制。
- [ ] **队列数学双语实现 + golden 向量守护**；接 player。
- [ ] 资源生命周期（FS 句柄 revoke-before-replace 等价）。

### Phase 2 Checklist
- [ ] 双端播放/上下首/shuffle/repeat 正确（queue golden 向量两端绿）。
- [ ] 锁屏/通知显示+控制；切后台不断播。

### Phase 3: DJ 续歌
- [ ] `TrackBrief` codegen 双语 + tool-use JSON schema 结构化输出。
- [ ] DJ brain：Android 官方 anthropic-java/openai-java 或 Koog；iOS Swift SDK 或 URLSession+REST。
- [ ] musicgen cloud provider：双语实现 `cloud-job` 轮询 + 三纯函数；mock provider 供离线/测试。
- [ ] BYOK 存 Keychain/Keystore（§8）+ Settings 录入。
- [ ] **DJ 决策/`shouldAutoExtend`/轮询 golden 向量两端守护**。

### Phase 3 Checklist
- [ ] 双端 integration：draft→pending→materialize→ready→refill（mock brain+provider）。
- [ ] 真机：BYOK 续出新曲入队；key 存安全区不落日志。

### Phase 4: 2D 频谱
- [ ] FFT→分带（golden 守护）→ Android Compose Canvas / iOS SwiftUI Canvas 画 4 样式。
- [ ] 跟随主色；reduced-motion/不可见暂停；零分配循环。
- [ ] 补帧指标，prod 复测。

### Phase 4 Checklist
- [ ] 双端 4 样式可接受帧率（截图）；FFT 不可用回退不崩。

### Phase 5: 流光背景
- [ ] curate 4–6 个 shader：AGSL(Android)+Metal(iOS)（基于 P0 差异清单）。
- [ ] 多色取色（双语量化 + golden 守护）喂 palette，900ms glide。
- [ ] 独立合成层 + 基础混合（screen/normal）+ 透明度/压暗；低端回退静态渐变。

### Phase 5 Checklist
- [ ] 子集 shader 双端真机正确 + 跟封面变色 + calm；设备分级达标（prod 复测）。

### Phase 6: Now Playing + 歌词 + 封面
- [ ] 同步歌词各端原生（LazyColumn/LazyVStack）+ 共享动效参数/解析向量 + beat-exact 高亮。
- [ ] 封面 Coil/AsyncImage；media-stage video→cover→title 回退（golden 守护）。
- [ ] Now Playing 三层叠加（背景图/视频→流光→频谱）。

### Phase 6 Checklist
- [ ] 三动效手感可接受（逐端调，记录差异）；Now Playing 双端验收。

### Phase 7: 打磨 / 分级 / i18n / 性能 CI / 裁剪复核
- [ ] i18n 四语（en/zh/ja/ko）：iOS String Catalogs + Android strings.xml，en 源。
- [ ] 设备分级（GPU/内存）→ 特效降级矩阵；安全区 inset / 触摸 ≥44px。
- [ ] **性能 CI 门禁**：Android Macrobenchmark（`FrameTimingMetric`/`TraceSectionMetric`）+ iOS XCTest baseline，同场景同预算。
- [ ] v1 裁剪复核（§7）；CLAUDE.md / 本 PRD 状态更新。

### Phase 7 Checklist
- [ ] 四语全量、无硬编码用户可见串。
- [ ] 低端机达标；崩溃/内存/掉电基线达标；CI 门禁生效。

---

## 7. Out of Scope（mobile v1 不做 / 简化）
- Pixi 滤镜全家桶（CRT/ASCII/pixel/cross-hatch/dot/noise）→ v2。
- 全部 14 flow shader → v1 只 4–6 个。
- exotic 混合模式 → v1 仅 screen/normal。
- Lenis 式自定义动量 → 用原生。
- 跨端数据迁移/同步 → 复用已有云盘 PRD，独立后续 phase。
- 桌面专属能力（OBS 歌词 overlay、托盘、全局快捷键、live 弹幕 socket、整目录索引、YouTube n-throttle）→ 不适用。
- WebView 过渡包（Capacitor/Tauri mobile）→ 如要「最快出个能用的」另起独立路线，不在本 PRD。
- **KMP 共享代码** → 已评估并否决（§2.1）；翻盘条件见 §1.3 ④。

---

## 8. Security Considerations
- **BYOK 密钥**：iOS Keychain / Android Keystore（或 EncryptedSharedPreferences），不进 DB 明文/bundle/日志/遥测（规则 2）；从安全区直达 provider。
- **本地优先/无后端**：零 MUZERO 服务端、零遥测；唯一出站 = 用户配置的 BYOK LLM/musicgen。
- **native 无 CORS**：直连第三方，删 muzfetch（减攻击面）。
- **不引入 hidden flag**：runtime toggle 走可见 Settings；回退=`git revert`+重发版（规则 3）。
- **文件访问**：scoped storage/沙盒；导入走系统 picker，不全盘读。
- **Telemetry whitelist**（若未来加）：绝不上报色值/LUT/歌词文本/源文件名/prompt。

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [`prd-create.md`](../../../../.cursor/commands/prd-create.md) | PRD 工作流 + §3 effect/shader、§4 性能附加要求 |
| [`20260611-immersive-flow-background-prd`](../../20260611-muzero-immersive-flow-background-prd/20260611-muzero-immersive-flow-background-prd.md) | 流光背景源（14 shader/取色/合成） |
| [`20260607-music-reactive-visualizer-prd`](../../20260607-muzero-music-reactive-visualizer-prd/20260607-muzero-music-reactive-visualizer-prd.md) | 频谱可视化源 |
| [`20260613-amll-style-lyrics-engine-prd`](../../20260613-muzero-amll-style-lyrics-engine-prd/20260613-muzero-amll-style-lyrics-engine-prd.md) | 同步歌词源 |
| [`20260606-ai-dj-foundation-prd`](../../20260606-muzero-ai-dj-foundation-prd/20260606-muzero-ai-dj-foundation-prd.md) | DJ 续歌地基源 |
| `docs/prd/desktop/` | 桌面端新 PRD（分层约定见 [`desktop/README.md`](../../desktop/README.md)） |

**调研来源（四轮 deep research，2026-06，对抗式核验）：** 见脚注。

---

## 10. Open Questions

| # | Question | Status | 处理 |
|---|----------|--------|------|
| 1 | **AI 能否长期把 Swift+Kotlin 两份 ~1,500 LOC 逻辑保持同步？**（C 的决定性未知，无基准） | Open（最弱证据链） | golden 向量 + codegen 是主要防线；Phase 0 建立后持续度量漂移 |
| 2 | **共享面/churn 的翻盘阈值**：多大/多频时 KMP「单源」收益超过其税？ | Open | ~1,500 LOC 远低于翻盘点；若逻辑膨胀重评（回 B） |
| 3 | **多少逻辑真纯 vs 终究平台专属**（音频/DB/FFT/后台）？ | Open | 越多平台专属，C 越占优；Phase 1-2 量化 |
| 4 | **KMP 在改进**：Swift Export 2026 stable + 构建提速，是否在移动开工时已抹平 friction？ | Open（时效） | 开工前复核本决策 |
| 5 | **iOS 播放节点 tap FFT**：OSS 都 tap 麦克风，无「播放输出 tap」先例 | Open | Phase 0 iOS spike：可能需经 AVAudioEngine mixer 节点 tap |
| 6 | **Android FFT 60fps 可靠性**：Media3 AudioProcessor tap 延迟/权限 | 机制已佐证 [^media3]，可靠性待验 | Phase 0 spike |
| 7 | **2D 频谱 60fps**：SwiftUI/Compose Canvas 复杂路径+阴影性能 | Open | Phase 4 帧指标复测 |
| 8 | **14 shader 全量移植成本**（现 ×2 语言 Metal+AGSL） | Open（最大风险） | P0 移 1 个标定，curate 子集铺开 |
| 9 | **iOS DB 选型** GRDB vs SwiftData vs SQLite.swift | Open | Phase 0 demo 定 |
| 10 | **工程仓库形态** + codegen 工具链（quicktype vs openapi-generator） | Open | Phase 0 定 |
| 11 | **歌词三动效 parity**：classic/inertial/cascade 两套原生 UI 手感一致？ | Open | §5.7 逐端调参（native 拿到真原生滚动） |
| 12 | **i18n**：String Catalogs(iOS) vs strings.xml(Android) 与桌面 en 源对齐流程 | Open | Phase 7 定 |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-16 | DoodleBear / MUZERO | 初稿（KMP+CMP，Option A）：仓库三路 Explore + deep research（KMP/CMP/SkSL/FFT/Koog/Coil 核验）；逐特性可行性 + 分阶段 + v1 裁剪 |
| 2026-06-16 | DoodleBear / MUZERO | 加参考 OSS（第二轮）+ 性能 harness（第三轮）；DB 重审（SimpMusic 用 Room-KMP）；harness 三层（控制端点/仪表/各平台 profiling），无 KMP 版 CDP |
| 2026-06-16 | DoodleBear / MUZERO | 架构改 Option B（第三轮：A/B/C+AI）：共享 Kotlin 核心 + 原生 UI；shader 改 AGSL+Metal；加 SKIE |
| 2026-06-16 | DoodleBear / MUZERO | **架构改定 Option C + spec guard（第四轮：全原生 vs KMP + 生态人才 + solo+AI）**：弃 KMP/commonMain/SKIE，改**两套全原生（SwiftUI + Compose）+ 语言中立契约规格**（`TrackBrief` JSON Schema codegen + golden 测试向量防漂移）。依据：KMP 仅 18% Kotlin 开发者 [^deveco]、KMP interop/构建/DX 税 JetBrains 自认 [^kmproadmap]、AI 在主流原生更熟少错 [^composeai]、Android 现可用官方 anthropic/openai-java、可共享面仅 ~1,500 LOC。**全文重写**（标题/§1–§11）；文件/目录改名 `kmp-`→`native-`。中等置信，翻盘条件见 §1.3④/§10。代价=逻辑写两遍（golden 守护）；收益=真原生+最高 AI 效率+最简工具链+day-one API |

---

### 脚注（四轮 research 来源）

[^cm18]: Compose Multiplatform 1.8.0 — iOS Stable（JetBrains 2025-05）；附独立来源 iOS CPU/内存、无 Cupertino、滚动 parity 证伪. https://blog.jetbrains.com/kotlin/2025/05/compose-multiplatform-1-8-0-released-compose-multiplatform-for-ios-is-stable-and-production-ready/
[^deveco]: JetBrains State of Developer Ecosystem 2025——KMP 占 Kotlin 开发者 18%（2024 为 7%）；62% 用 AI 助手、85% 常用 AI. https://blog.jetbrains.com/research/2025/10/state-of-developer-ecosystem-2025/
[^so2025]: Stack Overflow Developer Survey 2025——Kotlin 10.8% / Swift 5.4%（Kotlin 含大量后端，非 mobile 净值）. https://survey.stackoverflow.co/2025/technology
[^kmproadmap]: Kotlin Multiplatform roadmap（JetBrains 2025-08）——构建慢、iOS DX「仍有改进空间」、idiomatic Swift Export 2026 才计划. https://blog.jetbrains.com/kotlin/2025/08/kmp-roadmap-aug-2025/
[^composeai]: AI 对 Compose/CMP 不喂 grounding 易错（CMP 专属：commonMain 误引 Android-only 库破 iOS）；Compose skill（含 Google 工程师对照工具）. https://github.com/Meet-Miyani/compose-skill
[^swiftuiwhatsnew]: SwiftUI What's New（Apple）——每年 OS/Xcode 周期 day-one 新 API. https://developer.apple.com/swiftui/whats-new/
[^skiareadme]: Skia SkSL README——GLSL→SkSL/AGSL 移植差异（sample、precision、float2、(0,0) 左上）. https://github.com/google/skia/blob/main/src/sksl/README.md
[^tempi]: jscalo/tempi-fft——iOS 实时 FFT（Accelerate vDSP_fft_zrip + 八度分带，CC0；麦克风采集）. https://github.com/jscalo/tempi-fft
[^vdsp]: Apple Accelerate / vDSP FFT. https://developer.apple.com/documentation/accelerate/vdsp/fft
[^media3]: androidx/media（Media3 `AudioProcessor`/`TeeAudioProcessor` PCM tap）+ dzolnai/ExoVisualizer. https://github.com/androidx/media
[^gramo]: FoedusProgramme/Gramophone——原生 Android 音乐播放器（Media3 + LRC/TTML/SRT 逐词卡拉OK，GPL-3.0）. https://github.com/FoedusProgramme/Gramophone
[^simp]: maxrave-dev/SimpMusic——KMP/CMP 音乐 App（Koin/Ktor/Coil3/Media3/Room-KMP；GPL-3.0）. https://github.com/maxrave-dev/SimpMusic
[^ma]: music-assistant/mobile-app——官方跨端音乐客户端（Apache-2.0，CMP，iOS 1.0 2026-06）. https://github.com/music-assistant/mobile-app
[^kicks]: ayodelekehinde/Kicks——KMM expect/actual ExoPlayer/AVPlayer（2023 停更）. https://github.com/ayodelekehinde/Kicks
[^shadercmp]: Coding-Meet/Shader-Animation-CMP（AGSL/SkSL，无 license）/ Kashif-E/KMPLiquidGlass（Apache）. https://github.com/Coding-Meet/Shader-Animation-CMP
[^amll]: amll-dev/applemusic-like-lyrics——web npm（TS+Pixi，AGPL）；仅行为参考. https://github.com/amll-dev/applemusic-like-lyrics
[^kotlinai]: Kotlin AI overview——官方 Anthropic/OpenAI 仅 Java SDK（JVM/Android 可用，非全 KMP）. https://kotlinlang.org/docs/kotlin-ai-apps-development-overview.html
[^koog]: JetBrains/Koog——Kotlin AI agent 框架（1.0 2026-05，Anthropic/OpenAI 等）. https://github.com/JetBrains/koog
[^xemantic]: xemantic/anthropic-sdk-kotlin——tool JSON schema 从 @Serializable 自动抽（等价 generateObject+Zod）. https://github.com/xemantic/anthropic-sdk-kotlin
[^coil]: coil-kt/coil——Android 图片加载（+coil-network-ktor3）. https://github.com/coil-kt/coil

> **Note（模板纪律对齐）**：复用已有设计 + 用 golden 向量/JSON Schema 锁语义，而非另起炉灶；每个原生依赖过 license/维护度判定（§2.4）；特效 curate 不穷举、基础设施先于覆盖广度；回退=`git revert` 不藏 flag。research 已核验项标引用，未核验项标 ⚠️ 入 §10，不混淆事实与推断。决策为**中等置信**（最弱链=「AI 长期保持两份实现同步」无基准），列明**翻盘回 KMP 的条件**。
