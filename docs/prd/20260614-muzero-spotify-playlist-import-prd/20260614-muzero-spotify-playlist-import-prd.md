# PRD: MUZERO Spotify 歌单导入（元数据导入 + YouTube 匹配播放）

**Status:** Draft
**Created:** 2026-06-14
**Author:** DoodleBear
**Module:** `src/playlistsrc/`（新建）· `src/streamsrc/youtube/`（复用播放）· `src/lib/desktop/`（OAuth 回调）· `electron/`（loopback listener）· `src/db/`（provenance 字段）· Settings · Set 导入

> **背景调研结论（2026-06-14）**：Spotify 与已实装的 [网易云 / Bilibili / YouTube](../20260610-muzero-external-streaming-sources-prd/20260610-muzero-external-streaming-sources-prd.md) **不是同一类源**。后三者能 `resolve()` 出可播放直链；Spotify 全程 Widevine DRM，**合法拿不到任何音频字节**（Web Playback SDK 需 Premium 且 Electron 放不出 DRM 内容）。因此 Spotify **只做「歌单元数据导入源」**，导入的曲目通过**已有的 YouTube provider 按需匹配**出声（spotDL 模式）。产品决策已确认：**用户只需导入自己账号的歌单即可，接受听不到 Spotify 原声。**

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 0 | 可行性 spike：免费账号能否读自己歌单（Premium 门槛验证） | 🔲 Pending | [Phase 0 Checklist](#phase-0-checklist) |
| 1 | 基础设施：`PlaylistImportSource` 抽象 + OAuth PKCE + loopback 回调 + 数据模型 | 🔲 Pending | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | Spotify 源：OAuth 登录端到端 + 拉歌单/曲目/Liked（纯解析单测） | 🔲 Pending | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | Spotify→YouTube 匹配 + 导入入库（置信度评分 + 用 Spotify 封面/元数据） | 🔲 Pending | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | UI：Settings（BYOK client ID）+ 歌单浏览/导入对话框 + 手动改匹配 + 增量重同步 + i18n×4 | 🔲 Pending | [Phase 4 Checklist](#phase-4-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending
>
> **Phase 顺序遵循 [`prd-create.md`](../../../.cursor/commands/prd-create.md) §3「基础设施先于覆盖广度」**：Phase 0 的 Premium 验证是 go/no-go 闸门（决定受众=所有人 还是 仅 Premium），低成本，先做；Phase 1 抽象与 OAuth 不先合并，2/3/4 会反复 rebase。

---

## 1. Overview

### 1.1 Background

PM 要扩多平台支持。MUZERO 现有曲库来源：**AI 生成**（`origin:"generated"`）、**用户上传**（`origin:"uploaded"`）、**外部流媒体**（`origin:"streamed"`，网易云/B站/YouTube 已实装，见 [`src/streamsrc/`](../../../src/streamsrc/provider.ts)）。大量用户的歌单沉淀在 **Spotify**，希望能把这些歌单纳入 MUZERO 的策展/记忆/DJ 体系。

**Spotify 的硬约束（区别于现有三源）：**

| | 拿「歌单信息」（元数据） | 拿「可播放音频」 |
|---|---|---|
| Spotify 官方 Web API | ✅ 标题/艺人/专辑/封面/**ISRC**/时长 | ❌ 不可能（DRM；Web Playback SDK 需 Premium，Electron 放不出） |

所以 Spotify **不实现 [`StreamSourceProvider`](../../../src/streamsrc/provider.ts)**（其 `resolve()` 契约必须返回可播放流，规则 5）。它是一个**独立的、与播放解耦的「歌单导入源」**：拉元数据 → 用已有 YouTube provider 匹配出声 → 落成 `streamSourceId:"youtube"` 的 `streamed` track，复用现有播放/缓存/虚拟化全链路。

**2024–2026 Spotify API 收紧（影响设计的关键事实）：**
- **2024-11-27**：`audio-features`（BPM/key/energy/valence）、`audio-analysis`、`recommendations`、`related-artists`、multi-get 的 30s `preview_url`、算法/编辑歌单——**新应用直接 403、无替代**。→ 我们**不依赖**这些；本 PRD 只用稳定的歌单/曲目读取端点。
- **2025-04-09 / 2025-11-27（OAuth 迁移）**：implicit grant 停用、HTTP 重定向停用，**仅保留 loopback `http://127.0.0.1`**。→ 桌面回调必须走 loopback listener。
- **访问门槛**：官方 Web API 概览页现写「需要 Premium 才能用 Web API」（含义模糊，**Phase 0 验证**）；dev mode 每 app 仅约 5 用户、商业配额需 25 万 MAU。→ 上线靠 **BYOK**：每个用户自建 Spotify dev app、自己当唯一用户，绕开 5 用户上限。

### 1.2 Target Users

| Role | Description | Permissions |
|------|-------------|-------------|
| **本地高级用户（owner）** | 把自己 Spotify 账号的歌单（含私密、Liked Songs）导入 MUZERO，匹配 YouTube 播放、加 tag/记忆、喂 DJ。BYOK：自带 Spotify client ID + 登录态。 | 全功能；**默认关闭**，需在 Settings 填 client ID 并 OAuth 登录 |

> 单角色（本地优先、无账号系统）。定位为个人高级功能，见 §8 红线。

### 1.3 Core Value

1. **把 Spotify 歌单纳入 MUZERO 的记忆体系**：导入的曲目可加 tag/写记忆/配封面/被搜索，与其它 origin 同等待遇。
2. **真的能听**：通过已有 YouTube provider 匹配出声（声音来自 YouTube，不是 Spotify 原轨）——复用现有播放链路，零播放层改动。
3. **喂给 DJ**：导入曲目的元数据/tags/记忆进 `RecentTrack` 上下文，影响 DJ 续歌。
4. **零后端、BYOK**：OAuth token + client ID 只存设备本地 IndexedDB，无 MUZERO 服务器中转（规则 1/2）。

---

## 2. System Architecture

### 2.1 Architecture Overview

```
 Settings: 用户填 BYOK client ID + OAuth 登录（scope: playlist-read-private / -collaborative / user-library-read）
      │
      ▼
 PlaylistImportSource(spotify).getUserPlaylists()  ──▶ 用户歌单列表
      │  选一个歌单 → getPlaylistTracks(id)（分页 AsyncIterable）
      ▼
 ImportedTrackMeta[] { title, artists, album, isrc, durationSec, coverUrl(Spotify) }
      │
      ▼  对每首：matchToYoutube(meta, youtubeProvider)
 youtube-source.search("artist title") ──▶ 打分（标题/艺人 token 重合 + 时长窗口）
      │  status: matched(≥hi) | low(待确认) | none
      ▼
 createStreamedTrack({ sourceId:"youtube", externalId: videoId,
                       streamMeta:{ artist/album/coverUrl ← Spotify },
                       importedFrom:{ source:"spotify", externalId: spotifyTrackId, isrc } })
      │  → origin:"streamed", streamSourceId:"youtube" 进 set
      ▼
 ┌──────── 之后完全走现有 streamsrc 链路（零改动）────────┐
 │ player-store.ensureLoadedAndPlay → resolveStreamPlayback │
 │   → youtube resolve（Electron）→ mediaProxyUrl → 播放      │
 └──────────────────────────────────────────────────────────┘

 OAuth 回调（PKCE，无 client secret）：
   renderer 生成 code_verifier/challenge → bridge.openOAuthFlow(authUrl)
   → Electron 主进程起临时 loopback HTTP server(127.0.0.1:<port>) + 打开授权页
   → 捕获 redirect ?code&state → 返回 renderer
   → getAppFetch() POST accounts.spotify.com/api/token（带 code_verifier）→ access/refresh token
```

**关键边界（区别于现有 streamsrc）：**

| 关注点 | Spotify（本 PRD） | 现有三源 |
|---|---|---|
| 角色 | 仅**元数据导入源**（`PlaylistImportSource`） | **播放源**（`StreamSourceProvider`，`resolve()` 出直链） |
| 出声 | 委托给已有 YouTube provider 匹配 | 自己 `resolve()` |
| 认证 | OAuth 2.0 **PKCE + loopback 回调**（标准协议，无 cookie 抓取） | cookie/会话抓取（`openSourceLogin`） |
| 落库 | 落成 `streamSourceId:"youtube"` track + `importedFrom` 溯源 | `streamSourceId:"<self>"` |

### 2.2 Technology Stack

| Component | Technology | Rationale |
|---|---|---|
| **导入源抽象** | 新建 `PlaylistImportSource` 接口 + registry（**平行于** `StreamSourceProvider`，不复用） | 规则 5：Spotify 不返回可播放流，混进 `StreamSourceProvider` 会让 `resolve()` 契约失真 |
| **OAuth PKCE** | Web Crypto（`code_verifier`/S256 `code_challenge`）+ `getAppFetch()` 换 token（**无 client secret**） | 客户端无后端，PKCE 是官方推荐；token 交换不需密钥，renderer 直接 POST |
| **OAuth 回调** | Electron 主进程临时 loopback HTTP server（`127.0.0.1:<port>`）捕获 `?code` | 官方仅保留 loopback 重定向；不复用抓 cookie 的 `openSourceLogin`（语义不同） |
| **元数据拉取** | Spotify Web API `/me/playlists`、`/playlists/{id}/tracks`、`/me/tracks`，经 `getAppFetch()` | 规则 10：出站 HTTP 一律走 bridge（绕 CORS）；Bearer token 注入 |
| **YouTube 匹配** | 复用 [`youtube-source.ts`](../../../src/streamsrc/youtube/youtube-source.ts) `search()` + 自研打分纯函数 | 不重造播放；匹配是纯逻辑，可穷举单测 |
| **存储** | Dexie：`tracks`（加 `importedFrom` 非索引附加字段）+ `AppSettings.playlistSources` | 规则 1/4：本地 `muzero-db`，附加非索引字段 → 零 Dexie 版本 bump、零迁移（仿 `coverThumbhash`/现有 streamsrc Q4） |

### 2.3 Project Structure

```
src/
├── playlistsrc/                         # 新增：歌单导入源（平行于 streamsrc/）
│   ├── provider.ts                      # PlaylistImportSource / ImportedPlaylistMeta / ImportedTrackMeta 契约
│   ├── registry.ts                      # PlaylistSourceId union + createPlaylistSource(settings)
│   ├── oauth-pkce.ts                    # code_verifier/challenge 生成 + token 交换/刷新（纯, 注入 fetch/now/random-bytes）
│   ├── spotify/
│   │   ├── spotify-source.ts            # OAuth 流 + getUserPlaylists/getPlaylistTracks/getLikedSongs
│   │   ├── spotify-parse.ts             # parsePlaylists / parsePlaylistTracks / parseSavedTracks（纯映射, canned JSON 单测）
│   │   └── *.test.ts
│   └── match/
│       ├── match-to-youtube.ts          # matchToYoutube(meta, youtube): 查询构造 + resolve 选择
│       ├── match-score.ts               # scoreMatch(meta, hit): 标题/艺人 token + 时长窗口（纯, 穷举单测）
│       └── *.test.ts
├── lib/desktop/                         # 扩 bridge：openOAuthFlow（见 §4.3）
└── components/
    ├── settings/spotify-import-settings.tsx   # BYOK client ID + 连接/断开 + scope 说明
    └── playlist-import/                        # 歌单浏览 + 导入进度 + 手动改匹配（可复用现有 stream/playlist-import-dialog 模式）

electron/
└── main.cjs / ipc.cjs                   # 扩：临时 loopback OAuth listener（IPC: open-oauth-flow）
```

### 2.4 桌面壳 / OAuth 回调改造（基础设施先行）

- **新增 bridge 能力 `openOAuthFlow(req)`**（见 §4.3）：Electron 主进程在 `127.0.0.1` 上临时监听一个空闲端口，打开系统浏览器/隐藏 `BrowserWindow` 到 `authUrl`，捕获带 `code`+`state` 的回调后立即关闭 listener，返回给 renderer。
- **能力 gate**：用 `hasFolderAccess()` 同纪律的 `canOAuthLoopback()`（检测 bridge 是否实现 `openOAuthFlow`）——目前仅 Electron 实现。Tauri/web 返回 false，UI 隐藏 Spotify 连接入口。**不要** `if(kind==="electron")` 散落（规则 10）。
- **播放仍受 YouTube 约束**：匹配出的曲目是 YouTube track，播放本就 Electron-only（沿用现有 streamsrc gate）。故整个功能 v1 与 YouTube 播放同档，仅 Electron。

---

## 3. Data Model Design

### 3.1 Core Concepts

```
AppSettings(id:"app")
  └── playlistSources["spotify"] → { clientId(BYOK), accessToken, refreshToken, expiresAt, lastAuthAt }

DjSession(混合集，可标记 importedPlaylistRef 供增量重同步)
  └── Track(origin:"streamed", streamSourceId:"youtube")   ← 匹配后的可播放曲目
        ├── streamExternalId: <youtube videoId>            （播放用）
        ├── streamMeta: { artist, album, coverUrl }        ← 来自 Spotify（展示更准/封面更好）
        ├── importedFrom: { source:"spotify", externalId:<spotify trackId>, isrc? }  ← 新增溯源（增量去重键）
        ├── matchConfidence?: number                        ← 匹配置信度（低分=待确认）
        └── tags / memories / cover / mediaMetadata         （与其它 origin 一致）
```

### 3.2 Database Schema

⚠️ 优先扩展现有结构，不重构。当前 DB 已到高版本（见 [`src/db/muzero-db.ts`](../../../src/db/muzero-db.ts)）。

**所有改动都是「附加的非索引字段」→ 无需 bump Dexie 版本、无迁移体**（与现有 streamsrc PRD 的 Q4 结论、[`Track.coverThumbhash`](../../../src/db/types.ts) 做法一致）。

- **Current Schema:** [`src/db/types.ts`](../../../src/db/types.ts) — `Track`、`TrackOrigin`、`AppSettings`、`StreamSourceConfig`。
- **Required Changes（全部 TS 类型层 / 附加属性，零迁移）：**
  1. **`Track` 新增溯源字段**（仅导入曲目用，非索引）：
     ```ts
     importedFrom?: { source: PlaylistSourceId; externalId: string; isrc?: string };
     matchConfidence?: number;   // 0..1，低于阈值标「待确认」
     ```
  2. **`AppSettings` 新增 `playlistSources`**（BYOK，唯一 settings 行的新属性；与播放用的 `streamSources` 平行、互不污染）：
     ```ts
     playlistSources?: Partial<Record<PlaylistSourceId, PlaylistSourceConfig>>;
     // PlaylistSourceConfig = { clientId: string; accessToken?; refreshToken?; expiresAt?; lastAuthAt? }
     ```
  3. **Set 增量重同步引用**：复用现有「按 playlist ref 去重」基建（现有 `streamPlaylistRef` 思路），记导入来源 = `spotify:<playlistId>`。
- **Indexing:** 不建二级索引。增量重同步去重键 = `importedFrom.externalId`（Spotify track id），导入是偶发动作，一次 `where('sessionId')` + 内存 `filter` 即可（规则 6）。
- **Privacy & Retention:** `clientId` 非密但 token 是敏感凭据 → 只进 `AppSettings.playlistSources`（设备本地，规则 2）；**永不**进日志/遥测/bundle。提供「断开连接」清 `playlistSources.spotify`。

### 3.3 Data Relationship Diagram

```
playlistSources["spotify"]  ──OAuth token──▶  Spotify Web API
                                                  │ getUserPlaylists / getPlaylistTracks / getLikedSongs
                                                  ▼
                                       ImportedTrackMeta（含 ISRC）
                                                  │ matchToYoutube
                                                  ▼
DjSession ──1:N── Track(streamSourceId:"youtube", importedFrom.source:"spotify")
                    ├── 播放 = 现有 youtube resolve 链路
                    ├── 展示 = Spotify 的 artist/album/cover
                    └── 重同步去重 = importedFrom.externalId
```

---

## 4. Provider / API Design

### 4.1 `PlaylistImportSource` 接口（新建，平行于 `StreamSourceProvider`）

⚠️ **不复用 [`StreamSourceProvider`](../../../src/streamsrc/provider.ts)**——它的 `resolve()→PlayableStream` 是「解析可播放直链」契约，Spotify 满足不了。但**复用其纪律**：可插拔接口 + DI + registry + 绝不在 UI/store 散落 `if(source==="spotify")`（规则 5）。

```ts
// src/playlistsrc/provider.ts
export type PlaylistSourceId = "spotify";   // union；未来可加 "applemusic" 等

export interface ImportedPlaylistMeta {
  externalId: string;        // Spotify playlist id
  name: string; description?: string; coverUrl?: string;
  trackCount: number; ownerName?: string;
}

export interface ImportedTrackMeta {
  externalId: string;        // Spotify track id（溯源 + 重同步去重）
  title: string; artists: string[]; album?: string;
  isrc?: string;             // external_ids.isrc — 最可靠的跨平台锚点
  durationSec: number; coverUrl?: string;
}

export interface PlaylistImportSource {
  readonly id: PlaylistSourceId;
  readonly label: string;
  isAuthed(cfg: PlaylistSourceConfig): boolean;
  beginAuth(cfg: PlaylistSourceConfig): Promise<PlaylistSourceConfig>;  // OAuth PKCE + loopback；返回带 token 的新 cfg
  getUserPlaylists(): Promise<ImportedPlaylistMeta[]>;
  getPlaylistTracks(playlistId: string, opts?: { signal?: AbortSignal }): AsyncIterable<ImportedTrackMeta>;  // 分页
  getLikedSongs?(opts?: { signal?: AbortSignal }): AsyncIterable<ImportedTrackMeta>;  // saved tracks（v1 可选）
}
```

`registry.ts` 仿 [`streamsrc/registry.ts`](../../../src/streamsrc/registry.ts)：`createPlaylistSource(settings, id)` 按 id 装配，凭据从 `settings.playlistSources[id]` 注入。

### 4.2 Spotify Web API 端点（只用稳定的、未被砍的）

| Endpoint | Method | 用途 | Scope |
|---|---|---|---|
| `accounts.spotify.com/authorize` | GET（浏览器） | PKCE 授权 | — |
| `accounts.spotify.com/api/token` | POST | code→token / refresh | — |
| `/v1/me/playlists` | GET | 用户歌单列表（分页 `limit/offset`） | `playlist-read-private` |
| `/v1/playlists/{id}/tracks` | GET | 歌单内曲目（分页；`fields` 裁剪）| `playlist-read-private` `-collaborative` |
| `/v1/me/tracks` | GET | Liked Songs（分页） | `user-library-read` |

> **不使用**任何 2024-11 被砍端点（audio-features / recommendations / related-artists / preview_url）。曲目的 `external_ids.isrc` 在 `/playlists/{id}/tracks` 与 `/me/tracks` 响应里仍提供，用于匹配。

**Request/Response 示例：**
```ts
// token 交换（PKCE，无 secret）
POST https://accounts.spotify.com/api/token
  grant_type=authorization_code & code=<code> & redirect_uri=http://127.0.0.1:<port>/callback
  & client_id=<BYOK> & code_verifier=<verifier>
// → { access_token, refresh_token, expires_in }

// 拉曲目（裁字段省流量）
GET /v1/playlists/{id}/tracks?fields=items(track(id,name,duration_ms,artists(name),album(name,images),external_ids(isrc))),next&limit=100
```

### 4.3 OAuth 回调 bridge 契约（loopback）

```ts
// src/lib/desktop/bridge.ts — DesktopBridge 扩展
openOAuthFlow?: (req: {
  authUrl: string;            // 已拼好 client_id/scope/code_challenge/state 的授权 URL
  redirectPath?: string;      // 默认 "/callback"
  timeoutMs?: number;
}) => Promise<{ code: string; state: string } | null>;  // 用户取消/超时 → null
```
- **Electron 实现** [`electron.ts`](../../../src/lib/desktop/electron.ts) + [`main.cjs`](../../../electron/main.cjs)：主进程 `http.createServer` 监听 `127.0.0.1` 空闲端口，`shell.openExternal(authUrl)`（或隐藏 BrowserWindow），命中 `redirectPath?code&state` 即回显「可关闭」页面、resolve、关 server。
- **renderer 侧**（`oauth-pkce.ts`，纯/注入式）：生成 `code_verifier`（43–128 字符高熵）+ S256 `code_challenge` + `state`；`redirect_uri` = `http://127.0.0.1:<port>/callback`（端口由主进程回传，或固定 + 占用回退）；拿到 `code` 后 `getAppFetch()` POST 换 token；`state` 校验防 CSRF。
- **Tauri/web 不实现** → `canOAuthLoopback()` 自动 false，入口隐藏。

### 4.4 Spotify→YouTube 匹配（本方案质量核心）

YouTube **无 ISRC**，无法用 ISRC 直接命中 → 匹配 = 模糊比对：

```ts
// src/playlistsrc/match/match-score.ts（纯函数，穷举单测）
scoreMatch(meta: ImportedTrackMeta, hit: StreamSearchHit): number
//  = w1 * 标题 token Jaccard（归一化：去 feat./remaster/官方MV 噪声词、大小写、标点）
//  + w2 * 艺人 token 重合
//  + w3 * 时长贴合（|durΔ| ≤ 5s → 满分，线性衰减，>15s → 0）
//  ∈ [0,1]
```
```ts
// match-to-youtube.ts
matchToYoutube(meta, youtube): { hit?, confidence, status: "matched"|"low"|"none" }
//  query = `${meta.artists[0]} ${meta.title}`
//  取 youtube.search(query) top-N → scoreMatch 排序
//  confidence ≥ HI(默认 0.8) → matched；LO..HI → low(待确认)；无候选/最高 < LO → none
```
- **导入策略**：`matched` 自动入库；`low`/`none` 标「待确认」，入库但置 `matchConfidence` 低值，UI 给手动改匹配入口（搜 YouTube 选正确版本）。
- **封面/元数据用 Spotify 的**：`streamMeta.coverUrl` = Spotify 专辑图（比 YouTube 缩略图好），`mediaMetadata.artists/album` = Spotify 真实值（镜像进 `mediaMetadata`，与现有 streamed track 同款显示，零 UI 改）。
- **去重**：导入/重同步前按 `importedFrom.externalId`（Spotify track id）内存查重，避免同曲多条。

### 4.5 Error Handling & Token 过期

- **token 刷新**：`expiresAt < now+slack` → 用 `refresh_token` 静默刷新；refresh 失败（撤权/过期）→ 标记需重新连接，toast 走 [error-ux 架构](../../../src/stores/player-store.ts)（不静默吞）。
- **匹配失败**：`none` 曲目明示「未找到可播放匹配」，提供手动搜索/跳过；批量导入末尾汇总「N 首已匹配 / M 首待确认 / K 首未匹配」。
- **限流**：Spotify 429 带 `Retry-After` → 退避重试；分页用 `next` 游标。
- **Premium 门槛**：若 Phase 0 验证免费账号读不了（403），UI 在连接时明示「此功能需 Spotify Premium」。
- **Telemetry**：本地优先、无遥测（规则 1）。出错只走本地 [logger](../../../src/lib/logger.ts)（规则 8），**绝不**上报 token/client ID/歌单内容。

---

## 5. Frontend Design

### 5.1 Page Structure

```
components/settings/spotify-import-settings.tsx   # BYOK client ID 输入 + 连接/断开 + scope 与"需自建 app"引导
components/playlist-import/                        # 歌单列表 → 选歌单 → 导入进度 → 匹配结果（matched/待确认/未匹配）
components/player/                                 # 无需改：导入曲目是 youtube streamed track，复用现有
```

### 5.2 UI Components / Interaction

- **Settings · Spotify 导入**：client ID 输入框（BYOK，附「如何 2 分钟创建 Spotify app」分步引导链接）；`连接`（OAuth）/`断开`；连接态显示账号名 + 歌单数。`canOAuthLoopback()` 为 false（web/Tauri）时整块隐藏，附「需桌面端」提示。
- **歌单浏览/导入**：连接后列出 `getUserPlaylists()` + 「Liked Songs」；选一个 → 导入对话框（可复用现有 [`stream/playlist-import-dialog`](../../../src/components/stream/playlist-import-dialog.tsx) 三路径：建新 set / 增量重同步 / 加进已有 set）。导入时显示进度 + 实时「已匹配/待确认/未匹配」计数。
- **手动改匹配**：曲目行对「待确认/未匹配」给 `修正匹配` 按钮 → 内嵌 YouTube 搜索选正确版本 → 更新 `streamExternalId` + 置高 confidence。
- **增量重同步**：已导入的 set 上「重新同步」→ 只匹配并追加 Spotify 歌单里的新曲（按 `importedFrom.externalId` 去重），删除的不自动删（保留用户已加的记忆/tag）。

### 5.3 State Management

- OAuth 流（一次性）走命令式调用，不进 store。连接态从 `AppSettings.playlistSources` 经 Dexie `useLiveQuery` 读。
- 歌单列表/导入进度用 TanStack Query（异步/可取消），**不**塞 Zustand（规则 6）。
- 导入后的 streamed track 走 Dexie `useLiveQuery`（与全库一致）。

### 5.4 i18n（4 locale）

所有新文案（client ID 引导、连接/断开、scope 说明、导入进度、matched/待确认/未匹配、Premium 提示、桌面专属提示、修正匹配）走 `t("ns.key")`，先加 **en**（类型源）再补 zh/ja/ko。少 locale 在 PR 标 "pending translation" + 开 i18n followup（per [`prd-create.md`](../../../.cursor/commands/prd-create.md) §3）。

---

## 6. Implementation Plan

### Phase 0: 可行性 spike（go/no-go）

**Goal:** 用真实 Spotify 账号验证「免费账号能否 OAuth 读自己歌单」，决定受众与 UI 文案。

**Tasks:**
- [ ] 注册一个 Spotify dev app（loopback redirect），跑通 PKCE → `GET /me/playlists`。
- [ ] 用**免费账号**和 **Premium 账号**各测一次，记录是否 403。

#### Phase 0 Checklist
- [ ] 明确结论：免费账号可读 / 需 Premium（写入 §10 Open Questions Q1 决议）。
- [ ] 确认 dev mode 5 用户上限实际数字 + BYOK「自己当唯一用户」路径可行。

### Phase 1: 基础设施

**Goal:** `PlaylistImportSource` 抽象 + OAuth PKCE 纯模块 + loopback bridge 能力 + 数据模型就位（不接 UI）。

**Tasks:**
- [ ] `src/playlistsrc/{provider,registry}.ts` 接口与骨架。
- [ ] `oauth-pkce.ts`：verifier/challenge 生成 + token 交换/刷新（注入 `fetch`/`now`/随机源，确定性单测）。
- [ ] `DesktopBridge.openOAuthFlow` + **Electron loopback 实现**（Tauri/web 缺省）；`canOAuthLoopback()` 能力判定。
- [ ] 数据模型（附加非索引、零迁移）：`Track.importedFrom`/`matchConfidence`；`AppSettings.playlistSources`。

#### Phase 1 Checklist
- [ ] `oauth-pkce` 单测全绿（challenge 向量、refresh 分支）。
- [ ] Electron 手测：`openOAuthFlow` 能捕获一次 loopback 回调 `?code&state` 并 resolve。

### Phase 2: Spotify 源

**Goal:** OAuth 登录端到端 + 拉歌单/曲目/Liked，纯解析单测覆盖。

**Tasks:**
- [ ] `spotify-source.ts`：`beginAuth`（拼 authUrl + scope + 换 token）+ `getUserPlaylists` + `getPlaylistTracks`（分页）+ `getLikedSongs`。
- [ ] `spotify-parse.ts`：`parsePlaylists`/`parsePlaylistTracks`/`parseSavedTracks`（canned JSON 单测，含 ISRC 缺失/local track/已下架边界）。

#### Phase 2 Checklist
- [ ] 解析单测全绿（含分页 `next`、字段裁剪、空/异常项）。
- [ ] Electron 手测：连接真实账号 → 列出歌单 → 拉到某歌单全部曲目（含 ISRC）。

### Phase 3: 匹配 + 导入入库

**Goal:** Spotify→YouTube 匹配 + 落 `streamSourceId:"youtube"` track（用 Spotify 封面/元数据），批量进度 + 去重。

**Tasks:**
- [ ] `match-score.ts`（纯，穷举单测：噪声词归一化、时长窗口、艺人重合）+ `match-to-youtube.ts`。
- [ ] 导入流程：批量匹配 → `createStreamedTrack({sourceId:"youtube", streamMeta←Spotify, importedFrom})` → 进 set；`matched` 自动、`low/none` 标待确认。
- [ ] `importedFrom.externalId` 去重 + 增量重同步。

#### Phase 3 Checklist
- [ ] `scoreMatch` 单测全绿（含翻唱/现场/remaster 该低分的反例）。
- [ ] Electron 手测：导入一个 ~30 首歌单，多数自动匹配、能播放、封面是 Spotify 的；重同步不产生重复。

### Phase 4: UI

**Goal:** Settings（BYOK）+ 歌单浏览/导入对话框 + 手动改匹配 + i18n×4。

**Tasks:**
- [ ] `spotify-import-settings.tsx`（client ID + 连接/断开 + 引导 + 能力 gate）。
- [ ] 歌单浏览 + 导入对话框（复用 `playlist-import-dialog` 模式）+ 进度/计数。
- [ ] 待确认/未匹配的「修正匹配」入口。
- [ ] 文案 en→zh/ja/ko。

#### Phase 4 Checklist
- [ ] Electron 端到端：填 client ID → 连接 → 选歌单 → 导入 → 播放 → 修正一首待确认 → 重同步。
- [ ] web/Tauri 下入口隐藏（`canOAuthLoopback()` false）。
- [ ] i18n 4 locale 覆盖（缺则标 pending + followup）。

---

## 7. Out of Scope

- **Spotify 原声播放 / 下载**：DRM 硬约束，永不可能；不做 Web Playback SDK（需 Premium 且 Electron 放不出）。
- **依赖被砍端点的功能**：audio-features 自动填 `TrackBrief`（BPM/key/energy）、recommendations、related-artists、preview_url——新应用无权限，不做。
- **其它导入源**：Apple Music / Tidal / Deezer 等留作未来 `PlaylistSourceId` 扩展（本 PRD 只做 Spotify，但接口为多源预留）。
- **自动定时重同步**：v1 仅手动「重新同步」按钮；定时任务（cron/后台）留后续。
- **写回 Spotify**：不创建/修改 Spotify 歌单（只读 scope）。
- **单一全局 client ID 商业配额**：需 25 万 MAU，本期不申请；走 BYOK。

---

## 8. Security Considerations

- **Authentication:** OAuth 2.0 Authorization Code + **PKCE**（无 client secret）；`state` 防 CSRF；loopback `http://127.0.0.1` 回调（官方仅存的本地重定向）。
- **Authorization:** 最小 scope —— `playlist-read-private` `playlist-read-collaborative` `user-library-read`（**只读**，不申请任何写/播放 scope）。
- **Data Protection (BYOK, 规则 2):** `clientId`（非密）+ `access/refresh token`（敏感）只存 `AppSettings.playlistSources`（设备本地 IndexedDB）；**绝不**写进 bundle/`.env`/URL/日志/遥测。token 直达 Spotify，不经任何中转（规则 1）。
- **No hidden flags (规则 3):** Spotify 导入是 Settings 里可见开关；回滚 = `git revert` + 重新发版，不藏 runtime kill switch。
- **Audit Logging:** 仅本地 logger 记非敏感事件（连接成功/导入计数）；不记 token/歌单内容/匹配 query。

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [External Streaming Sources PRD](../20260610-muzero-external-streaming-sources-prd/20260610-muzero-external-streaming-sources-prd.md) | 网易云/B站/YouTube 接入；本 PRD 复用其 YouTube 播放链路与 streamsrc 数据模型 |
| [`src/streamsrc/provider.ts`](../../../src/streamsrc/provider.ts) | `StreamSourceProvider` 契约（Spotify **不**实现，平行新建 `PlaylistImportSource`） |
| [`src/streamsrc/youtube/youtube-source.ts`](../../../src/streamsrc/youtube/youtube-source.ts) | 匹配复用的 YouTube `search()`/`resolve()` |
| [CLAUDE.md](../../../CLAUDE.md) | 硬规则 1/2/3/4/5/10（本地优先/BYOK/无隐藏 flag/codename/provider 边界/桌面壳抽象） |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | 免费 Spotify 账号能否 OAuth 读自己歌单，还是必须 Premium？官方页写「需 Premium 用 Web API」含义模糊 | **Open（Phase 0 验证）** | 决定受众=所有人 还是 仅 Premium；影响连接 UI 文案 |
| 2 | client ID 发放：纯 BYOK（用户自建 app）vs 自带一个（仅 ≤5 用户内测） | Resolved | **BYOK**（自带全局只能服务 5 账号）；提供 2 分钟自建引导 |
| 3 | 导入曲目用途：匹配 YouTube 播放 vs 纯元数据喂 DJ | Resolved | **匹配 YouTube 可播放**（用户 2026-06-14 拍板） |
| 4 | Liked Songs（saved tracks）是否进 v1 | Open | 倾向 v1 顺带（同 `user-library-read` scope，分页接口一致） |
| 5 | 低置信度匹配默认行为：自动入库标待确认 vs 导入前让用户逐个确认 | Open | 倾向「自动入库 + 待确认标记 + 事后修正」，避免大歌单卡在逐个确认 |
| 6 | 匹配置信度阈值 HI/LO 初值 | Open | 初定 HI=0.8 / LO=0.5，Phase 3 真实歌单调参 |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-14 | DoodleBear | Initial draft（基于 Spotify API 现状调研 + 用户确认「匹配 YouTube 播放」方向） |
