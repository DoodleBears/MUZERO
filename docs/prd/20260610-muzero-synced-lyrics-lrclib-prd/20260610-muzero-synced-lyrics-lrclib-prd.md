# PRD: MUZERO Synced Lyrics（LRCLIB 自动获取 + Apple Music 式逐行播放）

**Status:** Draft
**Created:** 2026-06-10
**Author:** DoodleBear
**Module:** `src/lyrics/` (new) · `src/db/` · `src/components/player/now-playing-panel.tsx` · `now-playing-sheet` · `src/stores/player-store.ts` · `src/lib/track-display.ts` · Settings · i18n

> 参考服务：[LRCLIB](https://lrclib.net)（[docs](https://lrclib.net/docs)）—— 完全免费、无需 API key、无需注册、无速率限制的同步歌词数据库，本身就是 LRCGET / 多款本地优先播放器的歌词后端。本 PRD 把"自动抓词 + Apple Music 式逐行高亮/点击跳转"两件事，落进 MUZERO 的硬规则约束（本地优先 / BYOK / 无 hidden flag / provider 边界 / 桌面壳抽象 / zustand 纪律 / vitest）。

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | 基础设施：`src/lyrics/` provider 抽象 + LRCLIB 纯映射 + LRC parser（纯函数 + 单测，无 UI/DB） | ✅ Done | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | 存储 + 抓取编排：`lyrics` 表（v20）+ repo + 触发/负缓存 + Settings 自动抓词开关（默认开）+ i18n | ✅ Done | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | 显示：Apple Music 式逐行高亮 + 自动滚动 + 点击跳转 + reduced-motion（now-playing-panel lyrics tab） | ✅ Done | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | 手动歌词：搜索/选择 modal + 粘贴/编辑/清除/重取（annotation-editor）| 🔲 Pending | [Phase 4 Checklist](#phase-4-checklist) |
| 5 | R2 云同步：歌词进 manifest（仿 thumbhash 提交 `cf454a1`）+ export/import/merge | 🔲 Pending | [Phase 5 Checklist](#phase-5-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

MUZERO 已有歌词的**两种割裂状态**：

- **AI 生成曲**（`origin: "generated"`）带 `Track.brief.lyrics`（DJ 写的纯文本，无时间轴）。Now-Playing 右栏 lyrics tab 已经渲染它——但只是一坨 `<pre>` 纯文本（[`now-playing-panel.tsx:205`](../../../src/components/player/now-playing-panel.tsx)）。
- **用户上传曲**（`origin: "uploaded"`）**完全没有歌词字段**：`brief` 为 undefined，lyrics tab 直接落到 `nowPlaying.noLyrics` 兜底；`media-metadata.ts` 也不抽内嵌歌词。

而产品内核是"**音乐承载回忆**"——用户上传的恰恰是自己珍视的歌，却看不到词、更别说跟唱。本 PRD 补这些能力：

1. **自动获取歌词（LRC）**：对上传/未来 streamed 曲，用 `title + artist + album + duration` 向 LRCLIB 取**同步歌词**（带 `[mm:ss.cs]` 时间轴）与纯文本，落本地库。
2. **Apple Music 式歌词播放**：逐行高亮当前句、随播放自动滚动并居中、**点击任意一行跳到该句开头**、过去/未来行渐隐、reduced-motion 兜底；桌面右栏 + 移动全屏 sheet 都支持。
3. **手动歌词**：自动匹配不准/查无时，用户可手动搜索选择、粘贴/编辑 LRC 或纯文本、清除重取（`source:"manual"` 优先，不被自动结果覆盖）。
4. **跨设备同步**：歌词（自动 + 手动）随既有 **R2 云同步**带走——进 manifest 契约（仿 thumbhash），换设备/远端曲也有词。**WebDAV 本期不做**（见 §7：MUZERO 目前无 WebDAV/无 provider 抽象，单列未来 PRD；歌词在 manifest 里是传输无关的，将来 WebDAV 落地自动带上）。

LRCLIB 与 MUZERO 气质天然契合：它本身就是为本地优先播放器设计的免费服务，无 key、无后端、无注册——不引入"MUZERO 自有后端"（见 §8）。

### 1.2 Target Users

| Role | Description | Permissions |
|------|-------------|-------------|
| **本地用户（owner）** | 在自己设备上听上传/生成的歌，想看到歌词并跟唱；想点歌词快速跳转到某句。 | 全功能；自动抓词为**可见 Settings 开关**控制（默认见 Q1），随时可关 |

> 单角色产品（本地优先、无账号系统）。

### 1.3 Core Value

1. **上传曲第一次有了歌词**：把 LRCLIB 数千万条同步歌词接进来，上传的"回忆之歌"也能看词跟唱。
2. **沉浸式跟唱体验**：Apple Music 式逐行高亮 + 自动滚动 + 点击跳转，把"听"升级成"跟"。
3. **生成曲一并受益**：`brief.lyrics`（无时间轴）走同一显示组件的纯文本路径；未来 musicgen 若回传时间轴可直接点亮逐行。
4. **零后端、隐私可控**：歌词存设备本地 IndexedDB；抓词是用户可关的第三方只读调用，不经任何 MUZERO 服务端。

---

## 2. System Architecture

### 2.1 Architecture Overview

```
                       Track 成为 current（player-store.currentIndex 变化）
                                    │
              origin==="uploaded"/"streamed" 且 settings.autoFetchLyrics 且 lyrics 表无记录
                                    │
                                    ▼
        buildLyricsQuery(track) ── { trackName, artistName, albumName?, durationSec? }
            （title / trackArtists() / mediaMetadata.album / durationSec —— 纯函数）
                                    │
                                    ▼
        LyricsProvider.fetch(query, signal)          ← src/lyrics/（平行于 musicgen/）
                                    │
            lrclib-provider：buildGetUrl → /api/get（精确签名，命中率最高）
                                    │  404 ↓
            buildSearchUrl → /api/search → pickBestHit（duration 邻近 + 优先有 synced）
                                    │
                所有出站 HTTP 走 getAppFetch() → 桌面 bridge（muzfetch CORS 代理 / tauri http / web）
                                    │  带 User-Agent: "MUZERO/<ver> (+homepage)"（主进程可设；规则 10）
                                    ▼
        LyricsHit { source, sourceId, synced?, plain?, instrumental } | null
                                    │
                                    ▼
        setTrackLyrics(trackId, hit)  ──写库──▶  lyrics 表（status: found|notFound|instrumental，负缓存）
                                    │
                                    ▼ （Dexie useLiveQuery，仅订阅 current track 一行）
        resolveTrackLyrics(track, lyricsRow) ── 单一裁决（纯函数，穷举单测）
              synced(LRC) → parseLrc → LyricsLine[]   |   plain   |   brief.lyrics   |   instrumental | none
                                    │
                                    ▼
        <SyncedLyricsView> ── 逐行高亮 + 自动滚动 + 点击 seek(line.timeMs/1000)
              当前行索引：positionSec 二分；平滑滚动/within-line：本地 rAF 读 getCurrentTime()
              （单 rAF + 可见性暂停 + reduced-motion，复刻 visualizer 纪律；不进 store state）
```

**两个设计支点：**

| 支点 | 说明 |
|---|---|
| **唯一裁决函数 `resolveTrackLyrics`** | 仿 [`resolveStageContent`](../../../src/lib/track-display.ts)（video→cover→title 的唯一裁决）。歌词来源同样多态（LRCLIB synced / LRCLIB plain / manual / `brief.lyrics` / instrumental / none），**收进一个纯函数穷举单测**，UI 不散落 `if`。 |
| **存储与显示解耦** | LRC 原文存库（`lyrics` 表）；解析 `parseLrc` + 当前行计算都是**渲染期纯函数**，不预存解析结果（便于 offset 调整/重解析，且省存储）。 |
| **同步走 manifest 契约（传输无关）** | 歌词进 R2 manifest 的 set-index（仿 thumbhash 提交 `cf454a1`：schema 加可选字段 → export 拷贝 → import 落地，**附加、不 bump manifest 版本、向后兼容**）。因为它落在 manifest 协议层而非 R2 专属 wire 代码，**将来任何传输（R2 现在 / WebDAV 未来）自动带上歌词**——这正是 WebDAV 可安全推后的原因。 |

### 2.2 Technology Stack

| Component | Technology | Rationale |
|---|---|---|
| **歌词 provider 抽象** | 新建 `src/lyrics/`：`LyricsProvider` 接口 + registry（**平行于** `MusicGenProvider`，不复用）| provider 边界纪律（规则 5）：musicgen 是"生成新歌→`{blob,mime,durationSec}`"；lyrics 是"按签名查已存在词→文本"。契约不同，分开。即便 v1 只有 LRCLIB 一个源，也按接口写，避免日后 `if(source===…)` 散落 |
| **vendor 映射隔离** | LRCLIB 请求/响应映射收进**纯函数** `buildGetUrl`/`buildSearchUrl`/`parseHit`/`pickBestHit`（注入 fetch）| 仿 cloud-provider 的 `mapBrief/parseCreate/parseStatus` 三纯函数范式（规则 5），可确定性单测 |
| **LRC 解析** | 自研 `parse-lrc.ts`（纯函数）：`[mm:ss.cs]` + 多时间戳行 + 元数据标签 + `offset` + 容错排序 | LRC 是简单格式（~80 LOC 覆盖），不引第三方 lib，避免 vendor lock-in（对齐 prd-create.md §3「优先 home-grown」）|
| **出站 HTTP** | `getAppFetch()` → 桌面 bridge（Electron `muzfetch` / Tauri http / web）| 规则 5/10：一律走 `resolveDesktopBridge().fetch`，绕 CORS；主进程可设 `User-Agent` |
| **存储** | Dexie **新建 `lyrics` 表**（bump v19→v20，新 store，无 upgrade/backfill）| 见 §3.2 决策：歌词文本（KB 级）**不能**附加到 `Track` 行——否则随虚拟列表 query 一起反序列化，违反规则 6「保持列表查询轻量」|
| **同步渲染** | 本地 rAF 读 `mediaEngine.getCurrentTime()` + reduced-motion + 可见性暂停；当前行 `positionSec` 二分 | 复刻 visualizer 的「单 rAF + 可见性暂停 + reduced-motion」纪律（规则 6 / [visualizer host](../../../src/visualizer/registry.ts)）；rAF 状态留组件本地，不进 store（避免每帧重渲全树）|
| **跳转** | 复用 [`player-store.seek`](../../../src/stores/player-store.ts)（`seek(sec)` → `mediaEngine.seek` + set positionSec）| 已存在，点击行直接调，不新增 transport 概念 |

### 2.3 Project Structure

```
src/
├── lyrics/                          # 新增：歌词获取（平行于 musicgen/）
│   ├── provider.ts                  # LyricsProvider / LyricsQuery / LyricsHit 接口（契约）
│   ├── registry.ts                  # LyricsProviderId union + resolveLyricsProvider(settings)
│   ├── lrclib-provider.ts           # LRCLIB 实现（薄壳，调下面纯函数 + getAppFetch）
│   ├── lrclib-map.ts                # 纯映射：buildGetUrl / buildSearchUrl / parseHit / pickBestHit
│   ├── lrclib-map.test.ts
│   ├── parse-lrc.ts                 # 纯函数：LRC → LyricsLine[]（时间戳/多戳/offset/容错）
│   ├── parse-lrc.test.ts
│   ├── build-query.ts              # buildLyricsQuery(track) 纯函数（title/artist/album/duration）
│   └── resolve-lyrics.ts           # resolveTrackLyrics(track, row) 唯一裁决（纯函数）+ .test.ts
├── db/
│   ├── types.ts                     # 新增 TrackLyrics 接口；AppSettings += autoFetchLyrics?
│   ├── muzero-db.ts                 # version(20).stores({ lyrics: "id, &trackId" })，无 upgrade
│   └── repositories.ts              # setTrackLyrics / getTrackLyrics / clearTrackLyrics（仿 setTrackNote）
├── sync/                            # 既有 R2 同步（仅扩展，不重构）—— Phase 5
│   ├── r2-manifest-schema.ts        # r2SetTrackSchema 加可选 lyrics 字段（仿 thumbhash）
│   ├── r2-export-plan.ts            # export：读 lyrics 表 → 写进 set-index 条目
│   └── r2-import-stream.ts          # import：remoteTrack.source.lyrics → 写 lyrics 表（用重映射 trackId）+ lyricsRemoteWins 合并
├── stores/
│   └── player-store.ts             # current track 变化时触发 maybeFetchLyrics（模块作用域 + AbortController）
├── components/player/
│   ├── now-playing-panel.tsx       # 右栏 lyrics tab：<pre> → <SyncedLyricsView>
│   ├── synced-lyrics-view.tsx      # 新增：逐行高亮 + 自动滚动 + 点击跳转（桌面/移动共用）
│   └── now-playing-sheet.tsx       # 移动全屏：同 <SyncedLyricsView>
├── components/track/
│   └── annotation-editor.tsx       # 新增"歌词"区：搜索/选择 modal + 粘贴/编辑/清除/重取（Phase 4）
└── components/settings/            # 自动抓词开关（默认开，+隐私说明）
```

---

## 3. Data Model Design

### 3.1 Core Concepts

```
Track（任意 origin）
  ├── origin:"generated" → brief.lyrics（纯文本，无时间轴）── 走 plain 路径
  ├── origin:"uploaded"  → 无内置词 ──────────────────────┐
  └── origin:"streamed"  → 无内置词（未来）───────────────┤  自动抓词目标
                                                          ▼
                                            lyrics 表（1:1，trackId 唯一）
                                              ├── synced?  （LRC 原文，带时间轴）
                                              ├── plain?   （纯文本）
                                              ├── instrumental
                                              ├── status   found | notFound | instrumental
                                              ├── source   "lrclib" | "manual"
                                              └── fetchedAt（负缓存判重抓）

显示：resolveTrackLyrics(track, lyricsRow) 唯一裁决
  synced 优先 → plain → track.brief.lyrics → instrumental 态 → none 态
```

### 3.2 Database Schema

⚠️ 优先扩展、不重构。当前 DB **v19**（[`src/db/muzero-db.ts:313`](../../../src/db/muzero-db.ts)）。

**关键决策（best practice）：歌词单独建 `lyrics` 表，而不是附加字段到 `Track`。** 这与 [external-streaming-sources PRD](../20260610-muzero-external-streaming-sources-prd/) 的"附加非索引字段、不 bump"路线**有意分道**——理由是数据体量与读取路径不同：

| 方案 | 判定 | 理由 |
|---|---|---|
| **新建 `lyrics` 表（采用）** | ✅ | 同步歌词文本是 **KB 级**（一首歌 2–5KB LRC）。若附加到 `Track` 行，会随**虚拟列表的 `db.tracks` query** 一起被读取/反序列化——一个 5000 首的库 = 每次列表 liveQuery 拖着 ~15MB 歌词文本。这正是规则 6 警示的「音频字节永不进 tracks 行、保持列表查询轻量」同类问题。独立表只在 Now-Playing 读 current 一行 |
| 附加 `Track.lyrics?` 非索引字段 | ❌ | 体量太大，污染列表 query（见上）。对照 [`Track.coverThumbhash`](../../../src/db/types.ts) 是 ~30 字节才适合附加 |

- **Current Schema:** [`src/db/types.ts`](../../../src/db/types.ts) — `Track`（行 55）、`TrackOrigin`（行 16）、`AppSettings`（行 322）。
- **Required Changes:**
  1. **新建 `TrackLyrics` 接口**（[`src/db/types.ts`](../../../src/db/types.ts)）：
     ```ts
     export interface TrackLyrics {
       id: string;            // lyr_xxx（新 id 前缀，codename 稳定，规则 4）
       trackId: string;       // 唯一索引（1:1）
       source: "lrclib" | "manual";
       sourceId?: string;     // LRCLIB 记录 id（便于复查/重取）
       synced?: string;       // 原始 LRC（含 [mm:ss.cs]）
       plain?: string;        // 纯文本
       instrumental: boolean;
       status: "found" | "notFound" | "instrumental";  // notFound = 负缓存，避免每播放都打 API
       matched?: { trackName: string; artistName: string; durationSec: number };  // 命中元数据（调试/校正用）
       fetchedAt: number;
     }
     ```
  2. **新 store**（[`src/db/muzero-db.ts`](../../../src/db/muzero-db.ts)，bump 到 v20，**无 upgrade 体**——新表起始为空）：
     ```ts
     this.version(20).stores({ lyrics: "id, &trackId" });
     ```
  3. **`AppSettings` 新增**（[`src/db/types.ts:322`](../../../src/db/types.ts)，**附加非索引字段**，settings 单行，无需 bump 它）：
     ```ts
     autoFetchLyrics?: boolean;  // 默认见 Q1；用户可在 Settings 关闭
     ```
- **Indexing:** `&trackId` 唯一索引（1:1 查 current track 的词）。不建其它二级索引。
- **Migration / Zero-Downtime:** 新表起始为空，**无 backfill、无 upgrade 回调**；旧库（v≤19）打开自动建空表。`id` 用现有 `newId("lyr")` 风格生成器（规则 4：新前缀 `lyr_`）。
- **Rollback Plan:** 回滚 = `git revert` 注册/表代码 + 重发版（规则 3）。Dexie 不支持降版本读，但 `lyrics` 表是纯附加、不影响 `tracks`/`mediaBlobs`/`sessions` 读取——回滚后旧表照常工作，残留的 `lyrics` 表被忽略。
- **Cloud Sync（Phase 5）：** `lyrics` 表是同步源——export 时读出写进 R2 manifest 的 set-index 条目，import 时落回 `lyrics` 表（详见 §4.8）。manifest schema 已带 `brief`（含 `brief.lyrics`，生成曲歌词**今天已隐式同步**），但上传/手动歌词在新表里，需在 manifest 单独加可选 `lyrics` 字段（仿 thumbhash，附加、不 bump manifest 版本）。
- **Privacy & Retention:** 歌词文本是公开内容，非敏感；但**抓词请求会把 `title/artist` 发给 lrclib.net**（见 §8 隐私）。提供"重新获取/清除歌词"清 `lyrics` 行。手动歌词可能含个人改写——分享投影（share projection）时按 §8 当作"投影可控"（与 memories 同级），owner-sync（自有设备，默认 tier ①）照常带走。

### 3.3 Data Relationship Diagram

```
AppSettings(id:"app")
  └── autoFetchLyrics: boolean            （可见开关，默认见 Q1）

Track ──1:0..1── TrackLyrics(&trackId)
  │                 ├── synced(LRC) / plain / instrumental
  │                 ├── status: found|notFound|instrumental   （notFound=负缓存）
  │                 └── source: lrclib|manual
  └── brief.lyrics（仅 generated；resolveTrackLyrics 的兜底来源之一）
```

---

## 4. Provider / API Design

### 4.1 `LyricsProvider` 接口（新建，平行于 MusicGenProvider）

⚠️ **不复用** [`MusicGenProvider`](../../../src/musicgen/provider.ts)（其 `generate(req)→{blob,mime,durationSec}` 是"生成"契约）。**复用其纪律**：可插拔接口 + DI + registry + 绝不在 store/UI 散落 `if(source===…)`。

```ts
// src/lyrics/provider.ts
export type LyricsProviderId = "lrclib";

export interface LyricsQuery {
  trackName: string;
  artistName: string;
  albumName?: string;
  durationSec?: number;
}

export interface LyricsHit {
  source: LyricsProviderId;
  sourceId?: string;
  synced?: string;          // LRC 原文
  plain?: string;
  instrumental: boolean;
  matched: { trackName: string; artistName: string; durationSec: number };
}

export interface LyricsProvider {
  readonly id: LyricsProviderId;
  readonly label: string;
  /** 命中返回 LyricsHit；明确"查无此词"返回 null（区别于 throw 的网络错误） */
  fetch(q: LyricsQuery, signal?: AbortSignal): Promise<LyricsHit | null>;
  health?(): Promise<boolean>;
}
```

`registry.ts` 仿 [`musicgen/registry.ts`](../../../src/musicgen/registry.ts)：`resolveLyricsProvider(settings)` 装配（v1 恒返回 LRCLIB）。store/UI 只调接口。

### 4.2 LRCLIB API（外部，全部 `https://lrclib.net/api/...`）

| 端点 | 方法 | 参数 | 用途 |
|---|---|---|---|
| `/api/get` | GET | `track_name`, `artist_name`, `album_name`, `duration`（秒；**snake_case 查询参数**）| **精确签名匹配**，返回单条最佳匹配；命中率最高，优先用 |
| `/api/search` | GET | `q` **或** `track_name`（≥1）+ 可选 `artist_name`/`album_name` | 模糊搜索，最多 20 条、无分页；`/api/get` 404 时兜底，或手动校正用 |
| `/api/get/{id}` | GET | 路径 id | 按记录 id 取（手动选择后） |
| `/api/publish` | POST | 需 PoW challenge | 贡献歌词——**out of scope** |

**响应 JSON（camelCase，注意与请求参数命名不一致）：**`/api/get` 返回单对象，`/api/search` 返回数组：
```jsonc
{
  "id": 3396226,
  "trackName": "...", "artistName": "...", "albumName": "...",
  "duration": 233,
  "instrumental": false,
  "plainLyrics": "I feel your breath...\n...",
  "syncedLyrics": "[00:17.12] I feel your breath...\n..."   // LRC，[mm:ss.cs]
}
```
- `syncedLyrics` / `plainLyrics` 任一可能为 `null`；`instrumental:true` 表示纯器乐（无词，**区别于"没找到"**）。
- **无 key、无注册、无速率限制**；鼓励（非强制）带 `User-Agent: MUZERO/<ver> (+<homepage>)`。浏览器层 fetch 设不了 UA，但 **muzfetch 主进程 `net.fetch` 能设**——正好走 bridge。

### 4.3 vendor 映射隔离（仿 cloud-provider 三纯函数）

```ts
// src/lyrics/lrclib-map.ts —— 纯函数，无 IO，穷举单测
export function buildGetUrl(q: LyricsQuery): string          // → /api/get?track_name=...&duration=...
export function buildSearchUrl(q: LyricsQuery): string       // → /api/search?track_name=...&artist_name=...
export function parseHit(json: unknown): LyricsHit | null    // camelCase → LyricsHit；instrumental/null 处理
export function pickBestHit(hits: LyricsHit[], q: LyricsQuery): LyricsHit | null
//   排序：duration 邻近（|d-q.duration|，容差 ±2~3s 优先）→ 有 synced 优先 → 非 instrumental 优先
```
`lrclib-provider.ts` 是薄壳：先 `getAppFetch()` 打 `buildGetUrl`（带 UA + signal）；404 → `buildSearchUrl` + `pickBestHit`；全空 → 返回 null。HTTP 失败 → throw（上层区分 notFound vs 错误）。

### 4.4 查询构造 + 抓取编排

**`buildLyricsQuery(track)`**（纯函数）：`trackName = track.title`、`artistName = trackArtists(track).join(", ")`、`albumName = track.mediaMetadata?.album`、`durationSec = track.durationSec`（见 [`track-display.ts`](../../../src/lib/track-display.ts) 的 `trackArtists`）。元数据严重缺失（仅文件名、无 artist）→ 返回 null，**不自动抓**（命中率太低、徒增隐私出站），留手动入口（Phase 4）。

**触发点**（[`player-store.ts`](../../../src/stores/player-store.ts)，current track 变化时）：
```ts
// maybeFetchLyrics(track) —— 模块作用域编排，不进 store state（规则 6）
if (!settings.autoFetchLyrics) return;
if (track.origin === "generated") return;            // 生成曲走 brief.lyrics
if (await getTrackLyrics(track.id)) return;          // 已有记录（含 notFound 负缓存）→ 不重抓
const q = buildLyricsQuery(track); if (!q) return;
// AbortController：切歌即 abort（仿 cloud-job / streaming resolve 的可取消纪律）
const hit = await resolveLyricsProvider(settings).fetch(q, signal);
await setTrackLyrics(track.id, hit);                  // hit=null → 写 status:"notFound" 负缓存
```

### 4.5 LRC 解析（`parse-lrc.ts`，纯函数）

```ts
export interface LyricsLine { timeMs: number; text: string }
export function parseLrc(lrc: string): LyricsLine[]
```
处理：`[mm:ss.cs]` 与 `[mm:ss.cscs]`（2/3 位小数）；**一行多时间戳** `[00:12.00][00:55.00] text`（展开成多行）；元数据标签 `[ar:][ti:][al:][by:][length:]`（跳过）；`[offset:±ms]`（整体平移所有时间）；空行/纯音乐间奏行保留为空 text（用于呈现空拍）；非法行丢弃；**按 timeMs 升序排序**。**穷举单测**（规则 7 同精神：纯函数穷举）。

### 4.6 唯一裁决 `resolveTrackLyrics`

```ts
// src/lyrics/resolve-lyrics.ts —— 仿 resolveStageContent，UI 不散落 if（穷举单测）
type ResolvedLyrics =
  | { mode: "synced"; lines: LyricsLine[]; source: "lrclib" | "manual" }
  | { mode: "plain"; text: string; source: "lrclib" | "manual" | "brief" }
  | { mode: "instrumental" }
  | { mode: "none" };

export function resolveTrackLyrics(track: Track, row: TrackLyrics | undefined): ResolvedLyrics
//  row.synced → parseLrc → synced
//  row.plain → plain
//  row.status==="instrumental" → instrumental
//  无 row 但 track.brief?.lyrics → plain(brief)        ← 生成曲
//  否则 → none（UI 显示 noLyrics 或 "正在获取…"）
```

### 4.7 Error Handling

- **查无此词**：`fetch` 返回 null → 写 `status:"notFound"`（负缓存），UI 显示 `nowPlaying.noLyrics`。**不弹错**（不是错误）。
- **网络/解析错误**：`fetch` throw → 不写库（下次切回可重试）；**静默**（抓词是后台增强，失败不该打断播放）——只走本地 logger（规则 8），**不**进 toast/dock（对照 [error-ux-architecture](../../../.claude/projects/-Users-doodlebear-Documents-code-MUZERO/memory/error-ux-architecture.md)：抓词失败非播放错误，无需打扰）。
- **instrumental**：写 `status:"instrumental"`，UI 显示"纯音乐 / 无歌词"专属态，而非"没找到"。
- **匹配错误（词不对）**：用户走手动校正（Phase 4）覆盖，`source:"manual"`。
- **Telemetry:** 本地优先、无遥测（规则 1）。绝不上报 title/artist/歌词内容到任何外部端。

### 4.8 R2 云同步（Phase 5，仿 thumbhash 提交 `cf454a1`）

⚠️ **只扩展既有 R2 同步，不重构**。当前 sync 层是 R2 硬编码（无 provider 抽象、无 WebDAV，见 §7 与 Q5）；本期把歌词接进**既有 manifest 契约**，三步走，与 [instant-cover-thumbnails PRD §3.4](../20260610-muzero-instant-cover-thumbnails-prd/) 把 thumbhash 接进 manifest 的提交（`cf454a1`）**逐字对齐**：

1. **schema 扩展**（[`src/sync/r2-manifest-schema.ts`](../../../src/sync/r2-manifest-schema.ts) 的 `r2SetTrackSchema`，~行 132–152）——加可选字段（附加、不 bump manifest 版本、向后兼容；旧 reader 忽略未知字段）：
   ```ts
   lyrics: z.object({
     synced: z.string().optional(),
     plain: z.string().optional(),
     instrumental: z.boolean().default(false),
     source: z.enum(["lrclib", "manual"]),
     sourceId: z.string().optional(),
   }).optional(),
   ```
   > 注：`r2SetTrackSchema` **已带 `brief`**（含 `brief.lyrics`），所以**生成曲歌词今天已隐式同步**；本字段补的是**上传/手动**曲的歌词（它们在新 `lyrics` 表、不在 brief）。
2. **export 路径**（[`src/sync/r2-export-plan.ts`](../../../src/sync/r2-export-plan.ts) 的 setIndexTracks 映射，~行 164–216）：构建条目前读出该 track 的 `lyrics` 行 → `lyrics: row ? { synced, plain, instrumental, source, sourceId } : undefined`。**纯数据搬运、无计算**（同 thumbhash 的 `thumbhash: track.coverThumbhash`）。
3. **import 路径**（[`src/sync/r2-import-stream.ts`](../../../src/sync/r2-import-stream.ts)，~行 50–117）：`remoteTrack.source.lyrics` 落回 `lyrics` 表——**注意 trackId 用 import 的重映射 id**（`remoteLocalId("trk", driveId, remoteTrack.id)`，与 track 行一致），在同一事务内 put。

**合并/冲突（LWW + 来源优先，纯函数穷举单测）：** 既有同步是整行 LWW（track 用 `updatedAt`、entity cover 用 [`entityCoverRemoteWins`](../../../src/sync/r2-import-stream.ts)）。`lyrics` 是独立表，加 `lyricsRemoteWins(local, remote)` 纯函数：**`source:"manual"` 永远胜过 `"lrclib"`**（手动校正不被自动结果覆盖）；同源比 `fetchedAt` 新者胜；本地无则取远端。

**同步范围：** 自动（lrclib）+ 手动都同步。理由：(a) 远端-only 曲（字节未下载）在别台设备也要有词；(b) 一次匹配跨设备一致；(c) **同步比各设备各自重抓更护隐私**（title/artist 只外发一次，不是每台设备一次）。set-index 本就携带 `brief`（歌词可达 4000 字），再加同量级歌词字段一致、不显著增重。

**Telemetry：** 同步是设备↔用户自有 R2，无 MUZERO 服务端（规则 1）；歌词内容不进任何日志/遥测。

---

## 5. Frontend Design

### 5.1 Page / Surface Structure

```
components/player/
├── now-playing-panel.tsx     # 桌面右栏 lyrics tab：现 <pre>{brief.lyrics} → <SyncedLyricsView track={current} />
├── synced-lyrics-view.tsx    # 新增：桌面/移动共用的歌词渲染核心
└── now-playing-sheet.tsx     # 移动全屏 sheet：同 <SyncedLyricsView />（Apple Music 式全屏跟唱）
components/settings/          # 自动抓词开关 + 隐私一行说明
components/track/             # （Phase 4）annotation-editor 加"歌词"区：搜索/选择/手动粘贴
```

### 5.2 `<SyncedLyricsView>` —— Apple Music 式交互（本 PRD 的体验核心）

| 行为 | 实现要点 |
|---|---|
| **逐行高亮** | 当前行：`text-foreground` + 略放大/加粗 + 跟随 `--primary`；过去行渐隐、未来行更淡（透明度梯度）。当前行索引 = 对 `lines[].timeMs` 用 `positionSec*1000` **二分**。 |
| **自动滚动居中** | 当前行平滑滚到容器中部（`scrollInto-center`，motion/CSS smooth）。用户手动滚动时**暂停自动跟随**几秒（检测 wheel/touch），再恢复——避免和用户抢滚动。 |
| **点击跳转** | 每行可点（synced 模式），`onClick → usePlayerStore.getState().seek(line.timeMs/1000)`（复用现有 [`seek`](../../../src/stores/player-store.ts)）。点完即跳到该句开头并续播。键盘可达（`role="button"`/`tabIndex`，Enter 触发）。 |
| **平滑度** | `timeupdate` 仅 ~4Hz（[media-engine.ts:70](../../../src/player/media-engine.ts)），足够**切行**；但平滑滚动 / 可选 within-line 进度填充用**本地 rAF 读 `getCurrentTime()`**（[media-engine.ts:211](../../../src/player/media-engine.ts)）。rAF：**仅播放中 + tab 可见时跑**，`document.hidden`/blur 暂停，**reduced-motion 退化为瞬切**（复刻 visualizer host 纪律；见 [preview-hidden-tab-gotcha](../../../.claude/projects/-Users-doodlebear-Documents-code-MUZERO/memory/preview-hidden-tab-gotcha.md)）。 |
| **回退态** | `mode:"plain"` → 纯文本不可点、无高亮；`mode:"instrumental"` → "纯音乐"插画/文案；`mode:"none"` → 抓取中显示 `lyrics.fetching`，否则 `nowPlaying.noLyrics`。 |

### 5.3 State Management（规则 6 纪律）

- **当前行索引**：组件内用最小 selector `usePlayerStore(s => s.positionSec)` 订阅（4Hz，切行够用），本地 `useMemo` 二分得 index。**不**把 index 提进 store。
- **平滑 rAF**：组件本地 `useEffect` 起单个 rAF 读 `getCurrentTime()`，写**本地 ref/state**（仅驱动当前行动画/滚动），**绝不**进 store state（否则每帧重渲全树，规则 6）。卸载/不可见/暂停即停 rAF。
- **抓词编排**：模块作用域（player-store 的 `maybeFetchLyrics` + AbortController），不进 store state（规则 6：非响应式单例不进 store）。
- **歌词数据**：`useLiveQuery` 按 `currentTrackId` 读 `lyrics` 表一行（Dexie 响应式），不塞 Zustand。

### 5.4 Settings

- **外观/播放**区加 `自动获取歌词` 开关 → 写 `AppSettings.autoFetchLyrics`（仿现有 `saveSettings({...})`）。
- 开关下一行**隐私说明**（i18n）：开启会把歌名/艺人发送给 lrclib.net 以匹配歌词。
- （Phase 4）每首歌可"重新获取 / 清除歌词"。

### 5.5 i18n（4 locale，per prd-create.md §3）

新增 key 先加 **en**（类型源）再补 zh/ja/ko：
- `nowPlaying.lyrics` / `nowPlaying.noLyrics`（已存在，复用）
- `lyrics.fetching`（"正在获取歌词…"）、`lyrics.instrumental`（"纯音乐 · 无歌词"）、`lyrics.source`（"歌词来自 {{source}}"，LRCLIB 署名）
- `settings.autoFetchLyrics` + `settings.autoFetchLyricsHint`（隐私说明）
- （Phase 4）`lyrics.search` / `lyrics.pickMatch` / `lyrics.pasteManual` / `lyrics.refetch` / `lyrics.clear`

少 locale 在 PR 标 "pending translation" + 开 i18n followup。歌词来源名/状态不写按 locale 的大对象分支。

### 5.6 手动歌词（Phase 4，核心，非可选）

自动匹配可能选错版本或查无，**手动歌词是一等能力**。落在 [`annotation-editor.tsx`](../../../src/components/track/annotation-editor.tsx) 新增"歌词"区（与 tag/note/cover 同处，"音乐承载回忆"的统一注释面板）：

- **搜索/选择**：弹 modal，用 `/api/search` 列候选（标题/艺人/专辑/时长/是否有 synced），用户点一条 → `/api/get/{id}` 取全文 → 写库 `source:"manual"`。
- **粘贴/编辑**：直接粘贴 LRC 或纯文本（自动判别有无 `[mm:ss]` 时间戳走 synced/plain），保存为 `source:"manual"`。
- **清除/重取**：清 `lyrics` 行（含负缓存），可重新自动获取。
- **优先级**：`source:"manual"` 不被自动抓覆盖（编排里 `getTrackLyrics` 命中即跳过抓取；同步合并里 manual 恒胜，见 §4.8）。
- 全程 i18n（§5.5），出站仍走 `getAppFetch()`（规则 5/10）。

---

## 6. Implementation Plan

> 顺序遵循 prd-create.md §3「基础设施先于覆盖广度」：Phase 1（纯函数地基）零风险先合并，Phase 2/3 在其上叠加。

### Phase 1: 基础设施（纯函数 + 单测，无 UI/DB）

**Goal:** `src/lyrics/` provider 抽象 + LRCLIB 纯映射 + LRC parser + 查询构造 + 唯一裁决，全部纯函数 + 单测就位，不接 DB/UI。

**Tasks:**
- [ ] `src/lyrics/provider.ts` + `registry.ts`：接口 + `resolveLyricsProvider`（恒 LRCLIB）。
- [ ] `lrclib-map.ts`：`buildGetUrl`/`buildSearchUrl`/`parseHit`/`pickBestHit`（snake_case 参数 / camelCase 响应 / instrumental / null）。
- [ ] `parse-lrc.ts`：LRC → `LyricsLine[]`（多时间戳/offset/元数据标签/容错/排序）。
- [ ] `build-query.ts`：`buildLyricsQuery(track)`（缺元数据返回 null）。
- [ ] `resolve-lyrics.ts`：`resolveTrackLyrics(track, row)` 唯一裁决。
- [ ] `lrclib-provider.ts`：薄壳（get→404→search→pickBest），注入 fetch 可单测。

#### Phase 1 Checklist
- [x] `buildGetUrl` 对固定 query 产出期望 URL（snake_case + URL 编码）。
- [x] `parseHit` 对 canned LRCLIB JSON（含 instrumental、含 null synced）映射正确。
- [x] `pickBestHit` 按 duration 邻近 + synced 优先选中预期条目（含容差边界）。
- [x] `parseLrc` 穷举：多时间戳行展开、`offset` 平移、非法行丢弃、空行保留、升序。
- [x] `resolveTrackLyrics` 穷举：synced/plain/instrumental/brief/none 五态。
- [x] `lrclib-provider` 注入式单测：get 命中 / get 404→search 兜底 / 全空→null / 网络错误→throw。
- [x] `make check` 通过（`src/lyrics` 42 测试绿 + biome 干净 + lefthook 暂存 typecheck）。

> **Phase 1 实现说明（2026-06-10）：** `src/lyrics/` 落地 7 文件——`provider.ts`（契约 + `LyricsRecord`/`LyricsHit`/`LyricsError`）、`parse-lrc.ts`、`lrclib-map.ts`（`buildGetUrl`/`buildSearchUrl`/`parseHit`/`parseSearchResults`/`pickBestHit`）、`build-query.ts`、`resolve-lyrics.ts`、`lrclib-provider.ts`（注入 fetch）、`registry.ts`。5 个 `.test.ts` 共 42 例，全绿。无 DB/UI 依赖。

### Phase 2: 存储 + 抓取编排

**Goal:** `lyrics` 表落地 + repo + current track 触发自动抓词（含负缓存、可取消）+ Settings 开关 + i18n。

**Tasks:**
- [ ] `db/types.ts`：`TrackLyrics` 接口；`AppSettings.autoFetchLyrics?`。
- [ ] `db/muzero-db.ts`：`version(20).stores({ lyrics: "id, &trackId" })`（无 upgrade 体）。
- [ ] `repositories.ts`：`setTrackLyrics(trackId, hit|null)` / `getTrackLyrics(trackId)` / `clearTrackLyrics(trackId)`（仿 [`setTrackNote`](../../../src/db/repositories.ts)）。
- [ ] `player-store.ts`：current track 变化 → `maybeFetchLyrics`（模块作用域 + AbortController，切歌 abort）。
- [ ] Settings 开关（`autoFetchLyrics` **默认 `true`**，见 [`DEFAULT_SETTINGS`](../../../src/db/types.ts)）+ 隐私说明 + i18n（en→zh/ja/ko）。

#### Phase 2 Checklist
- [x] 旧库（v19）打开自动建空 `lyrics` 表，旧数据读取无碍（`version(20)` 附加表、无 upgrade 体）。
- [x] 全新安装默认开启自动抓词（`DEFAULT_SETTINGS.autoFetchLyrics = true`）。
- [x] 播放一首有 artist 元数据的上传曲 → 自动抓到并写库；切歌中途 abort 不写脏数据（`runAutoFetchLyrics` 单测）。
- [x] 负缓存：`notFound`/`instrumental` 不重复打 API（`shouldAutoFetchLyrics`/existing 命中即跳过，单测）。
- [x] 开关关闭后不发任何 lrclib 出站请求（"does not fetch when disabled" 单测）。
- [x] 抓词请求带 `User-Agent`（`lrclib-provider` headers，best-effort；muzfetch 主进程可设）。
- [x] `make check` 通过（`src/lyrics` 60 测试绿 + biome 干净 + 全项目 `tsc --noEmit` 退出 0）。

> **Phase 2 实现说明（2026-06-10）：** 数据层 `db/types.ts`（`TrackLyrics extends LyricsRecord` + `AppSettings.autoFetchLyrics` + `DEFAULT_SETTINGS` 默认 true）、`muzero-db.ts`（`version(20).stores({ lyrics: "id, &trackId" })`）、`repositories.ts`（`getTrackLyrics`/`setTrackLyrics`/`clearTrackLyrics`）。编排 `src/lyrics/auto-fetch.ts`（`shouldAutoFetchLyrics`/`lyricsRecordFromHit`/`runAutoFetchLyrics`，注入 provider+db 可单测）。`player-store.ts` 在 `ensureLoadedAndPlay` 的换曲点 `triggerLyricsAutoFetch`（模块作用域 + AbortController，不进 store state）。Settings「外观」加可见开关 + 隐私说明；i18n 4 locale。新增 18 测试（共 60 绿）。

### Phase 3: Apple Music 式显示

**Goal:** `<SyncedLyricsView>` 逐行高亮 + 自动滚动居中 + 点击跳转 + reduced-motion；接进右栏 lyrics tab 与移动全屏 sheet；替换现 `<pre>` brief 渲染。

**Tasks:**
- [ ] `synced-lyrics-view.tsx`：消费 `resolveTrackLyrics` + `useLiveQuery(lyrics)`；二分当前行；本地 rAF 平滑（可见性/reduced-motion gate）。
- [ ] 点击行 → `seek(line.timeMs/1000)`；键盘可达。
- [ ] 自动滚动居中 + 用户手动滚动暂停跟随。
- [ ] `now-playing-panel.tsx` lyrics tab：`<pre>` → `<SyncedLyricsView>`；`now-playing-sheet` 移动全屏接入。
- [ ] 回退态：plain / instrumental / fetching / none + LRCLIB 署名。

#### Phase 3 Checklist
- [x] synced 歌词逐行高亮（`activeLineIndex` 二分，单测）+ 自动滚动居中（`scrollIntoView({block:"center"})`）。
- [x] 点击任意行跳到该句开头（`onSeek(timeMs/1000)`，组件单测验证）。
- [x] reduced-motion 下瞬切（`prefersReducedMotion()` → `behavior:"auto"`）。**实现用 4Hz `positionSec` selector，非 per-frame rAF**——故无 hidden-tab rAF 隐患（rAF 平滑留作后续增强）。
- [x] 生成曲 `brief.lyrics` 走 plain 路径正常显示（`resolveTrackLyrics` + plain 渲染，单测）。
- [x] instrumental / noLyrics / fetching 三态正确（`SyncedLyricsView` 分支 + i18n）。
- [x] 单一歌词面（now-playing-panel lyrics tab，桌面右栏 + now-playing-page 共用）。**注：仓库无独立 now-playing-sheet 组件**，故不另起；移动全屏由 now-playing-page 承载同一面板。
- [x] 播放期不每帧整树重渲：最小 selector（`positionSec`/`seek`，4Hz）+ 模块作用域抓取，不进 store state（规则 6）。
- [x] `make check` 通过（`src/lyrics` + 组件共 70 测试绿 + biome 干净 + `tsc --noEmit` 退出 0）。

> **Phase 3 实现说明（2026-06-10）：** 新增 [`synced-lyrics-view.tsx`](../../../src/components/player/synced-lyrics-view.tsx)：`SyncedLyricsView`（hooks 壳：`useLiveQuery(getTrackLyrics)` + `usePlayerStore(positionSec/seek)` + `useSettings`，消费 `resolveTrackLyrics`）+ 导出的纯展示 `LyricsScroller`（synced 逐行高亮/点击跳转/自动滚动、plain、LRCLIB 署名）。`now-playing-panel` lyrics tab 由 `<pre>{brief.lyrics}` 换成 `<SyncedLyricsView track={current} />`。i18n `lyrics.fetching/instrumental/source` ×4 locale。**与 §2.2/§5.2 的偏差**：v1 用 store 的 4Hz `positionSec` 切行（够顺、零 rAF、规则 6），未上 per-frame rAF 平滑/within-line 填充——列为后续增强。新增 10 测试（共 70）。**视觉顺滑度建议用户在真实播放一首有 LRCLIB 匹配的上传曲时确认**（沙箱预览难以可靠地起播放 + 外网抓词）。

### Phase 4: 手动歌词（核心）

**Goal:** `annotation-editor` 加"歌词"区——搜索/选择 modal + 粘贴/编辑 + 清除/重取；`source:"manual"` 优先、不被自动覆盖。

**Tasks:**
- [ ] `annotation-editor.tsx` 新增"歌词"区（与 tag/note/cover 同面板）：`重新获取` / `清除`。
- [ ] 搜索 modal：`/api/search` 列多条候选（标题/艺人/专辑/时长/有无 synced），选 → `/api/get/{id}` → `source:"manual"` 写库。
- [ ] 手动粘贴/编辑 LRC 或纯文本（自动判别时间戳走 synced/plain），`source:"manual"`。
- [ ] 编排与合并里 `source:"manual"` 优先（命中即跳过自动抓 / 合并恒胜）。
- [ ] i18n（en→zh/ja/ko）。

#### Phase 4 Checklist
- [ ] 手动选择/粘贴的歌词覆盖自动结果且不被再抓覆盖（`source:"manual"` 优先）。
- [ ] 粘贴的 LRC 能逐行播放（接 Phase 3 显示）。
- [ ] 清除后可重新自动获取。
- [ ] `make check` 通过。

### Phase 5: R2 云同步（仿 thumbhash 提交 `cf454a1`）

**Goal:** 歌词（自动 + 手动）随既有 R2 同步带走——进 manifest 的 set-index 条目，export/import/merge 全通，**只扩展不重构**。

**Tasks:**
- [ ] [`r2-manifest-schema.ts`](../../../src/sync/r2-manifest-schema.ts)：`r2SetTrackSchema` 加可选 `lyrics` 对象（附加、不 bump manifest 版本）。
- [ ] [`r2-export-plan.ts`](../../../src/sync/r2-export-plan.ts)：构建 set-index 条目时读 `lyrics` 行 → 写入。
- [ ] [`r2-import-stream.ts`](../../../src/sync/r2-import-stream.ts)：`remoteTrack.source.lyrics` → 写 `lyrics` 表（用重映射 trackId，同事务）。
- [ ] `lyricsRemoteWins(local, remote)` 纯函数（manual > lrclib；同源比 fetchedAt）+ 穷举单测。

#### Phase 5 Checklist
- [ ] export→import 往返保留歌词（synced + plain + source），仿 [r2-import-stream 现有往返单测](../../../src/sync/r2-import-stream.test.ts)。
- [ ] 旧 manifest（无 `lyrics` 字段）import 不报错（向后兼容）。
- [ ] 远端-only 曲（字节未下载）也能显示同步来的歌词。
- [ ] 合并：本地 manual 不被远端 lrclib 覆盖（`lyricsRemoteWins` 单测）。
- [ ] `make check` 通过。

---

## 7. Out of Scope

- **WebDAV 云盘同步（明确推后，单列未来 PRD）**：MUZERO 当前 sync 层**完全是 R2 硬编码**（`src/sync/r2-*.ts`），无 WebDAV、无 `CloudDriveProvider` 抽象（`CloudDrive.provider` 只是 `"r2"|"mu0"` 标签，无对应接口）。支持 WebDAV = 先把 R2 硬编码 sync 抽象成统一 provider 接口、再实现 WebDAV transport——这是**比本 PRD 大得多的独立架构工程**，应另开 PRD。**好处**：本 PRD 已把歌词放进**传输无关的 manifest 契约**（§4.8），未来 WebDAV PRD 落地后歌词**自动随之同步**，无需回头改歌词代码。
- **内嵌歌词解析（USLT/SYLT/Vorbis）**：作离线兜底——多数上传文件无内嵌词，优先级低于 LRCLIB；后续可在 `media-metadata.ts` 增量做，不在本期。
- **贡献歌词到 LRCLIB**（`/api/publish` + PoW challenge）：只读取，不上传。
- **生成曲的时间轴**：musicgen 目前回传纯文本 `brief.lyrics`，不自造时间戳；待 provider 支持再点亮 synced。
- **逐字（word-level）卡拉OK高亮**：v1 做**逐行**（Apple Music 主体验）；逐字需 enhanced LRC（`<mm:ss.cs>` 词级标签），LRCLIB 多数无此数据 —— 后续评估。
- **多源歌词聚合**（QQ音乐/网易/Musixmatch 等）：v1 只 LRCLIB（Q6 已定）；接口已可插拔，后续加源只实现 `LyricsProvider` + 注册。
- **歌词翻译/双语对照**：后续增强。
- **Web 壳 User-Agent**：浏览器层设不了 UA（LRCLIB 不强制，可省）；桌面端经 muzfetch 设。

---

## 8. Security / Privacy / Compliance Considerations

- **本地优先 / 无自有后端（规则 1）**：歌词存设备本地 IndexedDB `muzero-db`；LRCLIB 是**第三方免费只读服务**，不经任何 MUZERO 服务端，不构成"MUZERO 自有后端"。这是继 LLM/musicgen（BYOK）之后的第三个出站端点——与 [external-streaming-sources](../20260610-muzero-external-streaming-sources-prd/) 的扩张同类，但**更轻**（无凭据、只读、无反爬）。
- **🔸 隐私（核心关注点）**：自动抓词会把**当前曲的 `title + artist + album + duration` 发送给 lrclib.net**。因此：(a) 由**可见 Settings 开关**控制（规则 3：不藏 flag），(b) 开关旁附明确隐私说明，(c) **默认开启**（Q1 已定）。**绝不**发送音频字节、用户的 tag/note/记忆、播放历史。
- **🔸 同步隐私（owner-sync vs share projection）**：歌词随 R2 同步——**owner-sync（自有设备，默认 tier ①）照常带走**，这是同步的目的。但 R2 PRD §2.8 明列一条 pitfall：「不要在未经 share projection review 的情况下默认发布私有 notes / **lyrics** / prompts / 照片」。因此**对第三方 share projection**，手动歌词（可能含个人改写）按 **memories 同级的"投影可控"**处理（受 share capability 控制，不默认外发）；自动 lrclib 歌词是公开内容，敏感度低。share projection 本身是 V3，本期只需保证 owner-sync 正确 + 不把歌词塞进 share 默认投影。
- **无 hidden flag（规则 3）**：开关 = 可见 Settings 控件；回滚 = `git revert` + 重发版，不藏 `localStorage`/URL/`window.*`。
- **出站 HTTP 收口（规则 5/10）**：一切请求走 `getAppFetch()` → bridge；不直接 `window.fetch` 外部 API。
- **BYOK 纪律（规则 2）**：LRCLIB 无 key——天然不涉密钥；不内置任何凭据。
- **Telemetry**：本地优先、无遥测（规则 1）。失败只走本地 logger（规则 8），**永不**记录 title/artist/歌词内容到任何外部端。
- **provider 边界（规则 5）**：`LyricsProvider` 独立抽象，不污染 musicgen 链路；UI/store 不散落 `if(source===…)`。
- **codename 稳定（规则 4）**：db 名 `muzero-db` 不变；新 id 前缀 `lyr_`、新表名 `lyrics`、provider id `"lrclib"` 跨品牌/壳稳定。
- **License**：LRCLIB 数据由社区贡献、API 免费公开使用；不 bundle 任何歌词数据（运行时按需取），不分发歌词库。

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [LRCLIB docs](https://lrclib.net/docs) | 外部 API 文档（SPA；端点见 §4.2）|
| [CLAUDE.md](../../../CLAUDE.md) | 硬规则 1(本地优先)/2(BYOK)/3(无 flag)/4(codename)/5(provider 边界)/6(zustand)/7(vitest)/8(logger)/9(播放)/10(桌面壳) |
| [`musicgen/provider.ts`](../../../src/musicgen/provider.ts) / [`registry.ts`](../../../src/musicgen/registry.ts) | 被平行参照的 provider + registry 模式 |
| [`cloud-provider.ts`](../../../src/musicgen/cloud-provider.ts) | 三纯函数 vendor 隔离范式（lrclib-map 仿照）|
| [`track-display.ts`](../../../src/lib/track-display.ts) | `resolveStageContent`（唯一裁决范式）+ `trackArtists`（查询构造用）|
| [`media-engine.ts`](../../../src/player/media-engine.ts) / [`player-store.ts`](../../../src/stores/player-store.ts) | `seek` / `getCurrentTime` / `positionSec`（显示与跳转）|
| [`now-playing-panel.tsx`](../../../src/components/player/now-playing-panel.tsx) | 现 lyrics tab（替换点）|
| [`annotation-editor.tsx`](../../../src/components/track/annotation-editor.tsx) | tag/note/cover 注释面板（手动歌词区落点，Phase 4）|
| [`r2-manifest-schema.ts`](../../../src/sync/r2-manifest-schema.ts) / [`r2-export-plan.ts`](../../../src/sync/r2-export-plan.ts) / [`r2-import-stream.ts`](../../../src/sync/r2-import-stream.ts) | R2 同步三改造点（Phase 5，仿 thumbhash）|
| 相关 PRD | [R2 cloud-drive sync](../20260609-muzero-r2-cloud-drive-sync-prd/)（被扩展的同步机制）、[instant-cover-thumbnails §3.4](../20260610-muzero-instant-cover-thumbnails-prd/)（thumbhash-through-manifest，本期同步逐字对齐的提交 `cf454a1`）、[external-streaming-sources](../20260610-muzero-external-streaming-sources-prd/)（出站源 + bridge 同纪律）、[cloud musicgen provider](../20260607-muzero-cloud-musicgen-provider-selection-prd/)（三纯函数范式）|
| Memory | [error-ux-architecture](../../../.claude/projects/-Users-doodlebear-Documents-code-MUZERO/memory/error-ux-architecture.md)、[preview-hidden-tab-gotcha](../../../.claude/projects/-Users-doodlebear-Documents-code-MUZERO/memory/preview-hidden-tab-gotcha.md)、[electron-shell-pivot](../../../.claude/projects/-Users-doodlebear-Documents-code-MUZERO/memory/electron-shell-pivot.md) |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| Q1 | 自动抓词默认开还是默认关？ | ✅ 已定（2026-06-10）| **默认开 + 可关 + 隐私说明**（`autoFetchLyrics` 缺省 true）|
| Q2 | 歌词单独建表 vs 附加 `Track` 字段 | ✅ 已定 | **单独 `lyrics` 表**（KB 级文本不污染虚拟列表 query，规则 6）；bump v20、无 backfill |
| Q3 | 平滑度方案 | ✅ 已定 | 切行用 `positionSec`(4Hz)；平滑滚动/within-line 用本地 rAF 读 `getCurrentTime()`，可见性+reduced-motion gate，不进 store |
| Q4 | 逐行 vs 逐字高亮 | ✅ 已定（v1）| v1 **逐行**；逐字需 enhanced LRC，多数无数据，后续评估 |
| Q5 | 手动歌词 + 同步 | ✅ 已定（2026-06-10）| **手动上传/编辑歌词进核心**（Phase 4，annotation-editor）；歌词随 **R2 同步**进 manifest（Phase 5，仿 thumbhash）。**WebDAV 完全推后**（单列未来 PRD，见 §7；歌词在 manifest 里传输无关，将来自动带上）|
| Q6 | LRCLIB 不可用时是否预留第二源 | ✅ 已定（2026-06-10）| 接口可插拔但 **v1 只 LRCLIB**；后续加源只实现 `LyricsProvider` + 注册 |
| Q7 | 同步范围：仅 manual vs lrclib+manual | ✅ 已定 | **两者都同步**（远端-only 曲也有词 / 跨设备一致 / 同步比各设备重抓更护隐私），见 §4.8 |
| Q8 | 内嵌歌词（USLT/SYLT）离线兜底 | 🔲 待定 | out of scope（§7）；多数上传无内嵌词，优先级低于 LRCLIB，后续增量 |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-10 | DoodleBear | 初稿：LRCLIB 自动抓词 + Apple Music 式逐行播放（高亮/自动滚动/点击跳转）。确定单独 `lyrics` 表(v20)、provider 可插拔抽象、rAF 平滑方案；Q1/Q5/Q6 待定 |
| 2026-06-10 | DoodleBear | 据评审定 Q1/Q5/Q6/Q7：自动抓词**默认开**；**手动歌词进核心**（Phase 4）；**歌词随 R2 同步**进 manifest（Phase 5，仿 thumbhash `cf454a1`，新增 §4.8 + §5.6）；**WebDAV 完全推后**（单列未来 PRD，§7）；v1 只 LRCLIB；自动+手动均同步。Phase 由 4 增至 5 |

---

> **Note:** 本 PRD 优先**扩展**现有结构（lyrics tab / player-store seek / repo setter 范式 / provider registry 纪律 / **R2 manifest 同步**=仿 thumbhash 只扩展不重构 / annotation-editor 注释面板）。新建仅限：`src/lyrics/`（新 parser + lib bridge）、`lyrics` 表（新存储）、`synced-lyrics-view`（新交互组件）。R2 同步三处（schema/export/import）与 annotation-editor 歌词区均为**编辑既有文件**。所有 vendor/格式脏活收进纯函数穷举单测，UI/store 不散落 `if(source===…)`。**WebDAV 不在本期**——歌词进传输无关的 manifest 契约，未来 WebDAV PRD 自动带上。
