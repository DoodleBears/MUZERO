# PRD: 直播点歌长驻播放内存增长（5 小时 ~2.8GB）排查与治理

**Status:** Draft
**Created:** 2026-07-05
**Author:** Claude Code（全库静态排查 + 3 路 agent 交叉核实 + 人工复核）
**Module:** 全局内存 — 直播点歌(live-requests) / 流媒体播放缓存 / 封面资产 / 可视化取色 / 播放队列长驻

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 0 | 归因先行：真机 5h 直播点歌复现 + heap 三连拍定位「主导保留类」 | ✅ Completed（2026-07-05 E2E：受控 Blob 归属实验坐实 H-1 机制 ③，见 §10） | [Phase 0 Checklist](#phase-0-checklist) |
| 1 | 确证无界缓存治理（L-1~L-8 + M-1，两轮静态排查发现，逐项有界化） | ✅ Completed（L-1~L-6 + L-8 + M-1 已修；L-7 复核发现 main 已有 50 条上限。L-8 在 annotation-commands 分支合入 main 后按 L-2 同型补修） | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | 播放缓存 / autoCacheStreamed 内存画像与上限（H-1，占用主导嫌疑） | 🔄 方向已由 Phase 0 数据修正（见 §4.2 H-1 结论更新）：RAM 主导 = 渲染端 Blob 句柄钉主进程字节（非泄漏、GC 全额可回收）；`playbackCache` 实测为空，落盘走 `mediaBlobs`（electron-file 磁盘文件，无 IDB 内联回退）——「降缓存上限」杠杆失效，改为「确定性释放内存背书 Blob 句柄」设计题 | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | 队列长驻上限（F-11 承接六月审计遗留 Q-3） | ✅ Completed（最小安全治理：active playQueue 只保留最近 200 条已播历史；未来队列与 session.trackIds 不裁剪） | [Phase 3 Checklist](#phase-3-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

用户在**真实使用**里跑 **build Release 版**：开直播 + 观众弹幕点歌（直播点歌，live-requests），连续播放约 **5 小时**后，任务管理器显示 MUZERO 主渲染进程占用 **≈ 2,859.9 MB**（近 3GB），而 GPU 进程只有 **122.7 MB**、若干工具进程各几 MB。用户提问：「是否哪里内存泄漏 / 没有回收」。

**关键取证事实（决定排查方向）：**

> ⚠️ **2026-07-05 截图归因更新（推翻初稿事实 1 的进程判断）**：用户任务管理器截图显示 MUZERO 组 6 个进程——**2,859.9MB 的是无窗口标题的进程（= Electron 主进程）**；带歌名窗口标题的**渲染进程只有 62.4MB**；GPU 122.7MB；其余 utility 各 ≤5MB。→ **2.8GB 在主进程，不在渲染进程**。渲染进程侧的 JS 堆假说（队列元数据、字符串缓存、L-2~L-8）全部确认**非主导**；主导驻留在主进程侧：**blob storage（渲染端每个存活 Blob 句柄的字节都钉在主进程）、IndexedDB 存储层、`muzfetch://` 代理所在的 net 栈**。Q-6 已回答，Phase 0 归因目标改为主进程（见 §2.2）。

1. ~~占用在渲染进程主体~~（**已被截图推翻，见上方更新**）。原判断「不是 GPU 纹理泄漏」仍成立（GPU 仅 122MB）。
2. **场景是「直播点歌 + 连续播放数小时」**——本仓库最典型的长驻形态，也是「每首歌泄漏/未回收一点」会线性累积成 OOM 的场景（承接 [六月内存审计 PRD](../20260612-muzero-memory-perf-audit-prd/20260612-muzero-memory-perf-audit-prd.md) §1.1 的判断）。
3. 当前分支 `feat/annotation-commands-lyrics-memory`——六月审计之后新增了歌词引擎、记忆浮层、直播点歌命令路由等功能，属于**未被六月审计覆盖**的面，是本次排查的重点新增区。

### 1.2 本 PRD 与六月内存审计 PRD 的关系（承接，不重复）

[六月内存审计 PRD（20260612）](../20260612-muzero-memory-perf-audit-prd/20260612-muzero-memory-perf-audit-prd.md) 已做过一轮全库排查并修复：

- **已修且本次复核仍健康**：F-1（YouTube blob 播放 object URL 泄漏）已修——本次三路 agent 复核确认 **YouTube 走 blob 但由 MediaEngine 唯一持有+revoke，NetEase/Bilibili/QQ 返回 URL 不返回 blob，均无 F-1 模式**（§4.4）；object-url-cache 的 LRU（ref-count + 容量 + revoke-on-evict）、trace 环形缓冲（300 条 + prod 仅 warn/error）、通知 store 上限（sticky 20 / transient 5）、playback-preload 大小守卫、perf-counters 全 HUD 门控——本次逐一复核，**仍健康**。
- **观测设施已建但从未真机采集**：六月 Phase 1 已在 [`DevPerfPanel`](../../../src/components/dev/dev-perf-panel.tsx) + [`perf-counters.ts`](../../../src/lib/perf-counters.ts) 建好 blob: URL 存活计数、JS heap、队列长度三行，并有 prod 可见开关 `perfHudEnabled`（[types.ts](../../../src/db/types.ts) AppSettings）。**但六月的 §10 Baseline 全部标「待采集」**——从未在真机长跑里跑过。本 PRD 的 Phase 0 就是补上这一步，并专门针对「直播点歌 5h」场景。
- **本次静态排查的核心结论（见 §1.3）**与六月不同：六月找到一处确证 P0 逐首泄漏（F-1）；**本次没有任何单点能静态解释 2.8GB**——所有确证发现都是 MB 级小无界缓存，主导成本必须靠**归因测量**定位。

### 1.3 核心结论（本次排查）

> ⚠️ **诚实口径**：静态代码排查（3 路 agent + 人工复核，覆盖 playback / streamsrc / live-requests / 可视化 / 歌词记忆 / 通知 / 同步）**未发现任何单点能解释 2.8GB**。经典的 blob-URL 泄漏路径全部复核为健康或已修。因此本 PRD 遵循 [prd-create.md §4](../../../.cursor/commands/prd-create.md)「观测先行，再优化」，把**归因测量列为 Phase 0（P0）**，而不是凭静态推断认定单一根因。

1. **一批确证的无界模块级缓存（L-1~L-6）**：本次新发现 6 处「只增不删」的模块作用域 Map/Set，逐首/逐弹幕/逐封面累积、无 LRU、无 reset。**单项均为 MB 级**（最大的 L-1 保留的是**真实 Blob 字节**、随点歌量增长可达数十 MB），合计上限约几百 MB。它们是确证的「未回收」，Phase 1 逐项有界化。**但它们加起来不足以解释 2.8GB。**
2. **主导占用的最强嫌疑（H-1，需 Phase 0 测量确认）**：**播放缓存默认上限 2 GiB（最高 10 GiB）** + `autoCacheStreamed` 默认开——直播点歌每首都被完整下载并写入 `mediaBlobs`/OPFS/IndexedDB。Chromium 存储层（Blob / IndexedDB）在高频写读下会把字节保留在渲染进程相邻内存里。**这很可能是 2.8GB 的主体，且是「按设计工作」——代码审查看不出是泄漏**，只有 heap snapshot + OPFS/IDB 用量核对能坐实。
3. **长驻无界增长（F-11 承接六月）**：直播点歌 5h 让 `playQueue` / `session.trackIds` 涨到上千条 Track 元数据（每条含 brief/metadata/palette），叠加是数十 MB 级。

---

### 1.4 Target Users

| Role | Description | 受影响场景 |
|------|-------------|-----------|
| **直播主播（主）** | 开直播 + 弹幕点歌，连续跑 5h+ | 渲染进程内存单调上升逼近 3GB，最终卡顿 / OOM 崩溃 |
| **挂机听歌用户** | DJ 续歌 / 歌单循环数小时不关 | 同样命中 H-1 缓存累积 + F-11 队列增长 |
| **在线源重度用户** | 主力点 NetEase / Bilibili 在线歌 | autoCacheStreamed 逐首落盘 + 播放缓存 2GB 上限 |

### 1.5 Core Value

1. **长驻稳定性**：直播点歌 5h 后渲染进程内存曲线**趋于平台期**，不随点歌首数单调逼近 OOM。
2. **可归因**：先补齐「直播点歌 5h」的 before/after 真机基线 + heap 三连拍，**用数据坐实主导保留类**，而不是凭感觉调参（[prd-create.md §4](../../../.cursor/commands/prd-create.md)）。
3. **确证即修**：6 处无界缓存（L-1~L-6）无论主导与否都是真「未回收」，独立有界化即得。

---

## 2. 测量方法学（先于一切优化 —— 本 PRD 的 P0）

> 依据 [prd-create.md §4](../../../.cursor/commands/prd-create.md)：「先把测量方法学写进 PRD，再写优化方案」。**本节直接复用六月 PRD §2 已建好的 [`DevPerfPanel`](../../../src/components/dev/dev-perf-panel.tsx) + trace 管道**（blob: URL 存活计数、JS heap、队列长度三行都已存在），只补「直播点歌 5h」专属复现脚本 + heap 三连拍归因流程——**不新建采样器、不新建日志通道**（硬规则 8）。

### 2.1 指标（大部分六月已建，本 PRD 复用 + 补一行）

| 指标 | 测法 | 状态 | 为什么 |
|------|------|------|--------|
| **JS Heap** | DevPerfPanel 已有：`performance.memory.usedJSHeapSize` 500ms 快照 | ✅ 已有 | 基础内存曲线；但 **Blob 字节不一定计入 JS heap**，需配合下面几项 |
| **blob: URL 存活计数** | DevPerfPanel 已有：DEV/HUD 包装 `createObjectURL/revokeObjectURL` 的 live diff（[perf-counters.ts](../../../src/lib/perf-counters.ts) `installBlobUrlTracker`） | ✅ 已有 | L-1 类 Blob 保留、封面/媒体 URL 未 revoke 的无歧义信号 |
| **队列长度** | DevPerfPanel 已有：playQueue entries 数 | ✅ 已有 | F-11 无界增长可见化 |
| **进程 RSS / Blob 保留树** | DevTools heap snapshot **三连拍**（基线 → 播 30 首后 → 手动 GC 后）；Electron 主进程 `process.memoryUsage()` 三处（main / renderer / gpu）；Chromium `chrome://blob-internals` 交叉验证 blob 存活 | 手动 | **归因主导 2.8GB 的核心手段**（JS heap 行看不见的 Blob/解码字节靠这里定位） |
| **播放缓存实际用量 + 后端** | **新增**：`summarizePlaybackCache()`（[playback-cache.ts:91](../../../src/player/playback-cache.ts)）读 count/bytes + 抽查每条 `storage` 是 `opfs` 还是 `indexeddb`（内联 blob） | 🔲 Phase 0 | 坐实 H-1：缓存逼近 2GB 上限？是否走了内存更差的 IndexedDB 内联回退？ |

### 2.2 测量纪律（承接六月 §2.2）

- **prod build / Release 复测，dev mode 不作数**：所有数字在 `make build` 产物或 `make desktop-build` 安装包下采集（用户报的就是 Release）。dev 的 StrictMode + HMR + sourcemap 污染基线。
- **第二次循环为准**：首轮 warmup 上涨（shader 编译、字典懒加载、JIT）是预期，复测第二轮（[CLAUDE.md 内存问题复现规则] 同规约）。
- **区分「渲染进程 RSS」与「JS heap」**：本案 JS heap 可能只占 2.8GB 的一部分——Blob/解码媒体/IndexedDB 缓存落在 JS heap 之外，必须用 heap snapshot 的 retainer + `blob-internals` + `process.memoryUsage()` 交叉定位，别只看面板 heap 行。
- **✅ 2.8GB 进程归属已坐实（2026-07-05 用户截图）**：2,859.9MB = **主进程**（无窗口标题）；渲染进程（带歌名标题）仅 62.4MB。→ 归因测量的主目标从渲染进程改为**主进程**：主进程侧 `process.memoryUsage()`（heapUsed vs external vs rss）+ `v8.getHeapStatistics()`——若主进程 Node/V8 堆只有几十 MB 而 RSS 2.8GB，则字节在 Chromium 浏览器进程侧分配（blob storage / IDB / 缓存索引），配合渲染端「手动 GC → 看主进程 RSS 回落」实验定性（见 H-1 机制细化 ③）。渲染端 heap snapshot 三连拍降级为辅助（渲染堆本身很小）。
- **回退 = `git revert`**：不为任何优化引入 hidden flag；需要 runtime 开关就建可见 Settings 控件（硬规则 3；六月 F 系列已循此例）。

### 2.3 标准复现脚本（本 PRD 专属，验收用）

| 场景 | 步骤 | 通过标准 |
|------|------|---------|
| **LR-1 直播点歌长跑** | Release build，开启直播点歌 intake（SSN/webhook），脚本灌入 ~30 首/小时的弹幕点歌（含 NetEase 在线源 + 若干视频 MV 点歌），连播 **≥ 1 小时**（等比外推 5h） | 渲染进程 RSS 增幅**收敛**（非线性单调）；blob: URL 计数回落基线 ±（coverUrlCache 24 + coverDerivativeUrlCache 128 容量内）；heap GC 后较基线增幅 < 100MB |
| **LR-2 主导类归因** | LR-1 跑到平台期后，DevTools heap snapshot 三连拍 + `chrome://blob-internals` + `summarizePlaybackCache()` | 明确主导保留类：是①播放缓存/IDB blob ②解码媒体 ③无界缓存(L-*) ④队列(F-11) 中的哪一/哪几类，量化各自占比 |
| **LR-3 无界缓存回归** | 播 200 首不同封面/不同点歌人的歌 | `remoteCoverAssets`/`colorCache`/`seenExternalIds` 等的 size 有界（有 LRU/prune 后 ≤ 各自 cap） |
| **LR-4 缓存上限验证** | 把 `playbackCacheMaxBytes` 调到 1 GiB，重跑 LR-1 | OPFS 用量不超上限；渲染进程 RSS 平台期随缓存上限同步下降（坐实 H-1 相关性） |

---

## 3. System Architecture（受影响面）

```
┌─ 直播点歌链（本分支新增，未被六月审计覆盖）───────────────────────┐
│ SSN/webhook ─▶ live-request-controller.handlePayload             │
│   └▶ audience-request-runtime.handle                             │  L-2: seenExternalIds /
│         seenExternalIds / lastAcceptedByRequester（只增不删）      │      lastAcceptedByRequester
│   └▶ playRequestNow/Next ─▶ player-store 播放                     │
└──────────────────────────────────────────────────────────────────┘
┌─ 流媒体播放缓存链（H-1 主导嫌疑）─────────────────────────────────┐
│ 点歌 URL ─▶ downloadStreamForPlayback ─▶ resp.blob()（3–10MB/首； │
│   视频 MV 数十–数百 MB）                                           │
│   ├▶ MediaEngine.loadBlob（object URL，revoke-before-replace ✓）  │
│   └▶ cacheResolvedStreamBlob ─▶ mediaBlobs / OPFS / IndexedDB     │  H-1: 播放缓存默认 2GiB /
│ autoCacheStreamed 默认开：每首永久落盘                            │      autoCacheStreamed 落盘
│ playback-cache 默认上限 2 GiB（最高 10 GiB）                       │
└──────────────────────────────────────────────────────────────────┘
┌─ 封面 / 取色链 ───────────────────────────────────────────────────┐
│ 远程封面 ─▶ cover-asset.getOrFetchRemoteCoverAsset                │  L-1: remoteCoverAssets
│              remoteCoverAssets（Map 持全量 Blob，永不 evict）      │      （持真实 Blob 字节）
│ 当前封面 ─▶ visualizer-dynamic-color.colorCache（palette 只增）    │  L-3: colorCache
│ 本地封面 ─▶ use-local-cover.localCoverUrlCache（URL 串只增）       │  L-5 / L-6
└──────────────────────────────────────────────────────────────────┘
┌─ 队列长驻链（F-11 承接六月）──────────────────────────────────────┐
│ playQueue.entries / session.trackIds 无上限，5h 点歌涨到上千       │  F-11
└──────────────────────────────────────────────────────────────────┘
```

---

## 4. 发现清单（全部经人工核实 + 3 路 agent 交叉验证）

> 严重度：**P0** = 确证泄漏逐次累积；**High** = 随时长/点歌量线性恶化；**Medium** = 有界或小无界的浪费；**Hypothesis** = 需 Phase 0 测量证实/证伪的主导嫌疑。

### 4.1 问题登记表

| ID | 区域 | 位置 | 严重度 | 状态 |
|----|------|------|--------|------|
| **H-1** | 流媒体播放缓存 | [playback-cache.ts:6-8](../../../src/player/playback-cache.ts)（默认 2GiB/最高 10GiB）+ `autoCacheStreamed` 默认开（[types.ts](../../../src/db/types.ts) `autoCacheStreamed`） | **Hypothesis（主导嫌疑）** | ✅ **已归因（2026-07-05 E2E）**：机制 ③（Blob 句柄钉主进程）受控实验坐实；但 `playbackCache` 实测为空、落盘走 `mediaBlobs` electron-file——「缓存上限」非杠杆，见 §4.2 更新 |
| **L-1** | 远程封面资产 | [cover-asset.ts](../../../src/lib/cover-asset.ts) `remoteCoverAssets` | **High** | ✅ 已修（LRU 64 条 / 24MiB 字节上限，`bounded-cache.ts`；evict 单测） |
| **L-2** | 直播点歌去重/冷却 | [audience-request-runtime.ts](../../../src/live-requests/audience-request-runtime.ts) `seenExternalIds`/`lastAcceptedByRequester` | **Medium** | ✅ 已修（`pruneExpiredTimestamps` 与 rate 窗口同处清扫；单测 + 注入 E2E 回归） |
| **L-3** | 可视化取色 | [visualizer-dynamic-color.tsx](../../../src/components/player/visualizer-dynamic-color.tsx) `colorCache` | **Medium** | ✅ 已修（LRU 128） |
| **L-4** | 记忆瀑布布局 | [memory-masonry.ts](../../../src/lib/memory-masonry.ts) `preparedCache` | **Low-Medium** | ✅ 已修（LRU 512） |
| **L-5** | 本地封面 URL | [use-local-cover.ts](../../../src/hooks/use-local-cover.ts) `localCoverUrlCache` | **Low** | ✅ 已修（LRU 1024） |
| **L-6** | 封面解码登记 | [cover-decode-registry.ts](../../../src/lib/cover-decode-registry.ts) `decodedCoverUrls` | **Low** | ✅ 已修（有界 Set 2048） |
| **F-11** | 队列长驻 | [player-store.ts](../../../src/stores/player-store.ts) playQueue/session.trackIds（承接六月 F-11 / Q-3） | **Low-Medium** | ✅ 已落最小治理：persisted playQueue 深历史裁剪到最近 200 条已播；session/set 历史归档另行设计 |
| **L-7** | 直播点歌请求历史 | [audience-request-runtime.ts](../../../src/live-requests/audience-request-runtime.ts) `items` 数组 | **Medium** | ✅ **复核：main 已有界**（`remember` 已裁到 50 条——PRD 初稿基于 feat 分支旧读；无需改动） |
| **L-8** | 注释限流器 | [live-request-annotation.ts](../../../src/live-requests/live-request-annotation.ts) `createAnnotationLimiter().lastByRater` | **Medium** | ✅ 已修（annotation-commands 分支合入 main 后，`allow()` 内与 `recent` 同处 `pruneExpiredTimestamps` 按 `cooldownMs` 清扫；长驻单测覆盖） |
| **M-1** | 流下载并发积压 | [player-store.ts](../../../src/stores/player-store.ts) `downloadStreamForPlayback` 未接 abort signal | **Low** | ✅ 已修（`beginPlaybackLoading` 的 controller.signal 透传进 fetch；abort 静默降级） |
| **M-2** | 主进程流式写入登记 | [ipc.cjs:26,414](../../../electron/ipc.cjs) `pendingMediaStorageWrites`——renderer 崩溃/不 commit 时文件句柄+临时文件泄漏 | **Low** | 确证边缘（fd/tmp 泄漏，非字节驻留；第三轮主进程排查）——未修，Low 挂账 |

### 4.2 逐项细节与修复方向

#### H-1（Hypothesis / 主导嫌疑）播放缓存 2GiB 默认上限 + autoCacheStreamed 落盘 → 存储层内存保留

直播点歌**每首**（NetEase/Bili/QQ 返回 URL）都在 [player-store.ts:4900-4930](../../../src/stores/player-store.ts) 走 download-before-play：`downloadStreamForPlayback` → `resp.blob()` 把整首拉成 Blob（音频 3–10MB，**视频 MV 数十–数百 MB**），再 `loadBlob`（object URL 会 revoke-before-replace ✓）+ `cacheResolvedStreamBlob` 落盘。`autoCacheStreamed` 默认开（[types.ts](../../../src/db/types.ts)），所以**每首都被永久写入 `mediaBlobs`**；同时自动播放缓存 [`PLAYBACK_CACHE_DEFAULT_BYTES = 2 * GIB`](../../../src/player/playback-cache.ts)（`playbackCacheLimitBytes` 最高允许 10 GiB）。

- **为什么这是主导嫌疑**：代码路径本身健康（blob 该 revoke 的都 revoke、缓存 prune 到字节上限、OPFS 优先），静态审查看不出「泄漏」。但**一个 2GB 上限、被每首点歌持续写读的缓存，本就会让渲染进程相邻内存逼近 GB 级**——Chromium 的 Blob/IndexedDB 存储层在高频写读下把字节保留在进程内。占用**近 2.8GB、GPU 仅 122MB** 的画像与「大容量磁盘/内存混合缓存被打满」高度吻合。
- **需 Phase 0 坐实的三点**：
  1. 缓存实际用量是否逼近上限（`summarizePlaybackCache()` 读 bytes）。
  2. `storeCachedBlob` 是否真的走了 OPFS，还是**回退到 IndexedDB 内联 `blob:` 字段**（[playback-cache.ts:154-170](../../../src/player/playback-cache.ts)——OPFS 不可用时 `storage:"indexeddb"` + `blob: media.blob` 内联，内存表现更差）。
  3. LR-4：把上限调到 1GiB 后渲染进程 RSS 平台期是否同步下降（证相关性）。
- **修复方向（测量证实后）**：① 若确为主导——把 `playbackCacheMaxBytes` 默认值从 2GiB 降到更保守值（如 512MiB–1GiB，可见 Settings 已存在滑块）；② 确保 OPFS 路径生效、避免 IndexedDB 内联回退长期驻留；③ 评估 `autoCacheStreamed` 在直播点歌形态下默认关或加「仅缓存 N 首/仅音频」策略（直播是一次性点播，未必需要永久离线副本）。**均需真机 before/after，不凭推断先改。**

> ✅ **H-1 归因结论（2026-07-05 第四轮 · E2E 实测，dev build + 真实 5731 曲库）：**
>
> 1. **机制 ③ 受控实验坐实（决定性）**：`scripts/perf-blob-pinning-probe.mjs` 在渲染端造 100×8MB Blob → **主进程 working set 精确 +801MB**（渲染进程仅 +286MB 的暂存拷贝）；释放引用 + 渲染端强制 GC → **主进程全额回落 802MB**。⇒ `resp.blob()` 字节确实驻留主进程 blob storage、由渲染端句柄钉住、句柄 GC 后**全额可回收**——**不是泄漏，是惰性 GC**。5h 长跑中渲染端 JS 堆稳定在 ~90MB（V8 无压力 → 几乎不跑 major GC），死句柄无感堆积 → 主进程逼近 BlobMemoryController ~2GB 内存层上限的画像完全吻合。
> 2. **Q-2 证伪（本机）**：`mediaBlobs` 实测分布 = electron-file 3874 条/2.48GB（磁盘文件，不占 RAM）· indexeddb 内联 897 条/仅 52.6MB（全是封面级小块）· opfs 2 条/17MB。**无 GB 级 IDB 内联回退**。
> 3. **`playbackCache` 实测为空（count 0）**——直播点歌/流媒体的 download-before-play 落盘走的是 `cacheStreamedTrackBlob → mediaBlobs`（`autoCacheStreamed` 永久路径，磁盘无字节上限），根本不写 `playbackCache`。⇒ **Phase 2 原方案「降 playbackCacheMaxBytes 默认值」对本场景无效**；磁盘无界增长的治理对象是 `mediaBlobs`（Q-3 的 autoCacheStreamed 策略），RAM 治理对象是**内存背书 Blob 句柄的确定性释放**（如：落盘完成后把 MediaEngine 源换成 OPFS/文件背书的 Blob、尽早断开 `resp.blob()` 引用；不引入 `--expose-gc` 类 hidden flag）。
> 4. **14 次真实切歌（9s 驻留）**：主进程仅 +17.6MB（收敛）；渲染进程在 273→1114MB 间波动并自行回落（解码/下载暂存，GC 正常）。dev build 数字仅作机制归因，不替代 Release 5h 基线（§2.2 纪律仍适用）。
>
> 观测设施新增（复用 perf-control，硬规则 8）：`GET /memory/diag`（有界缓存 size + playbackCache/mediaBlobs 后端分布，[perf-control-bridge.ts](../../../src/dev/perf-control-bridge.ts) `memoryDiag`）；`GET /processes` 增 `mainProcess`（主进程 `process.memoryUsage()`+`v8.getHeapStatistics()`，Node 堆 6MB vs RSS 155MB ⇒ 主进程字节在 Chromium 侧，与 ① 一致）；场景驱动 [scripts/perf-longrun-memory.mjs](../../../scripts/perf-longrun-memory.mjs) + 机制探针 [scripts/perf-blob-pinning-probe.mjs](../../../scripts/perf-blob-pinning-probe.mjs)。

**H-1 机制细化（第二轮排查补充，2026-07-05）：**

1. **IDB 内联回退有两处独立站点**（Q-2 的具体化）：[playback-cache.ts:78](../../../src/player/playback-cache.ts)（`storeCachedBlob` OPFS 失败 → `entry.blob = media.blob` 内联进 `playbackCache` 行）与 [media-blob-storage.ts:103,138](../../../src/db/media-blob-storage.ts)（provider 为 indexeddb 或 OPFS put 失败 → `row.blob = input.blob` 内联进 `mediaBlobs` 行）。若真机 OPFS 不可用/间歇失败，直播点歌每首 3–10MB（视频数十–数百 MB）都内联进 IndexedDB——**单此一项即可达 GB 级**。Phase 0 必须分别抽查两张表的 `storage` 后端分布。
2. **同一首歌可能被双重缓存**：播放路径走 `playbackCache`（2GiB prune），`autoCacheStreamed` 又写 `mediaBlobs`（永久、无字节上限）——同字节两份落盘，IDB 内联时是两份堆内驻留。
3. **进程归属已坐实（2026-07-05 截图）**：2.86GB 是**主进程**，渲染进程仅 62.4MB → H-1 的机制精确化为「**渲染端 Blob 句柄惰性 GC + 字节钉在主进程 blob storage**」：`resp.blob()` / IDB 读出的每个 Blob 在渲染堆里只是几十字节的句柄，V8 感受不到内存压力就不触发 GC，而句柄背后的 MB 级字节全在主进程 blob storage（BlobMemoryController，内存层上限约 2GB，超过才分页到磁盘）里等句柄死亡——5h 数百首 `resp.blob()` 的字节就这样在主进程无感累积。**这解释了为什么渲染进程看起来完全健康**。廉价决定性实验：渲染进程 DevTools 手动「Collect garbage」，看主进程 RSS 是否应声大幅回落（回落 = 惰性 GC 句柄钉字节坐实；不回落 = 存储层/IDB 侧驻留，查 Q-2 内联回退）。
4. **每次写入全表物化**：`putRemotePlaybackCache` 末尾的 [`prunePlaybackCache`](../../../src/player/playback-cache.ts) 与 `summarizePlaybackCache` 都 `toArray()` 全表——若存在 IDB 内联 blob 行，每次点歌落缓存都会把全部内联 Blob 句柄重新物化一遍（GC 可回收，但高频写读下抬高水位）。
5. **prune 数学本身已复核正确**（按 `lastAccessedAt` LRU 裁到字节上限，无累积 bug）；下载在**播放时**触发而非点歌入队时，pending 队列不持 Blob——「队列囤 Blob」假说已排除。

#### L-1（High）远程封面资产缓存 `remoteCoverAssets` 持全量 Blob、永不淘汰

[cover-asset.ts:13](../../../src/lib/cover-asset.ts) `const remoteCoverAssets = new Map<string, RemoteCoverAsset>()`，每个 `RemoteCoverAsset` **持有整张封面的 Blob**（`blob: Blob`）。[:60](../../../src/lib/cover-asset.ts) 每拉一张远程封面就 `set` 进去，**只有测试用的 `clearRemoteCoverAssetCacheForTests()` 会清**——生产永不 evict、无 LRU、无容量上限。直播点歌的在线歌**全是远程封面**（`remoteCoverUrl`），由 [use-media.ts:441](../../../src/hooks/use-media.ts) `getOrFetchRemoteCoverAsset` 触发。

- **为什么值得单列**：这是本次**唯一持真实 Blob 字节**的无界缓存（其余 L-* 只存字符串/小对象），随点歌量线性增长——封面 20–200KB/张，5h 数百首独立封面 = 数十 MB 常驻渲染堆。而且它**绕开了六月专门为封面 Blob 建的有界 [`ObjectUrlCache`](../../../src/lib/object-url-cache.ts)**（那个有 ref-count + LRU + revoke-on-evict），是同类问题的漏网缓存。
- **修复方向**：改造成有容量/字节上限的 LRU（复用/对齐 `ObjectUrlCache` 的策略），或干脆让远程封面也走 `coverUrlCache` 的生命周期，去掉这个平行的全量 Blob 缓存。加 `peek/evict` 单测。

#### L-2（Medium）直播点歌去重/冷却 Map 只增不删

[audience-request-runtime.ts:150-151](../../../src/live-requests/audience-request-runtime.ts) `seenExternalIds`（弹幕消息 id→时间戳，去重用）、`lastAcceptedByRequester`（点歌人→时间戳，冷却用）在 [:202-203](../../../src/live-requests/audience-request-runtime.ts) 每条被接受的请求 `set` 一次、**永不删除**。虽然去重/冷却判定只看 `dedupeWindowMs`（默认 30s）/`cooldownMs`（默认 10s）窗口，但 Map 把**全场历史 key 都留着**。`recentAcceptedAt`（速率限制）已在 [:197](../../../src/live-requests/audience-request-runtime.ts) 按 60s 窗口 filter ✓，同一处却漏了这两个 Map。

- **量级**：受 `maxRequestsPerMinute`（默认 30/min）限，5h 上限 ~9000 条 × ~100B < 1MB；但**开着不关会跨天无界增长**，且是直播主播（长驻数天）最典型形态。
- **修复方向**：在 [:197](../../../src/live-requests/audience-request-runtime.ts) 同处，对两个 Map 做同样的过期清理（`now - ts > max(dedupeWindowMs, cooldownMs)` 即 delete），或改用带 TTL 的结构。纯逻辑，穷举单测（对齐既有 `audience-request-security.test.ts`）。

#### L-3（Medium）可视化取色 `colorCache` 无界

[visualizer-dynamic-color.tsx:27](../../../src/components/player/visualizer-dynamic-color.tsx) `const colorCache = new Map<string, { rgb; palette }>()`，按封面源 key 缓存提取出的调色板，只 `set` 从不淘汰。每条 palette 是几个 RGB 元组（小），但逐首独立封面累积、无 LRU、无 reset。~5MB/数千首。

- **修复方向**：容量上限 LRU（如最近 64–128 条），或跟随封面切换淘汰。

#### L-4（Low-Medium）记忆瀑布布局 `preparedCache` 无界

[memory-masonry.ts:8](../../../src/lib/memory-masonry.ts) 模块级 `Map<string, PreparedText>`，按 `(font, text)` 缓存文本测量布局，每条可达 KB 级，无淘汰。直播点歌「评论→记忆」会产生大量不同文本，命中率低时累积。

- **修复方向**：LRU 上限（如 1000 条）或随记忆面板卸载 reset。

#### L-5 / L-6（Low）封面 URL 串缓存无界（小）

- [use-local-cover.ts:13](../../../src/hooks/use-local-cover.ts) `localCoverUrlCache`：`storageKey → muzfetch://` URL 串，每张本地封面一条，无淘汰。
- [cover-decode-registry.ts:14](../../../src/lib/cover-decode-registry.ts) `decodedCoverUrls`：已解码封面 URL 的 `Set<string>`，只增，只有测试 reset。
- 均为字符串（~50–300B/条），随库/会话增长。**修复方向**：加 LRU 上限或暴露非测试 reset，会话边界清理。

#### F-11（Low-Medium，承接六月）DJ/点歌队列无界增长

六月已登记（六月 F-11 / Q-3 留作 data-model PRD 后续）。直播点歌 5h 让 `playQueue.entries` / `session.trackIds` 涨到上千条 Track 元数据（每条含 brief/mediaMetadata/coverPalette，几 KB 级），store 内 `queue` 数组每次点歌/续歌全量重建。**注意**：歌词/记忆**不在** Track 行（各自独立表），所以单条 Track 未因新功能变大——本项仍是「数十 MB 级元数据」而非 GB 级。

- **修复方向**：承接六月 Q-3——保留最近 N（如 500）+ 历史归档策略；牵涉 set/queue/memory 数据模型语义，Phase 3 落地或再拆独立 PRD。

#### L-7（Medium，第二轮新发现）直播点歌请求历史 `items` 数组无界

[audience-request-runtime.ts:149](../../../src/live-requests/audience-request-runtime.ts) `const items: AudienceRequestRuntimeItem[] = []` 在 `createAudienceRequestRuntime` 闭包里，由 [live-request-controller.ts](../../../src/live-requests/live-request-controller.ts) 模块级 singleton 持有；每条点歌请求（含 ignored/failed）都 push、永不删除，`stop()` 只清 transport 订阅不清数组。5h ~9000 条 × ~500B ≈ 4.5MB，跨天直播无界。

- **修复方向**：加保留上限（如最近 500 条）或 `stop()`/会话边界 reset；与 L-2 同模块一起治理。

#### L-8（Medium，第二轮新发现）注释限流器 `lastByRater` Map 只增不删

[live-request-annotation.ts:118-129](../../../src/live-requests/live-request-annotation.ts) `createAnnotationLimiter()` 的 `lastByRater` Map 每个点评人记一条时间戳、永不过期清理；同函数里 `recent` 数组有 60s 窗口 filter ✓，唯独漏了这个 Map——与 L-2 完全同型。量级小（数千观众 × ~100B），但确证无界。

- **修复方向**：在 `allow()` 里按 `cooldownMs` 窗口同步清过期 key，对齐 `recent` 的清理；补长驻单测。

#### M-1（Low，第二轮新发现）流下载未接 abort signal → 快速切歌并发积压

[player-store.ts:4908](../../../src/stores/player-store.ts) `downloadStreamForPlayback` 调用未传 `playbackLoadAbort` 的 signal——用户快速连续点歌/跳歌时，被放弃那首的 fetch + `resp.blob()` 仍会跑完（下载完成后仅 fire-and-forget 落缓存）。瞬态 2-3 首并发 × 3-10MB（视频更大）≈ 30-60MB 积压，**非泄漏**（完成即释放），但白耗带宽/内存。

- **修复方向**：把 `beginPlaybackLoading` 的 AbortController signal 传进 `downloadStreamForPlayback`，abort 时中止 body 读取。

### 4.3 已复核健康（本次三路 agent + 人工，避免重复排查）

| 复核项 | 结论 |
|--------|------|
| **流媒体 provider blob 泄漏（F-1 模式在其他源）** | **健康**。YouTube 返回 blob 但由 MediaEngine 唯一持有 + revoke；NetEase/Bili/QQ **只返回 URL 不返回 blob**（[netease/bili/qq-source.ts]），download-before-play 的 blob 在 player-store 侧由 loadBlob revoke + 落盘，消费侧无残留 |
| **MediaEngine object URL** | 健康。`loadBlob`/`loadUrl` revoke-before-replace，`loadUrl` 收养传入 blob: URL 统一管理（[media-engine.ts:164-180,387-392](../../../src/player/media-engine.ts)） |
| **object-url-cache（封面/派生）** | 健康。ref-count + 容量（24/128）+ maxBytes + LRU + revoke-on-evict + revoke-before-replace（[object-url-cache.ts](../../../src/lib/object-url-cache.ts)） |
| **Pixi 背景 / WebGL 场景** | 健康。纹理 swap 销毁旧纹理、`disposeMedia`/`unload` 关 ImageBitmap、`teardownApp` 显式释放 Pixi v8 泄漏的 WebGPU device、window 环有界、GL program cleanup（六月 F-5~F-7 已治理；且 GPU 进程仅 122MB 佐证非纹理泄漏） |
| **trace 环 / 通知 / perf-counters** | 健康。trace 环形 300 条（prod 仅 warn/error）；通知 sticky 20 + transient 5 上限、timer 清理、`errorNotificationPersist` 默认关（12s 自动消失）；perf-counters 全 HUD 门控、按 span 名有界 |
| **playback-preload** | 健康。`remoteMediaWarmups` 持 Promise 非 blob、`.finally` 删除；blob 落盘 + F-8 大小守卫；只 warm R2/云享，不 warm 流媒体点歌 |
| **cache-stream / streamed-track-repo / social-stream-relay** | 健康。blob 即写即落盘无内存驻留；SSN WebSocket stop 时清理、指数退避有上限 |
| **immersive-memory / track-memory-notes / voice-tts / 记忆照片** | 健康。object URL 均在 unmount/依赖变更时 revoke；`immersive-memory-schedule` 数组按 seek 剪枝 |
| **listen session / R2 presence / auto-enrich** | 健康。listen flush 有界；presence 无状态；enrich `inflight` Set 在 finally 删除 |
| **player-store 模块级 Set** | 健康。`deferredSetAppendIdsBySession`/`localCoverFetchInFlight`/`queuedNcmHydrationTrackIds`/`streamSkipRunTrackIds` 均在流程末尾清理/重置 |

**第二轮排查追加复核健康（2026-07-05 二次深挖）：**

| 复核项 | 结论 |
|--------|------|
| **点歌入队是否囤 Blob** | 健康。下载在 `loadPlayIndex` 播放时才触发（[player-store.ts:4908](../../../src/stores/player-store.ts)），pending 队列/Track 行均不持 Blob 字段，「队列囤 Blob」GB 级假说排除 |
| **本分支命令路由 / 评分链** | 健康。[intake-command.ts](../../../src/live-requests/intake-command.ts) 纯解析无状态；`Track.ratingsByRater` 有 `RATING_RATER_CAP=500` 上限（[repositories.ts](../../../src/db/repositories.ts)）；[track-rating-chip.tsx](../../../src/components/player/track-rating-chip.tsx) `useLiveQuery` 依赖项清晰自动退订；通知层不持 track/blob 引用 |
| **逐帧累积（rAF）** | 健康。全部 rAF 站点核查（visualizer/spectrum/scrubber/lyrics/store），无 per-frame push 无界数组（60fps×5h≈100 万帧的经典泄漏形态不存在） |
| **perf 采样器 / trace 环** | 健康。[performance-trace-sampler.ts](../../../src/lib/performance-trace-sampler.ts) 仅 HUD/dev 门控启动、`PerfWindow` 环形有界、stop 时 cancel rAF/interval/observer；trace 环 300 条 |
| **playback-preload warmup abort 路径** | 基本健康。`.finally` 删 Promise；abort/落盘失败时 blob 交给 GC（无长驻引用），仅一次性几 MB |
| **prunePlaybackCache 数学** | 健康。按 `lastAccessedAt` LRU 裁到 maxBytes，无字节统计漂移 |

**第三轮排查：主进程（electron/）全量复核（2026-07-05，截图坐实 2.8GB 在主进程后新增）：**

| 复核项 | 结论 |
|--------|------|
| **muzfetch 代理（[fetch-proxy.cjs](../../../electron/fetch-proxy.cjs)）** | 健康。`res.body` 全程流式透传不缓冲（含大媒体/SSE）；错误路径返回小 Response；本地媒体走 `fs.createReadStream` 流式 |
| **主进程诊断（[diagnostics.cjs](../../../electron/diagnostics.cjs)）** | 健康。环形 100 条上限，订阅者随窗口 closed 退订 |
| **直播点歌 intake（[live-request-intake.cjs](../../../electron/live-request-intake.cjs)）** | 健康。HTTP body 上限 256KB、消息即转发不留存、stop 关 server |
| **fs IPC（[ipc.cjs](../../../electron/ipc.cjs)）** | 基本健康。allowlist Set 随授权增长（有限）；`pendingMediaStorageWrites` 只存句柄/计数不存字节，commit/abort 均删——唯一边缘登记为 M-2 |
| **主进程 JS 侧整体** | 无 GB 级候选 ⇒ 主进程 2.8GB 更指向 Chromium 浏览器进程侧分配：**blob storage（被渲染端存活句柄钉住）/ IndexedDB 存储层 / 缓存索引**，与 H-1 机制细化 ③ 一致 |

---

## 5. Implementation Plan

> Phase 顺序依据 [prd-create.md §4](../../../.cursor/commands/prd-create.md)「观测先行，再优化」。**Phase 0（归因测量）是 P0**——因为静态排查证明 L-* 小缓存加起来不足 2.8GB，主导保留类只能靠真机 heap snapshot 定位，不先测就改会「改了无法验证 / 改错地方」。L-* 的有界化（Phase 1）低风险、可与 Phase 0 并行独立 ship。

### Phase 0: 归因先行 —— 真机直播点歌 5h + heap 三连拍

**Goal:** 用数据坐实 2.8GB 的主导保留类（H-1 缓存/IDB · 解码媒体 · L-* 无界缓存 · F-11 队列 中的哪几类、各占比多少），产出 before 基线。

**Tasks:**
- [x] ~~进程归因第一步~~ **已由用户任务管理器截图坐实：2.86GB 在主进程，渲染进程仅 62.4MB**（2026-07-05，Q-6 已答）
- [x] **主进程内部归因**：`GET /processes` 新增 `mainProcess`（`process.memoryUsage()`+`v8.getHeapStatistics()`，[perf-control.cjs](../../../electron/perf-control.cjs)）——实测 Node 堆 ~6MB vs RSS 155MB+ ⇒ 字节在 Chromium 侧 ✓
- [x] **惰性 GC 定性实验**：升级为受控归属实验 [perf-blob-pinning-probe.mjs](../../../scripts/perf-blob-pinning-probe.mjs)——渲染端 800MB Blob → 主进程 +801MB、释放+GC 全额回落 802MB ⇒ **钉字节机制坐实、非泄漏**
- [x] 缓存用量+后端观测：`GET /memory/diag`（[perf-control-bridge.ts](../../../src/dev/perf-control-bridge.ts) `memoryDiag`：有界缓存 size + `playbackCache`/`mediaBlobs` storage 分布；两处内联站点均覆盖）。DevPerfPanel 行未加（控制端点已满足归因；面板行留给需要肉眼盯的场景）
- [x] 切歌长跑（dev build，14 切 × 9s，真实 download-before-play）曲线采集——主进程 +17.6MB 收敛（Release ≥1h 长跑留作发版前复核，机制结论不依赖它）
- [x] ~~heap 三连拍~~ 受控实验已给出无歧义归因（三连拍不再必要）
- [x] ~~LR-4 调 playbackCacheMaxBytes~~ **Moot**：`playbackCache` 实测为空，流媒体走 `mediaBlobs` 永久路径（Q-4）
- [x] 数字回填 §10 Baseline；Phase 2 方向据此改写（缓存上限 → 句柄生命周期 + mediaBlobs 磁盘策略）

### Phase 0 Checklist

- [x] 缓存用量+后端可观测（`/memory/diag`），无 console 直连
- [x] 长跑曲线 + 受控归属实验结论记录在 §10
- [x] H-1 已归因：机制 ③ 证实、「缓存上限」杠杆证伪；Phase 2 动作已据此改写
- [x] 无新增 console 直连、无 hidden flag（硬规则 3/8；诊断全走 dev-only perf-control）

### Phase 1: 确证无界缓存有界化（L-1~L-8 + M-1，可与 Phase 0 并行）

**Goal:** 8 处「只增不删」缓存全部有界（LRU/TTL/reset）+ 下载 abort 接线，LR-3 回归通过。

**Tasks:**
- [x] **L-1**：`remoteCoverAssets` 改有界 LRU（新 [bounded-cache.ts](../../../src/lib/bounded-cache.ts)：64 条 + 24MiB 字节上限；evict 后下次 lookup 走 force-cache 重取）；evict 单测 ✓
- [x] **L-2**：`pruneExpiredTimestamps`（[audience-request-security.ts](../../../src/live-requests/audience-request-security.ts)）在 rate 窗口 filter 同处清扫两 Map；穷举单测（含边界一致性）✓
- [x] **L-3**：`colorCache` LRU 128 ✓
- [x] **L-4**：`preparedCache` LRU 512 ✓
- [x] **L-5/L-6**：`localCoverUrlCache` LRU 1024 / `decodedCoverUrls` 有界 Set 2048（recency 刷新）✓
- [x] **L-7**：复核 main 已有 `remember` 50 条裁剪——无需改动（初稿基于 feat 分支）
- [x] **L-8**：annotation-commands 合入 main 后补修——`allow()` 与 `recent` 同处 `pruneExpiredTimestamps(lastByRater, now, cooldownMs)`；长驻单测（500 个独立 rater 决策不变 + 冷却语义保持）✓
- [x] **M-1**：`downloadStreamForPlayback` 接 `beginPlaybackLoading` 的 controller.signal；abort 走 debug 静默降级（非 warn）✓
- [x] 硬规则 6：所有有界缓存保持模块作用域，不进 store state ✓

### Phase 1 Checklist

- [x] LR-3（缩样）：14 次真实切歌后各缓存 size ≤ cap（`/memory/diag` 实测：15/64、20/128、3/1024）；eviction 行为由 `bounded-cache.test.ts` + `cover-asset.test.ts` 穷举
- [x] typecheck（tsc 0 错）+ biome（触达文件 0 错；仓库残留错误在干净 main 同样存在，非本次引入）+ 全量 vitest 3693 通过
- [x] E2E 回归：直播点歌注入 3/3 completed（含重复 query 命中同曲）；切歌/封面/取色在长跑场景无异常

### Phase 2: 切歌内存高水位归因与确定性释放（H-1，依赖 Phase 0/§10.1 结论）

**Goal:** 把“每切一首歌任务管理器看起来线性涨”的用户感知拆成可重复 harness 场景，区分本地已落盘播放、在线 download-before-play、视频 MV 解码三条路径；若 prod+CDP 证明 pause/GC 后仍不回平台期，再修媒体元素 / Blob URL / decode surface 生命周期。

**Tasks:**
- [x] **TDD harness endpoint**：`GET /playback/candidates`（dev-only perf-control）只返回 active queue 中 `status="ready"` 且有 `blobId` 或 `sourcePath` 的本地可播放 index；不返回本地路径、URL、标题等用户内容。单测覆盖 route + handler 过滤语义。
- [x] **Harness 分场景开关**：[`scripts/perf-longrun-memory.mjs`](../../../scripts/perf-longrun-memory.mjs) 增加 `--local-only`，用 `/playback/candidates` 驱动纯本地切歌；`--play-timeout` 避免在线下载卡死整轮。
- [ ] **Prod/CDP local-only 验收**：`pnpm electron:profile` 后跑 `node scripts/perf-longrun-memory.mjs --local-only --switches 20 --dwell 3000`，采 renderer/GPU/main 高水位、pause+20s、renderer `HeapProfiler.collectGarbage` 后回落幅度。
- [ ] **分路径对照**：再分别跑在线 download-before-play（默认 stride）与视频 MV-only 队列，建立三条曲线，避免把网络下载暂存、音频解码、视频 decode surface 混为一谈。
- [ ] 若 prod local-only 的 pause+GC 仍不能回到平台期：检查并修复 `MediaEngine` 的 source detach/load/revoke 顺序、封面/video decode surface、可视化 WebGL texture 生命周期；修复后用同一 harness 复测。
- [ ] `autoCacheStreamed` / `mediaBlobs` 磁盘策略另开决策：当前 RAM 主导已证伪 `playbackCacheMaxBytes` 杠杆，磁盘长期增长（每首永久落盘）不是本轮“任务管理器内存线性涨”的直接修复项。

### Phase 2 Checklist

- [x] TDD：`pnpm vitest run src/dev/perf-control.test.ts` 通过（23 tests，覆盖 `playbackCandidates` route/handler）
- [x] Harness 脚本语法：`node --check scripts/perf-longrun-memory.mjs` 通过
- [ ] Live smoke：需要当前 Electron dev / profile 控制端点可达；本轮后台重启后 7345 未监听，未把 smoke 伪装成通过
- [ ] Prod/CDP local-only 曲线显示 pause+20s 或 GC 后回平台期；否则进入媒体释放修复
- [ ] 若修复代码：对应单元/集成测试 + local-only harness before/after 数据入 §10

### Phase 3: 队列长驻上限（F-11，承接六月 Q-3）

**Goal:** playQueue/session.trackIds 不再无界；直播点歌数天不涨到上千条元数据。

**Tasks:**
- [x] **最小安全上限**：`playQueueSetIndex` 持久化 cursor 时裁剪 active playQueue 的深历史，只保留当前曲目前最近 200 条已播 entries；当前曲目与未来队列完整保留，`session.trackIds` / set membership 不裁剪。
- [x] **纯函数 TDD**：新增 `trimPastEntries`，覆盖保留当前曲目、未来条目、idle/no-op 分支。
- [x] **repo 集成 TDD**：`playQueueSetIndex` 从 index 250 前进时裁掉 `trk_0..trk_49`，当前曲目仍为 `trk_250`，currentIndex 重映射到 200，未来 9 条保留。
- [ ] **完整历史归档**：把已播历史归档到歌单/播放历史视图牵涉 set/queue/memory 语义，拆到后续 data-model PRD；本轮不做隐式删除用户歌单历史。

### Phase 3 Checklist

- [x] Active playQueue 已播历史收敛到 200 条上限；未来队列不被裁剪
- [x] `pnpm vitest run src/player/play-queue.test.ts src/db/play-queue-repo.test.ts` 通过（56 tests）
- [x] `pnpm typecheck` 通过
- [ ] Prod/CDP 长跑曲线仍待 Phase 2 live harness 复测；本轮未再启动 Electron，避免多开

---

## 6. Out of Scope

- **OPFS / 流式存储重构**（媒体字节分块流式写入）：六月已列 out of scope，本 PRD 只做缓存上限 + 后端核对，不做分块重构。
- **移动端（Tauri WKWebView）内存画像**：桌面优先（硬规则 9）；用户报的是桌面 Release，移动端 Blob 落盘差异专项推后。
- **队列历史归档到歌单的完整数据模型**：Phase 3 只落最小软上限，完整「队列 vs 歌单 vs 记忆」归档语义归 data-model 后续 PRD。
- **凭静态推断直接改缓存默认值**：明确不做——Phase 2 任何默认值改动都必须有 Phase 0 真机 before/after 支撑。

---

## 7. Security Considerations

- 所有新增诊断（缓存用量行、heap 三连拍）仅本地面板 / DevTools，**不新增任何遥测上报**（硬规则 1：无后端无云）。
- 缓存用量统计不含任何用户内容 / URL 明文——只报 count/bytes/storage 后端枚举。
- L-2 直播点歌 Map 清理不改变去重/冷却语义（窗口判定不变，只删过期 key），不影响安全（防刷）行为。
- 不引入 hidden flag：缓存上限 / autoCacheStreamed 策略都走已存在或新增的**可见 Settings 控件**（硬规则 3）。

---

## 8. Related Documents

| Document | Description |
|----------|-------------|
| [20260612 memory-perf-audit PRD](../20260612-muzero-memory-perf-audit-prd/20260612-muzero-memory-perf-audit-prd.md) | 六月全库内存审计（F-1~F-13 / F-L1~L5）——本 PRD 承接其观测设施与 F-11/Q-3 遗留，复核其修复仍健康 |
| [DevPerfPanel](../../../src/components/dev/dev-perf-panel.tsx) / [perf-counters.ts](../../../src/lib/perf-counters.ts) | 已建的性能 HUD（blob 计数 / heap / 队列长度）——Phase 0 复用宿主 |
| [playback-cache.ts](../../../src/player/playback-cache.ts) | H-1 播放缓存（默认 2GiB / OPFS-IDB 后端） |
| [cover-asset.ts](../../../src/lib/cover-asset.ts) / [object-url-cache.ts](../../../src/lib/object-url-cache.ts) | L-1 无界封面 Blob 缓存 vs 已有界的封面 URL 缓存 |
| [audience-request-runtime.ts](../../../src/live-requests/audience-request-runtime.ts) | L-2 直播点歌去重/冷却 Map |
| [20260704 annotation-commands-lyrics-memory PRD](../20260704-muzero-annotation-commands-lyrics-memory-prd/20260704-muzero-annotation-commands-lyrics-memory-prd.md) | 当前分支功能来源（直播点歌命令路由 / 记忆 / 歌词） |
| [prd-create.md §4](../../../.cursor/commands/prd-create.md) | 性能/内存类 PRD 测量方法学要求（本 PRD §2 依据） |

---

## 9. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| Q-1 | 2.8GB 的主导保留类到底是①播放缓存/IDB blob ②解码媒体 ③L-* 无界缓存 ④队列 中的哪一/哪几类？ | **✅ Answered** | **渲染端存活 Blob 句柄钉住的主进程 blob storage 字节**（受控实验：800MB Blob → 主进程精确 +801MB、GC 后全额回落）。L-*/队列均为 MB 级非主导（与静态判断一致） |
| Q-2 | `storeCachedBlob` 在用户真机是否走 OPFS，还是回退到 IndexedDB 内联 blob（内存表现更差）？ | **✅ Answered（本机）** | 无 GB 级内联回退：`mediaBlobs` = electron-file 2.48GB（磁盘）/ IDB 内联仅 52.6MB（封面小块）；且 `playbackCache` 实测为空——流媒体落盘走 `mediaBlobs` 永久路径，不经 `playbackCache` |
| Q-3 | 直播点歌形态下 `autoCacheStreamed` 是否该默认关 / 仅音频 / 仅最近 N 首（一次性点播未必需要永久离线副本）？ | Open（升级为 Phase 2 主题） | `mediaBlobs` 磁盘无字节上限，每首点歌永久 +3–10MB（视频更大）；治理它而非 playbackCacheMaxBytes |
| Q-4 | 播放缓存默认 2GiB 是否对「桌面长驻直播」偏高？降到 512MiB–1GiB 的体验代价？ | **✅ Moot** | `playbackCache` 在本场景为空——上限调整不是杠杆（LR-4 无需再跑） |
| Q-5 | F-11 队列上限的 N 取值与历史归档语义（承接六月 Q-3） | Open | Phase 3 / data-model PRD |
| Q-6 | 任务管理器里 2.86GB 的进程是 Electron main 还是 renderer？（Blob 存储层驻留在 main 侧——归属直接决定 H-1 的解释方向） | **✅ Answered** | **主进程**（2026-07-05 用户截图：无标题进程 2,859.9MB；带歌名标题的渲染进程仅 62.4MB）。H-1 机制精确化为「渲染端 Blob 句柄惰性 GC 钉住主进程 blob storage 字节」，见 H-1 机制细化 ③ |
| Q-7 | 主进程 2.8GB 里 blob storage / IndexedDB 存储层 / net 栈各占多少？渲染端强制 GC 能回落多少？ | **✅ Answered** | blob storage 是主体且**全额可回落**（受控实验 802/801MB）；主进程 Node 堆仅 ~6MB、IDB 内联仅 ~53MB。⇒ 2.8GB ≈ 死 Blob 句柄背后的字节，本质是「等一次 major GC」 |
| Q-8 | 渲染端 major GC 为何 5h 不跑？（新） | Answered（机制层面） | 渲染端 JS 堆稳定 ~90MB、V8 无堆压力 → major GC 稀少；Blob 句柄在 V8 眼里只有几十字节。Phase 2 解法应是「减少内存背书句柄的存活时间」而非「催 GC」（不引入 `--expose-gc` hidden flag） |

---

## 10. Baseline Records（Phase 0 回填）

> 2026-07-05 E2E 采集环境：dev build（Electron 42 + vite dev，localhost origin = 真实 5731 曲库），`scripts/perf-longrun-memory.mjs`（14 次切歌 × 9s 驻留，含真实 download-before-play）+ `scripts/perf-blob-pinning-probe.mjs`（受控归属实验）。机制归因成立；绝对值以后续 Release 长跑复核为准（§2.2）。

| 场景 | 指标 | Before（2026-07-05 实测） | After |
|------|------|--------|-------|
| 切歌长跑 | 主进程 working set（14 切歌） | 155.8 → 173.4MB（**+17.6MB，收敛**；主进程 Node 堆恒 ~6–9MB ⇒ 字节在 Chromium 侧） | — |
| 切歌长跑 | 渲染进程 working set | 273→1114MB 波动后自行回落至 ~450MB（解码/下载暂存，GC 正常，非泄漏） | — |
| **机制归因** | 渲染端 100×8MB Blob → 主进程增量 / GC 后回落 | **+801.3MB / 回落 802.1MB（全额）** ⇒ Q-1/Q-7 坐实：主导 = Blob 句柄钉主进程字节，非泄漏 | — |
| LR-2 | 播放缓存 bytes / storage 后端分布 | `playbackCache` = **0 条 0 字节**；`mediaBlobs` = electron-file 3874/2.48GB · IDB 内联 897/52.6MB · OPFS 2/17MB（无 GB 级内联回退） | — |
| LR-3 | 有界缓存 size（14 切歌后，`GET /memory/diag`） | remoteCoverAssets **15/64**（15.3MB/24MiB cap）· colorCache **20/128** · localCoverUrls 3/1024 —— 全部 ≤ cap；evict 行为另有单测穷举 | ✅（本身即 After：有界化已生效） |
| LR-4 | 缓存上限 1GiB 时 RSS 平台期 | **Moot**——playbackCache 为空，上限不是杠杆（Q-4） | — |
| 回归 | 直播点歌注入（append-queue ×3，含重复 query） | 全部 `completed` 且命中正确曲目；L-2 清扫不改变路由/去重语义 | ✅ |

### 10.1 Local Electron Dev Harness Loop（2026-07-05 用户截图后补测）

> 目的：复查用户在 Windows 任务管理器中观察到的「每切一首歌 Electron 内存线性增长」是否是永久泄漏，还是 Chromium 媒体/解码/Blob 工作集的惰性释放。环境为**当前本地 Electron dev**（`MUZERO_PERF_CONTROL=1`，控制端点 `.logs/perf-control.json`，未开启 CDP remote-debug，因此没有强制 renderer GC）；真实库 `queueLength=5734`，当前 set `ses_21d1b74a-0db3-40ed-8ace-92d5eea36831`，`displayMode="cover"`。

| Step | Main/Browser WS | Main Node heap | Renderer/Tab WS | GPU WS | 结论 |
|------|-----------------|----------------|-----------------|--------|------|
| 初始 `/processes` | 155.3MB | ~7MB | 545.2MB | 460.5MB | 本轮 dev 起点最大不是 main，而是 renderer + GPU；任务管理器必须按进程类型归因 |
| `/memory/diag` 初始 | — | JS heap 104MB | — | — | `playbackCache=0`；`mediaBlobs` 已落盘：electron-file 2.65GB、IndexedDB 55.9MB、OPFS 17.2MB；有界缓存很小 |
| 切歌 loop（9 次，约 4s dwell） | 176.2 → 229.9MB（波动） | 6-7MB | **549.9 → 1430.3MB** | 460.5 → 552.0MB | “看起来线性增长”的主体在 renderer/GPU 媒体工作集；main JS 堆没有跟随增长 |
| 暂停 + 2.5s | 188.5MB | 7.6MB | **839.0MB** | 447.0MB | 峰值已明显回落，说明不是每首永久保留 |
| 暂停后再等一轮 | 190.9MB | 7.1MB | **582.4MB** | 450.3MB | renderer 基本回到接近初始的 545-588MB 区间；短跑未复现永久线性泄漏 |

**本轮结论：**

1. 用户截图里的“每切歌涨”在本地 dev 可复现为**短时 renderer/GPU 工作集上涨**，但暂停/等待后会回落；这更像 Chromium 媒体解码缓存、Blob 句柄、文件读入缓冲的惰性释放，而不是 MUZERO JS 层永久泄漏。
2. 主播放 `MediaEngine.loadBlob()` 仍符合 revoke-before-replace：切歌前会 `URL.revokeObjectURL(this.objectUrl)`；本轮 `playbackCache=0` 也再次证明“播放缓存 2GiB 上限”不是当前增长杠杆。
3. 真正需要继续治理的是**用户感知层面的高水位**：即使最终可回落，连续切歌时 renderer 峰值会从 ~550MB 冲到 ~1.4GB；长时间不断切歌/下载时，如果 V8/Chromium 不及时 GC，任务管理器会呈现“线性爬升”的危险观感。
4. 第二轮脚本在某个 `playIndex` 上长时间未返回，说明测试样本混入了在线/未缓存下载路径。后续验收必须把场景拆成：A. 已本地缓存/引用文件切歌；B. 在线 download-before-play；C. 视频 MV；否则会把网络下载暂存、媒体解码和播放器释放问题混在一起。

**后续要求（追加到 Phase 2 的验收口径）：**

- 增加一个 harness 场景只挑选 `mediaBlobs` 已落盘或本地引用文件的 ready tracks，避免在线下载卡住 `playIndex`，用于测“纯切歌释放”。
- Profile/prod build 下开启 CDP remote-debug，跑同样 loop 后执行 renderer `HeapProfiler.collectGarbage`，记录 renderer/GPU/main 回落幅度，给“惰性释放”一个可重复的 before/after 数字。
- 若 prod 下 pause+20s 仍不能回到平台期，再进入代码修复：优先检查媒体元素 detach/load 顺序、object URL 句柄、封面/video decode surface、可视化 WebGL texture 生命周期。

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-07-05 | Claude Code | 初稿：针对用户报的「直播点歌 5h → 渲染进程 ~2.8GB / GPU 仅 122MB」。3 路 agent + 人工全库复核：确证 F-1 类 blob 泄漏在所有源均健康、经典路径无单点解释 2.8GB；新发现 6 处无界模块缓存（L-1~L-6，L-1 持真实 Blob）；主导嫌疑 H-1（播放缓存 2GiB 默认 + autoCacheStreamed）需 Phase 0 heap 三连拍坐实。承接六月审计（不重复 F-1 等），Phase 0 归因先行为 P0。 |
| 2026-07-05 | Claude Code | 第二轮深挖（3 路 agent 二次交叉 + 人工复核）：① 排除「点歌入队囤 Blob」「逐帧累积」两个 GB 级假说（下载在播放时才触发、rAF 站点全部干净）；② 新登记 L-7（`items` 请求历史数组无界）、L-8（`lastByRater` 限流 Map 只增不删）、M-1（下载未接 abort signal，瞬态积压）——均 MB 级；③ H-1 机制细化：IDB 内联回退有**两处**站点（playback-cache.ts:78 + media-blob-storage.ts:103,138，OPFS 失败即 GB 级堆内驻留）、同曲双重缓存（playbackCache + mediaBlobs）、每次写入全表 toArray 物化；④ 关键校准：Blob 字节驻留 Electron **main** 进程侧——2.86GB 究竟在哪个进程（新 Q-6）成为 Phase 0 第一步（`app.getAppMetrics()`）。本分支新增功能（命令路由/评分/歌词记忆）复核健康，不贡献 GB 级。 |
| 2026-07-05 | Claude Code | **第四轮：E2E 实测归因 + Phase 1 落地**。① Phase 0 完成：受控 Blob 归属实验（`perf-blob-pinning-probe.mjs`，100×8MB）坐实机制 ③——主进程精确 +801MB、渲染端 GC 后**全额回落** ⇒ 2.8GB = 惰性 GC 钉字节，**非泄漏**（Q-1/Q-7 答）；`playbackCache` 实测为空、流媒体落盘走 `mediaBlobs` electron-file（Q-2 证伪 IDB 内联回退、Q-4 moot——**Phase 2 原「降缓存上限」方案作废**，改「确定性释放内存背书 Blob 句柄」+「mediaBlobs/autoCacheStreamed 磁盘策略」）。② Phase 1 完成：L-1~L-6 有界化（新 `src/lib/bounded-cache.ts` LRU/BoundedSet + 各站点接入 + 穷举单测）、L-2 `pruneExpiredTimestamps` 窗口清扫、M-1 abort signal 接线；**L-7 复核 main 已有 50 条上限（初稿误读）、L-8 所指文件不在 main（N/A）**。③ 观测设施：`GET /memory/diag`、`/processes.mainProcess`、`scripts/perf-longrun-memory.mjs`。④ 验证：全量 vitest 3693 通过；直播点歌注入回归 3/3 completed；14 切歌主进程 +17.6MB 收敛、有界缓存全部 ≤ cap（§10 回填）。 |
| 2026-07-05 | Claude Code | **第三轮：用户任务管理器截图坐实 Q-6——2,859.9MB 是主进程，渲染进程仅 62.4MB**。①§1.1 事实 1 修正（初稿「占用在渲染进程」判断被推翻）；② H-1 机制精确化：渲染端 Blob 句柄惰性 GC + 字节钉在主进程 blob storage（BlobMemoryController 内存层 ~2GB 上限与 2.86GB 画像吻合），渲染端 L-2~L-8/F-11 确认非主导；③ 主进程（electron/）全量静态复核：fetch-proxy 流式无缓冲、diagnostics 环 100、intake 有界、ipc 均健康——主进程 JS 侧无 GB 级候选，指向 Chromium 存储层；新登记 M-2（pendingMediaStorageWrites fd 边缘泄漏，Low）；④ Phase 0 重定向：主进程 `process.memoryUsage()`/`v8.getHeapStatistics()` + **渲染端手动 GC → 看主进程 RSS 回落**的廉价定性实验（新 Q-7）；渲染端 heap 三连拍降级为辅助。 |
| 2026-07-05 | Codex | **用户截图后本地 Electron dev harness 复测（§10.1）**：通过 dev control endpoint 跑真实 5734 首队列短切歌。9 次切歌中 renderer/Tab 549.9→1430.3MB、GPU 460.5→552.0MB，main/Browser 176.2→229.9MB 且 Node heap 始终 6-7MB；暂停后 renderer 先回到 839MB，再回到 582.4MB，接近初始 545-588MB。结论：短跑复现的是 Chromium 媒体/Blob/解码工作集高水位与惰性释放，不是 MUZERO JS 永久线性泄漏；但用户感知的任务管理器高水位仍需 Phase 2 用 prod+CDP 强制 GC 和“已缓存曲目 vs 在线下载 vs 视频 MV”分场景验收。 |
| 2026-07-05 | Codex | **Phase 2 TDD harness 推进**：新增 dev-only `GET /playback/candidates` 设计与实现（route + renderer handler 单测先红后绿），只返回 ready 且有 `blobId`/`sourcePath` 的本地可播放 queue index，不泄露 path/url/title；`scripts/perf-longrun-memory.mjs` 增加 `--local-only` 与 `--play-timeout`，让纯切歌内存曲线与在线 download-before-play 分离。验证：`pnpm vitest run src/dev/perf-control.test.ts` 23 例通过，`node --check scripts/perf-longrun-memory.mjs` 通过；live smoke 因当前 Electron dev 控制端点未监听未标绿，留给 prod/profile harness。 |
| 2026-07-05 | Codex | **Phase 3 最小队列治理**：TDD 新增 `trimPastEntries` 纯函数，并在 `playQueueSetIndex` 持久化 cursor 时裁剪 active playQueue 深历史到最近 200 条已播 entries；当前曲目与未来队列完整保留，`session.trackIds` / set membership 不裁剪，完整历史归档拆后续 data-model PRD。验证：`pnpm vitest run src/player/play-queue.test.ts src/db/play-queue-repo.test.ts` 56 例通过，`pnpm typecheck` 通过。本轮遵守“不多开”，未再启动 Electron。 |
