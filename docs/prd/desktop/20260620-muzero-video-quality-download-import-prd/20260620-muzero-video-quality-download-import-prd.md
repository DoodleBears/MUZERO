# PRD: MUZERO 视频清晰度选择 + 直接下载到本地导入（Bilibili / YouTube）

**Status:** Draft
**Created:** 2026-06-20
**Author:** DoodleBear
**Module:** `src/streamsrc/`（video 解析 + mux）· `src/lib/desktop/`（save + 可选 BYO-ffmpeg bridge）· `src/stores/player-store.ts` · `src/db/` · Settings · Library

> 本 PRD 是 [`20260610-muzero-external-streaming-sources-prd`](../../20260610-muzero-external-streaming-sources-prd/20260610-muzero-external-streaming-sources-prd.md)（在线源接入，Phase 1–5 ✅）的**视频向纵深扩展**。前序 PRD 已把「搜索 → resolve → 播放 → 音频离线缓存」打通，但**全程音频优先**（[`pickAdaptiveAudio`](../../../../src/streamsrc/youtube/youtube-formats.ts) / [`parseDashAudio`](../../../../src/streamsrc/bili/bili-resolve.ts) 都只挑音轨）。本 PRD 补齐三件事：①**选择视频清晰度**、②**把视频直接下载到本地并导入曲库**、③用 **mediabunny**（纯 JS、MIT、**不打包/不外挂 FFmpeg**）解决 DASH「音视频分轨 → 合一」的 mux 问题。
>
> ⚠️ **关键约束（2026-06-20 决策）：绝不把 FFmpeg 库打包进 MUZERO。** 因此放弃 mediabunny 的 [server extension](https://mediabunny.dev/guide/extensions/server)（`@mediabunny/server` → NodeAV 内含 FFmpeg，LGPL/GPL 污染分发）。改为 **copy-remux 优先**（无重编码、按编码落原生容器 mp4/webm，零 FFmpeg、全平台、无损）；转码退化为**可选**项，且只走 Chromium 自带 WebCodecs（已在 Electron，BSD）或**用户自备**的系统 ffmpeg（BYO，不打包）。

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | 基础设施：视频轨解析 + 清晰度模型 + 下载计划 resolver（纯函数，零 mux） | 🔲 Pending | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | 渲染层 mediabunny copy-remux 下载（AVC+AAC 直接封装）+ 落盘/入库 | 🔲 Pending | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | 可选转码（**不打包 FFmpeg**）：WebCodecs 能力探测 + 自带系统 ffmpeg（BYO）兜底 | 🔲 Pending | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | 清晰度选择 UI + 下载进度 + 入口 + i18n（en/zh/ja/ko） | 🔲 Pending | [Phase 4 Checklist](#phase-4-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending
>
> **Phase 顺序遵循 [`prd-create.md`](../../../../.cursor/commands/prd-create.md) §3「基础设施先于覆盖广度」**：解析与下载计划（Phase 1）必须先合并，否则 mux（Phase 2）与转码（Phase 3）的 PR 会反复 rebase。

---

## 1. Overview

### 1.1 Background

MUZERO 现在能搜索并播放 Bilibili / YouTube 的曲目，但有两条产品空白：

1. **听不到「选清晰度」**：在线源的 resolve 是**音频优先**——YT 只取 audio-only adaptive format，Bili 只解析 `dash.audio[]`（[`bili-resolve.ts` 的 `parseDashAudio`](../../../../src/streamsrc/bili/bili-resolve.ts) 明确「只解析 audio 变体」）。MV / 视频内容拿不到画面，更谈不上 360p / 720p / 1080p / 4K 的档位选择。
2. **下载只到音频、且不落文件**：Phase 5 的 [`runStreamCache`](../../../../src/streamsrc/cache-stream.ts) 只把**单条已解析的音频流**缓存进 blob（`cacheStreamedTrackBlob` 设 `track.blobId`），既不含视频，也没有「下载成一个可在文件管理器看到的 mp4」。[`downloadTrackMedia`](../../../../src/lib/download-track.ts) 能把**已是本地 blob**的曲目另存为文件，但对 streamed 视频（分轨、需 mux）无能为力。

而 MUZERO 的产品内核是「音乐承载回忆」——视频 MV 同样要能进库、加 tag / 记忆 / 封面、被搜索、喂 DJ（CLAUDE.md 混合集规则）。要支撑这个，必须能把外部视频**按用户选的清晰度真正下载到设备**，并作为本地媒体纳入曲库。

**DASH 的硬约束 + 我们的解法**：B站和 YouTube 的高清视频都是 DASH——**视频轨和音频轨是两条独立流**。要得到一个能进 `<video>`、能离线、能另存的单文件，必须把两轨 **mux** 进一个容器。yt-dlp 用 ffmpeg 做这件事;MUZERO **不打包 FFmpeg**(见下「关键约束」),改用已装的 [`mediabunny@1.45.4`](../../../../package.json)（当前仅用于 poster-frame 探测，见 [`20260618-muzero-video-poster-frame-mediabunny-prd`](../../20260618-muzero-video-poster-frame-mediabunny-prd/20260618-muzero-video-poster-frame-mediabunny-prd.md)）。

**核心认知：copy-remux 不需要任何编码器。** mediabunny 的 Conversion API 默认 **transmux**（直接拷贝已编码的音视频包、重写容器，无重编码），只有必要时才转码（[官方文档](https://mediabunny.dev/guide/converting-media-files)）;流式处理，10GB 文件峰值内存 <200MB。所以默认路径是**「按编码落原生容器」**——AVC+AAC → **mp4**(copy)、VP9/AV1+Opus → **webm**(copy)，两者 Electron 的 `<video>` 都能原生解码播放。这条路**零 FFmpeg、零重编码、无损、全平台**，覆盖绝大多数 B站/YT 下载。

**转码只在「强制统一到某容器/编码」时才需要，且仍不打包 FFmpeg**：用 Chromium 自带的 WebCodecs（已在 Electron 内，BSD 许可，不额外打包）做尽力而为的重编码——但其编码端有平台坑（AAC 编码在桌面 Linux 不可用、Electron 的 H.264/AAC 编码取决于构建 flag，[WebCodecs 数据](https://webcodecsfundamentals.org/datasets/codec-support/)），故仅作 best-effort;真正兜底是**检测并调用用户自备的系统 `ffmpeg`**（BYO，类似 yt-dlp GUI，不随 app 分发）。

### 1.2 Target Users

| Role | Description | Permissions |
|------|-------------|-------------|
| **本地高级用户（owner）** | 把 B站 / YouTube 上的 MV / 现场 / 视频按需选清晰度下载进 MUZERO，做策展、加记忆、离线观看、喂 DJ。BYOK：自带各源登录态解锁高清/会员档。 | 全功能；功能**默认关闭**（沿用在线源红线，见 §8），需在 Settings 开启对应源并（如需高清）登录 |

> 单角色产品（本地优先、无账号系统）。定位为**个人使用的高级功能**。

### 1.3 Core Value

1. **看得到画面、选得了清晰度**：在线视频从「只出声」升级为「可选 360p–4K 的真正视频播放 + 下载」。
2. **真·下载到本地**：选定清晰度 → 音视频合一为单文件 → 写入设备持久媒体存储并入库（可离线、可另存到任意目录），不再依赖每次播放重 resolve 的短时直链。
3. **零打包二进制、零 FFmpeg**：复用已有的 streamsrc 提取 + mediabunny copy-remux（已是依赖，MIT，无重编码）。**不打包 FFmpeg、不引入 `@mediabunny/server`/NodeAV**；可选转码用 Chromium 自带 WebCodecs 或用户自备 ffmpeg——契合本地优先与「不引入新 runtime owner / 不污染分发许可证」纪律。
4. **纳入记忆体系**：下载后的视频是普通本地 track，与上传视频同等享受 tag / 记忆 / 封面 / 搜索 / DJ 上下文。

### 1.4 已验证基线：Bilibili 音频整条已打通（本 PRD 的起点）

> 本 PRD **不是从零接 Bilibili**。Bilibili 的整条提取→播放→入库管线**已实现并经 Electron 端到端手测**（见 [streamsrc PRD](../../20260610-muzero-external-streaming-sources-prd/20260610-muzero-external-streaming-sources-prd.md) 「B站搜索+播放+声音+封面背景全通」）。现状盘点：

| 能力 | 现状 | 代码 |
|---|---|---|
| WBI 签名 + key 取/缓存（10min） | ✅ 已验证 | [`bili-wbi.ts`](../../../../src/streamsrc/bili/bili-wbi.ts)、`bili-source.ts` `ensureMixinKey` |
| 搜索 → `view`→`cid` → `playurl` 取流 | ✅ 已验证 | [`bili-source.ts`](../../../../src/streamsrc/bili/bili-source.ts) `search`/`resolve`/`fetchFirstCid` |
| DASH **音轨**选档 + CDN 排序 + 直链过期(`deadline`) | ✅ 已验证 | [`bili-resolve.ts`](../../../../src/streamsrc/bili/bili-resolve.ts) `parseDashAudio`/`selectAudioByPreference` |
| Referer/UA 注入播放（CDN 403 绕过）+ 封面去防盗链 | ✅ 已验证 | `mediaProxyUrl`（Electron）、no-referrer |
| SESSDATA cookie 注入（会员/高音质） | ✅ 已接线 | `bili-source.ts` `getCookie`/`isAuthed` |
| 入库为 streamed track（标题/艺人/封面镜像） | ✅ 已验证 | `createStreamedTrack` |
| DASH **视频轨** | ❌ 未做（本 PRD） | `dash.video[]` 当前被丢弃 |

**关键事实（决定本 PRD 的工程量）**：`resolve()` 现在请求的同一个 `playurl`（`fnval=16`）**响应里本就同时带 `dash.video[]` 和 `dash.audio[]`**——代码只是用 `parseDashAudio` 读了音轨、丢掉了视频数组（[`bili-source.ts:112`](../../../../src/streamsrc/bili/bili-source.ts)）。因此 **Bilibili 的「选清晰度 + 拿视频轨」几乎是免费的**：复用同一条已验证的签名请求，只需新增 `parseDashVideo`/`selectVideoByResolution`/`resolveVideo`，**无任何新的鉴权/签名/网络工作**。唯一调整是为覆盖 4K/HDR/AV1 等视频档把视频侧的 `fnval` 从 `16` 提到 `4048`（见 §4.1），且不动已验证的音频路径。

> 对比：**YouTube 侧才是真正的脆弱大头**（sig/nsig/PoToken 活体对抗，§4.6）。Bilibili 视频是「低风险增量」，YouTube 视频是「需持续维护」——Phase 排期与验收应区别对待。

---

## 2. System Architecture

### 2.1 Architecture Overview

```
用户在「清晰度选择」里点「下载 1080p」
        │
        ▼
 resolveDownloadPlan(track, { videoQuality, audioQuality })   ← 纯函数（Phase 1）
   ├─ source.resolveVideo(externalId, quality)  →  videoTrack { url, headers, codec, w×h }
   └─ source.resolve(externalId, audioQuality)  →  audioTrack { url, headers, codec }   （复用既有）
        │  产出 DownloadPlan { video, audio, container:"mp4", muxStrategy }
        ▼
 chooseMuxStrategy(plan)                                       ← 纯函数（Phase 1）
   ├─ "copy"  AVC+AAC → mp4 / VP9·AV1+Opus → webm（原生容器，无重编码）  → 渲染层 mediabunny（Phase 2，默认/主路径）
   └─ "transcode"  仅当用户强制统一容器/编码（少数）                     → WebCodecs(best-effort) 或 BYO 系统 ffmpeg（Phase 3，可选）
        │
        ▼
 runVideoDownload(plan, deps)                                  ← 纯+注入式 orchestrator（Phase 2）
   ├─ fetchBytes(video.url, video.headers)  ┐  经 mediaProxyUrl / getAppFetch（注入 Referer/UA、CORS-free）
   ├─ fetchBytes(audio.url, audio.headers)  ┘
   ├─ mux(videoBytes, audioBytes, strategy) →  Blob(mp4|webm)   渲染层 mediabunny copy-remux（worker）；transcode=可选注入
   ├─ writeMediaStorageBlob({ storageKey, blob })               大文件落「持久媒体存储」（非 IndexedDB 内联）
   └─ 建本地 track（kind:"video"，blobId/storageKey 填上）       复用既有入库管线
        │
        ▼   （可选）bridge.saveFile(mp4) → 另存到用户选定目录

 ┌──────── 所有出站 HTTP（直链字节）────────┐
 │  getAppFetch() / mediaProxyUrl → muzfetch │  v1 仅 Electron；web/tauri 经 hasStreamingSources() gate 隐藏
 └────────────────────────────────────────────┘
```

### 2.2 Technology Stack

| Component | Technology | Rationale |
|---|---|---|
| **视频轨解析** | 扩 [`bili-resolve.ts`](../../../../src/streamsrc/bili/bili-resolve.ts)（解析 `dash.video[]`）+ [`youtube-formats.ts`](../../../../src/streamsrc/youtube/youtube-formats.ts)（解析 video adaptiveFormats），纯函数 | 复用既有 DASH/InnerTube 提取栈，只新增「挑视频轨」镜像「挑音轨」的逻辑；零 IO、穷举单测（规则 7） |
| **mux（copy-remux，主路径）** | `mediabunny`（已是依赖，MIT）—— renderer `Output` + `Mp4OutputFormat`/`WebMOutputFormat`，transmux 直接拷贝包、**无重编码** | 不打包 FFmpeg；按编码落原生容器（mp4/webm），Electron `<video>` 都能原生播 |
| **转码（可选兜底，不打包）** | ① Chromium **WebCodecs**（已在 Electron，BSD，best-effort）② 用户自备 **系统 ffmpeg**（BYO，运行时 PATH 检测，不随 app 分发） | 仅「强制统一容器/编码」时需要。WebCodecs 编码端有平台坑（桌面 Linux 无 AAC 编码、Electron H.264/AAC 编码视构建而定）→ 缺失时降级提示或走 BYO ffmpeg。**绝不打包 `@mediabunny/server`/NodeAV/FFmpeg** |
| **大文件持久化** | [`writeMediaStorageBlob`](../../../../src/lib/desktop/bridge.ts)（Electron 持久媒体存储，见 [OPFS PRD](../../20260612-muzero-opfs-persistent-media-storage-prd/20260612-muzero-opfs-persistent-media-storage-prd.md)） | 视频文件可达数百 MB，**绝不**内联进 IndexedDB `mediaBlobs` 行（规则 5：字节进 mediaBlobs/持久存储、不进 tracks 行；保持列表查询轻量） |
| **另存到磁盘** | [`bridge.saveFile`](../../../../src/lib/desktop/bridge.ts)（已存在） | 「下载成文件」的显式出口，复用现有 save-as |
| **出站 HTTP** | [`mediaProxyUrl`](../../../../src/lib/desktop/bridge.ts) / `getAppFetch()` → muzfetch（已存在） | 规则 10；B站 CDN 需注入 Referer，YT 需 UA + Range |

### 2.3 Project Structure

```
src/
├── streamsrc/
│   ├── bili/
│   │   └── bili-video.ts            # 新：parseDashVideo() + selectVideoByResolution()（镜像 bili-resolve 的 audio 选择）✅
│   ├── youtube/
│   │   └── youtube-formats.ts       # 扩：pickAdaptiveVideo()（镜像 pickAdaptiveAudio）
│   ├── video-quality.ts             # 新：跨源 label/排序（videoQualityLabel + sortVideoQualitiesDesc，bili 已消费）✅
│   ├── download-plan.ts             # 新：buildDownloadPlan()（纯，pair video+audio → DownloadPlan）✅
│   ├── mux/
│   │   ├── mux-mediabunny.ts        # 新：渲染层 copy-remux（transmux 无重编码；WebCodecs transcode 为可选分支）
│   │   └── mux-strategy.ts          # 新：chooseMuxStrategy + classifyAudioCodec（codec→容器裁决，纯）✅
│   └── video-download.ts            # 新：runVideoDownload() orchestrator（纯+注入，仿 cache-stream.ts）
├── workers/
│   └── video-mux-worker.ts          # 新：渲染层 copy-remux 放 Worker（规则 7：重活不卡主线程）
├── lib/desktop/                     # 扩 bridge（仅 Phase 3 可选）：detectSystemFfmpeg?/transcodeWithSystemFfmpeg?（BYO，Electron-only）
└── stores/player-store.ts           # 扩：downloadStreamedVideo() action + 进度状态（ephemeral）

electron/
└── ipc.cjs / preload.cjs            # 扩（仅 Phase 3 可选）：检测/调用「用户系统 ffmpeg」的最小 IPC —— 不打包任何二进制
```

> **遵循「不新增源代码文件，除非引入新 parser / lib bridge」（prd-create.md §3）**：新文件均属新 parser（video 轨解析、清晰度归一）或新 lib bridge（mediabunny mux 桥、可选 BYO-ffmpeg 桥），不重复造 registry/adapter。

---

## 3. Data Model Design

### 3.1 Core Concepts

```
Track(origin:"streamed", kind:"video")        ← 在线视频，可播放（即时 resolve 短时直链）
        │  用户点「下载 1080p」
        ▼
runVideoDownload → mp4 Blob → 持久媒体存储(storageKey)
        ▼
Track(kind:"video", blobId/storageKey 填上)    ← 下载后：优先走本地，不再依赖直链/代理；可离线、可另存
        通用：streamSourceId/streamExternalId（保留来源归属）· tags · memories · cover · 喂 DJ
```

**关键设计决策（Q2 默认，见 Open Questions）：下载不改 `origin`，沿用 Phase 5 缓存模式**——保持 `origin:"streamed"` + 填 `blobId`/`storageKey`，从而保留来源引用（可重解析、可跳转回源）与记忆。下载只是「把字节落到本地」，不是「伪装成上传」。提供「另存为文件」是独立动作（`saveFile`），不影响入库形态。

### 3.2 Database Schema

⚠️ 优先扩展现有结构，不重构。**全部改动都是「附加的非索引字段」→ 无需 bump Dexie 版本、无迁移体**（与 streamsrc PRD 的 Q4 一致；参照 `Track.coverThumbhash` 的 additive 做法）。

- **Current Schema:** [`src/db/types.ts`](../../../../src/db/types.ts) — `Track`、`StreamSourceConfig`（行 43）、`StreamSourceMeta`（行 57）、`AppSettings.streamSources`（行 642）、`MediaBlob`。
- **Required Changes（TS 类型层 / 附加属性，零迁移）：**
  1. **`StreamSourceConfig` 加视频清晰度偏好**（[`src/db/types.ts:43`](../../../../src/db/types.ts)）：
     ```ts
     /** 视频清晰度偏好键（如 "1080p" | "720p" | "max"），独立于已有的音频 `quality`。 */
     videoQuality?: string;
     ```
  2. **`Track` 加下载档位快照**（非索引附加；仅下载后的视频用，便于 UI 标注「已下载 1080p」）：
     ```ts
     downloadedVideoHeight?: number;   // 实际落地分辨率高度
     downloadedContainer?: string;     // "mp4" | "webm"
     downloadedCodecs?: string;        // "avc1+mp4a" 等（展示/排障）
     ```
  3. **`MediaBlob`**：复用现有 `role:"media"` + `storageKey`（持久媒体存储），无需新字段。视频字节走 `writeMediaStorageBlob`，**不内联**。
- **Indexing：** 不建二级索引（与规则 6 内存派生一致）。
- **Privacy & Retention:** 下载的视频字节是用户本地内容；来源 cookie/token 仍只在 `AppSettings.streamSources`（规则 2），永不进日志/遥测/bundle。提供「删除下载（保留来源引用）」= 清 `blobId`/`storageKey` + 删持久文件，track 退回 streamed 在线形态。

### 3.3 Data Relationship Diagram

```
AppSettings.streamSources[sourceId]
    ├── quality            （音频偏好，已存在）
    └── videoQuality       （视频偏好，新增）

Track(streamed, video)
    ├── streamSourceId + streamExternalId        （来源稳定引用，下载后仍保留）
    ├─?─ blobId/storageKey → MediaBlob(role:"media", 持久文件)   （下载后填）
    ├── downloadedVideoHeight / Container / Codecs              （下载档快照）
    └── tags / coverBlobId / memories            （与其它 origin 一致）
```

---

## 4. Provider / API Design

### 4.1 视频轨解析（镜像已有音频解析）

⚠️ **只扩展、不改音频路径**。在 `StreamSourceProvider`（[`src/streamsrc/provider.ts`](../../../../src/streamsrc/provider.ts)）上**新增可选** `resolveVideo`，使纯音频源（网易云）天然不实现、UI 自动不显示视频下载：

```ts
// src/streamsrc/provider.ts — 附加
export interface PlayableVideoTrack {
  url: string;
  headers?: Record<string, string>;   // 媒体 GET 注入头（B站 Referer / YT UA）
  mimeType: string;                    // video/mp4; codecs="avc1.640028" 等
  codec: "avc" | "hevc" | "vp9" | "av1" | "other";
  width?: number; height?: number; fps?: number; hdr?: boolean;
  bandwidth?: number;
}
export interface VideoQualityOption {
  key: string;          // "1080p" | "720p60" | "max" …（跨源归一）
  height: number; fps?: number; hdr?: boolean;
  requiresLogin?: boolean;   // 该档是否需登录/会员
  codec: PlayableVideoTrack["codec"];
}
export interface StreamSourceProvider {
  // …既有 search / resolve（音频）/ importPlaylist …
  /** 列出可下载视频清晰度（纯音频源不实现）。 */
  listVideoQualities?(externalId: string, opts?: { signal?: AbortSignal }): Promise<VideoQualityOption[]>;
  /** 解析某清晰度的视频轨（与 resolve 音频分开拿，便于 mux）。 */
  resolveVideo?(externalId: string, opts: { videoQuality?: string; signal?: AbortSignal }): Promise<PlayableVideoTrack>;
}
```

| 源 | 新增纯函数（隔离点） | 机制 |
|---|---|---|
| **Bilibili** | `parseDashVideo(data)` · `selectVideoByResolution(streams, opts)`（镜像现有 `parseDashAudio`/`selectAudioByPreference`，落新文件 [`bili-video.ts`](../../../../src/streamsrc/bili/bili-video.ts) ✅；选择按目标 `maxHeight` + `codecPreference` 容器兼容默认 AVC-first） | **复用已验证的 `resolve` 请求**（view→cid→playurl，§1.4）：同一 playurl 响应**已含 `dash.video[]`**（`id`(qn)/`codecs`/`width×height`/`frameRate`），现被丢弃。新增 `resolveVideo` 读视频轨；为覆盖 4K/HDR/AV1 把**视频侧** `fnval` 由现 `16` 提到 `4048`（番剧/大会员 `12240`），**不动音频路径**。`qn`→360/480/720/1080/4K，`SESSDATA` 决定可见档。CDN 排序复用 `prioritizeBiliUrls`、过期复用 `deadlineFromUrl`。 |
| **YouTube** | `pickAdaptiveVideo(formats, key)`（镜像 [`pickAdaptiveAudio`](../../../../src/streamsrc/youtube/youtube-formats.ts)） | InnerTube `streamingData.adaptiveFormats[]` 的 `mimeType` 以 `video/` 开头者；`qualityLabel`(360p/1080p60/2160p)、`width/height/fps`；ciphered URL 复用既有 sig/n + PoToken 解密（[`youtube-ytjs.ts`](../../../../src/streamsrc/youtube/youtube-ytjs.ts)）。选档**先按 `height/fps/hdr`**，codec 仅决定容器配对（见 §4.2 + 下注）。 |

> **不在 DJ/store/UI 散落 `if(source==="bili")`**（规则 5/10）：源差异全部收进各 provider 的纯映射函数；上层只调 `listVideoQualities`/`resolveVideo`。

> **codec 偏好不硬编码（研究教训）**：业界并无稳定统一的 codec「画质排名」（yt-dlp 的 `h264>vp9>av01` 默认排序本轮深度研究**校验未通过**、且随版本变）。本 PRD 对 **AVC 的倾向纯属容器兼容理由**（能与 AAC 一起 copy 进 mp4、Chromium 必播），不是画质判断——实际选档按 `height/fps/hdr`，codec 只决定容器配对（§4.2），并做成可配置项而非散落常量。
>
> **Bilibili 提取参考（合规更新）**：事实标准文档 `bilibili-API-collect` 已于 **2026-01-28 被律师函关停**、`BBDown` 亦于 **2026-05-14 archive**（见 §8）。WBI/playurl/DASH 的**仍在维护**可参考实现改用 [yt-dlp `bilibili.py`](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/bilibili.py)（`_get_wbi_key`/`_sign_wbi`；DASH `fnval=4048`、大会员/番剧 `12240`；`qn`+`SESSDATA` 解锁高清；`dash.video[]`/`dash.audio[]`/`dash.flac.audio` 分轨）与 yutto。我们已有的 [`bili-wbi.ts`](../../../../src/streamsrc/bili/bili-wbi.ts) 后续以这些活源校准。

### 4.2 下载计划 + mux 策略（纯函数，Phase 1）

```ts
// src/streamsrc/download-plan.ts
export type MuxStrategy =
  | { kind: "copy"; container: "mp4" | "webm" }                                   // transmux，无重编码（默认）
  | { kind: "transcode"; via: "webcodecs" | "system-ffmpeg"; container: "mp4" };  // 可选，强制统一容器时
export interface DownloadPlan {
  video: PlayableVideoTrack;
  audio: PlayableStream;          // 复用既有音频 resolve 结果
  strategy: MuxStrategy;
}
export function chooseMuxStrategy(
  v: PlayableVideoTrack,
  a: { codec: string },
  opts: { forceContainer?: "mp4"; caps: MuxCaps },   // caps = WebCodecs/BYO-ffmpeg 能力探测结果
): MuxStrategy;
```

`chooseMuxStrategy` 决策（[`mux-strategy.ts`](../../../../src/streamsrc/mux/mux-strategy.ts)，穷举单测）。核心是**「音轨配对视频的可播容器族」**，使默认永远是 copy：

| 视频 codec（源） | 配对音频（同容器族） | 默认策略 | 容器 |
|---|---|---|---|
| AVC / HEVC | AAC | **copy** | mp4 |
| VP9 / AV1 | Opus | **copy** | webm |
| AVC/HEVC（B站 Hi-Res/杜比） | FLAC / AC-3 | **copy** | mp4（mp4 支持 FLAC/AC-3） |

> **Mediabunny 容器×codec 矩阵（已核实，[官方表](https://mediabunny.dev/guide/supported-formats-and-codecs)）**：mp4 能装 AVC/HEVC/VP8/VP9/AV1 + AAC/Opus/MP3/Vorbis/FLAC；webm 只装 VP8/VP9/AV1 + Opus/Vorbis（**无 AAC**）；mkv 几乎全收。即 **mp4 在容器层面几乎能 copy 任何组合**。
>
> **但「能 mux」≠「Chromium 能播」**：Chromium/Electron `<video>` 对 **mp4 内的 VP9/Opus 播放支持不完整**、mkv 也不可靠。因此默认按上表「音轨配对视频的可播容器族」——YT 的 AAC 与 Opus 两种音轨都提供、B站基本是 AVC/HEVC + AAC/FLAC，所以**几乎 100% 实拍下载都能纯 copy、零转码、Chromium 必播**。
>
> **转码只剩一种触发**：用户显式勾「强制单一 mp4」且源为 VP9/AV1（想塞进 mp4 又要老设备能播）→ 才走 §4.4 的可选转码（不打包 FFmpeg）。另保留 **`copy→mkv`（mkv 全收）作为「只存档不在 app 内播」的高级另存档**（直接 `saveFile`、不入库播放）。Chromium 对各组合的实际播放边界 **Phase 2 实测**（checklist）。

### 4.3 下载 orchestrator（纯 + 注入，仿 `cache-stream.ts`）

```ts
// src/streamsrc/video-download.ts
export interface RunVideoDownloadDeps {
  resolvePlan: () => Promise<DownloadPlan>;
  fetchBytes: (url: string, headers?: Record<string, string>) => Promise<Blob>;   // 经 mediaProxyUrl
  mux: (video: Blob, audio: Blob, plan: DownloadPlan, onProgress?: (p: number) => void) => Promise<Blob>;
  store: (blob: Blob, mime: string) => Promise<{ blobId: string; storageKey?: string }>;
  onProgress?: (stage: "fetch" | "mux" | "store", ratio: number) => void;
  trace?: Pick<DiagnosticContext, "traceId" | "trackId" | "sessionId" | "sourceId">;
}
export type RunVideoDownloadResult =
  | { kind: "downloaded"; blobId: string; bytes: number; height: number }
  | { kind: "requires-login" } | { kind: "no-permission"; reason: string } | { kind: "error"; message: string };
```

与 [`runStreamCache`](../../../../src/streamsrc/cache-stream.ts) 同纪律：**never throws、返回结构化 verdict**，VIP/登录门返回而非写坏 blob。`mux` 由 caller 注入（默认渲染层 mediabunny copy-remux worker；可选 transcode 注入 WebCodecs 或 `bridge.transcodeWithSystemFfmpeg`），保证 orchestrator 可 fake-mux 单测。

### 4.4 可选转码（Phase 3，不打包 FFmpeg）

> 默认路径（copy-remux）不需要本节。本节只服务「用户强制把 VP9/AV1/Opus 统一成 mp4」这一少数场景，且**两条实现都不随 app 分发任何 FFmpeg 二进制**。

**(a) WebCodecs（首选，零安装、零打包）。** 渲染层 mediabunny 用 Chromium 自带 `VideoEncoder`/`AudioEncoder` 重编码。先 `VideoEncoder.isConfigSupported('avc1.…')` / `AudioEncoder.isConfigSupported('mp4a.40.2')` 探测能力（落 `MuxCaps`）——支持才显示该选项。⚠️ 桌面 Linux 无 AAC 编码、Electron 的 H.264/AAC 编码取决于构建 flag，故按平台 best-effort，不可用即转 (b)。

**(b) BYO 系统 ffmpeg（兜底，用户自备）。** WebCodecs 缺编码器时，检测用户机器是否已装 `ffmpeg`（PATH 或 Settings 指定路径），有则 spawn 它转码：

```ts
// src/lib/desktop/bridge.ts — DesktopBridge 附加（均可选，Electron-only）
detectSystemFfmpeg?: () => Promise<{ available: boolean; path?: string; version?: string }>;
transcodeWithSystemFfmpeg?: (input: {
  videoStorageKey: string; audioStorageKey: string;    // 字节先落临时持久文件，避免 IPC 搬运大 buffer
  target: { container: "mp4"; videoCodec: "avc"; audioCodec: "aac"; maxHeight?: number };
}) => Promise<{ outStorageKey: string; bytes: number }>;
```

- **实现**：[`electron/ipc.cjs`](../../../../electron/ipc.cjs) spawn **用户的** ffmpeg；`tauri.ts`/`web.ts` 不实现 → 能力判定自动隐藏（规则 10，沿用 `mediaProxyUrl` 缺省即降级纪律）。**仓库与安装包都不含 ffmpeg**；检测不到就引导安装或仅提供 copy 档。
- **安全**：保持 `contextIsolation:true + sandbox:true + nodeIntegration:false`；preload 仅 `contextBridge` 暴露这两个最小通道（规则 10）。I/O 走持久媒体存储 + realpath allowlist（与现有 fs IPC 同款）；spawn 用固定参数模板（不拼接用户输入），ffmpeg 路径仅取 PATH / 用户显式指定。

### 4.5 Error Handling & 边界

- **清晰度不可用 / 需登录**：`listVideoQualities` 标 `requiresLogin` 的档在 UI 灰显并提示「登录解锁高清/会员」；resolve 命中 VIP 墙 → 结构化 `no-permission`，走 [`error-ux-architecture`](../../../../.claude/projects/-Users-doodlebear-Documents-code-MUZERO/memory/error-ux-architecture.md) toast，不静默吞。
- **直链过期**：下载是一次性长任务；`resolveVideo`/音频 resolve 紧贴 fetch 执行，过期则在 orchestrator 内重 resolve 一次再失败。
- **磁盘不足 / 写失败**：`writeMediaStorageBlob` 失败 → 清理半成品临时文件，verdict `error`，不留孤儿 blob。
- **强制 mp4 但无转码能力**：用户勾「强制 mp4」、源为 VP9/AV1/Opus，但 WebCodecs 不支持该编码且未检测到系统 ffmpeg → 明确提示「需安装 ffmpeg，或改用原生容器(webm)」，并默认给出 copy→webm 降级档（仍可在 app 内播放）。
- **Telemetry**：本地优先、无遥测（规则 1/8）。仅本地 logger，且仅记 `effect`-级白名单：`source` / `videoHeight` / `strategy` / `bytes` / `durationMs`；**永不**记 URL / cookie / externalId / 文件名（与 prd-create §3 telemetry 白名单一致）。

### 4.6 提取层韧性（抗失效，研究教训）

> 深度研究头号结论：YouTube 的解密资产（signature cipher / nsig / PoToken）是**活体对抗对象**，会随上游 player 周期性失效——这是所有下载器的最大脆弱点。设计纪律：把「易失效的破解资产」与「稳定的下载/合并业务码」彻底解耦。

- **复用而非自造**：YT 解密走已依赖的 `youtubei.js`（`Format.decipher` 已把 solver 隔离在独立 `Player`），不自己维护 base.js 正则；Bili WBI 是稳定算法、自实现可控（[`bili-wbi.ts`](../../../../src/streamsrc/bili/bili-wbi.ts)）。
- **版本钉死 + 快速升级路径**：`youtubei.js` / `bgutils-js` **pin 精确版本**，把「升级提取依赖」做成低风险独立 PR（不碰业务码）；预期每隔数周~数月需跟随上游升一次，演练写进 checklist。
- **丢格式不崩（抄 yt-dlp）**：某清晰度/某 codec 解析失败时**降级到其它可用档并 warning**，而不是整条下载失败——对齐 [`runStreamCache`](../../../../src/streamsrc/cache-stream.ts) 的结构化 verdict，`runVideoDownload` 做 per-format 容错。
- **PoToken = 封号级硬门禁，且只能在真渲染器铸（gap 3 已答）**：缺 PoToken 会 **HTTP 403 甚至封号/封 IP**（不是限速）。`bgutils-js`（BotGuard）**只能在有真实 `window`/DOM 的 Chromium 渲染器跑**——headless / 主进程 Node 过不了 BotGuard 完整性校验（[BgUtils](https://github.com/LuanRT/BgUtils) 实测）。这正是 [`youtube-ytjs.ts`](../../../../src/streamsrc/youtube/youtube-ytjs.ts) 现有做法（渲染器 REAL DOM 里跑 bgutils），**无需任何后端/token 服务**，契合本地优先；视频下载**复用同一已铸 token**、不新增机制。`bgutils-js` 属逆向/教育性质 → 归入上面「钉版本 + 快速升级」流程。

---

## 5. Frontend Design

### 5.1 Page Structure

```
components/player/         # Now Playing / track 菜单加「下载视频…」入口（弹清晰度选择）
components/library/        # track-list-menu.tsx：streamed video 行加「下载」菜单项
components/settings/       # stream-sources-settings：每源加「默认视频清晰度」下拉
components/track/          # download-quality-dialog.tsx（新）：清晰度列表 + 体积估算 + 下载/另存
```

### 5.2 UI Components / Interaction

- **清晰度选择对话框（新 `download-quality-dialog.tsx`）**：列出 `listVideoQualities` 返回的档（1080p / 720p60 / 480p / 360p / 4K / HDR），每档标 codec、约估体积（`bandwidth × duration`）、是否需登录。两个动作：**① 下载并入库**（落持久存储 + 建本地 track）、**② 另存为文件…**（`saveFile`）。可记住为该源默认（写 `videoQuality`）。
- **下载进度**：fetch → mux → store 三段进度（ephemeral，进 `ui-store` 或本地组件态，**不进** player-store 持久状态；规则 6）。可取消（AbortSignal 贯穿 resolve/fetch/mux）。
- **入口**：track 行菜单、Now Playing「⋯」、搜索在线结果项。仅当 `provider.resolveVideo` 存在且 `hasStreamingSources()` 为真时显示；否则隐藏并附「在线视频下载需桌面端」一行。
- **已下载标记**：track 行显示「⬇ 1080p」徽标（读 `downloadedVideoHeight`），并提供「删除下载」回到在线形态。

### 5.3 State Management

- 清晰度列表用 TanStack Query（异步/可取消/缓存），**不**塞 Zustand（规则 6）。
- 下载任务进度为 ephemeral，模块作用域或 `ui-store`；下载完成后 track 经 Dexie `useLiveQuery` 自然刷新出本地形态。

### 5.4 i18n（4 locale，per prd-create.md §3）

所有新文案（「下载视频」「选择清晰度」各档 label、「需登录解锁」、三段进度、「另存为文件」、转码/桌面专属提示、删除下载）走 `t("ns.key")`，先加 **en**（类型源）再补 zh/ja/ko。清晰度档 label（1080p/4K/HDR）是技术常量，不做 locale 大对象分支；解释性文案才进 i18n。少 locale 在 PR 标 "pending translation" + 开 followup。

---

## 6. Implementation Plan

> 顺序遵循「基础设施先于覆盖广度」。每个纯函数单元走 TDD（test → impl → green），带运行时（mux/转码/IPC/UI）的部分实现后标「待 Electron 手测」，不冒充已验证（沿用 streamsrc PRD 的 Progress Log 纪律）。

### Phase 1: 基础设施（视频轨解析 + 清晰度模型 + 下载计划）

**Goal:** 能解析出视频清晰度档与可下载直链、能产出 `DownloadPlan` 并裁决 mux 策略——全纯函数，不下载、不 mux。

**Tasks:**
- [x] **Bilibili 视频轨解析/选档（低风险，先行）**：新文件 `bili-video.ts` 的 `parseDashVideo` + `selectVideoByResolution`（镜像音频；codec 容器兼容默认 AVC-first，可配置）。✅ 9 单测全绿。
- [x] **Bilibili 视频 resolve**：`bili-source.ts` 加 `resolveVideo`/`listVideoQualities`，视频侧 `fnval` 由 `16` 提至 `4048`——复用已验证的 view→cid→playurl（§1.4），音频路径未动（34 bili 测全绿，含既有音频）；provider.ts 加 `PlayableVideoTrack`/`VideoQualityOption`/`resolveVideo?`/`listVideoQualities?`。✅
- [ ] **YouTube（脆弱，独立验收）**：`youtube-formats.ts` 加 `pickAdaptiveVideo`（按 `height/fps/hdr` 选档，codec 仅决定容器配对、**不硬编码画质排名**）；复用 [`youtube-ytjs.ts`](../../../../src/streamsrc/youtube/youtube-ytjs.ts) 的 sig/n + PoToken（§4.6）。
- [x] `video-quality.ts` 跨源 label/排序（`videoQualityLabel`/`sortVideoQualitiesDesc`，bili `listVideoQualities` 已消费）。✅ 跨源「归一」由 `provider.VideoQualityOption` 统一契约达成，无需独立 normalize 层（YT 落地时复用同 util）。
- [ ] `provider.ts` 加可选 `listVideoQualities`/`resolveVideo`；bili/youtube source 实装，netease 不实装。
- [x] `mux/mux-strategy.ts` `chooseMuxStrategy` + `classifyAudioCodec`（默认 copy、音轨配对视频容器族、mkv 归档兜底、force-mp4 才 transcode）+ `download-plan.ts` `buildDownloadPlan`（纯）。✅ 16 单测全绿（`resolveDownloadPlan` 的 provider-calling 包装并入 Phase 2 orchestrator）。
- [x] `Track`（`downloadedVideoHeight`/`downloadedContainer`/`downloadedCodecs`）/`StreamSourceConfig`（`videoQuality`）附加非索引字段，零 Dexie 迁移。✅

> **排期建议（基于 §1.4 基线）**：Bilibili 视频是对**已验证请求**的纯增量，可**先单独 ship**（Phase 1+2 只做 Bili 即可端到端最快见效）；YouTube 视频依赖活体对抗的 sig/n/PoToken（§4.6），**单独验收、不阻塞 Bili**。

#### Phase 1 Checklist
- [ ] 用 canned B站 playurl（含 `dash.video[]`）+ YT player 响应，单测能列出正确清晰度档并选中目标分辨率直链。
- [ ] Bilibili：视频侧 `fnval=4048` 取流后**音频路径回归无变化**（既有音频 resolve/播放测试全绿）。
- [ ] `chooseMuxStrategy` 对 AVC+AAC→mp4 copy、VP9/AV1+Opus→webm copy、强制 mp4 跨编码→transcode 全分支命中（穷举单测）。
- [ ] 全项目 `tsc` 绿；既有音频 resolve/缓存测试无回归。

### Phase 2: 渲染层 mediabunny copy-remux 下载 + 落盘/入库

**Goal:** 对 copy 友好的档（AVC+AAC→mp4、VP9+Opus→webm）实现端到端下载：fetch 两轨 → mediabunny 封装 → 持久存储 → 建本地 track，并提供「另存为文件」。

**Tasks:**
- [ ] `mux/mux-mediabunny.ts`：mediabunny `Output` + `Mp4OutputFormat`/`WebMOutputFormat` copy-remux（必要时 WebCodecs transcode）。
- [ ] `workers/video-mux-worker.ts`：mux 放 Worker（规则 7，不卡主线程）。
- [ ] `video-download.ts` `runVideoDownload` orchestrator（纯+注入，fake-mux 单测）。
- [ ] player-store `downloadStreamedVideo` action：注入 `mediaProxyUrl` fetch + worker mux + `writeMediaStorageBlob` store + 建/更新 track。
- [ ] 复用 `bridge.saveFile` 实现「另存为文件」。

#### Phase 2 Checklist
- [ ] Electron 手测：一个公开 B站 MV 选 720p（AVC+AAC）→ 下载 → 库里出现可离线播放的本地视频 track。
- [ ] 另存为文件能在文件管理器打开、音视频同步、可 seek。
- [ ] 大文件（>200MB）走持久存储而非 IndexedDB，下载中内存不爆（第二次循环复测，prod build）。
- [ ] 下载可取消、半成品被清理。

### Phase 3: 可选转码（不打包 FFmpeg）

**Goal:** 给「强制统一 mp4」少数场景提供转码，**不向 app 引入任何 FFmpeg 二进制**：WebCodecs 优先、用户自备 ffmpeg 兜底。可后置于 Phase 4，甚至按需再做（默认 copy 路径已覆盖绝大多数下载）。

**Tasks:**
- [ ] `MuxCaps` 能力探测（`VideoEncoder/AudioEncoder.isConfigSupported`）；渲染层 mediabunny 的 WebCodecs transcode 分支。
- [ ] `bridge.detectSystemFfmpeg` / `transcodeWithSystemFfmpeg`（仅检测/调用**用户的** ffmpeg）+ Electron 实现；tauri/web 缺省。
- [ ] Settings：「强制 mp4（最大兼容性）」开关 + 可选「ffmpeg 路径」+ 检测状态展示。
- [ ] `chooseMuxStrategy` transcode 分支按 caps 选 webcodecs / system-ffmpeg；都无 → copy→webm 降级 + 提示。

#### Phase 3 Checklist
- [ ] **确认安装包不含任何 FFmpeg / NodeAV 二进制**（`pnpm build` 产物核查 + 依赖树无 `@mediabunny/server`）。
- [ ] WebCodecs 路径：在支持平台把 VP9/Opus 强制转 mp4(AVC+AAC) 成功播放；Linux 等不支持平台正确降级。
- [ ] BYO 路径：装了系统 ffmpeg 时被检测到并完成转码；未装时给出清晰引导、不崩。

### Phase 4: 清晰度选择 UI + 进度 + 入口 + i18n

**Goal:** 把下载能力变成产品化交互。

**Tasks:**
- [ ] `download-quality-dialog.tsx`：档列表 + 体积估算 + 登录门提示 + 下载/另存 + 记住默认。
- [ ] track 菜单 / Now Playing / 搜索结果接入入口（`hasStreamingSources()` + `resolveVideo` gate）。
- [ ] 三段下载进度 + 取消 UI（ephemeral 状态）。
- [ ] 「已下载」徽标 + 「删除下载」。
- [ ] i18n en→zh/ja/ko 全量。

#### Phase 4 Checklist
- [ ] 四语言文案齐全、无内联硬编码用户可见串。
- [ ] web/tauri 壳下入口隐藏且附桌面专属提示。
- [ ] 端到端：选档→下载→进度→入库→离线播放→删除下载 全流程手测通过。

---

## 7. Out of Scope

- **网易云视频下载**：网易云源是纯音频（不实现 `resolveVideo`），本 PRD 不涉及其 MV。
- **Tauri / web 壳的视频下载 parity**：v1 仅 Electron（同 streamsrc PRD，`hasStreamingSources()` gate）。Tauri http 插件 + 自定义协议补齐后可点亮，推迟。
- **批量/歌单整单下载、后台队列、断点续传**：v1 单曲手动下载；批量与断点续传是后续增强。
- **字幕 / 弹幕（danmaku）下载与烧录**：不在本期；如需另开 PRD。
- **音频-only「下载成文件」改造**：已有 `runStreamCache`（缓存进 blob）+ `downloadTrackMedia`（本地 blob 另存）覆盖；本 PRD 聚焦视频。
- **移动端**：移动端走 [native PRD](../../mobile/) 的独立栈（Media3 / AVFoundation），不复用本桌面方案。
- **DRM / 加密流**：红线——不解密任何受 DRM 保护的内容（见 §8）。

---

## 8. Security & Compliance Considerations

- **红线：只处理可自由流式播放的内容，不碰 DRM**。本质上「下载」与现有「在线播放」拿的是同一份直链字节，只是改为持久化落盘——不新增任何解密/破解。沿用 [`qq-music-stream-source`](../../../../.claude/projects/-Users-doodlebear-Documents-code-MUZERO/memory/qq-music-stream-source-state.md) 的纪律：质量封顶于明文可得档，不解密 DRM 容器。
- **⚠️ Bilibili 工具链合规事件（2026，研究发现）**：B站对下载工具链施压已具象化——事实标准 API 文档 [`SocialSisterYi/bilibili-API-collect`](https://github.com/SocialSisterYi/bilibili-API-collect) 于 **2026-01-28 因律师函永久关停**（WBI 文档页现 404），[`nilaoda/BBDown`](https://github.com/nilaoda/BBDown) 于 **2026-05-14 被作者 archive**。含义：① **不把这两个已死项目作为可依赖的实现/文档来源**——我们 [streamsrc PRD](../../20260610-muzero-external-streaming-sources-prd/20260610-muzero-external-streaming-sources-prd.md) 与 `bili-wbi.ts` 原参考（NeriPlayer + 该文档）需改以仍维护的 [yt-dlp `bilibili.py`](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/bilibili.py) / yutto 校准；② Bili 抓取/签名绕过合规风险升高，维持「个人本地使用、BYO 登录态、不解密 DRM、不商用分发破解逻辑」红线。
- **个人使用 / BYOK / 默认关闭**：功能默认 disabled，高清/会员档需用户自带登录态；下载内容仅留本地、无上传无中转（规则 1）。
- **凭据纪律**：cookie/token 只在 `AppSettings.streamSources`（规则 2），永不进日志/遥测/bundle/URL。
- **FFmpeg 许可证红线（已决策，2026-06-20）：绝不打包 FFmpeg 库。** 因此**放弃** `@mediabunny/server`——其 NodeAV 后端内含 FFmpeg，LGPL/GPL 都会污染 MUZERO 的分发（LGPL 的动态链接 + 可替换义务对一个分发型桌面 app 同样是负担）。本 PRD 的 mux 只用：① `mediabunny` 渲染层 copy-remux（MIT、纯 JS、无 FFmpeg）；② 可选转码走 Chromium 自带 WebCodecs（已在 Electron，BSD，非我们打包）或**用户自备**的系统 ffmpeg（运行时检测，不分发）。`THIRD-PARTY-LICENSES.md` 仅需为 `mediabunny`（MIT）记一条；**不新增任何含 FFmpeg 的依赖**。
- **Electron 沙箱**：可选 BYO-ffmpeg 的 `detect/transcode` IPC 最小暴露；转码 I/O 走持久媒体存储 + realpath allowlist，spawn 用固定参数模板（不拼接用户输入），不接收任意路径（规则 10）。
- **回退 = `git revert`**：不藏 hidden flag；下载/转码不塞 `localStorage`/URL/`window.*` 开关，需要 toggle 就建可见 Settings 控件（规则 3，与 `feedback_no_hidden_backend_flags` 一致）。
- **Bundle size 预算**：渲染层 mediabunny 已在依赖中（增量近 0）。**不引入任何原生二进制**（无 `@mediabunny/server`/NodeAV/ffmpeg），故对安装包体增量近 0；BYO ffmpeg 由用户自行安装，不计入包体。

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [`20260610-muzero-external-streaming-sources-prd`](../../20260610-muzero-external-streaming-sources-prd/20260610-muzero-external-streaming-sources-prd.md) | 前序：在线源接入（搜索/resolve/播放/音频缓存），本 PRD 直接扩展其提取栈 |
| [`20260618-muzero-video-poster-frame-mediabunny-prd`](../../20260618-muzero-video-poster-frame-mediabunny-prd/20260618-muzero-video-poster-frame-mediabunny-prd.md) | mediabunny 现有用法（poster-frame 探测），本 PRD 将其扩展到 mux/转码 |
| [`20260612-muzero-opfs-persistent-media-storage-prd`](../../20260612-muzero-opfs-persistent-media-storage-prd/20260612-muzero-opfs-persistent-media-storage-prd.md) | 持久媒体存储（`writeMediaStorageBlob`），下载视频字节的落点 |
| [`20260614-muzero-electron-local-media-protocol-prd`](../../20260614-muzero-electron-local-media-protocol-prd/20260614-muzero-electron-local-media-protocol-prd.md) | 本地媒体协议（`localMediaUrlForStorageKey`），下载后视频的原生播放路径 |
| [Mediabunny server extension](https://mediabunny.dev/guide/extensions/server) | `@mediabunny/server`（NodeAV 转码）——**评估后放弃**：含 FFmpeg，违反「不打包 FFmpeg」红线（§8 / Open Q1） |
| [Mediabunny 转换文档](https://mediabunny.dev/guide/converting-media-files) | Conversion API 默认 transmux（copy，无重编码），本 PRD 的主路径依据 |
| [Mediabunny 支持的格式与 codec](https://mediabunny.dev/guide/supported-formats-and-codecs) | 容器×codec 矩阵（mp4 几乎全收 / webm 无 AAC / mkv 全收），§4.2 copy 策略依据 |
| [WebCodecs 编码支持数据](https://webcodecsfundamentals.org/datasets/codec-support/) | AVC/AAC 编码的平台覆盖（Linux 无 AAC 编码等），决定可选转码的可用范围 |
| [yt-dlp `bilibili.py`](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/bilibili.py) | **仍在维护**的 Bilibili 提取参考（WBI/fnval/qn/DASH 分轨），替代已关停的 bilibili-API-collect（§4.1/§8） |
| [LuanRT/BgUtils](https://github.com/LuanRT/BgUtils) | PoToken/BotGuard（`bgutils-js`）；须在渲染器 REAL DOM 铸 token，§4.6 依据 |
| [LuanRT/YouTube.js](https://github.com/LuanRT/YouTube.js) | `youtubei.js`：YT 解密（`Format.decipher`）与 PoToken 集成；提取层韧性依赖（§4.6） |
| ⚠️ [bilibili-API-collect（已关停）](https://github.com/SocialSisterYi/bilibili-API-collect) | 2026-01-28 律师函关停、勿依赖；仅作历史背景（§8） |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | 转码是否打包 FFmpeg？ | ✅ Resolved (2026-06-20) | **否**。放弃 `@mediabunny/server`（NodeAV 含 FFmpeg → LGPL/GPL 污染分发）。mux 只用 mediabunny 渲染层 copy-remux（MIT）+ 可选 WebCodecs / BYO 系统 ffmpeg |
| 2 | 下载后 track 的 `origin`：保持 `streamed`+blobId（保留来源引用）还是转 `uploaded`（完全本地化）？ | Open（默认 streamed+blobId） | 倾向保持 streamed + 填 blobId/storageKey（沿用 Phase 5 缓存模式、保留来源跳转与记忆）；如用户期望「彻底变本地文件」再评估 |
| 3 | 各平台 Electron 的 WebCodecs **编码**能力（AVC/AAC）覆盖度？决定「强制 mp4」在哪些平台直接可用、哪些需 BYO ffmpeg | Open | Phase 3 用 `isConfigSupported` 实测 win/mac/linux，据此决定 UI 是否对该平台显示「强制 mp4」或提示装 ffmpeg |
| 4 | 体积估算与「最高画质」档：是否需在选择前 HEAD 探测 `contentLength`，还是 `bandwidth×duration` 估算够用？ | Open | v1 用估算 + 标注「约」；精确体积留后续 |
| 5 | 是否支持「仅下载视频不入库、纯另存」的轻量路径（跳过持久存储与建 track）？ | Open | 倾向支持（saveFile 直接消费 mux 产物 Blob，不落库），UI 两按钮已含此意 |
| 6 | bilibili-API-collect / BBDown 关停后，Bili 提取的仍维护参考？ | ✅ Resolved (2026-06-20) | yt-dlp `bilibili.py`（活跃，Unlicense）+ yutto；不再依赖已死项目（§4.1/§8） |
| 7 | Mediabunny copy-remux 的 YT/B站 codec×容器兼容边界？ | ✅ 矩阵已明 / 🔲 播放边界待实测 | mp4 容器层面几乎全收，但 Chromium 仅可靠播 AVC+AAC@mp4 与 VP9·AV1+Opus@webm → 「音轨配对视频容器族」即可纯 copy（§4.2）；精确播放边界 Phase 2 实测 |
| 8 | PoToken 在纯 Electron（无 yt-dlp）栈如何取、是否需后端？ | ✅ Resolved (2026-06-20) | `bgutils-js` 在**渲染器 REAL DOM** 铸（已是 `youtube-ytjs.ts` 做法），无需后端；headless/主进程不可；归入提取层韧性（§4.6） |
| 9 | Bili「锁定的更高档」（未登录时仍想展示 1080P+/4K 以引导登录）如何列出？ | Open（v1 仅列可用档） | v1 `listVideoQualities` 只列 playurl **实际返回**的档（最准）；展示锁定更高档需解析 `support_formats[]`（带 `need_login`/`need_vip`），留后续 UI 增强 |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-20 | DoodleBear | Initial draft：视频清晰度选择 + 直接下载到本地导入 + mediabunny mux 方案，作为 external-streaming-sources PRD 的视频向扩展 |
| 2026-06-20 | DoodleBear | 决策：**绝不打包 FFmpeg**。移除 `@mediabunny/server` / 主进程转码；改为 copy-remux 优先（原生容器 mp4/webm）+ 可选 WebCodecs / BYO 系统 ffmpeg。Open Q1 关闭 |
| 2026-06-20 | DoodleBear | 纳入深度研究教训：§4.1 codec 偏好不硬编码 + Bili 参考改 yt-dlp `bilibili.py`（bilibili-API-collect/BBDown 已关停）；§4.2 Mediabunny 容器矩阵 +「音轨配对视频容器族」（几乎 100% 纯 copy）；新增 §4.6 提取层韧性（youtubei.js/bgutils 钉版本 + 丢格式不崩 + PoToken 渲染器铸）；§8 Bili 合规事件；§9 活源更新；Open Q6–8 关闭 |
| 2026-06-20 | DoodleBear | 对齐现状基线：新增 §1.4「Bilibili 音频整条已打通」——同一已验证 playurl 响应已含 `dash.video[]`（现被丢弃），故 Bili 视频是对已验证请求的纯增量（仅加 `parseDashVideo`/`resolveVideo` + 视频侧 `fnval` 16→4048，不动音频路径）；§4.1 + §6 改为「Bili 低风险先行、YouTube 脆弱独立验收」 |

---

> **Note:** 本 PRD 强调扩展既有 `src/streamsrc/` 提取栈与已装的 `mediabunny`，而非另起炉灶或引入 yt-dlp/ffmpeg CLI。所有源差异收进 provider 纯映射函数，桌面能力走 bridge 抽象（规则 5/10）。
