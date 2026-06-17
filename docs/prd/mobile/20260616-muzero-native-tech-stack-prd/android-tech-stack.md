# MUZERO Android 原生技术栈选型（Kotlin / Jetpack Compose）

**Status:** Draft · **Created:** 2026-06-16 · **Author:** DoodleBear / MUZERO
**Parent:** [native-tech-stack 总文档](20260616-muzero-native-tech-stack-prd.md) · **属于:** [全原生移动端移植 PRD](../20260616-muzero-native-mobile-port-prd/20260616-muzero-native-mobile-port-prd.md)（Option C + spec guard）

> 本文档是 **Android 端独立技术栈参考**（实现 Android 时只读本篇即可）。逐层给**推荐选型 + 版本/License + 备选 + 何时切换 + 理由**。置信标注：**✅本轮 research 核验**（引用）/ **✅*前轮核验** / **⚠️团队判断/标准实践**（入总文档 Open Q）。

## 0. 基线

- **语言/UI**：Kotlin + **Jetpack Compose + Material 3**。
- **SDK**：**targetSdk 35**（Google Play 门禁：2025-08-31 起新 app/更新须 target API 35）✅核验 [^playsdk]；**minSdk 26**（覆盖 ~95%+；**AGSL 运行时 gate 到 API 33+**，<33 走回退，§2.2）。⚠️ minSdk 团队判断。
- **构建**：Gradle + AGP；KSP（非 KAPT，KAPT 已维护模式）。
- **并发**：Coroutines + Flow。

## 1. 逐层选型表

| 层 | 推荐 | 版本/License | 备选（何时切换） | 理由 / 置信 |
|---|---|---|---|---|
| **UI** | **Jetpack Compose + Material 3** | BOM 2026.x，Apache-2.0 | View/XML（仅遗留 interop） | 主流、AI 最熟。⚠️ |
| **状态** | **ViewModel + StateFlow + `collectAsStateWithLifecycle`** | androidx.lifecycle，Apache-2.0 | — | 官方默认；生命周期安全。⚠️ |
| **音频播放** | **Media3 ExoPlayer** | 1.9.x，Apache-2.0 | — | 官方现代播放器。✅*（前轮 + 本轮 MediaSession） |
| **后台 + 锁屏 + Now Playing** | **Media3 `MediaSession` + `MediaSessionService`**（自动 MediaStyle 通知/锁屏） | 1.9.x，Apache-2.0 | — | 实现 MediaSession 自动同步 PlaybackState；MediaSessionService 自动发并维护通知。**旧 `MediaSessionCompat` 明确不推荐**。✅核验 [^media3surfaces][^media3legacy] |
| **音频 FFT** | **Media3 自定义 `AudioProcessor`（PCM tap）+ FFT 库** | — | — | 插进 ExoPlayer 音频链取 PCM 自做 FFT；**避开已弃用 `Visualizer` API**。✅*机制前轮核验 [^exoviz]；⚠️ 60fps 可靠性/延迟 Phase 0 spike |
| └ FFT 库 | **JTransforms**（纯 Java，无 NDK）或 **paramsen/noise**（JNI kissfft，更快） | JTransforms BSD / noise（Android-only JNI） | KissFFT 直接 NDK | 纯逻辑分带在 Kotlin `Core`（golden 守护）。⚠️ 库选型 Phase 0 定 |
| **流光着色器** | **AGSL `RuntimeShader`（API 33+）** + `RenderEffect` 合成 | 系统(API 33+)，Apache-2.0 | — | AGSL≈GLSL ES 1.0（Y 轴反转、`half4 main(vec2 fragCoord)`、无 `#define`、`layout(color)` uniform）→ fbm/noise/voronoi 小改即移。✅核验 [^agsl][^agslvsglsl] |
| └ **<33 回退** | **静态多色渐变**（Compose `Brush`）或预渲染动画 | — | 低成本动画 | AGSL 仅 33+，必须有 <33 回退路径。✅(gate 已核验) |
| **2D 频谱** | **Compose `Canvas`(DrawScope)** + `withFrameNanos`/`Choreographer` 驱动 | Apache-2.0 | AndroidView + 自定义 View/RenderNode（最吃力样式） | 渐变/路径/阴影齐全。⚠️ 60fps 复杂路径待验 |
| **本地 DB** | **Room**（KSP，`Flow` 响应式） | **2.8.4**(2025-11)，Apache-2.0 | SQLDelight-Android | KSP 默认开启；`InvalidationTracker.createFlow()`/`room-ktx` Flow = `useLiveQuery` 对位；迁移成熟、最主流 AI 最熟。✅核验 [^room][^roomksp] |
| **网络（BYOK HTTP）** | **OkHttp**（+ Retrofit 若端点多）+ kotlinx.serialization | OkHttp Apache-2.0 | Ktor client | native **无 CORS**（删 muzfetch）；最主流。⚠️ |
| **图片加载** | **Coil 3**（`AsyncImage`）+ coil-network-okhttp/ktor3 | **3.5.0**，Apache-2.0 | — | 一等 Compose 支持。✅核验 [^coil] |
| **DI** | **Hilt**（编译期，Google 官方） | Apache-2.0 | Koin（运行期，更简，solo 想最省时） | 编译期 DI 避免运行期开销/启动失败。⚠️ [^di] |
| **LLM 客户端（BYOK）** | **官方 `anthropic-java` + `openai-java`**（JVM，Android 可用） | anthropic-java v2.4x MIT；openai-java v4.4x Apache-2.0 | Koog（KMP/JVM agent 框架）；社区 Kotlin SDK | **Android 独立后官方 Java SDK 可直接用**（Java 8+ desugaring）；结构化输出从 class 自动派生 JSON schema。✅核验 [^anthropicjava][^openaijava][^koog] |
| **结构化输出** | kotlinx.serialization `@Serializable` + tool-use / class→JSON schema | Apache-2.0 | — | 等价 `generateObject`+Zod。✅(机制) |
| **契约 codegen** | **quicktype**（JSON Schema → Kotlin `@Serializable`） | Apache-2.0 | json-kotlin-schema-codegen | 与 iOS 同一 JSON Schema 单源（总文 spec guard）。✅(工具存在) [^quicktype] |
| **测试 + 性能** | JUnit + Compose UI test；**Macrobenchmark**(`FrameTimingMetric`/`TraceSectionMetric`) + **JankStats** + **Perfetto** + **Baseline Profiles** + **Gradle Managed Devices** | androidx，Apache-2.0 | — | golden 向量跑 JUnit；Macrobenchmark `frameOverrunMs` 做不掉帧门禁。⚠️*（perf harness 前轮覆盖） |
| **i18n** | **`strings.xml`** + plurals | 系统 | moko-resources（如要与桌面共享串） | en 为源，对齐桌面 i18n key。⚠️ |

