# MUZERO iOS 原生技术栈选型（Swift / SwiftUI）

**Status:** Draft · **Created:** 2026-06-16 · **Author:** DoodleBear / MUZERO
**Parent:** [native-tech-stack 总文档](20260616-muzero-native-tech-stack-prd.md) · **属于:** [全原生移动端移植 PRD](../20260616-muzero-native-mobile-port-prd/20260616-muzero-native-mobile-port-prd.md)（Option C + spec guard）

> 本文档是 **iOS 端独立技术栈参考**（实现 iOS 时只读本篇即可）。逐层给**推荐选型 + 版本/License + 备选 + 何时切换 + 理由**。置信标注：**✅本轮 research 核验**（引用）/ **✅*前轮核验** / **⚠️团队判断/标准实践**（未被本轮独立核验，入总文档 Open Q）。

## 0. 基线

- **语言/UI**：Swift 6 + **SwiftUI 为主**，UIKit 仅在 interop 边角（见 §1）。
- **最低系统**：**iOS 17**（拿到 **Observation `@Observable`** + **SwiftUI 内置 Metal shader 修饰符** `.colorEffect`/`.layerEffect`，iOS 17+）。⚠️ 团队判断（reach vs 现代 API 平衡）。
- **包管理**：Swift Package Manager（SPM）。
- **并发**：Swift Concurrency（async/await、actors）。

## 1. 逐层选型表

| 层 | 推荐 | 版本/License | 备选（何时切换） | 理由 / 置信 |
|---|---|---|---|---|
| **UI** | **SwiftUI** | 系统 | UIKit via `UIViewRepresentable`（托管 MTKView、复杂文本输入、个别 list 行为） | 主流、AI 最熟；边角才下沉 UIKit。⚠️ |
| **状态/响应式** | **Observation `@Observable`** | iOS 17+ | Combine（GRDB publisher、debounce、定时流处） | 官方现代默认，比 `ObservableObject` 少样板。⚠️ |
| **音频播放** | **AVAudioEngine + AVAudioPlayerNode** | 系统 | AVPlayer（若**不**需自管 FFT tap/远程流 HLS） | **要在同一音频图上 `installTap` 做 FFT** → 用 AVAudioEngine；我们音频在播放时已是本地文件（submit→poll→**download**），engine 直接喂。⚠️*（FFT 机制前轮核验） |
| **后台 + 锁屏** | **AVAudioSession(.playback)** + **MPNowPlayingInfoCenter** + **MPRemoteCommandCenter** + `UIBackgroundModes: audio` | 系统 | — | 平台一等公民，净收益。⚠️ |
| **音频 FFT** | **AVAudioEngine `installTap`(mainMixerNode) + Accelerate `vDSP.FFT`** | 系统 | — | tap **播放总线**（非麦克风）→ vDSP FFT → 八度分带。✅*前轮核验（tempi-fft / vDSP）[^tempi][^vdsp] |
| **流光着色器** | **SwiftUI `.colorEffect`/`.layerEffect`（Metal `Shader`）+ `TimelineView(.animation)`** | iOS 17+ | **MTKView/CAMetalLayer**（多 pass / framebuffer feedback / 极限性能时） | `Shader.Argument` 支持 `float`/`float2..4`/`color`/**`floatArray`**/`data`/`image` → 多色 palette 用 `floatArray`、时间/音频用 float 逐帧；fbm/noise 片元可跑，**无需全 MTKView**。⚠️ **Phase 0 必 spike**（总文 Open Q）[^swiftuishader] |
| **2D 频谱** | **SwiftUI `Canvas` + `TimelineView(.animation)`** | iOS 15+/17 | Metal（最吃力样式）/ Core Graphics | GPU 加速、渐变/路径/阴影齐全；FFT 驱动重绘。⚠️ 60fps 复杂路径待验 |
| **本地 DB** | **GRDB.swift** | v7.x（~7.11），MIT | **SQLiteData**(Point-Free，`@FetchAll`/`@Query` 风，GRDB 驱动，要 SwiftData 式人体工学时) | `ValueObservation` 只在落盘变更后通知 = Dexie `useLiveQuery` 直接对位；原始 SQL + record ORM 双 API。✅核验 [^grdb][^sqlitedata]。避开 SwiftData（年轻/控制弱）/Core Data（重）/Realm（重、被收购） |
| **网络（BYOK HTTP）** | **URLSession + async/await** | 系统 | Alamofire（需其便利时） | 零依赖、native **无 CORS**（删 muzfetch）。⚠️ |
| **图片加载/缓存** | **Nuke**（NukeUI `LazyImage`） | ~12.x，MIT | Kingfisher（社区更大）/ AsyncImage（内置但无磁盘缓存，不够） | LRU 内存+磁盘、后台解码、async/await。✅核验 [^nuke] |
| **DI** | **手动 composition root** 或 **Factory** | Factory MIT | swift-dependencies（若走 TCA 风） | solo+AI 取最简；Factory 轻量。⚠️ |
| **LLM 客户端（BYOK）** | **MacPaw/OpenAI** + **SwiftAnthropic** | OpenAI v0.5.x(MIT，**pre-1.0**)；SwiftAnthropic v2.x(MIT) | URLSession+Codable 直连 REST（全控） | OpenAI SDK 有原生 Structured Outputs（JSON Schema）；SwiftAnthropic 全 Messages/tool-use，但**无原生结构化输出** → 用 tool-use input_schema 强制 JSON。✅核验 [^macpaw][^swiftanthropic]。**切换触发**：Anthropic API 已 GA 原生 Structured Outputs（output_format）→ 想用则传 raw params/更新 SDK |
| **结构化输出** | `Codable` + tool-use JSON schema（强制 brief 形状） | — | — | 等价 Vercel `generateObject`+Zod。✅(机制) |
| **契约 codegen** | **quicktype**（JSON Schema → Swift `Codable`） | quicktype，Apache-2.0 | — | 与 Android 同一 JSON Schema 单源（总文 spec guard）。✅(工具存在) [^quicktype] |
| **测试 + 性能** | **Swift Testing**（单测/golden 向量）+ **XCTest**（UI/perf）+ Instruments/`xctrace` + `os_signpost` + `CADisplayLink` | Xcode 16+ | XCTest 全量 | golden 向量跑 Swift Testing；`measure(metrics:)` baseline 判回归；CADisplayLink 测帧节奏。⚠️*（perf harness 前轮覆盖） |
| **i18n** | **String Catalogs（`.xcstrings`）** | Xcode 15+ | — | en 为源，对齐桌面 i18n key。⚠️ |

