# PRD: MUZERO 移动端原生技术栈选型（总文档）

**Status:** Draft
**Created:** 2026-06-16
**Author:** DoodleBear / MUZERO
**Module:** Mobile 技术栈 —— 为 [全原生移动端移植 PRD](../20260616-muzero-native-mobile-port-prd/20260616-muzero-native-mobile-port-prd.md)（**Option C + spec guard**：两套全原生 App + 语言中立契约规格）落地**逐层具体库选型**。

> 本文为**总文档/索引**：放**跨端共性决策**（spec guard codegen、最低系统、共享 golden 向量工具）+ **iOS/Android 并排对照**，并引用两份独立平台文档：
> - 📄 [**iOS 技术栈**（Swift/SwiftUI）](ios-tech-stack.md)
> - 📄 [**Android 技术栈**（Kotlin/Jetpack Compose）](android-tech-stack.md)
>
> 来源：四轮 deep research（2026-06，对抗式核验），逐层标 **✅本轮核验** / **✅*前轮核验** / **⚠️团队判断/标准实践**，未核验项入 §5 Open Questions。版本/门禁快速演进——**锁版本前复核**。

---

## 1. 为什么是「全原生 + spec guard」（回链）

架构选型 A（KMP+CMP）→ B（KMP 共享逻辑+原生 UI）→ **C+spec guard** 的完整论证见主 PRD [§2.1](../20260616-muzero-native-mobile-port-prd/20260616-muzero-native-mobile-port-prd.md#21-选型决策a--b--c-比选四轮-research-为什么-soloai-落在-c)。一句话：solo+重度 AI 下，KMP 的工具链/interop/构建/学习税不值为共享 ~1,500 LOC，AI 在主流原生更熟更少错；唯一要防的「逻辑漂移」用本文 §3 的 spec guard 解决。本文只管「**既然全原生，每层用什么库**」。

---

## 2. 并排对照（按特性）

| 层 | iOS（Swift/SwiftUI） | Android（Kotlin/Compose） | 置信 |
|---|---|---|---|
| UI | SwiftUI（+UIKit interop 边角） | Jetpack Compose + Material 3 | ⚠️ |
| 状态 | Observation `@Observable`(iOS17+) | ViewModel + StateFlow | ⚠️ |
| 音频播放 | AVAudioEngine + AVAudioPlayerNode | Media3 ExoPlayer | ✅* |
| 后台/锁屏 | AVAudioSession + MPNowPlayingInfoCenter/MPRemoteCommandCenter | Media3 MediaSession + MediaSessionService | iOS⚠️ / And✅ |
| 音频 FFT | AVAudioEngine `installTap` + vDSP | Media3 `AudioProcessor` PCM tap + JTransforms/noise | iOS✅* / And✅*(机制) |
| 分带数学 | Swift `Core`（+golden 向量） | Kotlin `Core`（+golden 向量） | ✅(八度机制) |
| 流光 shader | SwiftUI `.colorEffect`(Metal)，不行→MTKView | AGSL `RuntimeShader`(API33+)，<33 回退渐变 | ✅(机制)/⚠️(iOS 路径待验) |
| 2D 频谱 | SwiftUI `Canvas`+`TimelineView` | Compose `Canvas`(DrawScope) | ⚠️ |
| 本地 DB | **GRDB.swift**（ValueObservation） | **Room**（Flow） | ✅ |
| 网络 | URLSession（无 CORS） | OkHttp（无 CORS） | ⚠️ |
| 图片 | Nuke | Coil 3 | ✅ |
| DI | 手动/Factory | Hilt（或 Koin） | ⚠️ |
| LLM brain | MacPaw/OpenAI + SwiftAnthropic | 官方 openai-java + anthropic-java | ✅ |
| 结构化输出 | Codable + tool-use JSON schema | @Serializable + class→JSON schema | ✅(机制) |
| 测试/性能 | Swift Testing + XCTest + Instruments/xctrace | JUnit + Macrobenchmark + JankStats + Perfetto | ⚠️* |
| i18n | String Catalogs | strings.xml | ⚠️ |

> 详表（版本/License/备选/何时切换/理由）见各平台文档。

---

## 3. 跨端共性决策

### 3.1 Spec guard：契约 + 关键逻辑单源（不共享代码）
C 不共享代码 → 用「规格」防漂移：

- **契约 codegen（单一真源）**：`shared-spec/track-brief.schema.json`（JSON Schema）→ **quicktype** 一把生成 **Swift `Codable`** + **Kotlin `@Serializable`**（quicktype 双语都支持）✅[^quicktype]。改 `TrackBrief` 字段 = 改 schema → 双语类型自动对齐 + 桌面 Zod 三处仍各自校验。备选：iOS quicktype / Android `json-kotlin-schema-codegen`（若想各端独立工具）。
- **golden 测试向量（关键逻辑同守）**：`shared-spec/golden/*.json`（同一份「输入→期望输出」，从桌面 `*.test.ts` 导出），iOS 用 **Swift Testing** 加载断言、Android 用 **JUnit** 加载断言。覆盖 queue（next/prev/shuffle/refill）、dj（brief 应用、`shouldAutoExtend`）、bands（分带）、palette（取色）、cloud-job（轮询迁移）、track-display（回退）。
- **CI**：两端各跑 golden 向量 + codegen 一致性检查；任一端实现偏离即 fail——这层就是 KMP「单一真源」的轻量替代。
- ⚠️ **决定性未知**（主 PRD §10 Q1）：AI 能否长期把两份实现保持同步——golden 向量是主要防线，需持续度量漂移。

### 3.2 最低系统版本（reach vs 现代 API）
- **iOS 17**：拿 Observation `@Observable` + SwiftUI Metal shader 修饰符（流光走 SwiftUI Shader 路线的前提）。⚠️
- **Android**：**targetSdk 35**（Play 门禁 2025-08-31 已生效）✅[^playsdk]；**minSdk 26**（覆盖广）；**AGSL 运行时 gate 到 API 33+**，<33 走静态渐变回退（不是 minSdk 卡 33）。⚠️ minSdk 为团队判断。

### 3.3 BYOK LLM（双端都要结构化输出）
- iOS：MacPaw/OpenAI（原生 Structured Outputs）+ SwiftAnthropic（用 tool-use input_schema 强制 JSON；Anthropic API 已 GA `output_format`，想用传 raw/更新 SDK）✅[^macpaw][^swiftanthropic]。
- Android：官方 **openai-java**（class→JSON schema 自动派生）+ **anthropic-java**，均 JVM 可跑 Android（Java 8+ desugaring）✅[^openaijava][^anthropicjava]。**这是全原生的红利**——Android 独立后不再受「必须全 KMP 喂 iOS」约束，可用官方 Java SDK。
- 密钥存 Keychain(iOS)/Keystore(Android)，不落日志（主 PRD §8）。

### 3.4 性能 / 自动化 harness（镜像桌面 Electron CDP+控制端点）
详见主 PRD §5.10。要点：无「原生版 CDP」；**控制端点各端原生**（iOS Network.framework/Swift-NIO、Android NanoHTTPD/Ktor）但**桌面 `perf-drive.mjs` 场景脚本复用**（HTTP/JSON 契约）；深度 profiling 各端原生（iOS Instruments+`xctrace`+XCTest baseline / Android Macrobenchmark+Perfetto+JankStats+Baseline Profiles）；同场景同预算（注意 120Hz/60Hz、热降频多跑取中位）。

### 3.5 2025-2026 标准但易漏的几项
- **Baseline Profiles**（Android 启动/滚动提速，几乎必配）。
- **Swift Testing**（Xcode 16+ 新单测框架，比 XCTest 现代）。
- **本地优先 → 默认不接 Crashlytics/Sentry 遥测**（与 CLAUDE.md 无遥测一致；若要崩溃收集需明确开关且不上报内容）。
- App Clips / 小组件 / Wear / CarPlay：**v1 out of scope**。

---

## 4. License 总览（无 GPL/AGPL 风险）

全栈推荐项均 **MIT / Apache-2.0 / BSD / 系统框架**：GRDB·Nuke·MacPaw/OpenAI·SwiftAnthropic·anthropic-java(MIT)；Compose·Media3·Room·Coil·OkHttp·Hilt·kotlinx·openai-java·quicktype(Apache-2.0)；JTransforms(BSD)。pre-1.0（MacPaw/OpenAI、SwiftAnthropic）在 PR 锁版本。参考过的 GPL/AGPL/无 license OSS（Gramophone/SimpMusic/AMLL/Shader-Animation-CMP）**仅学模式不抄码**（主 PRD §2.6）。

---

## 5. Open Questions（合并两端 spike，回流主 PRD §10）

| # | Question | 端 | 处理 |
|---|----------|---|------|
| 1 | SwiftUI `.colorEffect` 能否承载 14 个 fbm/noise flow shader（floatArray 多色+time+audio），还是需 MTKView？ | iOS | Phase 0 shader spike |
| 2 | AVAudioEngine 播放-tap FFT（vs AVPlayer+MTAudioProcessingTap）真机路径？ | iOS | Phase 0 FFT spike |
| 3 | Media3 `AudioProcessor` PCM tap 60fps 延迟/稳定性 + FFT 库（JTransforms vs noise）？ | And | Phase 0 FFT spike |
| 4 | AGSL <33 回退在低端机体验？ | And | Phase 5 |
| 5 | `Canvas`(SwiftUI/Compose) 频谱 60fps 复杂路径+阴影性能？ | 双 | Phase 4 帧指标 |
| 6 | iOS DB：GRDB vs SQLiteData 人体工学？ | iOS | Phase 0 demo |
| 7 | DI：Hilt vs Koin（solo 取舍）？ | And | Phase 0 |
| 8 | quicktype 双语 codegen + golden 向量在 Swift Testing/JUnit 的加载断言写法？ | 双 | Phase 0 spec guard |
| 9 | 决定性未知：AI 能否长期保持两份实现同步？ | 双 | golden 向量持续度量（主 PRD §10 Q1） |

---

## 6. Related Documents

| Document | Description |
|---|---|
| [iOS 技术栈](ios-tech-stack.md) | iOS 独立栈（实现 iOS 只读这篇） |
| [Android 技术栈](android-tech-stack.md) | Android 独立栈（实现 Android 只读这篇） |
| [全原生移动端移植 PRD](../20260616-muzero-native-mobile-port-prd/20260616-muzero-native-mobile-port-prd.md) | 架构决策 / 逐特性可行性 / 分阶段 / harness |
| [`prd-create.md`](../../../../.cursor/commands/prd-create.md) | PRD 工作流 + §3/§4 附加要求 |

---

## 7. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-16 | DoodleBear / MUZERO | 初稿：第四轮 deep research（per-platform native 栈）。总文档 + iOS/Android 两份独立栈文档；逐层推荐+备选+License+置信；跨端 spec guard（quicktype codegen + golden 向量）、最低系统、性能 harness、License 总览、Open Questions。✅核验：GRDB/SQLiteData/Nuke/MacPaw-OpenAI/SwiftAnthropic/Room2.8.4/Media3 MediaSession/AGSL33+/Coil3.5/anthropic-java/openai-java/Play 门禁/quicktype；其余前轮核验或团队判断标注入 Open Q |

---

### 脚注
[^quicktype]: quicktype（JSON Schema → Swift Codable + Kotlin @Serializable，单源双语）. https://github.com/glideapps/quicktype
[^playsdk]: Google Play target-SDK 门禁（API 35，2025-08-31 起）. https://developer.android.com/google/play/requirements/target-sdk
[^macpaw]: MacPaw/OpenAI（社区 Swift OpenAI SDK，MIT，Structured Outputs）. https://github.com/MacPaw/OpenAI
[^swiftanthropic]: SwiftAnthropic（社区 Claude SDK，MIT）. https://github.com/jamesrochabrun/SwiftAnthropic
[^openaijava]: 官方 openai-java（Apache-2.0，class→JSON schema）. https://github.com/openai/openai-java
[^anthropicjava]: 官方 anthropic-java（MIT，JVM/Android）. https://github.com/anthropics/anthropic-sdk-java