## 2. 关键子系统说明

### 2.1 音频 + FFT
- Media3 ExoPlayer 播放；自定义 **`AudioProcessor`** 插入音频处理链，`queueInput(ByteBuffer)` 拿 PCM → FFT（JTransforms/noise）→ 移植 `bands.ts` 八度分带（golden 守护）。可参考 `TeeAudioProcessor` 的 passthrough+tap 模式。
- 后台：`MediaSessionService` 托管 session + 自动 MediaStyle 通知（锁屏/蓝牙/Wear 控制）。
- ⚠️ **Phase 0 spike**：AudioProcessor tap 在 60fps 下的延迟/稳定性/线程（音频线程→UI 投递）。

### 2.2 流光着色器：AGSL + 回退
- **API 33+**：`RuntimeShader(agslSource)` → `RenderEffect.createRuntimeShaderEffect(...)` 挂到 Compose `graphicsLayer { renderEffect = ... }`；uniform 经 `setFloatUniform`/`setColorUniform`（多色逐个 set 或打包 float 数组）+ 逐帧 `uTime`/`uAudio`。
- **API <33 回退**：静态多色 `Brush.linearGradient`/`radialGradient`（不黑屏），或预渲染循环帧。
- GLSL→AGSL 移植差异：Y 轴反转、`half4 main(in vec2 fragCoord)` 签名、无 `#define`、`layout(color) uniform half4`、AGSL 固定在 GLSL ES 1.0 特性集。✅核验 [^agslvsglsl]。Phase 0 先移 1 个比对。

### 2.3 2D 频谱
Compose `Canvas { drawRect/drawPath/drawLine + Brush 渐变 }`，`withFrameNanos` 驱动；分带/选色/平滑在 Kotlin `Core`（golden 守护）。⚠️ 60fps 复杂路径 Phase 4 补帧指标。

