# PRD: MUZERO 内存泄漏 / OOM / 性能问题审计与修复

**Status:** Draft
**Created:** 2026-06-12
**Author:** Claude Code（全库静态排查 + 人工核实）
**Module:** 全局性能 — playback / 网络与同步 / 可视化与背景 / 列表渲染 / store 订阅

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | 观测先行：内存与帧节奏指标 | 🔄 In Progress | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | 确证泄漏修复（P0：YouTube 播放路径） | ✅ Completed | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | 全表查询放大链治理（列表 / 搜索 / 统计） | ✅ Completed | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | 渲染层 GPU / GC 卫生（可视化 + 背景） | 🔄 In Progress（F-6/F-7 被并发改动阻塞） | [Phase 4 Checklist](#phase-4-checklist) |
| 5 | 大文件内存防护（预热 / 缓存 / 下载） | 🔲 Pending | [Phase 5 Checklist](#phase-5-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

MUZERO 是本地优先的长驻播放器：用户会让它**连续运行数小时甚至数天**（DJ 无限续歌、挂机听歌、视频背景常开）。这种使用形态下，任何「每首歌泄漏一点」「每次写库放大一次」的缺陷都会随时间线性累积成 OOM 或可感知卡顿。

本次对 playback、网络请求、可视化频谱、流光/像素背景、列表渲染、store 订阅六个区域做了全库静态排查。**所有写入本 PRD 的发现都经过二次人工核实**（排查 agent 的初步报告中有 5 条结论被证伪，见 §4.3 误报澄清——保留下来防止未来重复排查）。

核心结论：

1. **一处确证的逐首泄漏**：YouTube blob 播放路径每播一首歌泄漏一个 object URL，并把整首歌的音频 Blob 钉在内存里直到刷新页面（§4.1 F-1）。
2. **一条全表查询放大链**：任何 `tracks` 表写入都会触发「整表重查 → 派生索引全量重建 → 搜索快照全量重新序列化发给 Worker」，在导入 / DJ 续歌突发时成本是 O(N×写入次数)（§4.1 F-3）。
3. 渲染层若干 GPU 资源累积与每帧浪费（GL program 不删除、视频背景双解码、每帧 `getComputedStyle`），单项不致命，叠加构成长播 GC/GPU 压力（§4.1 F-5~F-10）。

### 1.2 Target Users

| Role | Description | 受影响场景 |
|------|-------------|-----------|
| **挂机听歌用户** | DJ 续歌 / 歌单循环数小时不关 | 内存累积、GC 卡顿、最终 OOM |
| **流媒体源用户** | 主力听 YouTube / B站 / 网易云在线源 | F-1 逐首泄漏直接命中 |
| **大库用户** | 本地导入数千首（文件夹导入 / R2 同步） | F-3/F-4 全表查询放大、搜索页进场卡顿 |
| **视觉效果用户** | 常开流光背景 + 频谱 + 像素视频背景 | F-5~F-10 GPU/解码叠加成本 |

### 1.3 Core Value

1. **长驻稳定性**：播放 N 小时后内存曲线回落平稳，不随播放首数单调上升。
2. **大库可伸缩**：库从 100 首长到 10000 首，写库突发不再造成全表级联重算。
3. **可验证**：先补观测指标再改代码，每项修复都有 before/after ground truth（见 §2 测量方法学，依据 [prd-create.md §4](../../../.cursor/commands/prd-create.md) 性能类 PRD 附加要求）。

---

## 2. 测量方法学（先于一切优化）

> 依据 prd-create.md §4：「先把测量方法学写进 PRD，再写优化方案——否则容易凭感觉调参 + 改了无法验证」。

### 2.1 指标定义

> **既有设施优先**：左下角 dev 性能面板 [`DevPerfPanel`](../../../src/components/dev/dev-perf-panel.tsx)（`fixed bottom-3 left-3`，仅 `import.meta.env.DEV` 挂载）**已经实现** frame cadence（全局 rAF 间隔，`PerfWindow` 180 帧环）、Long Tasks observer（≥50ms）、JS heap（`readJsHeapBytes`），并带 copy-trace 按钮导出 [`trace.ts`](../../../src/lib/trace.ts) 环形缓冲（300 条，经 `sanitizeDiagnosticData` 脱敏）。本 PRD 新增的指标一律走同一套管道：计数器经 `traceEvent` / [`createDiagnosticLogger`](../../../src/lib/logger.ts) 进 trace 环，面板加行展示——**不另建采样器**。

| 指标 | 测法 | 状态 | 为什么 |
|------|------|------|--------|
| **frame cadence（呈现帧间隔）** | DevPerfPanel 已有：全局 rAF 间隔 → `PerfWindow` → avg/p99/max（[perf-metrics.ts](../../../src/lib/perf-metrics.ts)） | ✅ 已有 | 渲染耗时健康 ≠ 不卡；GC pause 落在渲染测量之外 |
| **Long Tasks** | DevPerfPanel 已有：`PerformanceObserver({ entryTypes: ["longtask"] })` → jank max 行 | ✅ 已有 | 「顿一下」的无歧义 before/after 信号，不管成因 |
| **JS Heap** | DevPerfPanel 已有：`performance.memory.usedJSHeapSize` 500ms 快照 | ✅ 已有 | 基础内存曲线 |
| **blob: URL 存活计数** | **新增面板行**：DEV 下包装 `URL.createObjectURL/revokeObjectURL` 的 live 计数器（create−revoke 差值）；交叉验证用 Chromium `chrome://blob-internals` | 🔲 Phase 1 | F-1 类泄漏的无歧义信号：播放 20 首流媒体歌后计数应回到基线 ±预期缓存量（coverUrlCache 容量 256 内） |
| **liveQuery 重查计数** | **新增**：`listAllTracks` 等重查询入口 `traceEvent("debug", "db", …)` 进 trace 环 + 面板累计行（prod 静默，符合硬规则 8） | 🔲 Phase 1 | F-3 的 before/after：一次 100 首导入触发几次整表重查 |
| **队列长度** | **新增面板行**：playQueue entries 数（F-11 观测） | 🔲 Phase 1 | 长驻无界增长可见化 |
| **进程内存 / Blob 保留树** | DevTools heap snapshot 三连拍（基线 → 操作后 → 手动 GC 后）+ Electron 主进程 `process.memoryUsage()`；Blob 字节不一定计入 JS heap | 手动 | 面板 heap 行的补充，泄漏归因 |
| **WebGL 资源** | DevTools → More tools → Rendering / `gl.getProgramParameter` 抽查；切换 14 种 flow 效果一轮后看 GPU 进程内存 | 手动 | F-5 program 累积的验证手段 |

### 2.2 测量纪律

- **prod build 复测，dev mode 不作数**：所有数字在 `make build` 产物（或 `make desktop-build` 安装包）下采集。dev 的 React StrictMode（effect 双调用）+ HMR + sourcemap 会污染基线。
- **第二次循环为准**：首次操作的 warmup 上涨（shader 编译、字典懒加载、JIT）是预期，复测第二轮。
- **症状先验证普遍性**：若观察到卡顿，先确认是否 layer-type-specific（纯音频 / MV / 流媒体三类都复现 → 根因在公共路径），再深入具体子系统。
- **每帧主线程工作显式预算**：render loop 内每帧跑的东西（§4.1 F-9/F-10）逐项列出成本，标注哪些可 gate / 降频 / defer。
- **回退 = `git revert`**：不为任何优化引入 hidden flag；需要 runtime 开关就建可见 Settings 控件（沿用硬规则 3）。

### 2.3 标准复现脚本（验收用）

| 场景 | 步骤 | 通过标准 |
|------|------|---------|
| S1 流媒体长播 | prod build，连续播放 30 首 YouTube 歌（自动 next） | blob: URL 计数回落到基线；手动 GC 后 heap 较基线增幅 < 50MB |
| S2 导入突发 | 文件夹导入 500 首本地文件，同时停留在搜索页 | 导入期间 longtask max < 200ms；`listAllTracks` 重查次数有界（防抖后 ≤ 导入批次数） |
| S3 长播 GC | 任一可视化样式 + 流光背景开启，连续播放 1 小时 | frame p99 < 33ms，frame max 无周期性 >100ms 尖刺 |
| S4 效果切换 | 依次切换全部 14 种 flow 效果 ×3 轮，再切 6 种像素背景效果 ×3 轮 | GPU 进程内存回落；无 WebGL context lost |
| S5 快速切歌 | 手动 next ×50（含 MV、流媒体、本地混合队列） | blob: URL 计数稳定；mediaSession artwork 无累积 |

---

## 3. System Architecture（受影响面）

```
┌─ 播放链 ───────────────────────────────────────────────┐
│ streamsrc(youtube-ytjs) ─▶ player-store ─▶ MediaEngine │   F-1, F-2
│ playback-preload ─▶ playback-cache(IndexedDB)          │   F-8
└────────────────────────────────────────────────────────┘
┌─ 数据/列表链 ──────────────────────────────────────────┐
│ Dexie tracks 表 ─▶ useLiveQuery(listAllTracks 整表)     │
│   ├▶ artist/album 索引重建（useMemo）                   │   F-3
│   ├▶ memoryNotesByTrack 重扫                            │
│   └▶ setSearchRows 全量快照 ─▶ search-worker            │
│ trackPlaybackStats 表 ─▶ 播放期周期 flush ─▶ 整表重查    │   F-4
└────────────────────────────────────────────────────────┘
┌─ 渲染链 ───────────────────────────────────────────────┐
│ VisualizerHost ─▶ spectrum(canvas) / ReactiveScene(twgl)│   F-5, F-9, F-10
│ now-playing-background ─▶ scene-flow 层                 │
│ PixiPixelBackground（独立 Pixi App + 第二个 <video>）    │   F-6, F-7
└────────────────────────────────────────────────────────┘
```

---

## 4. 发现清单（全部经人工核实）

> 严重度口径：**P0** = 确证泄漏，逐次累积；**High** = 随库规模/时长线性恶化的性能问题；**Medium** = 有界但可感知的浪费；**Low** = 卫生项 / 仅 dev/test 可见。

### 4.1 问题登记表

| ID | 区域 | 位置 | 严重度 | 状态 |
|----|------|------|--------|------|
| F-1 | 流媒体播放 | [youtube-ytjs.ts:368](../../../src/streamsrc/youtube/youtube-ytjs.ts) | **P0** | 确证 |
| F-2 | 流媒体下载 | [youtube-ytjs.ts:165-181](../../../src/streamsrc/youtube/youtube-ytjs.ts) | **High** | 确证 |
| F-3 | 列表/搜索 | [search-page.tsx:234-246](../../../src/pages/search-page.tsx), [use-worker-track-search.ts:25-29](../../../src/hooks/use-worker-track-search.ts) | **High** | 确证 |
| F-4 | 播放统计 | [search-page.tsx:311](../../../src/pages/search-page.tsx) | **Medium** | 确证 |
| F-5 | WebGL 场景 | [reactive-scene.tsx:80-126](../../../src/visualizer/scene/reactive-scene.tsx) | **Medium** | 确证 |
| F-6 | 像素视频背景 | [pixi-pixel-background.tsx:104-121,336-363](../../../src/components/player/pixi-pixel-background.tsx) | **Medium** | 确证 |
| F-7 | 像素背景切换 | [pixi-pixel-background.tsx:49-164](../../../src/components/player/pixi-pixel-background.tsx) | **Medium** | 确证 |
| F-8 | 大文件入内存 | [playback-preload.ts:149](../../../src/player/playback-preload.ts), [r2-cache.ts:42](../../../src/sync/r2-cache.ts), [cloud-provider.ts](../../../src/musicgen/cloud-provider.ts) | **Medium** | 确证 |
| F-9 | 每帧样式读 | [reactive-scene.tsx:169](../../../src/visualizer/scene/reactive-scene.tsx) → [visualizer-color.ts:68-76](../../../src/lib/visualizer-color.ts) | **Medium** | 确证 |
| F-10 | 每帧数组分配 | [bands.ts:56-124](../../../src/visualizer/spectrum/bands.ts) | **Low** | 确证 |
| F-11 | DJ 队列无界增长 | [player-store.ts](../../../src/stores/player-store.ts)（playQueue/session.trackIds） | **Low** | 设计确认 |
| F-12 | artwork 竞态 | [player-store.ts:2122-2155](../../../src/stores/player-store.ts) | **Low** | 确证（非泄漏） |
| F-13 | 单例卫生项 | media-engine 无 destroy()、theme.ts matchMedia 无 guard、sync-indicator 订阅永驻 | **Low** | 确证（仅 dev/test） |

### 4.2 逐项细节与修复方向

#### F-1（P0）YouTube blob 播放：object URL 永不释放，整首歌字节钉死在内存

`createYtjsRuntime().resolveAudio` 下载整首歌为 Blob 后执行 `url = URL.createObjectURL(blob)`（youtube-ytjs.ts:368），把 `url` 和 `blob` 一起返回。但消费侧 [player-store.ts:2067-2069](../../../src/stores/player-store.ts) 在 `resolved.blob` 存在时走 `mediaEngine.loadBlob(resolvedBlob)` ——MediaEngine 会**自己再建一个** object URL 并管理其生命周期；resolver 创建的那个 URL **从未被任何代码使用，也从未 revoke**。

object URL 是 Blob 的强引用：每播一首 YouTube 歌就有一整首歌的音频字节（约 3–10MB）无法被 GC，直到页面刷新。挂机听流媒体一晚 ≈ 数百 MB 纯泄漏。

- **触发条件**：播放任意走 blob 下载 transport 的流媒体曲目（当前为 YouTube 主路径）。
- **修复方向**：resolver 在 `transport === "blob"` 时**不要创建 object URL**（`url` 字段对 blob 路径无意义，调用方只用 `blob`）；或调用方在 `loadBlob` 后立即 `URL.revokeObjectURL(resolved.url)`。前者更干净——契约改为 `blob` 与 `url` 二选一。注意 direct-fallback 路径（:386-408）`url` 是 https，不受影响。
- **验收**：场景 S1，blob: URL 计数播完回基线。

#### F-2（High）`readableStreamToBlob` 无 reader 清理 + 无大小上限

youtube-ytjs.ts:165-181：`stream.getReader()` 后的读循环没有 try/finally；abort / 网络错误 / 任何 `reader.read()` 抛出时 reader 不 `cancel()`，底层流与已缓冲 chunks 挂起等 GC，多次失败重试会叠加。同时整个下载以 `chunks: BlobPart[]` 形态全量驻留 JS 内存（音频可接受，但无 content-length 守卫，异常大的响应无封顶）。

- **修复方向**：`try { … } finally { reader.releaseLock(); }` + 错误路径 `void reader.cancel().catch(() => {})`；读循环累计字节数超阈值（如 200MB）即 cancel 并降级 direct URL 播放。
- **验收**：模拟中途 abort 的单测（注入 fake stream），断言 cancel 被调用。

#### F-3（High）全表 liveQuery 放大链：一次写库 = 整库重算

确认的完整链条（search-page.tsx，global-track-search.tsx 同构）：

```
任意 tracks 写入（导入一首 / DJ 落一首 / 点一个赞）
  → useLiveQuery(listAllTracks) 重新执行 db.tracks.toArray()   ← 整表
  → 返回新数组（引用必变）
    → memoryNotesByTrack(allTracks.map(id)) 重查 memories 表    ← 整表扫
    → trackById / artistIndex / albumIndex 三个 useMemo 全部重建 ← O(N)
    → useWorkerTrackSearch 的 effect 触发 setSearchRows(
        tracks.map(trackToRow))                                 ← O(N) 序列化
      → postMessage 结构化克隆整个快照给 search-worker          ← O(N) 克隆
```

500 首文件夹导入若产生 500 次独立写入，上述链条执行 500 遍 = O(N²) 总成本。DJ 续歌（draft→pending→ready 每首多次状态写）同样反复触发。这是「库规模增长」类最大的可伸缩性风险，也是导入期间搜索页卡顿的直接解释。

- **修复方向**（按优先级）：
  1. **写侧合批**：文件夹导入 / R2 拉取已在 worker 批量写（`bulkPut`），确认 DJ 引擎逐首状态机写入是否可合并事务；Dexie 同一事务内多写只触发一次 liveQuery 重查。
  2. **读侧防抖**：对 `allTracks` 这类重查询包一层 debounce（例如 trailing 250ms）再喂给派生计算与 `setSearchRows`——liveQuery 高频 emit 时只取最后一帧。
  3. **快照增量化（次期）**：`setSearchRows` 改成 diff 协议（add/update/remove by id），worker 端维护 Map；只有首次全量。
  4. 派生索引（artist/album）构建包 `useDeferredValue` / `startTransition`，让输入响应优先。
- **验收**：场景 S2；导入 500 首期间 `listAllTracks` 实际执行次数下降一个数量级，longtask max < 200ms。

#### F-4（Medium）播放期间 `trackPlaybackStats` 整表重查

search-page.tsx:311 `useLiveQuery(() => db.trackPlaybackStats.toArray())`。播放心跳（playbackListenTracker 周期 flush，[player-store.ts:2163-2177](../../../src/stores/player-store.ts)）会写 stats 表 → 停留在搜索页时，**正常播放本身**就周期性触发整表重查 + `statsByTrackId` / `artistStats` / `albumStats` 三层 useMemo 重建。

- **修复方向**：统计 liveQuery 与播放 flush 解耦——搜索页可见时才订阅（已天然如此，因为是页面 hook），再叠加防抖；或 stats 聚合下沉为单行聚合表，按 entity 读。
- **验收**：场景 S3 期间停留搜索页，stats 重查频率 ≤ flush 频率且无连锁 longtask。

#### F-5（Medium）ReactiveScene：切换 shader 不释放旧 GL program/buffer

reactive-scene.tsx:80-103 每次 `frag`/`fftSize` 变化在**同一个** WebGL context 上 `twgl.createProgramInfo` + `createXYQuadBufferInfo` 重建，旧 program / shader / buffer 既不 `gl.deleteProgram` 也不 `gl.deleteBuffer`。GPU 侧资源只在 canvas 卸载（context 被 GC）时整体释放——用户在 Settings 里轮流试 14 种 flow 效果时持续累积。cleanup 注释解释了不能 `loseContext()`（StrictMode 双挂载），但**删除 program ≠ 杀 context**，可以安全做。

- **修复方向**：build effect 的 cleanup 中对上一份 `GLState` 执行 `gl.deleteProgram(programInfo.program)` + 逐 buffer `gl.deleteBuffer`（twgl bufferInfo.attribs 可枚举）；保留现有不 loseContext 的决策。
- **验收**：场景 S4，GPU 进程内存回落。

#### F-6（Medium）像素视频背景：同一视频文件双路解码 + 暂停仍每帧渲染

pixi-pixel-background.tsx 的 `loadVideo`（:336-363）为背景效果创建**第二个 `<video>` 元素**解码同一文件——与 MediaEngine 的持久 `<video>`（stage 视觉）并行，MV + 像素背景同开时解码 CPU/内存双倍。另外 `ticker.add(tick)`（:116-119）后 ticker 持续每帧 `app.render()`，**视频暂停时也照常渲染**（rAF 驱动，前台 60fps 空转 GPU）。

- **修复方向**：短期——播放器 `isPlaying === false` 时 `ticker.stop()`，恢复时 `start()`（已有 store 订阅 :187-198 可顺带驱动）；长期——评估直接以 MediaEngine 的 video 元素为纹理源（同一元素不能同时在 stage 和纹理采样两处「显示」，但 `Texture.from(videoEl)` 采样不要求元素可见——需验证 stage 已 adopt 时的行为，列开放问题 Q-2）。
- **验收**：MV + 像素背景暂停 5 分钟，GPU 占用接近 0；CPU 解码进程单路。

#### F-7（Medium）像素背景每次换源整建 Pixi Application（WebGL context churn）

每次 `src` 变化（= 每次切歌换封面/视频）都 `new Pixi.Application()` + `init()`（新 WebGL context），350ms 交叉淡入后销毁旧层（:150-164）。瞬时双 context 可接受，但**高频切歌 = 持续 context 创建/销毁**，浏览器 context 池（约 16 个）频繁进出，且 `Application.init` 本身不便宜（百 ms 级）。

- **修复方向**：复用单个 Application/renderer，切源只换 `Texture` + sprite（淡入淡出可在两个 sprite 间做）；保留当前「先画新层再销毁旧层」的视觉语义。
- **验收**：场景 S5 切歌 50 次无 context lost、切换延迟下降。

#### F-8（Medium）大文件整块进内存（预热 / R2 缓存 / musicgen 下载）

`response.blob()` 三处全量缓冲：playback-preload.ts:149（远程媒体预热）、r2-cache.ts:42（R2 离线缓存）、cloud-provider 下载。音频（3–10MB）没问题；**远程视频（数百 MB）**会造成内存峰值。缓解事实：r2-pull-sync 对 trackIds 是**串行 for 循环**（已核实，无并发叠加）；Chromium 的 Blob 实现可落盘，但 Tauri WKWebView 无此保证。

- **修复方向**：三处统一加 content-length 守卫——超阈值（建议 256MB，可讨论）跳过预热/缓存、播放走 URL 流式（`loadUrl` 路径浏览器自带 Range 流式）；阈值常量集中一处。流式写入 OPFS 属重构，列 out of scope。
- **验收**：含 >500MB 视频的远程集，预热/同步全程进程内存增幅 < 阈值附近。

#### F-9（Medium）scene 渲染循环每帧 1–2 次 `getComputedStyle`

reactive-scene.tsx:169 每帧调 `readPrimaryRgb(canvas)`，实现（visualizer-color.ts:68-76）每次执行 1–2 次 `getComputedStyle(...).getPropertyValue(...)`。样式读取强制 style recalc 检查，60fps 下是无谓的每帧主线程成本；spectrum 各渲染器如有同模式一并处理。

- **修复方向**：缓存解析结果，仅在「主题/动态主色变化」时失效——动态主色本来就经 [visualizer-color-store](../../../src/stores/visualizer-color-store.ts) 流转，可在 store 更新时主动刷新缓存；或降频到每 500ms 读一次。
- **验收**：DevTools Performance 火焰图中 render loop 内 recalc style 片段消失。

#### F-10（Low）频谱每帧 3–4 个小数组分配

bands.ts 的 `aggregateBands` / `applyTilt` / `smoothBands` / `decayBands` 均返回新数组（每个 24–48 元素），叠加 `computeAudioUniforms` 返回对象与 `setUniforms` 字面量，每帧合计 ~5–8 个短命对象。单项极小（nursery GC 可吸收），列入 GC 卫生项：长播叠加其他分配源时减少 minor GC 频率。

- **修复方向**：为热路径提供原地变体（`smoothBandsInto(prev, next, out)`），渲染器持有复用数组；保持现有纯函数版本供测试与非热路径使用（bands.ts 已穷举单测，原地版补对照测试）。

#### F-11（Low）DJ 无限续歌 → playQueue / session.trackIds 无界增长

设计层面确认：autoExtend 集没有队列上限，挂机数日 trackIds 可达数千（每 track 行含 brief/lyrics，几 KB 级）。store 内 `queue` 数组与 liveQuery 每次续歌全量重建。短期不致命（虚拟化兜底渲染），但属于「长驻」形态的已知无界增长点。

- **修复方向**：本期仅记录 + 建立观测（队列长度进诊断日志）；上限策略（如保留最近 500 + 历史归档）牵涉产品语义（队列 vs 歌单 vs 记忆，见 data-model PRD），列开放问题 Q-3，不在本 PRD 实施。

#### F-12（Low）mediaSession artwork 并发竞态（非泄漏）

player-store.ts:2122-2155 两次 `updateMediaSessionMetadata` 交错时（await `getTrackCover` 期间切歌），最坏结果是 revoke 掉正在展示的 artwork URL（系统媒体面板封面闪失），**不是泄漏**（核实：所有分支的 URL 都有 revoke 归宿）。修复可顺手：以请求序号丢弃过期结果。

#### F-13（Low）单例卫生项（仅 dev/HMR/test 可见）

- [media-engine.ts](../../../src/player/media-engine.ts) 无 `destroy()`：监听器在构造器一次性绑定（`setCallbacks` 只换引用，**不累积**——核实纠正了初查报告），prod 单例无影响；补 destroy 利于测试隔离。
- [theme.ts:79-85](../../../src/theme/theme.ts) `initTheme` 的 matchMedia listener 无重入 guard（HMR 下叠加）。
- [sync-indicator.ts:182-195](../../../src/stores/sync-indicator.ts) 模块级 zustand subscribe 永不退订（prod 单例语义正确，违反「订阅即有 cleanup」规约）。

统一处理：补 guard / 返回 cleanup，一个小 PR 内完成。

### 4.3 误报澄清（已核实无问题，避免重复排查）

| 初查指控 | 核实结论 |
|----------|---------|
| 「reactive-scene `flowColors` Float32Array 每帧重分配」 | **误报**。:134 在 effect 作用域预分配并复用，注释明确 "Reused per-frame"；仅 effect 重建时重分配，无 GC 压力 |
| 「warmTrackCover abort 后泄漏中间 blob URL」 | **误报**。[playback-preload.ts:61-63](../../../src/player/playback-preload.ts) abort 检查在 `createObjectURL` **之前**，创建与 `coverUrlCache.store` 之间无 await，不存在竞态窗口；`store` 对重复 key 还会 revoke 后到者 |
| 「coverUrlCache 无 LRU、无限增长」 | **误报**。[object-url-cache.ts](../../../src/lib/object-url-cache.ts) 实现 ref-count + 容量 256 的 LRU + revoke-on-evict + revoke-before-replace，设计完善且有单测 |
| 「App.tsx cloud-auto-sync 的 useEffect 未返回 cleanup」 | **误报**。App.tsx:86 `useEffect(() => startCloudAutoSyncScheduler(), [])` 是表达式体箭头函数，cleanup 已正确返回 |
| 「MediaEngine setCallbacks 多次调用累积监听器」 | **误报**。监听器构造器内一次性绑定并引用 `this.callbacks`，setCallbacks 仅替换对象引用 |
| 「R2 拉取并发缓存多首立即 OOM」 | **夸大**。r2-pull-sync.ts:118 为串行 for 循环，峰值 = 单个最大文件（归入 F-8 阈值守卫即可） |

### 4.4 已验证健康的设计（抽查记录）

- MediaEngine `loadBlob/loadUrl` revoke-before-replace 正确，`loadUrl` 还会收养传入的 blob: URL 进统一 revoke 管理（media-engine.ts:163）。
- WebAudio graph 单次懒建（`ensureGraph` 幂等），无重复 `createMediaElementSource`。
- spectrum 渲染器 destroy / IntersectionObserver / visibilitychange 清理完备；VisualizerHost 单 rAF 管理正确。
- worker 通信用 transferable ArrayBuffer（heavy-client），无复制；Electron IPC buffer 隔离正确。
- 通知 store 有容量上限（persistent 20 / transient 5）+ timer 清理；DJ pump 标志防重入。
- `getTracksByIds` 走 `bulkGet`，列表无 N+1。
- image-palette 取色 96×96 降采样 + finally revoke；download-track / save-text-file 延迟 revoke。

---

## 5. Implementation Plan

> Phase 顺序依据 prd-create.md §4「观测先行，再优化」与 §3「基础设施先于覆盖广度」。Phase 2 例外提前：F-1 是确证逐首泄漏，修复本身即可被 §2.3-S1 直接验证，无需等观测设施。

### Phase 1: 观测先行 — 扩展既有 trace + DevPerfPanel

**Goal:** 在既有 [`DevPerfPanel`](../../../src/components/dev/dev-perf-panel.tsx)（左下角 dev HUD，已有 fps / frame p99 / jank / heap / copy-trace）和 [`trace.ts`](../../../src/lib/trace.ts) 管道上补齐本审计缺的三个计数器，固化 before 基线；纯 observability，低风险可独立先 ship。**不新建采样器、不新建日志通道。**

**Tasks:**
- [x] blob: URL 存活计数器：DEV 构建下包装 `URL.createObjectURL/revokeObjectURL`（live diff），DevPerfPanel 加一行 `blobs`（[perf-counters.ts](../../../src/lib/perf-counters.ts) `installBlobUrlTracker`，refcount + 卸载还原，TDD 11 测）
- [x] liveQuery 重查计数：`listAllTracks` / `memoryNotesByTrack` / `trackPlaybackStats` 查询入口经 `noteDbRequery` 计数 + `traceEvent("debug", "db", …)` 进 trace 环（copy-trace 一键带出），面板加 `db` 累计行；search-page 的内联 stats 查询改走新仓库函数 `listTrackPlaybackStats`
- [x] 队列长度行：playQueue entries 数进面板（F-11 观测，最小 selector `s.queue.length`）
- [x] prod build 采集途径：Settings「Trace 诊断」区新增可见开关 `perfHudEnabled`（默认关，i18n 四语），prod 经 main.tsx 的 `ProdPerfHud` 网关挂载（dev 仍由 App.tsx 挂载，互斥不双挂）
- [ ] 按 §2.3 五个场景在 prod build 采集 before 基线，数字回填本 PRD §10（人工操作，待真机采集）

### Phase 1 Checklist

- [x] 面板新增 blobs / db-requery / queue 三行（preview 验证渲染正常，无 console 错误）
- [x] copy-trace 导出含 db 重查事件（`noteDbRequery` → `traceEvent`，经 `sanitizeDiagnosticData` 脱敏；单测覆盖）
- [x] prod build 经 Settings 开关可见面板；默认关闭时零开销（计数器 enabled 标志 + HUD 卸载时还原 URL 包装，单测覆盖 refcount/还原）
- [ ] 五场景 before 基线已记录（人工，待真机）
- [x] typecheck + 触达区测试通过；无新增 console 直连（硬规则 8）。注：`repositories.test.ts` 有 6 个干净 HEAD 上即失败的 pre-existing 超时（provider-storage 路径），已另开任务跟踪，与本 phase 无关

### Phase 2: 确证泄漏修复（P0）

**Goal:** 流媒体长播内存曲线回落平稳。

**Tasks:**
- [x] F-1：blob transport 不再创建未使用的 object URL——契约改为 `url?`（blob/url 至少其一）贯穿 `YoutubePlayback` → `PlayableStream.mediaUrl?` → `StreamPlaybackResult.url?`；youtube-ytjs 删除 `createObjectURL`；youtube-source 按 `blob` 判定 transport；cache-stream / player-store 加契约守卫
- [x] F-2：`readableStreamToBlob` 导出 + try/finally `reader.cancel()`（错误/早退路径释放网络与队列）+ 200MB 累计字节 cap（超 cap 主动 cancel 底层 source）
- [x] F-12 顺手修：`updateMediaSessionMetadata` 加单调序号，迟到的旧请求只丢弃自己的 URL，不再 revoke 新 artwork
- [x] 单测：fake stream 断言超 cap 时底层 source 被 cancel、错误传播；blob-only resolve 在 source/resolve-playback 两层断言无 url 透传（流自身 error 时 cancel 是 no-op，故 spy 断言放在 cap 路径——比原计划的 createObjectURL spy 更贴近真实行为）

### Phase 2 Checklist

- [ ] 场景 S1：30 首流媒体播放后 blob: URL 计数回基线、GC 后 heap 增幅 < 50MB（人工，待真机用 Phase 1 HUD 验证）
- [ ] 场景 S5：快速切歌 ×50 计数稳定（人工，待真机）
- [x] 既有 streamsrc 测试全绿（215/215）；stores 触达区测试通过（folder-sync 3 个失败为 pre-existing，与 repositories 超时同族、已另开任务）

### Phase 3: 全表查询放大链治理

**Goal:** 写库突发（导入 / DJ 续歌）不再触发 O(N×写入) 级联。

**Tasks:**
- [x] F-3-1：审计完成，**决定不改写侧**——dj-engine 每次 draft 仅 batchSize(~3)+1 次写，全部落进读侧 250ms 合并窗口；folder import 已在 worker 批量写。不动 dj-engine（命脉文件），合批收益已被读侧覆盖
- [x] F-3-2：新建 [`useThrottledValue`](../../../src/hooks/use-throttled-value.ts)（**leading+trailing 节流**而非纯 trailing debounce——持续写入流下纯 debounce 会饿死，测试覆盖该场景）；search-page / global-track-search 的 `allTracks` 经 250ms 合并后再进派生计算，memoryNotes liveQuery 因依赖其 identity 自动随之降频
- [x] F-3-3：`useWorkerTrackSearch` 的快照 push 输入节流——worker 序列化 + 结构化克隆至多每 250ms 一次；查询仍对 live `tracks` 排序，结果不滞后于可见列表
- [x] F-3-4：artist/album 索引构建源包 `useDeferredValue`，合并后的更新先画列表、O(N) 重投影走 transition 优先级
- [x] F-4：`listTrackPlaybackStats` 输出同样 250ms 合并（播放心跳 flush 不再逐次触发整表重扫 + 三层统计重建）；订阅本就限于搜索页挂载期

### Phase 3 Checklist

- [ ] 场景 S2：导入 500 首期间 `listAllTracks` 执行次数较基线下降 ≥10×，longtask max < 200ms（人工，待真机用 HUD `db` 行验证）
- [x] 搜索结果正确性不回归（hooks/search/pages 40 测 + track-search 全绿）
- [x] DJ 续歌 integration test（硬规则 7）全绿（dj 套件 39 测）
- [x] preview 验证：改动后 app 正常启动渲染、HUD `db` 计数行端到端工作、无 console 错误（曾出现一次 HMR hook 顺序报错，整页刷新后消失，确认为热更新中间态而非真实 bug）

### Phase 4: 渲染层 GPU / GC 卫生

**Goal:** 效果切换无资源累积；render loop 每帧主线程成本有预算。

**Tasks:**
- [x] F-5：ReactiveScene cleanup 释放旧 program/attrib buffer/index buffer（`releaseGlState`，context-lost 时跳过；保留不 loseContext 决策——删 program 不杀 context，StrictMode 安全；单测覆盖三种路径）
- [ ] F-6：像素视频背景 ticker 随 `isPlaying` 启停 —— **推迟**：`pixi-pixel-background.tsx` 工作区有并发进行中的改动（dock-idle/背景功能），路径化提交无法安全隔离同文件；待该工作落地后跟进
- [ ] F-7：像素背景复用单 Application —— 同上推迟，与 F-6 同文件
- [x] F-9：实测确认每帧 `getComputedStyle` 仅 reactive-scene 一处（spectrum 渲染器已有 `frame % 6` 节流、playback-spectrum 有 `% 30`）；改为对齐 spectrum 的 6 帧节奏缓存，**不做**全局 `readPrimaryRgb` TTL 缓存——主题切换瞬间读旧值会让 `transitionVisualizerCoverColor("theme-primary", …)` 过渡到过期颜色，引入真 bug
- [x] F-10：bands.ts 增加 `aggregateBandsInto` / `applyTiltInto` / `smoothBandsInto` / `decayBandsInto` 原地变体（纯函数版保留），bars / radial / led-reflex 三个渲染器换用 + 持有复用 scratch 数组——render loop 零分配；对照单测断言与纯函数版逐项一致（含 rebuild 竞态下的长度增长）

### Phase 4 Checklist

- [ ] 场景 S4：效果轮换三轮后 GPU 内存回落、无 context lost（人工，待真机）
- [ ] 场景 S3：1 小时长播 frame p99 < 33ms、无周期性 >100ms 尖刺（人工，待真机）
- [ ] 火焰图确认 render loop 内无 recalc style 片段（人工；代码层 reactive-scene 已降为 1/6 帧）
- [x] bands.ts 既有穷举单测 + 原地版对照测试全绿（visualizer 套件 66 测）
- [ ] F-6/F-7 在 pixi-pixel-background 并发改动合入后跟进（见 Tasks 注）

### Phase 5: 大文件内存防护

**Goal:** 数百 MB 级远程视频不再造成全量内存峰值。

**Tasks:**
- [ ] F-8：统一 content-length 阈值常量；预热（playback-preload）、R2 缓存（r2-cache）、musicgen 下载三处接入
- [ ] 超阈值行为：预热跳过；播放走 `loadUrl` 流式；R2 缓存跳过并在同步指示器中标注「文件过大未离线」
- [ ] F-11：队列长度进诊断观测（上限策略留 Q-3）

### Phase 5 Checklist

- [ ] >500MB 远程视频场景进程内存增幅受控
- [ ] 同步含超大文件的远程集不中断、有用户可见标注（i18n 四语，硬规则 i18n）
- [ ] 既有 sync / preload 测试全绿

---

## 6. Out of Scope

- **OPFS / 流式存储重构**：媒体字节从「整 Blob 进 IndexedDB」迁移到分块/OPFS 是独立大改，本期只做阈值守卫（F-8）。
- **搜索快照增量 diff 协议**：本期防抖即可达标，diff 协议列 v2。
- **DJ 队列上限 / 历史归档策略**：牵涉 set/queue/memory 数据模型语义，归属 [data-model PRD](../20260610-muzero-set-queue-memory-prd/) 后续 phase（见 Q-3）。
- **mediabunny 音轨抽取**（audioOnly 真抽轨）：既有规划，与本审计无关。
- **Electron muzfetch 代理流式行为验证**：初查未发现实证问题（`net.fetch` + `protocol.handle` 按流式设计），深度验证（背压、大文件 PUT）列 Q-1 调研项，不阻塞本 PRD。
- **移动端（Tauri WKWebView）专项画像**：桌面优先（硬规则 9）；WKWebView Blob 落盘行为差异在 F-8 注明，专项测量推后。

---

## 7. Security Considerations

- 所有诊断指标仅写本地 trace 环（内存中 300 条）与左下角面板，**不新增任何遥测上报**（硬规则 1：无后端无云）；copy-trace 是用户主动剪贴板操作。
- trace 管道已有统一脱敏层 [`sanitizeDiagnosticData`](../../../src/lib/diagnostics.ts)（新计数事件自动经过），URL 类字段沿用 streamsrc `sanitizeUrlForTrace` 口径——不得包含 BYOK 密钥、流媒体 cookie、签名参数。
- 不引入 hidden flag：DEV 构建默认挂载面板；prod 构建经 Settings 开发者区**可见开关**启用（硬规则 3 禁止的是 hidden `localStorage`/URL flag，可见 Settings 控件是正路）。

---

## 8. Related Documents

| Document | Description |
|----------|-------------|
| [dev-perf-panel.tsx](../../../src/components/dev/dev-perf-panel.tsx) | 左下角 dev 性能 HUD（fps / frame / jank / heap / copy-trace）——Phase 1 的扩展宿主 |
| [trace.ts](../../../src/lib/trace.ts) / [diagnostics.ts](../../../src/lib/diagnostics.ts) | 内存 trace 环（300 条）+ 脱敏层——新计数器的统一管道 |
| [perf-metrics.ts](../../../src/lib/perf-metrics.ts) | PerfWindow 滚动窗口 / 百分位纯函数（已单测） |
| [prd-create.md §4](../../../.cursor/commands/prd-create.md) | 性能类 PRD 测量方法学要求（本 PRD §2 的依据） |
| [20260610 external streaming sources PRD](../) | F-1/F-2 所在的流媒体源功能来源 |
| [20260611 immersive flow background PRD](../) | F-5/F-9 所在的流光背景实现来源 |
| [data-model set/queue/memory PRD](../) | F-11 队列上限策略的归属文档 |
| [CLAUDE.md 硬规则 6/8](../../../CLAUDE.md) | Zustand selector 纪律 / logger 纪律 |

---

## 9. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| Q-1 | Electron `muzfetch://`（`net.fetch` → `protocol.handle`）对大文件是否全程背压流式？需要在真机用 >1GB 文件实测主进程 RSS | Open | — |
| Q-2 | Pixi 背景能否直接以 MediaEngine 的持久 `<video>` 为纹理源（消除双解码），stage 已 adopt 该元素时 `Texture.from` 采样是否可行 | Open | — |
| Q-3 | DJ 无限续歌的队列上限/归档策略（保留最近 N + 历史落歌单？），需与 set/queue/memory 模型对齐 | Open | — |
| Q-4 | F-8 大文件阈值取值（256MB？）与 WKWebView Blob 行为差异是否要求移动端更低阈值 | Open | — |

---

## 10. Baseline Records（Phase 1 回填）

| 场景 | 指标 | Before | After |
|------|------|--------|-------|
| S1 | blob: URL 计数 / GC 后 heap 增幅 | _待采集_ | — |
| S2 | listAllTracks 重查次数 / longtask max | _待采集_ | — |
| S3 | frame p99 / frame max | _待采集_ | — |
| S4 | GPU 进程内存（切换三轮后） | _待采集_ | — |
| S5 | blob: URL 计数（切歌 ×50） | _待采集_ | — |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-12 | Claude Code | 初稿：全库排查 + 人工核实，13 项发现（1 P0 / 2 High）、6 条误报澄清、5 phase 修复计划 |
| 2026-06-12 | Claude Code | Phase 1 改为对接既有 trace.ts + DevPerfPanel（frame/longtask/heap 已有，只补 blobs/db-requery/queue 三行）；新增 prod 采集的 Settings 可见开关任务 |