## 2. 关键子系统说明

### 2.1 音频图 + FFT（最需谨慎）
- 用 **AVAudioEngine**：`AVAudioPlayerNode → mainMixerNode → output`。在 **`mainMixerNode` 上 `installTap`** 拿混音后 PCM → `vDSP.FFT`（`vDSP_fft_zrip`）→ 移植 `bands.ts` 八度对数分带（golden 向量守护）→ 喂频谱 + bass/mid/treble/energy。
- ⚠️ **gotcha**：tap 的是**播放总线**不是麦克风（不需要麦克风权限）；buffer size/采样率与 FFT 窗口对齐；engine 在用户手势后 start，配合 `AVAudioSession`。
- 备选 AVPlayer：更适合远程/HLS 流，但**对其输出做 FFT 需 `MTAudioProcessingTap`（更底层）**——我们音频播放时已是本地文件，故 AVAudioEngine 更顺。**Phase 0 spike 确认**（总文 Open Q）。

### 2.2 流光着色器：先试 SwiftUI Shader，不行再 MTKView
- **首选** `.colorEffect`（逐像素生成）/ `.layerEffect`（可采样图层），shader 写在 `.metal` 文件、经 `ShaderLibrary` 引用；`TimelineView(.animation)` 每帧更新 `uTime`，`floatArray` 传多色 palette，float 传 `uAudio`。GLSL→Metal(MSL) 移植：坐标/归一化、向量类型按 MSL；fbm/noise/voronoi 标准片元逻辑可移。
- **MTKView/CAMetalLayer** 仅当：多 pass、需要上一帧反馈、或 SwiftUI shader 路径性能/能力不达标。
- **Phase 0 必先移 1 个 shader（如 ambient-light）双端比对**（iOS 这份走 SwiftUI Shader 优先）。低端/失败回退 SwiftUI `LinearGradient` 多色静态。