### 2.4 数据层
Room `@Database`/`@Dao`，查询返回 `Flow<List<…>>` → `collectAsStateWithLifecycle`。大字节落 `filesDir`/`cacheDir`，DB 存路径+元数据（codename：`muzero-db` 语义、id 前缀不变）。迁移用 Room `Migration`/`AutoMigration`。

## 3. 依赖清单（Gradle）

| 依赖 | 用途 | License |
|---|---|---|
| androidx.compose（BOM）+ material3 | UI | Apache-2.0 |
| androidx.media3：exoplayer / session / ui | 播放/锁屏 | Apache-2.0 |
| androidx.room：runtime/ktx + KSP | DB | Apache-2.0 |
| io.coil-kt.coil3：coil-compose + coil-network-okhttp | 图片 | Apache-2.0 |
| com.squareup.okhttp3 | HTTP | Apache-2.0 |
| org.jetbrains.kotlinx：serialization-json / coroutines | 序列化/并发 | Apache-2.0 |
| com.google.dagger：hilt-android（+ KSP） | DI | Apache-2.0 |
| com.anthropic:anthropic-java | Anthropic BYOK | MIT |
| com.openai:openai-java | OpenAI BYOK | Apache-2.0 |
| JTransforms 或 paramsen/noise | FFT | BSD / JNI |
| androidx.benchmark:benchmark-macro-junit4 + metrics-performance(JankStats) | 性能 | Apache-2.0 |

> 全部 Apache/MIT/BSD，无 GPL/AGPL 风险。版本快速演进（Room/Media3/Coil/官方 SDK）在 PR 锁版本。

## 4. Android 端 Open Spikes（汇总到总文 §Open Questions）
1. Media3 `AudioProcessor` PCM tap 60fps 延迟/稳定性 + FFT 库（JTransforms vs noise）选型。
2. AGSL <33 回退在低端机的体验/性能。
3. Compose `Canvas` 频谱 60fps 复杂路径+阴影性能。
4. Hilt vs Koin（solo 取舍）。
5. JUnit 跑语言中立 golden 向量的加载/断言写法。

---

### 脚注
[^playsdk]: Google Play target-SDK 门禁（2025-08-31 起新 app/更新须 target API 35；既有 app 须 API 34 触达新用户）. https://developer.android.com/google/play/requirements/target-sdk
[^media3surfaces]: Media3 MediaSession/MediaSessionService 自动 PlaybackState + MediaStyle 通知. https://developer.android.com/media/implement/surfaces/mobile
[^media3legacy]: Media3 legacy（MediaSessionCompat「不再更新」，强烈推荐 Media3）. https://developer.android.com/media/legacy/mediasession
[^exoviz]: dzolnai/ExoVisualizer（基于 ExoPlayer AudioProcessor 的频谱）+ androidx/media. https://github.com/dzolnai/ExoVisualizer
[^agsl]: AGSL（RuntimeShader，Android 13+/API 33+）. https://developer.android.com/develop/ui/views/graphics/agsl
[^agslvsglsl]: AGSL vs GLSL 移植差异. https://developer.android.com/develop/ui/views/graphics/agsl/agsl-vs-glsl
[^room]: Room release（2.8.4，2025-11；Flow 响应式）. https://developer.android.com/jetpack/androidx/releases/room
[^roomksp]: Room KSP 默认开启 / KAPT 维护模式. https://developer.android.com/build/migrate-to-ksp
[^coil]: Coil 3（3.5.0，AsyncImage）. https://coil-kt.github.io/coil/getting_started/
[^di]: Hilt vs Koin（编译期 DI 优势）. https://www.droidcon.com/2025/11/26/hilt-vs-koin-the-hidden-cost-of-runtime-injection-and-why-compile-time-di-wins/
[^anthropicjava]: 官方 anthropic-java（MIT，JVM/Android，结构化输出）. https://github.com/anthropics/anthropic-sdk-java
[^openaijava]: 官方 openai-java（Apache-2.0，JVM/Android，class→JSON schema 结构化输出）. https://github.com/openai/openai-java
[^koog]: JetBrains/Koog（Kotlin AI agent 框架）. https://github.com/JetBrains/koog
[^quicktype]: quicktype（JSON Schema → Kotlin @Serializable / Swift Codable）. https://github.com/glideapps/quicktype
