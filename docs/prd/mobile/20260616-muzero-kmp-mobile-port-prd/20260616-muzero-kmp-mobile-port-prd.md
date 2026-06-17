# PRD: MUZERO 移动端原生移植（KMP 共享核心 + 原生 UI：SwiftUI + Jetpack Compose）

**Status:** Draft
**Created:** 2026-06-16
**Author:** DoodleBear / MUZERO
**Module:** Mobile（iOS / Android）—— 在 web 端成熟后，用 **KMP（Kotlin Multiplatform）共享业务核心 + 原生 UI（iOS SwiftUI / Android Jetpack Compose）**（架构 = **Option B「中间路线」**，2026-06-16 经 deep research 比选 A/B/C + AI 编程效率后定，见 §2.1）把 MUZERO 移植为**原生（非 WebView）**移动 App，复现桌面/web 已有的播放、特效、可视化、DJ 续歌与「音乐承载回忆」体验。

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 0 | **地基 + 双高风险技术先验证（spike）**：KMP 工程骨架（共享核心 + 原生 UI 双壳）、模块结构、Koin DI、`MobileBridge` 接口、Ktor、SKIE 接 Swift；**先 de-risk** 两个最大未知——(a) 把 1 个 flow shader 在 **iOS=Metal / Android=AGSL** 双端跑通；(b) iOS/Android FFT tap 双端取到实时频谱 | 🔲 Pending | [Phase 0 Checklist](#phase-0-checklist) |
| 1 | **数据层**：SQLDelight schema（codename 不变）+ repositories + 媒体字节落文件系统 + reactive `Flow` 查询（替代 Dexie `useLiveQuery`） | 🔲 Pending | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | **音频引擎**：Media3/ExoPlayer（Android）+ AVPlayer/AVAudioEngine（iOS）播放 + 后台音频 + 锁屏/Now-Playing 控制；移植纯队列数学 | 🔲 Pending | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | **DJ 续歌循环**：DJ brain（Koog / anthropic-sdk-kotlin）+ `TrackBrief`（kotlinx.serialization）+ cloud musicgen provider（移植 `cloud-job` 轮询）+ BYOK 密钥安全存储 | 🔲 Pending | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | **2D 频谱可视化**：FFT tap → 八度分带（移植 `bands.ts`）→ Compose Canvas（DrawScope）画 bars/radial/led-reflex/waveform | 🔲 Pending | [Phase 4 Checklist](#phase-4-checklist) |
| 5 | **流光背景（着色器）**：curate 子集的 flow shader（iOS=Metal / Android=AGSL，共享 GLSL 逻辑参考）+ 多色 palette uniform + 轻度音频反应 + 合成/混合模式 | 🔲 Pending | [Phase 5 Checklist](#phase-5-checklist) |
| 6 | **Now Playing + 歌词 + 取色**：同步歌词（LazyColumn + spring/tween 三动效）、封面（Coil 3）、多色取色 palette glide | 🔲 Pending | [Phase 6 Checklist](#phase-6-checklist) |
| 7 | **打磨 / 设备分级 / i18n / 性能复测 / v1 裁剪复核** | 🔲 Pending | [Phase 7 Checklist](#phase-7-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending
>
> 本 PRD 适用 [`prd-create.md`](../../../../.cursor/commands/prd-create.md) 的 **§3「Effect / Shader / 外部依赖类」**（license 第一公民、curate 不穷举、bundle 预算、i18n 四语、不散落硬编码、shader uniform prelude 约定、**基础设施先于覆盖广度**、回退=`git revert`）与 **§4「realtime preview 性能类」**（先定**测量方法学**、prod build 复测、reduced-motion / 可见性暂停、每-tick 预算）。因为这是**新平台**而非在既有 web 树上改，「不引入新 runtime owner」一条按「新栈每个依赖逐个 license/维护度 ship 判定」执行（见 §2.4）。

---

## 1. Overview

### 1.1 Background — 需求来源

PM 口径：**web 端完善之后开发移动端**，倾向采用 **KMP** 带来 iOS / Android 的**原生体验**。诉求拆成三问：

1. 我们现在的特效 / 功能里，**哪些在移动端能实现**？
2. **用哪些库**比较好？
3. **架构 best practice** 是什么？

本 PRD 先盘点现状（§1.2 内部清单），再给**架构选型 + 逐特性可行性 + web→KMP 库映射**（§2/§5），最后给**分阶段落地 + 风险 + v1 裁剪**（§6/§7/§10）。结论基于一次 deep research（2026-06，多源对抗式核验，来源见 §9）+ 仓库三路 Explore 清单。**研究已核验的结论标注引用，未被核验项标注「⚠️ 团队判断（待验证）」**，不混淆事实与推断。

### 1.2 现状盘点（要被复现的特效 / 功能 + 当前渲染技术）

MUZERO 当前是 **Electron（桌面主力）+ Tauri 2（保留 + 移动壳）+ React 19 + TS**，整个 App 就是前端，重度依赖浏览器图形/音频 API。要在移动端复现的清单（含当前技术）：

| 能力 | 当前实现 | 关键 web API / 库 |
|---|---|---|
| **音频播放** | 单个持久 `<audio>`/`<video>`（[`media-engine.ts`](../../../../src/player/media-engine.ts)），object-URL revoke-before-replace | `HTMLMediaElement`、`AudioContext` |
| **音频分析** | `AnalyserNode` FFT（`getByteFrequencyData`/`getByteTimeDomainData`）→ 八度对数分带（[`spectrum/bands.ts`](../../../../src/visualizer/spectrum/bands.ts)）+ bass/mid/treble/energy（[`scene/audio-uniforms.ts`](../../../../src/visualizer/scene/audio-uniforms.ts)） | Web Audio `AnalyserNode` |
| **2D 频谱可视化** | bars / radial / led-reflex（带倒影）/ waveform，Canvas 2D（渐变/路径/阴影），~60fps，跟随 `--primary`（[`src/visualizer/spectrum/`](../../../../src/visualizer/spectrum/)） | Canvas 2D |
| **流光背景** | **14 个自研 GLSL ES 1.0 fragment shader**（fbm/noise/voronoi/metaball/gradient 家族，[`flow-shaders.ts`](../../../../src/visualizer/scene/flow-shaders.ts)），多色 `uColors[5]` uniform + 轻度音频反应，twgl.js WebGL 渲染，独立合成层 + CSS `mix-blend-mode` | WebGL + `twgl.js`(MIT) + CSS blend |
| **背景滤镜 + 封面交叉淡化** | pixel/ASCII/CRT/cross-hatch/dot/noise（[`pixi-pixel-background.tsx`](../../../../src/components/player/pixi-pixel-background.tsx)），常驻 Pixi filter 下 cover→cover 360ms crossfade | `pixi.js` v8 + `pixi-filters`(MIT) |
| **封面取色** | 零依赖 canvas 量化（[`image-palette.ts`](../../../../src/lib/image-palette.ts)）→ 多色 palette → EMA 平滑过渡（[`visualizer-color-store.ts`](../../../../src/stores/visualizer-color-store.ts) 900ms `mixPalette`） | Canvas 2D（`getImageData`） |
| **同步歌词** | AMLL/Apple-Music 风：DOM 行，spring/tween 跟随滚动，3 动效模式（classic/inertial/cascade，[`lyric-motion.ts`](../../../../src/lyrics/lyric-motion.ts)），动量滚动（Lenis），beat-exact 高亮（[`synced-lyrics-view.tsx`](../../../../src/components/player/synced-lyrics-view.tsx)） | DOM + `motion`(MIT) + `lenis`(MIT) |
| **动画 / 转场 / 列表** | View Transitions API + Framer Motion 共享元素；TanStack Virtual 虚拟化 | VT API / `motion` / `@tanstack/react-virtual` |
| **本地数据** | IndexedDB（Dexie，25 个 schema 版本；`tracks`/`sessions`/`mediaBlobs` 等；blob 字节进 `mediaBlobs`）+ `useLiveQuery` 响应式读 | IndexedDB + `dexie`(Apache-2.0) |
| **DJ 续歌循环** | LLM（Vercel AI SDK `generateObject` 结构化输出）写 Zod 校验的 `TrackBrief`（[`dj-brief-schema.ts`](../../../../src/dj/dj-brief-schema.ts)）→ 可插拔 musicgen provider submit→poll→download（[`cloud-job.ts`](../../../../src/musicgen/cloud-job.ts)）；BYOK 密钥本地 | `ai` SDK + `zod` |
| **出站 HTTP** | BYOK LLM + musicgen API，桌面经 `muzfetch://` / Tauri http 绕 CORS（[`platform.ts`](../../../../src/lib/platform.ts) `getAppFetch`） | bridge fetch |

### 1.3 关键认知（决定整份 PRD 的判断基准）

> **① KMP-native = 重写，不是「复用现有 TS」。** 现有代码是 TypeScript，KMP 共享的是 **Kotlin**。所以移动端不会自动复用一行 web 代码——它是一次**用 Kotlin 重写**。「可移植性」是**设计层面**的：纯逻辑模块（队列数学、DJ 编排、brief 契约、轮询状态机、取色量化、分带数学）算法与单测可**1:1 直译**到 Kotlin `commonMain`，省的是「设计 + 正确性」，不是「敲键盘」。

> **② WebView 复用（Capacitor / Tauri 2 mobile）是另一条路，但不是本 PRD 选的路。** Tauri 2 已支持移动端，理论上能把现有 React 直接塞进 WKWebView/Android WebView「最快出包」。但 PM 明确要**原生体验**，而 WebView 路线恰恰会继承我们在桌面已踩的坑（CLAUDE.md 记录的 WKWebView/WebView2 UI 不稳）——`view-transition.ts` 里已为 WebKit 关掉 View Transitions、Pixi/visualizer 全屏合成在 WKWebView 上 flicker。**移动 WebView 的 WebGL/合成/内存压力只会更糟**。⚠️ 团队判断（本次 research 未独立对比 WebView vs KMP 性能，见 §10 Open Q）：WebView 适合做一个**过渡期轻量 web 包**（PM 提的「网页轻量」方向，见 memory `live-chat-song-request-state`），但**不作为「原生体验」的终态**。本 PRD 聚焦 KMP-native 终态。

> **③ 原生反而消掉两类 web 包袱**：(a) **没有 CORS**——native HTTP 直连 BYOK API，`muzfetch://` 代理这层可删；(b) **后台音频 / 锁屏控制是平台一等公民**（MediaSession / MPNowPlayingInfoCenter），比 web 强。

### 1.4 Target Users

| Role | Description | 关注点 |
|------|-------------|--------|
| **移动沉浸用户** | iOS / Android 手持，竖屏为主 | Now Playing 流光氛围、跟封面变色、流畅不烫手不掉电；后台播放 + 锁屏控制 |
| **「音乐承载回忆」用户** | 上传自己音视频 + tag/note/cover 混合歌单 | 移动端也能听自己的歌、看注释、被 DJ 喂进上下文 |
| **DJ 续歌用户** | 配好 BYOK key，让 LLM + musicgen 无限续歌单 | 移动端发起/继续 DJ 集，密钥安全存设备 |
| **低端机 / 省电用户** | 老旧 Android / 弱 GPU | 设备分级降级特效，reduced-motion，不卡不烫 |
| **跨端用户** | 同时用桌面 + 移动 | 体验一致（同一套交互语言）；数据各端本地（已知限制：不跨端迁移，见 §3.5） |

### 1.5 Core Value

1. **原生体验 + 共享业务核心（Option B）**：UI **各端原生**（iOS SwiftUI / Android Jetpack Compose）拿到真正的平台手感与 AI 编程友好度；但**纯业务核心**（队列/DJ/brief 契约/取色/分带）**只写一次** Kotlin `commonMain`，两端共享同一份「正确性关键」逻辑，避免重复实现导致行为漂移（§2.1 / §2.5）。
2. **本地优先不变**：移动端依然「存储层无后端无云」——SQLDelight/IndexedDB 同义的本地 DB + 文件系统，仅 BYOK LLM/musicgen 出站。codename 层（`muzero-db` / id 前缀 / `TrackBrief` 字段 / provider id）跨端不变（§3.5）。
3. **皇冠逻辑直译**：续歌循环、队列数学、brief 契约这些「命脉」算法 + 单测 1:1 移到 Kotlin `commonMain`，桌面/移动**共享同一份业务规则定义**（虽是重写，但语义锁定）。
4. **特效有取舍地复现**：高价值特效（流光、频谱、取色、歌词）原生复现；高成本/低收益的（Pixi 滤镜全家桶、Lenis、exotic blend）**v1 裁剪或简化**（§7），不为「全量对齐」拖垮首版。
5. **架构有缝可换**：平台能力（音频/文件/HTTP/FFT）走**接口 + Koin DI**，是桌面 `DesktopBridge` 的移动版 `MobileBridge`——和 provider/visualizer registry 同纪律，不散落 `if (platform===…)`。

---

## 2. System Architecture

### 2.1 选型决策一：架构路线（A 全共享 UI / B 共享核心+原生 UI / C 全原生）

> **决策（2026-06-16，deep research 比选）：采用 Option B「中间路线」——共享 Kotlin 业务核心（`commonMain`）+ UI 各端原生（iOS SwiftUI / Android Jetpack Compose）。** 这也是 2025–2026 业界与 JetBrains 自己的**机构化默认**（JetBrains 2026-05 新默认工程结构把代码拆成 Compose-free 的 `sharedLogic` 模块 + 可选 `sharedUI`，并明示「可以 iOS 用 SwiftUI、其它端用 CMP」；官方口径「share business logic while keeping the UI native」）[^kmpdefault][^kmpoverview]；Google I/O 2024 背书 KMP 也是**为共享逻辑、非 UI**；Netflix/Down Dog/Todoist 等均共享逻辑+原生 UI [^netflix]。

| 方案 | 共享什么 | iOS 手感 | shader | 正确性关键逻辑 | AI 编码友好度 | 决策 |
|---|---|---|---|---|---|---|
| **A**：KMP + **CMP 共享 UI**（含 iOS UI 走 Skia） | 逻辑 + UI | ⚠️ Material 默认、无 Cupertino、滚动 parity 被证伪 [^cm18] | ✅ 一份 SkSL 两端（Skiko） | ✅ 单源 | ⚠️ CMP 小众 idiom（expect/actual/Skiko）AI 更易错 | ❌ |
| **B**：KMP **共享逻辑 + 原生 UI**（SwiftUI + Compose） | **仅逻辑** | ✅ 真原生 | ❌ Metal(iOS)+AGSL(Android) 两份 | ✅ **单源** | ✅ 主流 SwiftUI/Compose，AI 最熟 | ✅ **采用** |
| **C**：全原生两套（Swift + Kotlin，零共享） | 无 | ✅ 真原生 | ❌ Metal+AGSL 两份 | ❌ **重复→漂移风险** | ✅ 主流，AI 最熟 | ⛔ 备选（见下） |

**为什么 A 对 MUZERO 反而最差**（research 核验）：我们的**硬骨头**（shader / FFT / 音频 / DB driver / 安全存储）在**三个方案里都是平台专属**（`expect/actual` 或原生），所以 A 标榜的「连 UI 一起共享」**只剩下分享「普通屏」**（设置 / 队列 / 搜索列表）——而这恰恰是原生手感最重要、CMP 最弱（滚动物理 parity **被证伪 0-3** [^cm18]）的地方；JetBrains 自己也建议 fidelity 敏感的 App 用 SwiftUI 写 UI [^cmfeel]。A 还要付「非原生感 + AI 对 CMP idiom 更易错」的代价，收益被稀释。

**为什么不是 C（用户最初设想「AI 时代直接全原生最好」——半对）**：AI 角度（research 最弱证据面，诚实标注）——已**有据**：AI 助手**即便对主流 Jetpack Compose** 不喂源码 grounding 也常出错（幻觉 API、过时 Material 2、错误 `remember`），由 Google 工程师的对照工具 + Google I/O 2026 出 grounding CLI + 学术 LLM API 幻觉研究佐证 [^composeai]；据此推断 CMP 小众 idiom 对 AI **更难**（未被直接基准测）。但**「AI 抹平跨端学习曲线 / 不再需要懂 iOS」被明确证伪（0-3）** [^aimyth]。结论：**AI 让「原生 UI」更划算（远离 A），但并未让「重复实现正确性关键逻辑」变安全**——`TrackBrief` 契约、队列排序、续歌触发若两套语言各写一遍，正是 AI 易引入分歧 bug 之处（「单一真源」结构性优势，逻辑上成立但本轮未被独立测量）。故 C 把**该共享的核心也重复**了，过头。

> **AI 角度净效应**：推「原生 UI」（反 A）+ 推「单源共享核心」（反 C）→ **收敛到 B**。用户「原生最好」的直觉**对在 UI、错在也要重复核心逻辑**。

**B 的唯一真实代价**：放弃 A 的「一份 SkSL 两端」——shader 变 **Metal(iOS) + AGSL(Android)** 两份；因 **AGSL≈SkSL**，净增量约等于「iOS Metal 移植这一份」（§5.4）。对 fidelity 导向的沉浸播放器，原生手感通常压过这点成本。

**C 作为合法备选**：若团队觉得 KMP/Kotlin-Native/SKIE 的工具链税不值为共享 ~1,500 LOC 核心，可退到 C——但须把 `TrackBrief`/队列逻辑当**共享规格**（JSON schema 单源 + 跨语言一致性测试）防漂移（§10）。

> **SKIE 让 B 的 Kotlin→Swift interop 接近原生**（Touchlab，Apache-2.0）：把 `Flow`→Swift `AsyncSequence`、`suspend`→Swift `async`（带取消、任意线程可调）、sealed→Swift 穷举 `switch`、enum→原生 Swift enum，弥补 Kotlin 经 Obj-C 桥到 Swift 的能力损失 [^skie]（竞品 KMP-NativeCoroutines）。

**结论：Option B —— `commonMain` 共享业务核心；iOS UI = SwiftUI、Android UI = Jetpack Compose；经 SKIE 消费共享核心；shader/FFT/音频/DB 本就平台原生。**

### 2.2 选型决策二：模块结构 + 平台缝（DesktopBridge 的移动版）

Kotlin 官方指引：**优先用普通语言构造**，平台差异**藏在普通 Kotlin 接口 + DI 后**，而**不是**到处 `expect/actual` 类——`expect/actual` **只用在 DI 配置**那一层 [^expectactual]。这与我们现有 `DesktopBridge`（[`bridge.ts`](../../../../src/lib/desktop/bridge.ts) `resolveDesktopBridge()`）的纪律**完全同构**：加能力 = 扩接口 + 各平台实现，不散落 `isTauri()`。

**Option B 工程结构（对齐 JetBrains 2026-05 默认：Compose-free `sharedLogic` + 原生 UI 双壳）[^kmpdefault]：**

```
muzero-mobile/                      # 新 KMP 工程（独立仓 or 与 web 同仓子目录，见 Open Q）
├── sharedLogic/                    # KMP 共享核心（Compose-free，UI 无关）
│   ├── commonMain/                 #   纯业务逻辑（无 UI / 无 Compose）
│   │   ├── core/                   #     皇冠逻辑（§2.5）：queue / dj / brief(契约) / cloud-job / search / display / flow-config / bands / palette
│   │   ├── data/                   #     SQLDelight 或 Room-KMP queries + repositories + Flow 响应式读（§3.1）
│   │   ├── audio/                  #     AudioEngine 接口 + 队列编排（platform 实现注入）
│   │   ├── ai/                     #     DJ brain 接口（Koog/anthropic-kotlin 实现）+ musicgen provider 接口
│   │   └── platform/               #     MobileBridge 接口（fetch/files/fft/keystore/...）—— DesktopBridge 的移动版
│   ├── androidMain/                #   Media3、AudioProcessor FFT、Keystore、SAF 实现
│   └── iosMain/                    #   AVPlayer/AVAudioEngine+vDSP FFT、Keychain、Files 实现（经 SKIE 导出给 Swift 消费）
├── androidApp/                     # Android **原生 UI = Jetpack Compose**（pages/player/visualizer/lyrics/settings）+ **AGSL** shader + Coil 3 + MediaSession
└── iosApp/                         # iOS **原生 UI = SwiftUI**（同上各屏）+ **Metal** shader + 原生图片(AsyncImage/Kingfisher) + MPNowPlayingInfoCenter；经 **SKIE** 消费 sharedLogic
```

- **UI 各端原生、核心单源**：UI 不进 `sharedLogic`；iOS 写 SwiftUI、Android 写 Jetpack Compose。两端 UI 都只依赖 `sharedLogic` 暴露的 ViewModel/状态/用例。
- **DI = Koin**：`sharedLogic` 声明，平台模块提供 actual 实现。Koin **支持 KMP**（注解 + Koin Compiler Plugin 可免 per-platform KSP 配置）[^koin1][^koin2]；Koin 4.2 stable（~2026-04），Compiler Plugin 需 Kotlin 2.3.20+ [^koin2]。⚠️「expect/actual 的 Koin 定义必须各端同构造函数」一说被证伪（1-2）——构造可按平台变 [^koin1]。
- **状态管理**：Zustand → `sharedLogic` 的 `ViewModel`/普通类 + **`StateFlow`**。Android：Compose `collectAsState()`；iOS：经 **SKIE** 把 `Flow`→Swift `AsyncSequence` 喂进 SwiftUI（`@Observable`/`@State`）[^skie]。沿用 CLAUDE.md 规则 6「最小 selector、单例不进 state」：非响应式单例（AudioEngine、DjEngine、FFT tap）放模块作用域，不进可观察 state。

### 2.3 技术栈总映射表（web → 推荐 KMP 替代）

> 每行附**可行性**（High/Medium/Hard）与**调研可信度**（✅=research 核验并引用；⚠️=团队判断/research 未覆盖，见 §10）。

| 子系统 | 当前 web 技术 | 推荐 KMP/原生替代 | 可行性 | 可信度 |
|---|---|---|---|---|
| UI 框架 | React 19 + DOM | **原生：SwiftUI(iOS) + Jetpack Compose(Android)**（共享核心，不共享 UI） | High | ✅ [^kmpdefault][^cmfeel] |
| Kotlin→Swift interop | — | **SKIE**（Flow→AsyncSequence、suspend→async、sealed/enum） | High | ✅ [^skie] |
| DI | （手动） | **Koin**（KMP，sharedLogic） | High | ✅ [^koin1][^koin2] |
| 状态 | Zustand | **StateFlow + ViewModel**（sharedLogic）；Android collectAsState / iOS 经 SKIE | High | ✅(interop) [^skie] |
| 音频播放 | `HTMLMediaElement` | **Media3/ExoPlayer**(Android) + **AVPlayer**(iOS) | High | ✅(机制)/⚠️(封装) [^kmmplayer] |
| 后台/锁屏 | （web 无） | **MediaSession**(Android) + **MPNowPlayingInfoCenter/MPRemoteCommandCenter**(iOS) | High（净收益） | ⚠️ |
| 音频 FFT | `AnalyserNode` | iOS：**AVAudioEngine `installTap` + Accelerate/vDSP**；Android：**Media3 `AudioProcessor` PCM tap → FFT**（KissFFT/Noise） | iOS High / Android Medium | iOS ✅ [^tempi][^keijiro][^vdsp] / Android ⚠️ |
| 分带数学 | `bands.ts` | **纯 Kotlin `commonMain`（1:1 直译）** | High | ✅(八度分带机制) [^tempi] |
| 2D 频谱 | Canvas 2D | **iOS: SwiftUI `Canvas`/Metal / Android: Compose `Canvas`(DrawScope)**（渐变/路径/阴影） | High | ⚠️ |
| 流光 shader | GLSL ES + twgl WebGL | **iOS: Metal(MSL) / Android: AGSL `RuntimeShader`**（AGSL≈SkSL；GLSL 逻辑作共享参考，移植差异同 [^skiareadme]） | Medium（移植成本=最大风险） | ✅(机制) [^sksl][^skiareadme] |
| 混合模式 | CSS `mix-blend-mode` | **iOS: Metal blend / SwiftUI `.blendMode` / Android: Compose `BlendMode`·`RenderEffect`** | Medium | ⚠️ |
| Pixi 滤镜 | pixi-filters | **逐个重写**：iOS Metal / Android AGSL·`RenderEffect` | Hard | ⚠️ |
| 取色 | canvas 量化 | **纯 Kotlin 量化器 `commonMain`（移植 `image-palette.ts`）** > AndroidX Palette(仅 Android) | High | ⚠️ |
| 同步歌词 | DOM + motion | **iOS: SwiftUI `ScrollView`/`LazyVStack` + 原生动画 / Android: Compose `LazyColumn` + `Animatable`**（共享 `lyric-motion` 参数） | Medium | ⚠️ |
| 动量滚动 | Lenis | **各端原生动量**（不移植 Lenis） | High（简化） | ⚠️ |
| 转场/共享元素 | VT API + Framer Motion | **iOS: SwiftUI `matchedGeometryEffect`/`.transition` / Android: Compose shared-element** | Medium | ⚠️ |
| 虚拟列表 | TanStack Virtual | **iOS: SwiftUI `List`/`LazyVStack` / Android: `LazyColumn`（均内建）** | High | ⚠️ |
| 本地 DB | Dexie/IndexedDB | **SQLDelight**（推荐）或 Room-KMP | Medium | ⚠️ |
| 响应式读 | `useLiveQuery` | **SQLDelight `asFlow()`** / Room `Flow` | High | ⚠️ |
| 媒体字节 | `mediaBlobs` blob | **文件系统**（app files/cache）+ DB 存元数据/路径 | High | ⚠️ |
| schema 校验 | Zod | **kotlinx.serialization**（+ JSON schema 供 tool-use） | High | ✅(机制) [^xemantic] |
| DJ LLM brain | Vercel AI SDK `generateObject` | **Koog**（首选）/ **xemantic anthropic-sdk-kotlin** + **tddworks openai-kotlin** | High | ✅ [^koog][^koogrepo][^xemantic][^tdd][^kotlinai] |
| 出站 HTTP | `getAppFetch`/muzfetch | **Ktor client**（native 无 CORS，代理可删） | High | ⚠️(Ktor 常识) |
| 图片加载 | `<img>`/objectURL | **Android: Coil 3 (+coil-network-ktor3) / iOS: SwiftUI `AsyncImage`·Kingfisher·Nuke** | High | ✅ [^coil][^coilpost] |
| i18n | i18next | **共享串：moko-resources**（双端可读）；或各端原生（Android strings.xml / iOS `.strings`），en 仍为类型源 | High | ⚠️ |

### 2.4 依赖 license / 维护度清单（license 第一公民）

新栈每个依赖逐个 ship 判定（沿用模板 §3）：

| 库 | 用途 | License | 状态 / 版本锚点 | ship 判定 |
|---|---|---|---|---|
| Kotlin Multiplatform | 语言/编译 | Apache-2.0 | JetBrains 官方 | ✅ |
| Jetpack Compose（Android UI） | Android 原生 UI | Apache-2.0 | Google 官方 | ✅ |
| SwiftUI（iOS UI） | iOS 原生 UI | Apple | 系统内置 | ✅ |
| **SKIE**（Touchlab） | Kotlin→Swift interop | Apache-2.0 | Flow/suspend/sealed/enum 转 Swift 友好 API [^skie]；竞品 KMP-NativeCoroutines | ✅ |
| Koin | DI | Apache-2.0 | 4.2 stable ~2026-04 [^koin2] | ✅ |
| AndroidX Media3 / ExoPlayer | Android 播放 | Apache-2.0 | Google 官方 | ✅ |
| Ktor client | HTTP | Apache-2.0 | JetBrains | ✅ |
| kotlinx.serialization / coroutines | 序列化/并发 | Apache-2.0 | JetBrains | ✅ |
| SQLDelight **/ Room-KMP** | DB | Apache-2.0 | CashApp / AndroidX（Room-KMP 2025-05 stable，SimpMusic 在用 2.8.4） | ⚠️ 二选一未定（§2.6/§3.1，Phase 0 spike） |
| Coil 3 **(+ coil-network-ktor3)** | 图片 | Apache-2.0 | 3.0.0（2024-11）稳定，~3.5.0（2026-06）；music-assistant 用 coil-network-ktor3 走 Ktor 取图 [^coil][^coilpost][^ma] | ✅（**补 coil-network-ktor3** 复用 Ktor engine） |
| **Koog** | AI agent / LLM | Apache-2.0（JetBrains 开源） | **1.0 stable（KotlinConf 2026-05）**，1 年不破坏承诺；JVM/JS/WasmJS/Android/iOS；Anthropic+OpenAI+… [^koog][^koogrepo] | ✅（首选） |
| xemantic/anthropic-sdk-kotlin | Anthropic KMP | 见仓库 | v0.32.5（2026-05），有 iOS 产物；**pre-1.0 API 会变** [^xemantic] | ⚠️ 备选（标注 API 不稳风险） |
| tddworks/openai-kotlin | OpenAI KMP | 见仓库 | KMP，iOS 14+ [^tdd] | ⚠️ 备选 |
| 官方 anthropic-sdk-java / openai-java | — | — | **仅 JVM/Android，非全 KMP，喂不了 iOS 侧** [^kotlinai] | ❌ 不用于 shared 模块 |
| moko-resources | i18n | Apache-2.0 | IceRock | ✅（共享串；或各端原生） |
| KissFFT / Noise（Android FFT） | FFT | MIT/类 MIT | 看选型 | ⚠️ Android FFT 待 spike（§5.2） |

> **版本 pin 警告（research caveat）**：Koog 仅 1 年稳定承诺、xemantic 明确 pre-1.0 churn、SKIE/Coil/Media3 也快速演进——都要在 PR 锁版本并复验。（Option B 不用 CMP/Skiko 共享 UI，故 CM 1.11.x 的 Skiko `Shader` 包装 breaking change 不影响我们；Android UI 用 Jetpack Compose，shader 走 AGSL/Metal。）

### 2.5 现有可移植「皇冠逻辑」（commonMain Kotlin 直译，算法+单测 1:1）

下列模块**纯**（无 DOM/浏览器 API），是 App 命脉，直译到 `sharedLogic/commonMain/core/`，连同其穷举单测一起移植（语义锁定）。**这正是 Option B 相对「全原生 C」要共享的部分——单一真源，避免两端语言各写一遍导致行为漂移**：

| 模块 | 当前文件 | ~LOC | 直译要点 |
|---|---|---|---|
| 队列数学 | [`queue.ts`](../../../../src/player/queue.ts) + [`play-queue.ts`](../../../../src/player/play-queue.ts) | ~185 | `shouldAutoExtend`/`nextIndex`/shuffle/insertNext…；纯函数；不可变 |
| DJ 编排 | [`dj-engine.ts`](../../../../src/dj/dj-engine.ts) + [`dj-prompt.ts`](../../../../src/dj/dj-prompt.ts) | ~270 | draft→materialize→refill；`DjBrain`/`MusicGenProvider` 注入接口 |
| brief 契约 | [`dj-brief-schema.ts`](../../../../src/dj/dj-brief-schema.ts) | ~48 | Zod → **kotlinx.serialization @Serializable**（同时供 tool-use JSON schema） |
| 轮询状态机 | [`cloud-job.ts`](../../../../src/musicgen/cloud-job.ts) | ~78 | submit→poll→download；注入 `now`/`sleep` → Kotlin coroutines + 可测时钟 |
| provider 映射 | [`cloud-provider.ts`](../../../../src/musicgen/cloud-provider.ts) 三纯函数 | ~40 | `mapBriefToBody`/`parseCreate`/`parseStatus` |
| 搜索 | [`track-search.ts`](../../../../src/lib/track-search.ts) | ~100+ | `matchesQuery`（含 `#tag`）；CJK 转写需 Kotlin 拼音/假名库 |
| 显示回退 | [`track-display.ts`](../../../../src/lib/track-display.ts) | ~93 | `resolveStageContent`（video→cover→title）；`trackSubtitle` |
| 流光配置 | [`flow-config.ts`](../../../../src/lib/flow-config.ts) | ~174 | `resolveFlowColors`/`resolveFlowConfig`；hex→rgb |
| 分带数学 | [`spectrum/bands.ts`](../../../../src/visualizer/spectrum/bands.ts) | ~80 | 八度对数分带 + tilt + decay；零分配循环 |
| 取色量化 | [`image-palette.ts`](../../../../src/lib/image-palette.ts) `selectImagePalette` | ~100 | 纯像素→palette（解码/`getImageData` 那层平台化，纯量化进 commonMain） |
| palette 过渡 | [`visualizer-color-store.ts`](../../../../src/stores/visualizer-color-store.ts) `mixPalette` | ~30 | 逐色 EMA 插值 |

> 这些是「重写但语义锁定」的部分——Kotlin 侧补等价单测，桌面与移动**共享同一份业务规则**（虽两份代码）。改 `TrackBrief` 字段仍是「改契约 → 三处对齐」，只是现在跨语言两份契约要同步（Open Q：是否抽 codegen / JSON schema 单一真源）。

### 2.6 参考开源项目（选型佐证 + 可借鉴 package）

第二次 deep research（2026-06，对抗式核验）专门找「能借鉴 package 选择的同类 OSS」。结论：**我们的栈被真实在 2024–2026 活跃发版的项目强佐证**，且暴露 1 个真正要重审的点（DB）。

#### 参考 repo 一览（按相关度）

| repo | 是什么 | stars / 活跃 | License | 平台 | 关键库 | 借鉴点 |
|---|---|---|---|---|---|---|
| **maxrave-dev/SimpMusic** [^simp] | CMP 音乐 App（最相关） | 9.5k / 2026-06-07 发版 | **GPL-3.0** | Android+Desktop（**无 iOS**） | CMP 1.11.1、Kotlin 2.4.0、**Koin 4.2.1**、**Ktor 3.5.0**、**Coil 3 3.4.0**、**Media3 1.10.1**、kotlinx.serialization 1.11.0、**Room-KMP 2.8.4** | 版本目录几乎逐行对齐我们计划；**但 DB 用 Room-KMP（commonMain），非 SQLDelight**（§3.1 重审） |
| **music-assistant/mobile-app** [^ma] | 官方跨端音乐客户端 | 382 / 2026-06-15 push，**iOS 1.0 已发(2026-06-12)** | **Apache-2.0** ✅ | **Android + iOS** | CMP 1.11.0、Ktor 3.5.0、Koin 4.2.1、Coil 3.5.0-beta01 + **coil-network-ktor3**、ktor-darwin(iOS) | **证明这套栈在 iOS 真出包**；`commonMain/androidMain/iosMain/nativeMain` 结构 = **最佳活体模板**（可直接照抄结构，license 友好） |
| **ayodelekehinde/Kicks** [^kicks] | KMM+CMP 播放器 demo | 183 / **2023 起停更** | null(待确认) | Android+iOS | **expect/actual `AudioPlayer`**：androidMain=ExoPlayer，iosMain=AVPlayer/AVAudioSession | **正是我们计划的 Media3+AVPlayer expect/actual 模式**（仅薄参考：无 MediaSession/无 FFT，stale） |
| **open-ani/mediamp** [^mediamp] | KMP 媒体播放器抽象库 | 活跃(~2026-05) | Apache-2.0（VLC 模块 GPLv3） | And/iOS/JVM/wasm | ExoPlayer/AVKit/VLC/HTMLVideo 统一 commonMain | 不想手搓 wrapper 时的**现成库**（pre-1.0、偏视频）；「低 traction 太险」一说被**证伪** |
| **androidx/media** + **dzolnai/ExoVisualizer** [^media3][^exoviz] | Media3 官方 + ExoPlayer 可视化 | 官方 / — | Apache-2.0 ✅ | Android | `AudioProcessor` / `TeeAudioProcessor`→`handleBuffer(ByteBuffer)` | **Android 播放 PCM tap 取频谱的一等机制**（TeeAudioProcessor 是 @UnstableApi/诊断向，但机制对） |
| **jscalo/tempi-fft** [^tempi2] | iOS 实时 FFT | ~256 / stale(Swift2/3) | **CC0** ✅ | iOS | Accelerate `vDSP_fft_zrip` + 5 bands/octave 对数分带 | iOS vDSP FFT + 八度分带技法（**但取的是麦克风，非播放**） |
| **tomer8007/real-time-audio-fft** [^tomer] | iOS FFT | 23 / stale(2017) | MIT ✅ | iOS | vDSP/Accelerate | 同上技法佐证 |
| **paramsen/noise** [^noise] | FFT 库 | — | — | **仅 Android** | JNI kissfft | **仅 Android**，喂不了 iOS → **印证我们「双路 FFT」必要性** |
| **Coding-Meet/Shader-Animation-CMP** [^shadercmp] | CMP 跨端 shader | 53 / 2026-06-14 | **无 license** | And/iOS/Desktop/Web | **一份 shader 字符串在 commonMain** + expect/actual runner（Android13+ AGSL `RuntimeShader`；iOS/Desktop/Web Skia `RuntimeShaderBuilder`/SkSL；Android<13 优雅回退） | **正是我们「一份 shader 两端跑」的样板**（仅学模式，无 license 勿抄码） |
| **Kashif-E/KMPLiquidGlass** [^liquid] | CMP shader 库 | 114 / 2026-05-10 | Apache-2.0 ✅ | And/iOS/Desktop/Web | `skiaMain` 共享 + AGSL/SkSL 双文件经 expect/actual；Skia `RuntimeEffect`+`ImageFilter` | 全 4 端真 shader 渲染；license 友好可借代码（它在 host-API 层拆 AGSL/SkSL 文件） |
| **FoedusProgramme/Gramophone** [^gramo] | 原生 Android 音乐播放器 | ~2.1k | **GPL-3.0** | **仅 Android** | Media3；**LRC+TTML+SRT 逐词/逐音节卡拉OK** 解析 | 歌词解析**行为参考**（非 KMP；Apple 变体是另一仓 AccordLegacy） |
| **amll-dev/applemusic-like-lyrics (AMLL)** [^amll] | Apple Music 风歌词 | ~2k | **AGPL-3.0** | **Web(npm)** | **~87% TS** + 框架无关 core + React/Vue；DOM/CSS 渲染 + **Pixi.js/WebGL 流体背景**；`/lyric` 解析器=Rust→WASM | **不可在 KMP 复用**（浏览器/WASM 绑定）；只作**行为参考**。纠正「core 是 Rust」的旧说法——现版是 TS+Pixi |
| joreilly/**PeopleInSpace** / **Confetti** / Kotlin/**KMP-App-Template** [^pis] | KMP 架构模板 | 官方/知名 | Apache-2.0 ✅ | KMP | commonMain/androidMain/iosMain + Koin + Ktor + (SQLDelight) | 模块结构/DI 接线**规范参考**（PeopleInSpace 有 SwiftUI 原生 UI 变体，正合 Option B） |

> **⚠️ Option B 视角（架构已定 B，§2.1）**：SimpMusic / music-assistant 是 **Option A（CMP 共享 UI）** 的 App——它们仍**强力佐证共享核心的库选**（Koin/Ktor/Media3/kotlinx.serialization；Coil 在 Android 侧）和 **CMP-on-iOS 能出包**，但**我们不抄它们的「共享 UI」**。Option B 要照抄的是 **sharedLogic + 原生 UI** 模式（JetBrains 2026-05 默认 Compose-free sharedLogic [^kmpdefault] + Netflix/Todoist [^netflix]；PeopleInSpace 的 SwiftUI 变体）。Shader-Animation-CMP / KMPLiquidGlass 是「一份 shader 两端」的 A 法——在 B 下它们仍是 **Android 侧 AGSL 移植**的有用参考（AGSL≈SkSL），iOS 侧改走 **Metal**。iOS 图片不用 Coil，改 SwiftUI `AsyncImage`/Kingfisher。

#### 逐项选型 verdict（对照真实 OSS，已按 Option B 校准）

| 我们的选择 | verdict | 依据 |
|---|---|---|
| 原生 UI + 共享核心（Option B） | ✅ **corroborated** | JetBrains 2026-05 默认 sharedLogic+原生 UI [^kmpdefault]；Netflix/Todoist 共享逻辑+原生 UI [^netflix]；CMP-on-iOS 能出包由 music-assistant 旁证（但我们 iOS 走 SwiftUI 而非 CMP） |
| Koin DI | ✅ corroborated | SimpMusic & music-assistant 均 **4.2.1** |
| Ktor HTTP | ✅ corroborated | 两者均 **3.5.0**（含 ktor-darwin iOS） |
| Coil 3 图片 | ✅ corroborated | SimpMusic 3.4.0；music-assistant 3.5.0 + **coil-network-ktor3**（我们漏了这个 Ktor 集成包，建议加） |
| Media3 播放(Android) | ✅ corroborated | SimpMusic 1.10.1、Gramophone、ExoVisualizer |
| Media3+AVPlayer expect/actual | ✅ corroborated（模式） | Kicks 源码即此模式；或用 mediamp 库 |
| kotlinx.serialization | ✅ corroborated | SimpMusic 1.11.0 |
| Android FFT（Media3 AudioProcessor） | ✅ corroborated（机制） | Media3 `TeeAudioProcessor`/`AudioProcessor` + ExoVisualizer |
| iOS FFT（vDSP）| ✅ 技法 corroborated / ⚠️ **gap** | tempi-fft(CC0)、tomer8007(MIT) 证 vDSP+分带；**但全是麦克风采集，无「播放节点 tap」OSS 先例**（§10） |
| Shader 各端原生（Metal/AGSL，Option B） | ✅ corroborated（路径成熟） | Android AGSL 移植参考 Shader-Animation-CMP/KMPLiquidGlass（AGSL≈SkSL）；iOS Metal 是成熟原生路径 ⚠️ 代价=两份 shader 源（§5.4） |
| **DB：SQLDelight** | ⚠️ **alternative seen（要重审）** | **最相关的 SimpMusic 选了 Room-KMP 2.8.4（commonMain），非 SQLDelight**；本次未找到 SQLDelight 的 CMP 音乐 App 反向佐证（§3.1） |
| LLM（Koog/anthropic-kotlin 结构化） | ❌ **no evidence** | 未找到任何用 Koog/Kotlin LLM SDK 做结构化输出的真实 KMP App——**我们是早期采用者**（§10） |
| i18n（moko vs Compose resources） | ❓ no evidence | 未确认同类 App 用哪个（§10） |
| 歌词引擎 | ⚠️ **无可复用** | Gramophone(GPL/仅Android)、AMLL(web/AGPL) 都不可直接复用 → **自研**（移植 `lyric-motion.ts`） |

> **License 红线（借鉴≠抄码）**：**可自由学模式 + 抄依赖选择**，但 **GPL/AGPL/无 license 的代码不得拷进本产品**（SimpMusic GPL-3.0、Gramophone GPL-3.0、AMLL AGPL-3.0、Shader-Animation-CMP 无 license、Kicks license 待确认）。**可安全借代码**的是 Apache-2.0/MIT/CC0：music-assistant、mediamp、KMPLiquidGlass、Media3、tempi-fft(CC0)、tomer8007(MIT)、PeopleInSpace。
>
> **覆盖缺口（真实现状）**：**没有任何单一 OSS App 同时做到「本地优先存储 + 音频 + 实时 FFT/频谱 + 生成式 shader + iOS」**——每项能力是在不同 repo 里分别验证的。MUZERO 是在**集成别人分散做过的事**，没有现成的「抄一个就齐活」的参照。

---

## 3. Data Model Design（数据层）

### 3.1 DB 选型：SQLDelight（推荐）vs Room-KMP

> ⚠️ **本节为团队判断**：本次 research 未留下被核验的数据层结论（§10 Open Q F）。以下为基于公开常识的推荐，**Phase 1 前需独立验证**。

| 维度 | **SQLDelight**（推荐） | Room-KMP |
|---|---|---|
| 模型 | SQL-first（写 `.sq`，生成类型安全 Kotlin） | 注解/DAO-first（Room 现支持 KMP） |
| 响应式 | 查询 `asFlow()` → `mapToList()`，**天然替代 `useLiveQuery`** | 返回 `Flow<...>` |
| KMP 成熟度 | 老牌跨端（CashApp），iOS native driver 成熟 | 较新进 KMP |
| 迁移 | 显式 `.sqm` 迁移文件，版本化 | Room migration |
| 契合度 | 我们 Dexie schema 本就接近关系型，SQL-first 直观 | DAO 抽象更高 |

**⚠️ 重审（OSS 证据）**：原推荐 SQLDelight，但第二次 research 发现**最相关的同类 App SimpMusic 选了 Room-KMP（androidx.room 2.8.4，`@Database`+DAO 在 commonMain，KSP 多端 codegen）**，且本次**未找到任何用 SQLDelight 的 CMP 音乐 App 反向佐证（§2.6）**。Room-KMP 已于 2025-05 stable。**两者都活，决策天平不再一边倒**：

- **SQLDelight**：SQL-first、`asFlow()` 直替 `useLiveQuery`、iOS native driver 老牌成熟、迁移文件显式——贴合我们「已是关系型心智」。
- **Room-KMP**：注解/DAO、有**最强同类先例**（SimpMusic 真出货）、与 Android 生态最顺、`Flow` 响应式内建。

**结论：Phase 0 spike 各搭一个最小响应式查询 demo（含一次迁移）后定**；若团队更看重「有同类生产先例 + Android 顺手」→ Room-KMP，若更看重「SQL-first + 显式迁移控制」→ SQLDelight。不预设，spike 拍板。

### 3.2 Schema：不背 25 版迁移包袱，但 codename 不变

桌面 Dexie 走到 **v25**（`.upgrade()` 回填）。移动端是**全新 store**，**不需要重放 25 次迁移**——直接以 **v25 的等价目标形状**建初始 SQLDelight schema（一张「当前真相」表集），迁移历史只作参考。但 **codename 层严格保持**（CLAUDE.md 规则 4）：

- DB 名沿用 **`muzero-db`** 语义；表名 `tracks`/`sessions`/`mediaBlobs`/`settings`/`playQueue`/`memories`/`lyrics`/… 一致。
- id 前缀 **`trk_`/`ses_`/`blb_`/`mem_`/`pqe_`** 不变（`newId()` 直译进 commonMain）。
- **`TrackBrief` 字段名不变**（DJ↔musicgen↔DB 唯一契约）。
- `kind`(audio/video) / `origin`(generated/uploaded) / `displayMode` / `autoExtend` 等枚举值不变。

> codename 不变保证：(a) 跨端语义一致、(b) 同一 `TrackBrief` 既喂桌面又喂移动 provider、(c) 未来若做导出/同步（R2/WebDAV，已有桌面 PRD）数据可互认。**移动与桌面/web 各自独立本地库、不自动迁移数据**（与 Electron↔Tauri 已知限制同口径，§3.5）。

### 3.3 媒体字节：进文件系统，不进 DB blob

桌面把音频/封面/视频字节存 `mediaBlobs`（IndexedDB blob）。**移动端推荐：大字节落文件系统**（app `filesDir`/`cacheDir` via 平台路径），DB 只存**元数据 + 文件相对路径 + role**（`media`/`cover`/`memory`）。理由：手机内存/DB 压力敏感，大 blob 进 SQLite 既慢又易触发回收；文件系统天然支持流式播放与缓存淘汰（LRU）。这也呼应桌面 `writeMediaStorageFile`/`readMediaStorageFile`/`statMediaStorageFile`（[`bridge.ts`](../../../../src/lib/desktop/bridge.ts)）已抽象的「app 托管文件存储」——移动 `MobileBridge` 实现同接口。

> ⚠️ 团队判断（§10 Open Q F）：DB-blob vs FS 的最终选择 Phase 1 复测（小封面缩略图或可留 DB，大音频必走 FS）。

### 3.4 响应式读（替代 useLiveQuery）

Dexie `useLiveQuery` → SQLDelight/Room `query.asFlow().mapToList(Dispatchers.IO)`（在 `sharedLogic`）→ **Android Compose `collectAsState()`；iOS 经 SKIE 把 `Flow`→Swift `AsyncSequence` 喂 SwiftUI** [^skie]。列表/集合一律走 Flow 查询，**不把可由 DB 派生的数据塞进 StateFlow state**（沿用规则 6）。虚拟化用各端原生（`LazyColumn` / SwiftUI `List`），等价 TanStack Virtual。

### 3.5 codename 层不变（规则 4）+ 已知限制

移动 App 是**独立 origin / 独立本地库**，**切端不迁移数据**（与桌面 Electron↔Tauri 各自 IndexedDB 同限制）。跨端共享数据是**后续独立 phase**（复用已有 R2/WebDAV 云盘 PRD 的同步机制，非本期）。

---

## 4. Module Surface（无后端；平台缝接口契约）

> 本项目无后端、无 API endpoint（本地优先）。本节列**移动端平台接口契约**替代 §4 API。所有平台能力走接口 + Koin 注入（§2.2）。

### 4.1 `MobileBridge`（DesktopBridge 的移动版，commonMain 接口）

| 能力 | 方法（示意） | Android 实现 | iOS 实现 | 备注 |
|---|---|---|---|---|
| HTTP | `fetch(req): Response` | Ktor(OkHttp engine) | Ktor(Darwin engine) | **native 无 CORS**，无需 muzfetch 代理 |
| 媒体文件存储 | `writeMedia/readMedia/statMedia/deleteMedia` | `filesDir`/`cacheDir` | `Documents`/`Caches` | 大字节落 FS（§3.3） |
| 文件导入 | `pickMediaFiles()` | SAF (`ACTION_OPEN_DOCUMENT`) | `UIDocumentPicker`/Photos | 移动只挑单/多文件，无「读整文件夹」 |
| 密钥安全存储 | `secureGet/secureSet(key)` | **Android Keystore / EncryptedSharedPrefs** | **iOS Keychain** | BYOK 密钥（§8） |
| FFT tap | `audioSpectrum(): Flow<FloatArray>` | AudioProcessor PCM→FFT | AVAudioEngine tap + vDSP | §5.2 |
| 打开外链 | `openExternal(url)` | Intent | `UIApplication.open` | |
| 分享/导出 | `share(file)` | `ACTION_SEND` | `UIActivityViewController` | 替代桌面 saveFile 对话框 |

> 桌面 `DesktopBridge` 的桌面专属能力（`pickFolder`/`readDir`/window/tray/systemShortcuts/liveRequestIntake/mediaProxyUrl/`evalYoutubeN`…）**移动端不实现**（约 60% 不适用），保持接口可选。

### 4.2 音频引擎接口（AudioEngine，commonMain）

`mount/unmount/loadBlob/play/pause/seek/getSpectrum`，Media3（Android）/ AVPlayer+AVAudioEngine（iOS）实现注入。队列编排（纯逻辑）在 commonMain，调用此接口。

### 4.3 DJ brain + musicgen provider 接口

- `DjBrain`：`writeBriefs(context): List<TrackBrief>` —— Koog / anthropic-sdk-kotlin 实现，结构化输出经 tool-use JSON schema（从 `@Serializable TrackBrief` 自动抽，等价 generateObject+Zod）[^xemantic]。
- `MusicGenProvider`：`generate(brief): {bytes, mime, durationSec}` —— cloud(BYOK) 实现复用移植的 `cloud-job` 轮询；`mock` 实现供离线/单测。

### 4.4 错误 / 边界

- **shader 编译失败 / 低端 GPU**：流光层回退静态多色渐变（Android Compose `Brush` / iOS SwiftUI `LinearGradient`），不黑屏（对齐桌面 `resolveFlowColors` 永不黑屏纪律）。
- **FFT tap 不可用 / 无权限**：可视化回退到「无音频反应」的时间流动画（uAudio=0）。
- **取色失败 / tainted**：回退 `flowCustomColors`（移植 `resolveFlowColors`）。
- **BYOK key 缺失**：DJ/musicgen 优雅停摆 + 引导去 Settings 录入（不崩）。
- **context lost / 低内存**：各端原生渲染层自管（Metal/Compose）；订阅生命周期暂停渲染（§5）。

---

## 5. Frontend / Effects Design —— 逐特性可行性

### 5.1 音频播放 + 后台 + 锁屏

- **播放**：Android **Media3/ExoPlayer**，iOS **AVPlayer**（或 AVAudioEngine player node，若要与 FFT tap 同图）。单一持久 player（对齐桌面单 `<video>` 纪律）。⚠️ 已有社区把 Media3+AVPlayer 统进 KMM 媒体播放器的实践 [^kmmplayer]，但**封装库成熟度待评**，可能自写薄接口（§4.2）。
- **后台音频 + 锁屏**（web 没有，净收益）：Android **`MediaSessionService` + MediaSession**（通知 + 锁屏 + 蓝牙控制）；iOS **`AVAudioSession`(category=playback) + `MPNowPlayingInfoCenter` + `MPRemoteCommandCenter`**。**可行性 High**（平台一等公民），⚠️ research 未专项核验（常识级）。

### 5.2 音频分析（FFT）—— 替代 AnalyserNode

- **iOS（✅ research 核验，High）**：`AVAudioEngine` 在 **`mainMixerNode`** 上 `installTap`（取**混音后**的播放信号，不是 outputNode）+ Apple **Accelerate/vDSP** FFT（`vDSP_fft_zrip` / `vDSP.FFT`）。八度对数分带作为纯数学层套在 FFT bins 上喂频谱 + bass/mid/treble/energy uniform。已有 `tempi-fft`、`keijiro/AudioSpectrum` 证明 [^tempi][^keijiro][^vdsp]。
- **Android（⚠️ Medium，待 spike）**：两条路——(a) **Media3 自定义 `AudioProcessor`** 插进 ExoPlayer 音频链，拿 PCM 后自做 FFT（KissFFT/Noise 库）；(b) 旧 **`Visualizer` API**（已不推荐、有设备兼容/权限坑）。research **未核验** Android tap 在 60fps 下的可靠性/延迟/权限（§10 Open Q B）——**Phase 0 必须 spike 双端取到稳定频谱**。
- **分带数学**：移植 `bands.ts`（八度分带 ✅ 机制核验 [^tempi]）+ `audio-uniforms.ts` 到 commonMain，双端共用。

### 5.3 2D 频谱可视化 —— 各端原生 Canvas

bars / radial / led-reflex（倒影）/ waveform：**Android 用 Compose `Canvas`(DrawScope)**、**iOS 用 SwiftUI `Canvas`（或 Metal）**——渐变/路径/阴影（`drawRect`/`drawPath`/线性·径向渐变/shadow），跟随主色。每帧由 sharedLogic 的 FFT `Flow`（Android collectAsState / iOS 经 SKIE）驱动重绘。**逻辑（分带/选色/平滑）在 commonMain 单源，仅绘制各端原生写一遍**（绘制代码很薄）。**可行性 High**，⚠️ research 未独立核验「60fps 下复杂路径+阴影」移动性能（§10 Open Q D）——按模板 §4 先补**帧节奏指标**（Android frame metrics / iOS CADisplayLink）再调。零分配循环纪律照搬。

### 5.4 流光背景（着色器）—— 各端原生 shader（iOS Metal / Android AGSL）【最大风险】

> **Option B 调整**：放弃 A 的「一份 SkSL 两端」（那依赖 CMP/Skiko 共享 UI）。改为 **GLSL 逻辑作为共享参考真源，各端原生 shader**：**Android = AGSL `RuntimeShader`**（API 33+，AGSL≈SkSL），**iOS = Metal(MSL)**（SwiftUI 经 `MTKView`/`CAMetalLayer` 或 Metal-backed 视图）。AGSL 与 SkSL 几乎同源，移植差异同 [^sksl][^skiareadme]；iOS Metal 是额外那一份的主要成本。

- **GLSL→AGSL 移植差异（✅ 核验，逐项处理）**[^skiareadme]：纹理函数改 `eval`/`sample`；precision（AGSL 用 `half`/`float`）；向量类型 `float2/half4` 而非 `vec2`；**坐标非归一化、(0,0) 左上**（`uv`/`uResolution` 归一化逻辑要改）。`FLOW_PRELUDE` 的 `hash21`/`vnoise`/`fbm`/`ramp(多色)`/数组 uniform `uColors[5]` 可移植，逐个验证。
- **GLSL→Metal(MSL)**：fragment function + uniform buffer（`uColors`/`uTime`/`uAudio`），坐标系与归一化按 Metal 约定调；fbm/noise/voronoi 是标准片元逻辑，移植成熟。
- **保持单源的做法**：把 14 个 shader 的**算法逻辑**留在注释/文档化的 GLSL 参考（沿用桌面 `flow-shaders.ts` 的 `FLOW_PRELUDE`/`FLOW_FRAGS` 作 spec），AGSL 与 MSL 各按 spec 实现 + 截图比对，避免两端视觉漂移。
- **风险 + 裁剪**：research 明确——**14 个 shader（fbm/noise/voronoi/metaball + 数组 uniform）的移植工作量是单一最大技术风险**（现在还多一门 Metal）。⚠️ **v1 curate 子集**（如 4–6 个：chaos-waves/ambient-light/big-blob/wavy-waves 等，按 day-1 价值选），其余进 v2 backlog（对齐模板「curate 不穷举」）。**Phase 0 先移 1 个：Android AGSL + iOS Metal 双端比对**，再 Phase 5 铺子集。低端/无 GPU 回退静态多色渐变（SwiftUI `LinearGradient` / Compose `Brush`）。
- **合成 / 混合模式**：CSS `mix-blend-mode`（screen/multiply/overlay/plus-lighter）→ **iOS SwiftUI `.blendMode` / Metal blend；Android Compose `BlendMode`/`RenderEffect`**（⚠️ §10 Open Q C，v1 先 screen/normal，exotic 模式后置）。

### 5.5 背景滤镜（Pixi CRT/ASCII/pixel/dot）—— v1 裁剪

pixi-filters 全家桶在移动端**重写成本高**（每个 = 一份 iOS Metal + 一份 Android AGSL/`RenderEffect`），且属「锦上添花」。**v1 裁剪**（§7），v2 按需逐个重写。封面 cover→cover crossfade 用**各端原生**（iOS SwiftUI `.transition`/`AnimatedContent` 等价、Android Compose `Crossfade`），不需要常驻 filter，简化。

### 5.6 取色调色板

移植 `image-palette.ts` 的**纯量化器**到 `sharedLogic/commonMain`（解码那层平台化：Android `Bitmap`+`getPixels` / iOS `CGImage`+像素 buffer，喂同一个 Kotlin `selectImagePalette`）。**优于 AndroidX Palette**（仅 Android、风格不同），保证**双端取色结果一致**——这正是 Option B「共享核心」的价值。`mixPalette` 900ms EMA 过渡直译。**可行性 High**，⚠️ research 未核验（§10 Open Q E）。

### 5.7 同步歌词 + 三动效模式

- **共享**：`lyric-motion.ts` 的 classic/inertial/cascade 三套 stiffness/damping/mass 参数 + LRC/TTML 解析 + beat-exact 行号计算 → commonMain（纯数学/解析，单源）。
- **绘制各端原生**：Android = Compose `LazyColumn` + `Animatable`/`animateFloatAsState`；iOS = SwiftUI `ScrollViewReader`/`LazyVStack` + 原生 spring 动画。活动行用共享参数驱动滚动偏移；beat-exact 高亮读 player 精确 `currentTime`（只在行号变时更新，对齐桌面纪律）。
- **动量滚动**：各端**原生**（不移植 Lenis）。⚠️ 滚动物理本就各端不同——native UI 反而拿到**真原生手感**（消掉了 A 方案「CMP iOS 滚动 parity 被证伪」的隐患 [^cm18]）；三动效仍需逐端调参（§10）。

### 5.8 动画 / 转场 / 虚拟列表

- 转场/共享元素：**各端原生**（iOS SwiftUI `matchedGeometryEffect`/`.transition`；Android Compose shared-element + 动画），替代 View Transitions API + Framer Motion。
- 虚拟列表：iOS `List`/`LazyVStack`、Android `LazyColumn`/`LazyVerticalGrid` 内建，替代 TanStack Virtual（High）。
- 减动效：各端读系统 reduced-motion → 冻结流光、降频频谱（对齐桌面 SceneHost 纪律）。

### 5.9 逐特性可行性矩阵（汇总）

| 特性 | 可行性 | 推荐库/技术 | v1 范围 |
|---|---|---|---|
| 本地/云音频播放 | **High** | Media3 / AVPlayer | ✅ v1 |
| 后台 + 锁屏控制 | **High**（净收益） | MediaSession / MPNowPlayingInfoCenter | ✅ v1 |
| iOS FFT | **High** | AVAudioEngine + vDSP | ✅ v1 |
| Android FFT | **Medium**（spike） | Media3 AudioProcessor + KissFFT | ✅ v1（Phase0 验证） |
| 2D 频谱（4 样式） | **High** | Compose Canvas(Android) / SwiftUI Canvas(iOS)，逻辑共享 | ✅ v1 |
| 流光 shader（子集） | **Medium**（最大风险） | AGSL(Android) + Metal(iOS)，GLSL 作 spec | ⚠️ curate 子集 |
| 混合模式 | **Medium** | Compose BlendMode / SwiftUI .blendMode | ⚠️ 基础模式 |
| Pixi 滤镜 | **Hard** | 各端原生逐个重写 | ❌ v2 |
| 封面取色 + glide | **High** | 纯 Kotlin 量化器（commonMain 共享） | ✅ v1 |
| 同步歌词 + 动效 | **Medium** | 共享解析/参数 + 原生绘制(LazyColumn/LazyVStack) | ✅ v1（手感调） |
| 共享元素转场 | **Medium** | 各端原生（matchedGeometry / Compose shared element） | ⚠️ 简化 |
| 虚拟列表 | **High** | LazyColumn / SwiftUI List | ✅ v1 |
| 本地 DB + 响应式 | **Medium** | SQLDelight/Room asFlow（iOS 经 SKIE） | ✅ v1 |
| DJ LLM 续歌 | **High** | Koog / anthropic-sdk-kotlin（commonMain 共享） | ✅ v1 |
| BYOK HTTP | **High** | Ktor（无 CORS，commonMain 共享） | ✅ v1 |
| 图片加载 | **High** | Coil 3(Android) / AsyncImage·Kingfisher(iOS) | ✅ v1 |

### 5.10 性能 / 自动化测试 Harness（验收方法学，镜像 Electron CDP + 控制端点）

> 对齐 [`prd-create.md`](../../../../.cursor/commands/prd-create.md) §4「先定**测量方法学**再优化」。桌面已有成熟 harness（[`20260615-...dev-control-endpoint-automation-harness-prd`](../../20260615-muzero-dev-control-endpoint-automation-harness-prd/20260615-muzero-dev-control-endpoint-automation-harness-prd.md) + [`20260616-...agent-cpu-profiling-harness-prd`](../../20260616-muzero-agent-cpu-profiling-harness-prd/20260616-muzero-agent-cpu-profiling-harness-prd.md)）：dev-only **localhost 控制端点**（`127.0.0.1:7345`，token，loopback-only）把命令派发进既有 action/store 层，外部 `perf-drive.mjs` 跑场景（switch/pingpong/counted/like/idle），`perf-profile.mjs` 用 **CDP Profiler** 套在场景上抓 flame graph；指标=帧节奏（rAF `PerfWindow` p99/max）+ longtask（`PerformanceObserver` ≥50ms）+ heap + blob 跟踪 + trace ring + marker。

**关键认知：没有「KMP 版 CDP」**——CDP 存在是因为 Electron 就是 Chromium。原生 KMP 无内嵌浏览器，**用「单一 CDP」换「各平台原生 profiler」**；但 harness 是**三层**，只有最深一层按平台分叉：

| Electron harness 部件 | KMP 等价 | 可共享 |
|---|---|---|
| 控制端点 `perf-control.cjs`（HTTP+token+loopback） | **Ktor embedded server 在 dev-only `sharedLogic/commonMain`**（同端口/token/Host·Origin 校验/dev-gate） | ✅ 全共享（⚠️ 验 iOS native；否则 expect/actual） |
| IPC relay → renderer | 直接调 sharedLogic action 层（无需 IPC） | 更简单 |
| action 派发（`runShortcutAction`/player store/`saveSettings` allowlist） | **同一份 sharedLogic action/store 层** | ✅ 端点驱动**走真实代码路径**（B 下逻辑本就共享） |
| `perf-drive.mjs` 场景脚本 | **不改**（HTTP/JSON 契约语言无关，换 base-URL 即用） | ✅ 原样复用 |
| `perf-profile.mjs`（CDP Profiler→.cpuprofile） | **Android: Macrobenchmark + Perfetto**；**iOS: XCTest metrics + Instruments/`xctrace`** | ❌ 各平台 |
| 帧节奏（rAF `PerfWindow`） | **`PerfWindow` 百分位逻辑共享（commonMain）**；帧源各端原生：Android Choreographer/`withFrameNanos`、iOS `CADisplayLink`（B 无共享 UI，不能单一 `withFrameNanos`） | 百分位共享 / 帧源各平台 |
| longtask（`PerformanceObserver` ≥50ms） | **帧超预算（frame-overrun）= hitch 事件** + JankStats(Android) / MetricKit `MXAnimationMetric`(iOS) | 事件共享 / 源各平台 |
| trace section / `notePerfWork` | `expect fun traceSection(name)` → **`androidx.tracing.trace{}`(Perfetto)** / **`os_signpost`(Instruments)** | ✅ 一套标注两端 flame graph |
| `trace.ts` ring(300) + marker + `/perf/trace` | 移植到 commonMain（同 `TraceEntry` schema / 同 marker 协议 / 同 since 切片） | ✅ |
| heap（`usedJSHeapSize`） | Runtime 内存(Android) / `os_proc_available_memory`+footprint(iOS) / `MemoryUsageMetric` | 各平台 |
| blob URL 跟踪 | 解码 bitmap 内存 / Coil memory-cache stats / 文件句柄 | 各平台 |
| `dev-perf-panel.tsx` HUD | 各端原生 dev HUD（Android Compose / iOS SwiftUI），读同一份 sharedLogic window | 数据共享 / 呈现各平台 |
| `.logs` report JSON | 同 report schema | ✅ |
| CI 回归门禁 | Macrobenchmark JSON 预算 + XCTest baseline | 各平台，**同预算口径** |

**Layer 1 控制端点（共享）**：Ktor CIO server 在 dev-only `sharedLogic/commonMain`，镜像桌面端点全部路由 + 安全（token 常量时间比较 / loopback / dev-gate，**打包构建永不暴露**），派发进共享 action/store 层 → **现有 `perf-drive.mjs`/`perf-profile.mjs` 场景脚本直接复用**。⚠️ 验 Ktor server 是否跑在 Kotlin/Native iOS；否则 expect/actual（iOS `Network.framework` `NWListener`，或 XCUITest launch-args / `simctl openurl` deeplink；Android 亦可 `adb am broadcast`）。

**Layer 2 仪表（核心共享 + 帧源各端）**：`PerfWindow` 百分位 + `trace.ts` ring/marker + `perf-counters`（DB-requery 计数）移植到 `sharedLogic`；帧源各端原生喂进来——**Android Choreographer/`withFrameNanos`、iOS `CADisplayLink`**（Option B 无共享 UI，不能单一 `withFrameNanos`）；无原生 longtask API → **帧超预算 hitch**（带场景 marker + 活跃 trace section 归因）；`traceSection` expect/actual 映射 **Perfetto(Android) / `os_signpost`(iOS)**。

**Layer 3 深度 profiling + CI（各平台，同场景）**：
- **Android（强项）**：**Macrobenchmark** `FrameTimingMetric`（`frameOverrunMs` p99 = 确定性「不掉帧」门禁）+ **`TraceSectionMetric`**（直接断言你命名的 trace section p99，如 `switchSong`）+ `MemoryUsageMetric`/`PowerMetric`；自动出 **Perfetto** trace（flame graph）。**JankStats**（带屏幕状态归因）做 in-app；**Gradle Managed Devices** 跑 CI；Compose composition tracing 看重组。驱动可用 UiAutomator **或控制端点**。
- **iOS（可行但更重，需 macOS runner）**：**XCTest `measure(metrics:)`**（`XCTClockMetric`/`XCTCPUMetric`/`XCTMemoryMetric`/`XCTOSSignpostMetric`，**存 baseline 自动判回归**=门禁）+ **XCUITest** 驱动；**`xcrun xctrace record`** 在 CI 跑 **Instruments**（Time Profiler=flame graph / Animation Hitches）→ `.trace`；**MetricKit** 收 field 帧/卡顿/hitch。
- **场景契约是不变量**：同一组场景驱动两端，逐场景指标对**移动预算**（注意 **120Hz ProMotion=8.3ms 预算 vs 60Hz=16.7ms**；热降频 → 多跑取中位 + warm-up，沿用桌面「第二轮复测」纪律）→ 超预算 fail build。

---

## 6. Implementation Plan

> **Phase 顺序遵循「基础设施先于覆盖广度」**：先 P0 把工程骨架 + **两个最大未知（shader/FFT）**验证掉，再逐层铺。每 phase 独立可编译可测、可单独 PR。

### Phase 0: 地基 + 双高风险 spike

**Goal:** 立住 **Option B** 工程（`sharedLogic` + 原生 UI 双壳），并**先证伪/证实**最危险的两件事，避免后期返工。

**Tasks:**
- [ ] KMP 工程骨架（`sharedLogic`/`androidApp`(Compose)/`iosApp`(SwiftUI)），模块结构（§2.2），Koin DI + **SKIE** 接好（从 SwiftUI 消费一个 sharedLogic `Flow`/`suspend` 验证 interop）。
- [ ] `MobileBridge` 接口 + 各端空实现 + Ktor（双端发一个 BYOK 风格 HTTP，验证无 CORS）。
- [ ] **Shader spike**：把 **1 个** flow shader（如 `ambient-light`）移植成 **Android AGSL + iOS Metal 各一份**，双端跑通（含多色 `uColors` 数组 uniform + uTime）+ **截图比对**确认视觉一致，记录移植差异清单（坐标/类型/precision/AGSL vs MSL）。
- [ ] **FFT spike**：iOS（AVAudioEngine+vDSP）+ Android（Media3 AudioProcessor 或 Visualizer）双端取到**稳定实时频谱**，跑通 `bands.ts` 直译（commonMain）。
- [ ] 选定 DB（SQLDelight vs Room-KMP）：各搭最小 `asFlow()` 响应式查询 demo（iOS 经 SKIE 消费）。
- [ ] **Harness 地基（§5.10）**：dev-only Ktor 控制端点 `sharedLogic` skeleton（`/health`/`/state`/`/player/playIndex`，token+loopback+dev-gate）+ `PerfWindow`/trace ring（commonMain）+ 帧源各端（Android `withFrameNanos`/Choreographer、iOS `CADisplayLink`）；**验 Ktor server 是否跑 iOS native**（否则定 expect/actual 方案）；用**现有** `perf-drive.mjs` 的 `switch` 场景打到移动端点跑通。

### Phase 0 Checklist
- [ ] 双端 app 能启动、Koin 注入通、**SwiftUI 经 SKIE 拿到 sharedLogic 状态**、Ktor 请求成功（无 CORS）。
- [ ] 1 个 flow shader 在真机 **Android(AGSL)+iOS(Metal)** 渲染一致（截图存档）+ 差异清单文档化。
- [ ] 双端 FFT 取到频谱并驱动一个最简 bar 动画（验证延迟/帧率可接受）。
- [ ] DB 选型拍板（demo + 决策记录）。
- [ ] 控制端点双端可被 `perf-drive.mjs` 驱动切歌；帧节奏数出（Android/iOS 各自帧源）；**Ktor-iOS-server 结论记录**（成/否+回退方案）。

### Phase 1: 数据层
**Goal:** SQLDelight schema（codename 不变）+ repositories + 媒体落 FS + 响应式读。
**Tasks:**
- [ ] 选定 DB（SQLDelight/Room-KMP，Phase 0 拍板）的 schema（目标=桌面 v25 等价形状；表/id 前缀/`TrackBrief` 字段不变，§3.2）。
- [ ] repositories（移植 `repositories.ts` 业务逻辑，DB 调用换选定 DB；`newId()` 直译）。
- [ ] 媒体字节落文件系统（`MobileBridge.writeMedia/readMedia/stat`），DB 存路径+元数据（§3.3）。
- [ ] `asFlow()` 响应式查询替代 `useLiveQuery`；导入→落库→查询打通。

### Phase 1 Checklist
- [ ] 导入一首本地音频 → 落 FS + DB 行 → 列表响应式刷新。
- [ ] codename 校验：DB/表/id 前缀/brief 字段与桌面一致（单测）。
- [ ] commonMain repository 业务逻辑单测（移植桌面用例）。

### Phase 2: 音频引擎
**Goal:** 双端播放 + 后台 + 锁屏 + 队列。
**Tasks:**
- [ ] `AudioEngine` 接口 + Media3（Android）/ AVPlayer（iOS）实现。
- [ ] 后台音频 + MediaSession / MPNowPlayingInfoCenter + 远程控制。
- [ ] 移植队列数学（`queue.ts`/`play-queue.ts`）+ 编排（commonMain），接 AudioEngine。
- [ ] object-URL 等价的资源生命周期（FS 文件句柄，revoke-before-replace 等价）。

### Phase 2 Checklist
- [ ] 双端播放本地曲、上下首、shuffle/repeat 正确（队列单测全绿）。
- [ ] 锁屏/通知显示曲目 + 控制可用；切后台不断播。

### Phase 3: DJ 续歌循环
**Goal:** LLM 写 brief → musicgen 生成 → 入队续歌，BYOK 安全。
**Tasks:**
- [ ] `TrackBrief` kotlinx.serialization（@Serializable）+ tool-use JSON schema 抽取（等价 generateObject+Zod）[^xemantic]。
- [ ] DJ brain：Koog（首选）或 xemantic anthropic-sdk-kotlin + tddworks openai-kotlin 实现 `DjBrain` [^koog][^xemantic][^tdd]。
- [ ] musicgen cloud provider：移植 `cloud-job` 轮询（coroutines + 可测时钟）+ `cloud-provider` 三纯函数；mock provider 供离线/单测。
- [ ] BYOK 密钥存 Keychain/Keystore（§8）+ Settings 录入。
- [ ] 移植 DJ engine（draft→materialize→refill）+ `shouldAutoExtend` 触发。

### Phase 3 Checklist
- [ ] integration test：draft→pending→materialize→ready→refill 全流程（mock brain + mock provider，对齐 CLAUDE.md 规则 7）。
- [ ] 真机：配 BYOK key → DJ 续出新曲并入队播放；key 存安全区不落日志。

### Phase 4: 2D 频谱可视化
**Goal:** 4 个频谱样式各端原生 Canvas 跑通（分带逻辑共享）。
**Tasks:**
- [ ] FFT `Flow` → 分带（`bands.ts` 直译，commonMain）→ **Android: Compose `Canvas` / iOS: SwiftUI `Canvas`** 画 bars/radial/led-reflex/waveform。
- [ ] 跟随主色；reduced-motion / 不可见暂停；零分配循环。
- [ ] 补帧节奏指标（模板 §4，各端帧源），prod build 复测。

### Phase 4 Checklist
- [ ] 双端 4 样式 60fps（或可接受帧率）渲染，截图存档。
- [ ] FFT 不可用时回退「无反应」动画不崩。

### Phase 5: 流光背景（着色器子集）
**Goal:** curate 的 flow shader（Android AGSL + iOS Metal）+ 多色取色 + 合成。
**Tasks:**
- [ ] 移植 curate 子集（4–6 个）flow shader **各端两份（AGSL + Metal）**（基于 P0 差异清单 + GLSL spec），`uColors[5]`/`uTime`/轻度音频 uniform；**截图比对**防两端漂移。
- [ ] 多色取色（§5.6，commonMain 共享量化器）喂 palette，900ms glide（`mixPalette`）。
- [ ] 独立合成层 + 基础混合模式（screen/normal）+ 透明度/压暗（对齐桌面 flow 设置字段）。
- [ ] 低端机/无 GPU 回退静态多色渐变（SwiftUI `LinearGradient`/Compose `Brush`）；reduced-motion 冻结。

### Phase 5 Checklist
- [ ] 子集 shader Android(AGSL)+iOS(Metal) 真机视觉一致 + 跟封面变色 + calm。
- [ ] 设备分级：低端走回退，不烫不卡（prod 复测）。

### Phase 6: Now Playing + 歌词 + 封面
**Goal:** 同步歌词三动效 + 封面 + 取色 glide 串成沉浸 Now Playing（各端原生 UI）。
**Tasks:**
- [ ] 同步歌词：共享解析/动效参数（`lyric-motion.ts` classic/inertial/cascade，commonMain）+ 各端原生绘制（Android Compose `LazyColumn`+`Animatable` / iOS SwiftUI `ScrollViewReader`+spring）+ beat-exact 高亮。
- [ ] 封面加载（Android Coil 3 / iOS AsyncImage·Kingfisher）；media-stage video→cover→title 回退（移植 `resolveStageContent`，commonMain）。
- [ ] Now Playing 三层叠加（背景图/视频 → 流光 → 频谱），各端原生组合。

### Phase 6 Checklist
- [ ] 三动效模式手感可接受（各端原生滚动手感，记录与 web 差异）。
- [ ] 歌词/封面/流光串起的 Now Playing 双端验收。

### Phase 7: 打磨 / 分级 / i18n / 复测
**Goal:** 上线前收口。
**Tasks:**
- [ ] i18n 四语（en/zh/ja/ko）：moko-resources（双端共享串）或各端原生（Android strings.xml / iOS `.strings`），en 为类型源。
- [ ] 设备能力分级（GPU/内存）→ 特效降级矩阵；安全区 inset / 触摸 ≥44px。
- [ ] 转场/共享元素打磨；性能 prod 复测（帧节奏/长任务/内存第二轮）。
- [ ] **性能 CI 门禁（§5.10 Layer 3）**：Android Macrobenchmark（`FrameTimingMetric` `frameOverrunMs` + `TraceSectionMetric` 预算）+ iOS XCTest baseline；同场景（switch/pingpong/counted）、同预算口径（含 120Hz/60Hz 区分 + 多跑中位）；超预算 fail build。
- [ ] v1 裁剪复核（§7）；CLAUDE.md / 本 PRD 状态更新。

### Phase 7 Checklist
- [ ] 四语全量、无硬编码用户可见串。
- [ ] 低端机达标；崩溃/内存/掉电基线达标。

---

## 7. Out of Scope（mobile v1 明确不做 / 简化）

- **Pixi 滤镜全家桶**（CRT/ASCII/pixel/cross-hatch/dot/noise 背景）—— v2 按需逐个原生重写（Metal/AGSL）。
- **全部 14 个 flow shader** —— v1 只 curate 4–6 个；其余 v2。
- **exotic 混合模式**（overlay/soft-light/plus-lighter 全集）—— v1 仅 screen/normal。
- **Lenis 式自定义动量滚动** —— 用原生动量，不移植。
- **View Transitions API 级别的全屏共享元素** —— 用 Compose 简化转场。
- **跨端数据迁移 / 同步**（桌面↔移动）—— 复用已有云盘 PRD，独立后续 phase。
- **桌面专属能力**（OBS 歌词 overlay、系统托盘、全局快捷键、live 弹幕 socket intake、本地文件夹整目录索引、YouTube n-throttle）—— 移动不适用。
- **WebView 过渡包** —— 若 PM 要「最快出个能用的」，可另起独立路线，不在本 PRD。

---

## 8. Security Considerations

- **BYOK 密钥**：存 **iOS Keychain / Android Keystore（或 EncryptedSharedPreferences）**，不进普通 DB 明文、不进 bundle/日志/遥测（对齐 CLAUDE.md 规则 2）。密钥从安全区直达 provider。
- **本地优先 / 无后端**：移动端依然零 MUZERO 服务端、零遥测上报；唯一出站 = 用户配置的 BYOK LLM/musicgen。
- **native 无 CORS**：直连第三方 API，删 muzfetch 代理这层（减少攻击面）。
- **不引入 hidden flag**：runtime toggle 一律可见 Settings 控件；回退 = `git revert` + 重发版（规则 3）。
- **文件访问**：移动 scoped storage / 沙盒；导入走系统 picker，不要全盘读权限。
- **Telemetry whitelist**（若未来加）：沿用桌面口径——绝不上报色值/LUT/歌词文本/源文件名/prompt。

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [`prd-create.md`](../../../../.cursor/commands/prd-create.md) | PRD 工作流 + §3 effect/shader、§4 性能附加要求 |
| [`20260611-muzero-immersive-flow-background-prd`](../../20260611-muzero-immersive-flow-background-prd/20260611-muzero-immersive-flow-background-prd.md) | 流光背景（14 shader / 取色 / 合成）—— 移动端要复现的源 |
| [`20260607-muzero-music-reactive-visualizer-prd`](../../20260607-muzero-music-reactive-visualizer-prd/20260607-muzero-music-reactive-visualizer-prd.md) | 频谱可视化 registry —— 移动端 2D 频谱源 |
| [`20260613-muzero-amll-style-lyrics-engine-prd`](../../20260613-muzero-amll-style-lyrics-engine-prd/20260613-muzero-amll-style-lyrics-engine-prd.md) | AMLL 同步歌词引擎 —— 移动端歌词源 |
| [`20260606-muzero-ai-dj-foundation-prd`](../../20260606-muzero-ai-dj-foundation-prd/20260606-muzero-ai-dj-foundation-prd.md) | DJ 续歌地基 —— 移动端 DJ 循环源 |
| `docs/prd/desktop/` | 桌面端新 PRD（分层约定见 [`desktop/README.md`](../../desktop/README.md)） |

**调研来源（deep research 2026-06，已对抗式核验）：** 见下方脚注引用。

---

## 10. Open Questions（research 未核验 / 待 spike）

> deep research 对**架构/着色器机制/iOS-FFT/LLM/图片**给出了被核验的结论；以下子问题**无被核验的一手结论**或被证伪，列为 open，**不当作已答**。

| # | Question | Status | 处理 |
|---|----------|--------|------|
| 1 | **数据层**：SQLDelight vs Room-KMP？大 blob 进 DB 还是 FS？响应式 Flow 替代 useLiveQuery？ | Open（**OSS 反转**：最相关的 SimpMusic 选了 **Room-KMP**，非 SQLDelight） | §3.1 已改为「不预设」，Phase 0/1 spike 各搭 demo（含迁移）后定 + FS 存大字节 |
| 2 | **Android FFT**：Media3 AudioProcessor PCM tap 在 60fps 下可靠？延迟/权限坑？ | 机制已佐证（Media3 `TeeAudioProcessor` + dzolnai/ExoVisualizer），**60fps 可靠性待验** | Phase 0 spike |
| 3 | **2D 频谱 60fps parity**：各端原生 Canvas（Compose/SwiftUI）复杂路径+阴影的移动性能？ | Open（D 未核验） | Phase 4 补帧指标复测 |
| 4 | **取色**：纯 Kotlin 量化器 vs AndroidX Palette 的实际效果？ | Open（E 未核验） | §5.6 推荐纯量化器，Phase 5/6 验 |
| 5 | **歌词三动效 parity**：classic/inertial/cascade（共享参数）在两套**原生 UI**（SwiftUI/Compose）上手感一致？ | Open（绘制各端） | §5.7 逐端调参（native 反而拿到真原生滚动手感，消掉 A 的 CMP scroll-parity 隐患） |
| 6 | **合成/滤镜**：CSS mix-blend-mode + Pixi 滤镜经 **iOS Metal/SwiftUI `.blendMode` + Android Compose `BlendMode`/`RenderEffect`** 的复刻度？ | Open（C 未核验） | §5.4/5.5 v1 基础模式，滤镜 v2 |
| 7 | **WebView 备选**：Capacitor / Tauri 2 mobile 套现有 React 作更快 v1 是否可行？vs KMP-native 的实测差距？ | Open（A-c 未核验） | §1.3② 暂不作终态；如要过渡包另起 PRD |
| 8 | **14 shader 全量移植工作量**：fbm/noise/voronoi/metaball + 数组 uniform 的实际成本（**research 标为单一最大风险，未基准测**） | Open | Phase 0 移 1 个标定，curate 子集铺开 |
| 9 | **契约单一真源**：`TrackBrief` 跨 TS(Zod)/Kotlin(kotlinx.serialization) 两份，是否抽 JSON schema codegen 避免漂移？ | Open | Phase 3 评估 |
| 10 | **工程仓库形态**：KMP 工程独立仓 vs 与现有 web 同仓子目录？ | Open | Phase 0 定；模块结构参考 **JetBrains 2026-05 默认 sharedLogic+原生 UI** [^kmpdefault] 与 **PeopleInSpace 的 SwiftUI 变体**（music-assistant 是 CMP 共享 UI，仅借其库选/iOS 出包，不抄共享 UI） |
| 11 | **iOS 播放节点 tap FFT**：所有 OSS（tempi-fft/tomer8007/woheller69）都 tap **麦克风**，**无「播放输出 tap」先例** | Open（OSS gap） | Phase 0 iOS FFT spike 重点：可能需把播放路由经 **AVAudioEngine**（而非纯 AVPlayer）才能在 mixer 节点 `installTap` |
| 12 | **LLM 结构化输出的 KMP 先例**：未找到任何用 Koog / Kotlin LLM SDK 做结构化输出的真实 KMP App | Open（**我们是早期采用者**） | Phase 3 留预研冗余 + 备选（xemantic/tddworks）；mock brain 先行 |
| 13 | **i18n**：moko-resources（共享串）vs 各端原生（strings.xml/.strings）？ | Open | Phase 7 定 |
| 14 | **Ktor server 跑 iOS native？**（控制端点放 sharedLogic 的前提，§5.10） | Open（待 spike） | Phase 0 验；否则 expect/actual（iOS `Network.framework` `NWListener` / XCUITest deeplink；Android `adb am broadcast`） |
| 15 | **iOS 帧源**：`CADisplayLink` hitch 检测精度 + 与 Android Choreographer 帧节奏口径对齐（B 下 iOS 走 SwiftUI/`CADisplayLink`，非 `withFrameNanos`） | Open | Phase 0 校准 |
| 16 | **shader 两份维护（Option B 代价）**：AGSL(Android)+Metal(iOS) 两份源的视觉一致性 + 维护成本 + AI 对 Metal/AGSL 熟练度 | Open | Phase 0 单 shader 双端截图比对标定；curate 子集控规模 |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-16 | DoodleBear / MUZERO | 初稿：基于仓库三路 Explore 清单 + deep research（KMP/CMP/SkSL/FFT/Koog/Coil 核验）整合；选 KMP+CMP 共享 UI、SkSL 一次写双端、SQLDelight+FS、Koog/anthropic-kotlin DJ brain；逐特性可行性 + 分阶段 + v1 裁剪 + open questions |
| 2026-06-16 | DoodleBear / MUZERO | 加 §2.6「参考开源项目」（第二次 research：OSS package 选型佐证）：SimpMusic/music-assistant/Kicks/mediamp/Shader-Animation-CMP/KMPLiquidGlass/Gramophone/AMLL 等 repo 表 + 逐项 verdict + license 红线；据此**重审 DB（SimpMusic 用 Room-KMP→改为不预设，Phase 0 spike 定）**、补 coil-network-ktor3、新增 open Q（iOS 播放节点 tap FFT 无先例 / LLM 结构化早期采用者 / i18n）；模块结构以 music-assistant 为活体模板 |
| 2026-06-16 | DoodleBear / MUZERO | 加 §5.10「性能/自动化测试 Harness（验收方法学）」：镜像桌面 Electron CDP+控制端点；三层（控制端点 Ktor commonMain + 仪表 FrameMonitor/trace section + 各平台深度 profiling）；**无 KMP 版 CDP**→Android Macrobenchmark/Perfetto/JankStats + iOS XCTest/Instruments/MetricKit，同场景同预算；现有 `perf-drive.mjs` 脚本可复用；Phase 0/7 接线 + open Q14/15 |
| 2026-06-16 | DoodleBear / MUZERO | **架构改定 Option B**（第三次 research：KMP vs 全原生 + AI 编程效率，比选 A/B/C）：由「A=CMP 共享 UI」改为「**B=共享 Kotlin 核心 + 原生 UI（SwiftUI+Compose）**」——JetBrains 2026-05 机构化默认 [^kmpdefault]；A 对我们收益被稀释（硬骨头本就平台专属）+ 非原生感 [^cmfeel]；C 重复核心逻辑有漂移风险、AI 不能消除（「AI 抹平跨端」被证伪 [^aimyth]）；AI 推「原生 UI」+「单源核心」→ 收敛 B。全文 §1.5/§2.1–2.6/§5/§6/§10 改写：UI=各端原生、shader=AGSL+Metal（弃「一份 SkSL」）、加 **SKIE** interop [^skie]、harness 帧源各端、新增 open Q16（shader 两份维护）。**代价=失去「一份 shader 两端」**；**收益=真原生手感 + AI 最熟的 UI 栈 + 关键逻辑单源** |

---

### 脚注（research 来源）

[^cm18]: Compose Multiplatform 1.8.0 — Compose for iOS is Stable and production-ready（JetBrains, 2025-05）. https://blog.jetbrains.com/kotlin/2025/05/compose-multiplatform-1-8-0-released-compose-multiplatform-for-ios-is-stable-and-production-ready/ ——同时记录独立来源对 iOS CPU/内存、无 Cupertino 组件、滚动物理 parity（证伪 0-3）的反向证据。
[^cm111]: What's new in Compose Multiplatform 1.11.0（kotlinlang.org）——concurrent rendering 默认开启；non-Android `Shader` 改 Compose 包装类（`SkShader.asComposeShader()` / `Shader.skiaShader`）. https://kotlinlang.org/docs/multiplatform/whats-new-compose-111.html
[^cm111blog]: Compose Multiplatform 1.11.0（JetBrains blog, 2026-05）. https://blog.jetbrains.com/kotlin/2026/05/compose-multiplatform-1-11-0/
[^expectactual]: Expected and actual declarations（kotlinlang.org）——优先普通语言构造 + 接口隔离平台代码，expect/actual 仅用于 DI 配置. https://kotlinlang.org/docs/multiplatform/multiplatform-expect-actual.html
[^koin1]: Koin Annotations for KMP（insert-koin.io）. https://insert-koin.io/docs/reference/koin-annotations/kmp/
[^koin2]: Koin — from KSP to Compiler Plugin（insert-koin.io）. https://insert-koin.io/docs/migration/from-ksp-to-compiler-plugin/
[^sksl]: SkSL — Skia's shading language（skia.org）——「syntax very similar to GLSL」；`SkRuntimeEffect` 产出 `SkShader`/`SkColorFilter`/`SkBlender`. https://skia.org/docs/user/sksl/
[^skiareadme]: Skia SkSL README——GLSL→SkSL 移植差异（`sample()`、无 precision、`float2/bool4`、非归一化坐标 (0,0) 左上）. https://github.com/google/skia/blob/main/src/sksl/README.md
[^tempi]: jscalo/tempi-fft——Swift/iOS 实时 FFT（Accelerate `vDSP_fft_zrip`）+ `calculateLogarithmicBands`（八度分带）. https://github.com/jscalo/tempi-fft
[^keijiro]: keijiro/AudioSpectrum——低延迟音频输入 + vDSP FFT 频谱分析. https://github.com/keijiro/AudioSpectrum
[^vdsp]: Apple Accelerate / vDSP FFT 文档. https://developer.apple.com/documentation/accelerate/vdsp/fft
[^kmmplayer]: Building a cross-platform media player with KMM, Compose, Media3 and AVPlayer（Medium）. https://medium.com/@venakhaya_80297/building-a-cross-platform-media-player-with-kmm-jetpack-compose-media3-and-avplayer-featuring-a-3032629fd488
[^koog]: Koog 1.0 is out（JetBrains AI blog, 2026-05）——稳定核心 + KMP observability；Anthropic/OpenAI 等 provider. https://blog.jetbrains.com/ai/2026/05/koog-1-0-is-out-stable-core-better-interop-and-multiplatform-observability/
[^koogrepo]: JetBrains/koog（GitHub）——JVM/JS/WasmJS/Android/iOS targets. https://github.com/JetBrains/koog
[^kotlinai]: Kotlin AI apps development overview（kotlinlang.org）——官方 Anthropic/OpenAI 仅 Java SDK（JVM/Android，非全 KMP）. https://kotlinlang.org/docs/kotlin-ai-apps-development-overview.html
[^xemantic]: xemantic/anthropic-sdk-kotlin（GitHub）——KMP（含 iOS 产物）；tool JSON schema 从 `@Serializable` 自动抽取；pre-1.0 API churn 警告. https://github.com/xemantic/anthropic-sdk-kotlin
[^tdd]: tddworks/openai-kotlin（GitHub）——KMP（JVM/iOS 14+/macOS）多 provider. https://github.com/tddworks/openai-kotlin
[^coil]: coil-kt/coil（GitHub）——Android + Compose Multiplatform 图片加载. https://github.com/coil-kt/coil
[^coilpost]: Coil 3 release（colinwhite.me）——3.0.0（2024-11）支持 Android/iOS/JVM/JS/WASM 同一 API. https://colinwhite.me/post/coil_3_release

#### 脚注（OSS 参考来源，第二次 research 2026-06）

[^simp]: maxrave-dev/SimpMusic —— CMP 音乐 App（9.5k★，GPL-3.0，CMP 1.11.1/Kotlin 2.4.0；Koin 4.2.1/Ktor 3.5.0/Coil 3 3.4.0/Media3 1.10.1/**Room-KMP 2.8.4**/kotlinx.serialization 1.11.0；Android+Desktop，无 iOS）. https://github.com/maxrave-dev/SimpMusic
[^ma]: music-assistant/mobile-app —— 官方跨端音乐客户端（382★，Apache-2.0，**iOS 1.0 2026-06-12**；CMP 1.11.0/Ktor 3.5.0/Koin 4.2.1/Coil 3.5.0 + coil-network-ktor3；commonMain/androidMain/iosMain/nativeMain）. https://github.com/music-assistant/mobile-app
[^kicks]: ayodelekehinde/Kicks —— KMM+CMP 播放器 demo（expect/actual `AudioPlayer` = ExoPlayer/AVPlayer；2023 停更，无 MediaSession/FFT）. https://github.com/ayodelekehinde/Kicks
[^mediamp]: open-ani/mediamp —— KMP 媒体播放器抽象（ExoPlayer/AVKit/VLC/HTMLVideo，Apache-2.0；VLC 模块 GPLv3；pre-1.0，偏视频）. https://github.com/open-ani/mediamp
[^media3]: androidx/media —— Media3 官方；`AudioProcessor`/`TeeAudioProcessor`→`AudioBufferSink.handleBuffer(ByteBuffer)` PCM tap. https://github.com/androidx/media
[^exoviz]: dzolnai/ExoVisualizer —— 基于 ExoPlayer `AudioProcessor` 的频谱可视化. https://github.com/dzolnai/ExoVisualizer
[^tempi2]: jscalo/tempi-fft —— iOS 实时 FFT（Accelerate `vDSP_fft_zrip` + 5 bands/octave 对数分带，CC0；麦克风采集）. https://github.com/jscalo/tempi-fft
[^tomer]: tomer8007/real-time-audio-fft —— iOS vDSP/Accelerate FFT（MIT；麦克风采集，2017 停更）. https://github.com/tomer8007/real-time-audio-fft
[^noise]: paramsen/noise —— **仅 Android** JNI kissfft FFT（喂不了 iOS → 印证双路 FFT）. https://github.com/paramsen/noise
[^shadercmp]: Coding-Meet/Shader-Animation-CMP —— **一份 shader 字符串 commonMain** + expect/actual runner（Android13+ AGSL `RuntimeShader`；iOS/Desktop/Web Skia `RuntimeShaderBuilder`/SkSL；**无 license**，仅学模式）. https://github.com/Coding-Meet/Shader-Animation-CMP
[^liquid]: Kashif-E/KMPLiquidGlass —— CMP 全端 shader（Skia `RuntimeEffect`+`ImageFilter`；AGSL/SkSL 双文件经 expect/actual，Apache-2.0）. https://github.com/Kashif-E/KMPLiquidGlass
[^gramo]: FoedusProgramme/Gramophone —— 原生 Android 音乐播放器（Media3 + LRC/TTML/SRT 逐词/逐音节卡拉OK，GPL-3.0；仅 Android）. https://github.com/FoedusProgramme/Gramophone
[^amll]: amll-dev/applemusic-like-lyrics（AMLL）—— **web npm**（~87% TS + 框架无关 core + React/Vue；DOM/CSS + Pixi.js/WebGL 流体背景；`/lyric`=Rust→WASM；AGPL-3.0；**不可在 KMP 复用，仅行为参考**）. https://github.com/amll-dev/applemusic-like-lyrics
[^pis]: KMP 架构模板参考：joreilly/PeopleInSpace（含 SwiftUI 原生 UI 变体，正合 Option B）、joreilly/Confetti、Kotlin/KMP-App-Template（均 Apache-2.0）. https://github.com/joreilly/PeopleInSpace

#### 脚注（KMP vs 原生 + AI 效率 research，第三次 2026-06）

[^kmpdefault]: New KMP default project structure（JetBrains, 2026-05）——Compose-free `sharedLogic` + 可选 `sharedUI`；明示「可 iOS 用 SwiftUI、其它端用 CMP」. https://blog.jetbrains.com/kotlin/2026/05/new-kmp-default-structure/
[^kmpoverview]: Kotlin Multiplatform overview / use-cases（kotlinlang.org）——官方口径「share business logic while keeping the UI native」. https://kotlinlang.org/docs/multiplatform/kmp-overview.html
[^netflix]: Netflix Kotlin Multiplatform（Touchlab）——共享业务逻辑、原生 UI（~50% 生产代码与平台解耦）. https://touchlab.co/netflix-kotlin-multiplatform
[^cmfeel]: CMP iOS 默认 Material、无原生 Cupertino 组件；fidelity 敏感 App 建议用 SwiftUI 写 UI 层（Volpis 2026-05；kmpship）. https://volpis.com/blog/is-kotlin-multiplatform-production-ready/
[^skie]: SKIE（Touchlab，Apache-2.0）——Kotlin→Swift interop：Flow→Swift `AsyncSequence`、suspend→Swift `async`、sealed→穷举 switch、enum→原生 Swift enum. https://skie.touchlab.co/
[^composeai]: AI 助手即便对**主流** Jetpack Compose 不喂源码 grounding 也常出错（幻觉 API / 过时 Material 2 / 错误 `remember`）；由 Google 工程师对照工具 + Google I/O 2026 grounding CLI + arXiv LLM API 幻觉研究佐证（aldefy/compose-skill）. https://github.com/aldefy/compose-skill
[^aimyth]: 「AI 抹平跨端学习曲线 / 不再需要懂 iOS」一说本轮对抗式核验**证伪（0-3）**（Sivaraj Medium 2026 的该断言未通过）. https://medium.com/@sivaraaj/kotlin-multiplatform-in-2026-why-we-finally-deleted-our-flutter-code-6c3eb9ef6144

> **Note（模板纪律对齐）**：本 PRD 强调**复用已有设计 + 直译皇冠逻辑**，而非另起炉灶；每个第三方依赖都过了 license/维护度判定（§2.4）；特效**curate 不穷举**、**基础设施（P0 spike）先于覆盖广度**；回退路径 = `git revert`，不藏 runtime flag。research 已核验项标引用，未核验项标 ⚠️ 并入 §10 Open Questions，不混淆事实与推断。