### 2.3 2D 频谱
SwiftUI `Canvas { ctx, size in ... }` 内 `ctx.fill/stroke/addLinesBetween` + `LinearGradient`/`RadialGradient` + shadow，`TimelineView(.animation)` 驱动；分带/选色/平滑逻辑在 Swift `Core`（golden 向量守护），绘制薄。⚠️ 60fps 复杂路径 Phase 4 补帧指标复测。

### 2.4 数据层
GRDB：`DatabaseQueue`/`DatabasePool` + `FetchableRecord`/`PersistableRecord`；`ValueObservation` → SwiftUI（`@Observable` 持订阅 or `.publisher(in:)`）。大字节（音频/封面/视频）落 `FileManager`（Documents/Caches），DB 存路径+元数据（codename：`muzero-db` 语义、id 前缀不变）。迁移用 GRDB `DatabaseMigrator`。

## 3. 依赖清单（SPM）

| 包 | 用途 | License |
|---|---|---|
| GRDB.swift | DB | MIT |
| (可选) SQLiteData / Sharing | DB 高层 | MIT |
| Nuke / NukeUI | 图片 | MIT |
| MacPaw/OpenAI | OpenAI BYOK | MIT |
| SwiftAnthropic | Anthropic BYOK | MIT |
| (可选) Factory | DI | MIT |
| 系统：AVFoundation / Accelerate / Metal / MetalKit / MediaPlayer / SwiftUI / Observation | 音频/FFT/shader/锁屏/UI | Apple |

> 全部 MIT/系统框架，无 GPL/AGPL 风险。pre-1.0（MacPaw/OpenAI、SwiftAnthropic）在 PR 锁版本。

## 4. iOS 端 Open Spikes（汇总到总文 §Open Questions）
1. AVAudioEngine 播放-tap FFT 路径（vs AVPlayer + MTAudioProcessingTap）真机验证。
2. SwiftUI `.colorEffect` 能否承载 14 个 fbm/noise flow shader（floatArray 多色 + time + audio uniform），还是需 MTKView。
3. SwiftUI `Canvas`+`TimelineView` 频谱 60fps 复杂路径+阴影性能。
4. iOS DB：GRDB vs SQLiteData 人体工学 demo 拍板。
5. Swift Testing 跑语言中立 golden 向量的加载/断言写法。

---

### 脚注
[^grdb]: GRDB.swift（MIT，v7.x，ValueObservation 响应式）. https://github.com/groue/GRDB.swift
[^sqlitedata]: Point-Free SQLiteData（原 SharingGRDB，@FetchAll/@Query 风，GRDB 驱动）. https://github.com/pointfreeco/sqlite-data
[^nuke]: Nuke（LRU 内存+磁盘、async/await、NukeUI）. https://kean.blog/nuke/home
[^macpaw]: MacPaw/OpenAI（社区 Swift OpenAI SDK，MIT，Structured Outputs via JSON Schema）. https://github.com/MacPaw/OpenAI
[^swiftanthropic]: SwiftAnthropic（社区 Claude SDK，MIT，Messages/streaming/tool-use；无原生结构化输出）. https://github.com/jamesrochabrun/SwiftAnthropic
[^quicktype]: quicktype（JSON Schema → Swift Codable / Kotlin 等多语言）. https://github.com/glideapps/quicktype
[^swiftuishader]: SwiftUI Metal shader 修饰符（.colorEffect/.layerEffect，iOS 17+）. https://www.hackingwithswift.com/quick-start/swiftui/how-to-add-metal-shaders-to-swiftui-views-using-layer-effects
[^tempi]: tempi-fft（iOS 实时 FFT，Accelerate vDSP_fft_zrip + 八度分带，CC0）. https://github.com/jscalo/tempi-fft
[^vdsp]: Apple Accelerate / vDSP FFT. https://developer.apple.com/documentation/accelerate/vdsp/fft
