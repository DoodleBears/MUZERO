# PRD: MUZERO External Streaming Sources (网易云 / Bilibili / YouTube 在线源接入)

**Status:** Draft
**Created:** 2026-06-10
**Author:** DoodleBear
**Module:** `src/streamsrc/` (new) · `src/lib/desktop/` · `src/stores/player-store.ts` · `src/db/` · Settings · Search

> 参考实现：[cwuom/NeriPlayer](https://github.com/cwuom/NeriPlayer)（Android/Kotlin 播放器，已工程化接入网易云 / Bilibili / YouTube Music）。本 PRD 把它的**多源统一架构**与三套**鉴权/签名/反爬机制**落地为 MUZERO（TS/React/Electron+Tauri，本地优先）的集成方案，而**不是直接移植 Kotlin 代码**。

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | 基础设施：muzfetch header 注入 + Range 透传 + StreamSource 抽象 + 数据模型 | 🔄 In Progress | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | Bilibili 源（架构试金石：WBI + DASH 音轨 + 登录 + 入库 + 播放路由） | 🔲 Pending | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | 网易云源（weapi/eapi 纯 TS 加密 + 登录 + 搜索 + 音质降级） | 🔲 Pending | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | YouTube 源（InnerTube + EJS sig/n 解密 + PoToken） | 🔲 Pending | [Phase 4 Checklist](#phase-4-checklist) |
| 5 | 离线缓存 / 下载持久化（"尽量入库存储"，可选增强） | 🔲 Pending | [Phase 5 Checklist](#phase-5-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

### Implementation Progress Log（TDD，纯核心优先；网易 + B站，YouTube/Phase 4 押后）

> 每行 = 一个 TDD 原子单元（test → impl → green → 路径化 commit）。纯函数核心可在 vitest 完整验证；带网络/Electron 运行时的部分（代理 header 注入、登录窗口、live resolve、UI）实现后标「待运行时验证」，不冒充已验证。

| # | 单元 | 文件 | 测试 | 状态 |
|---|---|---|---|---|
| C1 | MD5（RFC 1321，eapi digest + WBI w_rid 的基石） | `src/streamsrc/crypto/md5.ts` | RFC 已知向量 ×10 | ✅ green |
| B1 | Bilibili WBI 签名（mixinKey 重排 + `w_rid=md5(query+key)`，`wts` 注入可测） | `src/streamsrc/bili/bili-wbi.ts` | 官方文档向量 + Node md5 交叉验证 ×6 | ✅ green |
| B2 | Bilibili DASH 音轨选择（normal/dolby/flac 标签化 + 偏好降级/升级 + CDN 排序） | `src/streamsrc/bili/bili-resolve.ts` | canned playurl ×9 | ✅ green |
| C2 | 无填充 RSA（BigInt modpow，weapi encSecKey 包密钥；按字节宽 → 256-hex 非 258） | `src/streamsrc/crypto/rsa.ts` | 教科书 RSA 向量 + 朴素参照 ×6 | ✅ green |
| N1 | 网易 weapi/eapi 加密（AES-CBC×2+RSA / AES-ECB+md5 digest，secretKey 注入可测） | `src/streamsrc/netease/netease-crypto.ts` | node:crypto 交叉验证 + 往返 ×7 | ✅ green |
| N2 | 网易播放响应解析（200/301/404/fee/freeTrial → 可播/登录/VIP/试听 + https 升级） | `src/streamsrc/netease/netease-resolve.ts` | canned 响应 ×9 | ✅ green |

---

## 1. Overview

### 1.1 Background

MUZERO 当前的曲库只有两类来源：**AI 生成**（`origin: "generated"`，由 DJ 写 `TrackBrief`→ musicgen provider 生成）与**用户上传**（`origin: "uploaded"`，本地文件 / 文件夹导入 / 粘贴）。CLAUDE.md 把"音乐承载回忆"作为产品内核——每首歌可加 tag + 记忆 + 封面，可搜索、可喂给 DJ。但用户日常听的大量歌曲其实存在于**网易云 / Bilibili / YouTube** 上，今天无法把它们纳入 MUZERO 的策展 / 记忆 / DJ 上下文。

[NeriPlayer](https://github.com/cwuom/NeriPlayer) 证明了纯客户端（无自有后端、无第三方代理）接入这三个源是可行的——它在设备端复刻了各家的鉴权 / 签名 / 反爬算法，直连官方接口取直链播放。本 PRD 把这套能力**在 MUZERO 的硬规则约束下**（本地优先 / BYOK / 无 hidden flag / provider 边界 / 桌面壳抽象）重新设计落地。

**已确认的两个产品决策（2026-06-10）：**
1. **三源全做**，含 YouTube（工程量与维护脆弱度最大的一档，单列为最后 phase）。
2. **默认入库**：外部歌曲导入为持久化的 `streamed` track 进 set，尽量存储（元数据 + 源引用，且可选缓存音频字节到 `mediaBlobs` 供离线），而非仅临时点播。

### 1.2 Target Users

| Role | Description | Permissions |
|------|-------------|-------------|
| **本地高级用户（owner）** | 在自己设备上把已有的网易云/B站/YT 曲目纳入 MUZERO 库做策展、加记忆、喂 DJ。BYOK：自带各源登录态。 | 全功能；功能**默认关闭**，需在 Settings 显式开启并登录对应源 |

> 单角色产品（本地优先、无账号系统）。此能力定位为**个人使用的高级功能**，见 §8 红线。

### 1.3 Core Value

1. **把"别处的歌"纳入 MUZERO 的记忆体系**：外部歌曲也能加 tag / 写记忆 / 配封面 / 被搜索，统一进 set。
2. **喂给 DJ**：streamed track 的 metadata + tags + 记忆进 `RecentTrack` 上下文，影响 DJ 续歌（与生成/上传曲目同等待遇）。
3. **统一播放体验**：三源与生成/上传曲目共用同一播放队列、同一 `<video>`/`<audio>` 引擎、同一可视化与 Now Playing。
4. **零后端、BYOK**：延续本地优先——无 MUZERO 服务器中转，登录态只存设备本地 IndexedDB。

---

## 2. System Architecture

### 2.1 Architecture Overview

```
                    ┌──────────────────── 统一 Track（origin:"streamed"）─────────────────┐
                    │  streamSourceId: "bili"|"netease"|"youtube"                          │
                    │  streamExternalId: <bvid#cid | songId | videoId>                     │
                    └─────────────────────────────────────────────────────────────────────┘
 搜索/歌单导入                                播放（player-store.playIndex）
      │                                              │
      ▼                                              ▼
 StreamSourceProvider.search()            resolveStreamPlayback(track)   ← 即时解析（直链会过期）
 StreamSourceProvider.importPlaylist()           │
      │                                           ▼
      │                            StreamSourceProvider.resolve(externalId, quality)
      ▼                                           │  返回 { mediaUrl, headers{Referer/UA}, mime, expiresAt }
 createStreamedTrack(...)  ──写库──┐               ▼
                                  │      proxiedMediaUrl = wrapMuzfetch(mediaUrl, headers)
                                  │               │
                                  ▼               ▼
                          tracks / sets    mediaEngine.loadUrl(proxiedMediaUrl)
                                                  │
   ┌──────────────── 所有出站 HTTP（API 调用 + 媒体流）─────────────┐
   │  getAppFetch() / media-engine src  →  muzfetch://（Electron） │
   │      · header 注入别名 x-muzero-h-*（绕 forbidden headers）    │
   │      · Range/206 透传（媒体 seek）                            │
   │  →  net.fetch（主进程，无渲染层 CORS）                         │
   │  v1 仅 Electron；Tauri/web 经 hasStreamingSources() gate 隐藏  │
   └─────────────────────────────────────────────────────────────┘
```

**两条"必须经代理"的链路（本 PRD 的技术核心）：**

| 链路 | 为什么必须代理 | NeriPlayer 对应 | MUZERO 现状 |
|---|---|---|---|
| **API 调用**（搜索 / 取直链 / 签名） | 跨域 + 需带 `Cookie`/`User-Agent`/`Referer`，而 Chromium 渲染层 `fetch` **禁止 JS 设置这些 forbidden headers** | OkHttp 原生，无此限制 | `muzfetch` 逐字转发 header（[`electron/fetch-proxy.cjs:14`](electron/fetch-proxy.cjs)），但渲染层根本设不进 Cookie/UA/Referer → **需加 header 注入别名** |
| **媒体流播放**（`<audio src>` GET CDN 直链） | B站 CDN 无 `Referer: https://www.bilibili.com` 直接 **403**；YT/网易直链也需 UA + **Range/206** 才能 seek。`<audio>` 自身的 GET 不带这些 header | 自定义 `ConditionalHttpDataSourceFactory` 按 host 注入 header（NeriPlayer: `core/player/ConditionalHttpDataSourceFactory.kt`） | `media-engine.loadSource` 直接 `audioEl.src = url`（[`src/player/media-engine.ts:154`](src/player/media-engine.ts)）→ **需让 src 走 muzfetch 并注入 header + 支持 Range** |

> 结论：此功能 **v1 仅 Electron**（"这里我们主要用 Electron"）；Tauri 流媒体 parity 推迟（§7 out-of-scope），web 壳不支持（无代理 + forbidden header + CORS）。用 **`hasStreamingSources()` 能力判定** gate——它检测 bridge 是否实现了流媒体能力（目前只有 Electron 实现），**不要** `if (kind==="electron")` 散落（沿用 `hasFolderAccess()` 纪律，CLAUDE.md 规则 10）；将来补 Tauri 实现即自动点亮，无需改 UI。

### 2.2 Technology Stack

| Component | Technology | Rationale |
|---|---|---|
| **源 provider 抽象** | 新建 `StreamSourceProvider` 接口 + registry（**平行于** `MusicGenProvider`，不复用） | provider 边界纪律（规则 5）：musicgen 是"生成新歌→ `{blob,mime,durationSec}`"；stream 是"解析已存在歌→ URL"。契约不同，混用会污染生成链路 |
| **加密 / 签名（网易/B站）** | 纯 TS：`crypto-js` 或 Web Crypto（AES/RSA/MD5/HMAC-SHA256） | 算法已知且轻量，纯 TS 可复刻；放 Web Worker（规则 7、与 `ncm-decode` 同位置） |
| **YouTube sig/n + PoToken** | **单个隐藏离屏 sandboxed `BrowserWindow`**（Electron 主进程持有，IPC 驱动），跑 [yt-dlp/ejs](https://github.com/yt-dlp/ejs) solver 算 `sig`/`n` + BotGuard 取 `pot`（Q3 已定，见 §4.5）| PoToken 需真实浏览器环境（BotGuard 探测 DOM/navigator）；sig/n 是不可信 YT JS，必须隔离出主进程。一个窗口办两件，避免第二套 JS runtime |
| **出站 HTTP** | `getAppFetch()` → `muzfetch`（扩 header 注入 + Range，Electron 主进程 `net.fetch`）| 规则 10：一律走 `resolveDesktopBridge()` |
| **存储** | Dexie（`tracks` / `mediaBlobs` / `settings`）——stream 字段**附加非索引、不 bump 版本**（Q4 已定，仿 `coverThumbhash`）| 规则 1/4：本地 IndexedDB `muzero-db`，codename 不变 |
| **登录** | Electron `BrowserWindow` 打开官方登录页抓 cookie | 沿用 folder-import 的"运行时授权"思路；cookie 加密存 settings。Tauri parity 推迟（§7）|

### 2.3 Project Structure

```
src/
├── streamsrc/                          # 新增：外部流媒体源（平行于 musicgen/）
│   ├── provider.ts                     # StreamSourceProvider / StreamTrackRef / Playable 接口（契约）
│   ├── registry.ts                     # StreamSourceId union + resolveStreamSource(settings)
│   ├── source-detect.ts               # detectStreamSource(track) — channelId 优先级链（纯函数，穷举单测）
│   ├── http.ts                         # streamFetch()：包 getAppFetch + 注入 per-host header 别名（唯一出站点）
│   ├── bili/                           # WBI 签名 + playurl(DASH) + 音轨选择（纯映射 3 函数）
│   │   ├── bili-source.ts  bili-wbi.ts  bili-resolve.ts  *.test.ts
│   ├── netease/                        # weapi/eapi 加密 + song/url + 音质降级
│   │   ├── netease-source.ts  netease-crypto.ts  netease-resolve.ts  *.test.ts
│   └── youtube/                        # InnerTube + EJS sig/n + PoToken
│       ├── youtube-source.ts  youtube-innertube.ts  youtube-sig-solver.ts  youtube-potoken.ts
├── workers/
│   └── stream-crypto-worker.ts         # 网易/B站签名(MD5/AES/HMAC)与 sig 预处理放 worker（规则 7）
├── lib/desktop/                        # 扩 bridge：媒体代理 URL + header 注入（见 §4.3）
├── stores/
│   └── stream-auth-store.ts            # 各源登录态（observer 注入，模块作用域单例，不进 player-store state）
└── pages|components/                   # search 在线 tab / settings 各源登录+音质 / set 导入入口

electron/
├── fetch-proxy.cjs                     # 扩：x-muzero-h-* header 注入 + Range/206 透传
└── (login window via main.cjs IPC)     # 打开官方登录页抓 cookie
```

### 2.4 桌面壳 / 出站 HTTP 改造（基础设施，先于源覆盖）

> 沿用 prd-create.md §3「Phase 顺序：基础设施先于覆盖广度」——header 注入 + Range 不先做，三个源的 PR 会反复 rebase 等代理改动。

**(a) Header 注入别名（绕 forbidden headers）。** `streamFetch()` 把需要的受限 header 以 `x-muzero-h-cookie` / `x-muzero-h-user-agent` / `x-muzero-h-referer` 形式写入；[`electron/fetch-proxy.cjs`](electron/fetch-proxy.cjs) 在 `net.fetch` 前把 `x-muzero-h-<name>` 还原成真实 `<name>`。`net.fetch`（主进程，Chromium 网络栈，不受渲染层 forbidden-header 约束）照常发出。

**(b) 媒体流代理 + Range。** 新增 bridge 能力 `mediaProxyUrl(targetUrl, headers): string` → 返回一个 `<audio>`/`<video>` 可直接 `src` 的 `muzfetch://` URL（target + header 别名编码进去）。代理需：转发媒体元素发来的 `Range` 请求头、**保留 `206 Partial Content` + `Content-Range` + `Accept-Ranges`**（当前代理 `redirect:"follow"` 并整体重发 header，需补 Range 路径验证）。

**(c) 能力 gate（Electron-only v1）。** `hasStreamingSources()` 检测 bridge 是否实现 `mediaProxyUrl` + header 注入——目前只有 Electron。Tauri/web 返回 false，UI 隐藏在线源入口。Tauri 将来若补实现（http 插件设任意 header + 自定义协议供媒体 seek，reqwest 无 forbidden 限制）即自动点亮——推迟到 v1 之后（§7）。

---

## 3. Data Model Design

### 3.1 Core Concepts

```
Set (DjSession, 混合集)
  └── Track[]
        ├── origin:"generated"  → brief + blobId(mediaBlobs:media)
        ├── origin:"uploaded"   → blobId(mediaBlobs:media)
        └── origin:"streamed"   ← 新增
              ├── streamSourceId   "bili" | "netease" | "youtube"
              ├── streamExternalId  源稳定 id（bvid#cid / songId / videoId）
              ├── streamMeta?       源侧 metadata 快照（标题/艺人/封面 url/时长）
              ├── blobId?           可选：缓存的音频字节（Phase 5 离线，role:"media"）
              └── (播放时即时 resolve 直链；不长存 URL — 会过期)
        通用：tags / memories / cover / mediaMetadata / playCount —— 与其它 origin 完全一致
```

**关键设计（抄自 NeriPlayer 并适配）：**
- **稳定外部 id 而非可变直链**：`streamExternalId` 存稳定标识（NeriPlayer 用 `ytmusic://video/<id>` scheme / B站 `album="Bilibili|<cid>"` / 网易 songId 直存）。直链**每次播放前即时 resolve**，不持久化（YT/B站直链秒级~小时级过期）。
- **音频字节可选缓存**：默认只存元数据 + 源引用（轻）；用户"下载/离线"时才把 resolve 到的字节落 `mediaBlobs`（Phase 5），命中则播本地、不再 resolve。这就是"尽量入库存储"的落点。

### 3.2 Database Schema

⚠️ 优先扩展现有结构，不重构。当前 DB 已到 **v19**（[`src/db/muzero-db.ts:313`](src/db/muzero-db.ts)）。

**Q4 已定（best practice）：所有改动都是「附加的非索引字段」→ 无需 bump Dexie 版本、无迁移体**。Dexie 只对**被索引的**键建版本；新增普通属性、新增 origin 枚举值、给 settings 行加新属性都不触碰 schema。这与 [`Track.coverThumbhash`](src/db/types.ts) 的做法一致（其注释明言"Non-indexed → additive, no schema bump"）。

- **Current Schema:** [`src/db/types.ts`](src/db/types.ts) — `Track`（行 55-107）、`TrackOrigin`（行 16）、`MediaBlob`（行 140）、`AppSettings`（行 322）。
- **Required Changes（全部 TS 类型层 / 附加属性，零迁移）：**
  1. **`TrackOrigin` union 扩值**（[`src/db/types.ts:16`](src/db/types.ts)，TS-only）：
     ```ts
     export type TrackOrigin = "generated" | "uploaded" | "streamed";
     ```
  2. **`Track` 新增 stream 字段**（仅 `origin==="streamed"` 用；**非索引附加字段**）：
     ```ts
     streamSourceId?: StreamSourceId;      // "bili" | "netease" | "youtube"
     streamExternalId?: string;            // 源稳定 id（含分P/cid 等复合键）
     streamMeta?: StreamSourceMeta;        // 源侧元数据快照（避免重复在线查）
     // blobId 复用现有字段：Phase 5 缓存命中后填，播放优先走本地
     ```
  3. **`AppSettings` 新增按源配置**（[`src/db/types.ts:322`](src/db/types.ts)，BYOK，唯一 settings 行的新属性）：
     ```ts
     streamSources?: Partial<Record<StreamSourceId, StreamSourceConfig>>;
     // StreamSourceConfig = { enabled, cookie?, accessToken?, refreshToken?,
     //                        expiresAt?, quality?, lastAuthAt? }
     ```
- **Indexing（Q4 已定）：不建二级索引**。按源筛选库走**内存过滤**（与规则 6「列表用 useLiveQuery + 内存派生」一致）；个人规模库（数千~数万）足够快。**不**为 `streamSourceId` 建索引。
- **Import 去重：内存扫描**。去重键 = `streamSourceId + streamExternalId`（与本地导入的 `sourcePath` 同思路），但导入是用户偶发动作（非热路径），用一次 `where('sessionId')`/内存 `filter` 检查即可，不必为它建复合索引。
- **未来再评估**：仅当库膨胀到实测「按源筛选」或「导入查重」变慢，才在某个未来版本加 `[streamSourceId+streamExternalId]` 复合索引（YAGNI，届时是一次干净的索引-only 版本 bump）。
- **Privacy & Retention:** cookie/token 是敏感凭据 → 只进 `AppSettings.streamSources`（设备本地，规则 2）；**永不**进日志/遥测/bundle。提供"忘记登录"清 `streamSources[id]`。

### 3.3 Data Relationship Diagram

```
AppSettings(id:"app")
  └── streamSources[sourceId] → { enabled, cookie/token, quality }   （登录态 + 偏好）

DjSession ──1:N── Track(origin:"streamed")
                    ├── streamSourceId + streamExternalId   （稳定引用，可重解析）
                    ├── streamMeta                           （展示用快照）
                    ├─?─ blobId → MediaBlob(role:"media")    （Phase 5 离线缓存，可选）
                    ├── tags / coverBlobId / coverThumbhash  （与其它 origin 一致）
                    └── Memory[]（1:N）                       （音乐承载回忆，一致）
```

---

## 4. Provider / API Design

### 4.1 `StreamSourceProvider` 接口（新建，平行于 MusicGenProvider）

⚠️ 优先扩展、不大改既有。**不复用 [`MusicGenProvider`](src/musicgen/provider.ts)**（它的 `generate(req)→{blob,mime,durationSec}` 契约是"生成"，规则 5 还规定音频字节进 `mediaBlobs` 由 musicgen 写）。但**复用其纪律**：可插拔接口 + DI + registry + "绝不在 DJ/store/UI 里 `if(source===…)` 散落分支"。

```ts
// src/streamsrc/provider.ts
export type StreamSourceId = "bili" | "netease" | "youtube";

export interface StreamSearchHit {
  externalId: string;            // 源稳定 id
  title: string; artist?: string; album?: string;
  durationSec?: number; coverUrl?: string;
  source: StreamSourceId;
}

export interface PlayableStream {
  mediaUrl: string;              // CDN 直链（裸 URL，未代理）
  headers?: Record<string, string>;  // 媒体 GET 需注入的 header（Referer/UA）
  mime: string;                  // audio/mp4 | audio/webm | audio/mpeg | ...
  durationSec?: number;
  expiresAt?: number;            // 直链失效时间（ms）；播放前若 < now 则重 resolve
  quality?: string;              // 实际命中的音质档
}

export interface StreamSourceProvider {
  readonly id: StreamSourceId;
  readonly label: string;
  readonly requiresLogin: boolean;
  isAuthed(cfg: StreamSourceConfig): boolean;
  search(query: string, opts?: { limit?: number; signal?: AbortSignal }): Promise<StreamSearchHit[]>;
  importPlaylist?(playlistRef: string): Promise<StreamSearchHit[]>;   // 网易歌单/B站收藏夹/YT playlist
  resolve(externalId: string, opts: { quality?: string; signal?: AbortSignal }): Promise<PlayableStream>;
  health?(): Promise<boolean>;
}
```

`registry.ts` 仿 [`musicgen/registry.ts`](src/musicgen/registry.ts)：`resolveStreamSource(settings, id)` 按 id 装配，凭据从 `settings.streamSources[id]` 注入；UI/store 只调接口。

### 4.2 源检测 → 分发（NeriPlayer 最干净的模式）

NeriPlayer 用 `when{ isYouTube / isBili / else }` 按 `channelId` 路由（`PlayerManagerUrlExtensions.kt`）。MUZERO 等价物——纯函数，穷举单测：

```ts
// src/streamsrc/source-detect.ts
export function detectStreamSource(track: Track): StreamSourceId | null {
  if (track.origin !== "streamed") return null;
  return track.streamSourceId ?? null;   // 显式字段优先（比 NeriPlayer 的 album 前缀 hack 更干净）
}
```

播放分发挂在 [`player-store.ts`](src/stores/player-store.ts) 的 `playIndex` 加载分支（现有 `blobId` → `remoteMediaUrl` 之后插 `origin==="streamed"`）：

```ts
// player-store playIndex 内（新增分支，伪码）
if (track.blobId) { /* 既有：本地/缓存 blob */ }
else if (track.origin === "streamed") {
  const playable = await resolveStreamPlayback(track);              // 即时 resolve（含 expiresAt 判定）
  const src = bridge.mediaProxyUrl(playable.mediaUrl, playable.headers);  // 走 muzfetch 注入 header+Range
  await mediaEngine.loadUrl(src, track.kind);
}
else if (track.remoteMediaUrl) { /* 既有：R2 分享 */ }
```

### 4.3 muzfetch header 注入 + 媒体代理契约

```ts
// src/lib/desktop/bridge.ts — DesktopBridge 扩展
mediaProxyUrl?: (targetUrl: string, headers?: Record<string, string>) => string;
```
- **API 调用**：`streamFetch(url, { headers: {cookie, "user-agent", referer} })` → bridge.fetch 把受限 header 改写成 `x-muzero-h-*` → 代理还原。
- **媒体播放**：`mediaProxyUrl(cdnUrl, {referer, "user-agent"})` → `muzfetch://...`，喂给 `<audio src>`；代理转发 `Range`、回传 `206`。
- 真实改动点（v1 仅 Electron）：[`electron/fetch-proxy.cjs`](electron/fetch-proxy.cjs)（`x-muzero-h-*` 还原 + Range/206）、[`src/lib/desktop/electron.ts`](src/lib/desktop/electron.ts)（实现 `mediaProxyUrl`）；[`tauri.ts`](src/lib/desktop/tauri.ts) / [`web.ts`](src/lib/desktop/web.ts) 不实现（`mediaProxyUrl` 缺省 → `hasStreamingSources()` 自动为 false）。

### 4.4 每源映射隔离（仿 cloud-provider 三纯函数）

CLAUDE.md 规则 5：cloud vendor 映射隔离在 `mapBriefToBody`/`parseCreate`/`parseStatus`。每个 stream 源照此把"脏活"收进**纯函数 + 注入 now/fetch**，可确定性单测：

| 源 | 纯映射函数（隔离点） | 关键机制（详见 NeriPlayer） |
|---|---|---|
| **Bilibili** | `signWbi(params, keys)` · `mapSearch(json)` · `pickDashAudio(playurl, quality)` | WBI：nav 取 img/sub_key → `MIXIN_INDEX` 重排 → `md5(query+mixinKey)=w_rid`；`/x/player/wbi/playurl?fnval=DASH` → 选 `dash.audio/dolby/flac` 音轨；CDN 优先级排序。需 `Referer` 播放。 |
| **网易云** | `weapiEncrypt(payload)` · `eapiEncrypt(url,payload)` · `parsePlayback(json)` | weapi=AES-CBC 双层+RSA（`PRESET_KEY=0CoJUm6Qyw8W8jud`）；eapi=AES-ECB+MD5（`EAPI_KEY=e82ckenh8dichen8`，salt `36cd479b6b5`）；`/eapi/song/enhance/player/url/v1` + 7 级音质降级；301→需登录、`fee>0`→VIP、`freeTrialInfo`→试听。 |
| **YouTube** | `buildInnerTubeBody(videoId, client)` · `solveSig(playerJs, s)` / `solveN(...)` · `pickAdaptiveAudio(formats)` | InnerTube `WEB_REMIX→TV` client 轮询 `/youtubei/v1/player`；`signatureCipher` 的 `s`/`n` 用 EJS solver 实时算；googlevideo 直链补 `pot`(PoToken)。见 §4.5。 |

### 4.5 YouTube 专项（最难，单列 Phase 4）

**Q3 已定（best practice）：sig/n 与 PoToken 共用一个由主进程持有的隐藏、离屏、sandboxed `BrowserWindow`，经 IPC 驱动；app 渲染层永不执行 YT JS，只通过 bridge 请求 `solveSig`/`getPoToken`。** 决策推理：

| 候选 | 判定 | 理由 |
|---|---|---|
| **隐藏 `BrowserWindow`（采用）** | ✅ | PoToken/BotGuard 会探测真实浏览器环境（DOM/navigator/`window`），**必须**在真浏览器上下文跑——裸 JS 引擎做不到。sig/n solver 顺带在同一窗口的隔离世界（`executeJavaScript` in isolated world）执行。一个机制办两件，最省（契合「不引入新 runtime owner」）|
| `node:vm`（主进程） | ❌ | `node:vm` **不是安全沙箱**（可逃逸到宿主），把不可信 YT JS 放主进程违反规则 10（保持 `sandbox:true`）|
| QuickJS-wasm + Worker | ❌ | 第二套要维护的 JS runtime，且**仍搞不定 PoToken**（无浏览器环境）。徒增复杂度 |

窗口配置：`show:false` + 离屏，`nodeIntegration:false` + `contextIsolation:true` + `sandbox:true`；PoToken 阶段 `loadURL("https://music.youtube.com/")`（BotGuard 需真实 origin），缓存 `pot` 6h（NeriPlayer `YouTubeWebPoTokenProvider`）；sig/n 阶段注入 `yt.solver.{lib,core}.min.js` + 目标 `player.js` 调变换函数，按 `playerJsUrl` 缓存解密结果。
- **sig/n 来源**：直连 InnerTube 拿 `adaptiveFormats`，`s`/`n` 用 [yt-dlp/ejs](https://github.com/yt-dlp/ejs) 生成的 solver JS（复用 NeriPlayer `assets/youtube/yt.solver.{lib,core}.min.js`）。
- **脆弱度（持续维护项）**：YT 频繁改 `player.js` → 把 solver 资产与 client 版本号做成可热替换、跟随 ejs/NewPipe 升级；solver 失效时业务代码不动、只换资产即恢复（Phase 4 checklist 有演练项）。

### 4.6 Error Handling & URL 过期

- **直链过期**：`PlayableStream.expiresAt`；`playIndex` 与 prefetch 在播放/预取前判 `expiresAt < now+slack` 则重 resolve。失败 → 走 [`error-ux-architecture`](../../../.claude/projects/-Users-doodlebear-Documents-code-MUZERO/memory/error-ux-architecture.md)：播放类错误进 toast（不进 dock），不静默吞。
- **权限/地区**：网易 VIP/灰色、B站大会员、YT 区域限制 → 返回结构化失败原因，UI 明示"该曲在此源不可播放"，可提示换源。
- **音质降级**：网易按 `jymaster→…→standard` 候选链逐级 resolve（NeriPlayer `buildNeteaseQualityCandidates`）。
- **Telemetry**：本地优先、无遥测（规则 1）。出错只走本地 logger（规则 8），**绝不**上报 URL/cookie/外部 id。

---

## 5. Frontend Design

### 5.1 Page Structure

```
pages/search-page.tsx         # 加"在线"分段：本地结果 + 各已登录源并行 search()
components/settings/          # 新增 stream-sources-settings.tsx：每源 登录/登出 + 音质选择 + enable
components/library/           # set 内"添加在线歌曲/导入歌单"入口 → createStreamedTrack
components/player/            # 无需改：streamed track 复用 media-stage / now-playing
```

### 5.2 UI Components / Interaction

- **Settings · 在线源**：每源一张卡：开关、`登录`（开官方登录页抓 cookie）/`忘记登录`、音质下拉（源各自档位，NeriPlayer 是每源独立 `qualityFlow`）。默认全部 **disabled**。
- **搜索**：本地结果即时（现有纯函数）；勾"在线"后并行查已登录源，结果按源分组；每条 `▶ 试听` + `+ 收藏入库`（= `createStreamedTrack` 进当前/新 set）。**默认入库**（产品决策 2）：收藏即落 `streamed` track。
- **歌单导入**：粘贴网易歌单/ B站收藏夹/ YT playlist 链接 → `importPlaylist` → 批量建 streamed track 进新 set。
- **能力 gate**：`hasStreamingSources()` 为 false（web 壳）时整块隐藏，附一行"在线源需桌面端"。

### 5.3 State Management

- 登录态 → 模块作用域单例 `stream-auth-store` + observer 注入各 provider（NeriPlayer `AppContainer.startCookieObserver` 的等价；规则 6：不进 player-store state，避免重渲染）。
- 在线搜索结果用 TanStack Query（异步/可取消/缓存），**不**塞 Zustand（规则 6）。
- 库内 streamed track 仍走 Dexie `useLiveQuery`。

### 5.4 i18n（4 locale，per prd-create.md §3）

所有新文案（源名、登录/登出、音质档、试听/收藏、过期/不可播错误、桌面专属提示）走 `t("ns.key")`，先加 **en**（类型源）再补 zh/ja/ko。少 locale 在 PR 标 "pending translation" + 开 i18n followup。源名/音质档不写按 locale 的大对象分支。

---

## 6. Implementation Plan

> 顺序遵循 prd-create.md §3「基础设施先于覆盖广度」：Phase 1（代理 + 抽象 + 数据模型）必须先合并，否则 2/3/4 的 PR 反复 rebase。

### Phase 1: 基础设施

**Goal:** muzfetch 能注入受限 header 并支持媒体 Range；StreamSource 抽象 + registry + 数据模型 + 桌面能力 gate 就位（不接任何真实源）。

**Tasks:**
- [ ] `electron/fetch-proxy.cjs`：`x-muzero-h-*` → 真实 header 还原；`Range` 转发 + `206/Content-Range/Accept-Ranges` 透传。
- [ ] `DesktopBridge.mediaProxyUrl` + **Electron 实现**（Tauri/web 缺省）；`hasStreamingSources()` 按能力存在判定。
- [ ] `src/streamsrc/{provider,registry,source-detect,http}.ts` 接口与纯函数骨架。
- [ ] 数据模型（**附加非索引、零迁移**）：`TrackOrigin += "streamed"`；`Track` 加 stream 字段；`AppSettings.streamSources`。**不** bump Dexie 版本、**不**建索引。
- [ ] `createStreamedTrack()` repo + `streamSourceId+externalId` 内存查重。

#### Phase 1 Checklist
- [ ] muzfetch 注入 `Referer` 能让一个真实 B站 CDN GET 不再 403（手测一个公开 bvid）。
- [ ] 媒体元素经 `mediaProxyUrl` 能 **seek**（206 生效）。
- [ ] `detectStreamSource` 纯函数穷举单测。
- [ ] streamed track 可写读、与旧库（generated/uploaded）共存无碍；确认未触发 Dexie 版本升级（无 `.version()` 新增）。
- [ ] 内存查重单测：同 `streamSourceId+externalId` 不重复入库。
- [ ] Tauri / web 壳下 `hasStreamingSources()===false`，UI 入口隐藏。
- [ ] `make check` 通过。

### Phase 2: Bilibili（架构试金石）

**Goal:** 端到端跑通一个源——搜索 → 入库 streamed track → 即时 resolve → 注入 Referer 播放；WBI + DASH 音轨选择 + 登录 + 音质偏好。

**Tasks:**
- [ ] `bili-wbi.ts`：`MIXIN_INDEX` 重排 + `md5(query+mixinKey)`；nav/ticket 取 key（10min 缓存）。
- [ ] `bili-source.ts`：`search`（`/x/web-interface/wbi/search/type`）+ `importPlaylist`（收藏夹/合集）。
- [ ] `bili-resolve.ts`：`/x/player/wbi/playurl?fnval=DASH` → 选音轨（dolby/hires/lossless/high/med/low 降级）+ CDN 排序 + `expiresAt`。
- [ ] 登录：Electron 开 `passport.bilibili.com` 抓 `SESSDATA/bili_jct/buvid3`；匿名 `finger/spi` 兜底。
- [ ] Settings 卡 + 搜索在线 tab + set 导入入口（i18n 全量）。

#### Phase 2 Checklist
- [ ] WBI 签名单测（固定输入 → 期望 `w_rid`）。
- [ ] resolve 注入式单测（canned playurl JSON → 选中预期音轨）。
- [ ] 真机：搜 → 收藏入库 → 播放出声、可 seek、切 tab 不断播。
- [ ] 未登录匿名可放普通音质；登录后可放高音质。
- [ ] 直链过期重解析路径手测（改短 slack 验证）。
- [ ] 加密/签名在 `stream-crypto-worker` 不卡主线程。

### Phase 3: 网易云

**Goal:** weapi/eapi 纯 TS 加密；搜索 / 取直链 / 7 级音质降级 / 登录 / VIP·灰色·试听处理。

**Tasks:**
- [ ] `netease-crypto.ts`：weapi(AES-CBC×2+RSA) + eapi(AES-ECB+MD5) + linuxapi；常量与 NeriPlayer 对齐。
- [ ] `netease-source.ts`：`/weapi/cloudsearch/get/web` 搜索 + 歌单导入。
- [ ] `netease-resolve.ts`：`/eapi/song/enhance/player/url/v1` + 候选音质降级 + `parsePlayback`（301/fee/freeTrial）。
- [ ] 登录：手机验证码 或 抓 `MUSIC_U`+`__csrf` cookie；csrf 预热。

#### Phase 3 Checklist
- [ ] 加密单测：已知 payload → 期望 params/encSecKey（对拍 NeriPlayer 输出）。
- [ ] `parsePlayback` 分支单测（200/301/404/fee/freeTrialInfo）。
- [ ] 真机：登录后可放无损；未登录退化/提示。
- [ ] 音质降级链命中下一档单测。

### Phase 4: YouTube（最难）

**Goal:** InnerTube 取流 + EJS sig/n 解密 + PoToken；audio-only 直链补 `pot` 播放。

**Tasks:**
- [ ] `youtube-innertube.ts`：bootstrap（apiKey/visitorData/playerJsUrl）+ `WEB_REMIX→TV` client 轮询 `/youtubei/v1/player`。
- [ ] 主进程：单个隐藏离屏 sandboxed `BrowserWindow` 生命周期 + IPC（`solveSig`/`getPoToken`），渲染层只经 bridge 调（Q3 已定）。
- [ ] `youtube-sig-solver.ts`：复用 `yt.solver.*.min.js`，在该窗口隔离世界算 `sig`/`n`，按 `playerJsUrl` 缓存。
- [ ] `youtube-potoken.ts`：同一窗口 `loadURL("music.youtube.com")` 跑 BotGuard 得 `pot`，缓存 6h。
- [ ] `pickAdaptiveAudio`：MP4(AAC)>WebM(Opus) + bitrate 排；登录(cookie)/游客(visitorData)。
- [ ] solver/资产可热更新机制（应对 YT 改 player.js）。

#### Phase 4 Checklist
- [ ] 一个公开 videoId 端到端出声（含 sig 解密 + pot）。
- [ ] sig solver 对一段固定 player.js + s 算出与参考实现一致的解密值。
- [ ] PoToken 6h 缓存命中；过期重取。
- [ ] YT 改版演练：solver 资产替换后无需改业务代码即恢复。

### Phase 5: 离线缓存 / 下载（"尽量入库存储"，可选增强）

**Goal:** 用户可把 streamed track 的音频字节缓存到 `mediaBlobs`（role:"media"）供离线；命中则播本地、不再 resolve。

**Tasks:**
- [ ] 下载：经 muzfetch 拉 resolve 到的字节 → `mediaBlobs` → 回填 `Track.blobId`；进度/可取消（沿用 [`electron-shell-pivot`](../../../.claude/projects/-Users-doodlebear-Documents-code-MUZERO/memory/electron-shell-pivot.md) 的同步指示器纪律）。
- [ ] 播放优先级：`blobId` 命中走本地，否则即时 resolve。
- [ ] 缓存管理：Settings 显示占用 + 清理。

#### Phase 5 Checklist
- [ ] 下载后断网仍可播。
- [ ] 缓存与即时 resolve 的优先级单测。
- [ ] object-URL revoke-before-replace 不泄漏（规则 9）。

---

## 7. Out of Scope

- **Web 壳支持**：浏览器环境无代理 + forbidden header + CORS，明确不做（gate 隐藏）。
- **Tauri 流媒体 parity（推迟）**："这里我们主要用 Electron"——v1 不实现 Tauri 端的 `mediaProxyUrl` / header 注入 / 媒体 seek 协议。抽象层保持壳无关（capability gate，非 `isElectron()` 硬判），将来补 Tauri 实现即点亮，不属本 PRD 范围。
- **写操作**：不做收藏到网易/B站/YT 服务端、不做评论/弹幕/点赞——只读取播放。
- **视频画面**：B站/YT 默认取 **audio-only**；不做 MV 视频流（与现有上传 MV 的 `<video>` 不同链路，后续单独评估）。
- **DRM 内容**：不碰 Widevine/FairPlay 等加密媒体。
- **账号系统 / 跨设备同步登录态**：登录态各源各设备各自存（与 Electron↔Tauri 不迁移数据的已知限制一致）。
- **多源聚合"全网搜一首歌"智能匹配**：v1 各源独立搜，不做跨源去重/最佳源自动选。

---

## 8. Security / Privacy / Compliance Considerations（含红线）

- **🚩 ToS / 版权红线（必读）**：接入网易云/B站/YouTube 依赖**复刻各家鉴权与反爬**，通常**违反其服务条款**，且流式播放受版权保护的内容有法律风险。本特性定位为**个人使用的高级功能，默认关闭，需用户显式开启并自带登录态**——与 [`folder-import-feature`](../../../.claude/projects/-Users-doodlebear-Documents-code-MUZERO/memory/folder-import-feature.md) 的红线一脉相承（那里只导明文、不解密商店 DRM；这里同样不内置任何凭据、不绕付费墙以外的 DRM、不分发受保护内容）。MUZERO **不内置任何官方 API key / cookie**，不代理、不缓存到任何 MUZERO 服务端（无后端，规则 1）。
- **BYOK / 密钥纪律（规则 2）**：cookie/token 只存 `AppSettings.streamSources`（设备本地 IndexedDB）。**禁止**写进 bundle / committed `.env` / URL / 日志 / 遥测。提供"忘记登录"一键清除。
- **无 hidden flag（规则 3）**：功能开关 = 可见的 Settings 控件；回滚 = `git revert` + 重发版，不藏 `localStorage`/URL/`window.*` toggle。
- **出站 HTTP 收口（规则 10）**：一切外部请求走 `getAppFetch()`/bridge；新增的出站源在 §8 红线下是**用户显式启用的第三方调用**，与 BYOK LLM/musicgen 同类——不构成"MUZERO 自有后端"。
- **Telemetry whitelist**：本地优先、不上报。即便将来加任何本地诊断，**永不**记录 cookie/token、外部 id、直链、搜索词、播放历史到任何外部端。
- **隔离执行安全（YouTube）**：sig solver / PoToken 跑在隔离的隐藏窗口；保持 `contextIsolation:true + sandbox:true`（规则 10），不因跑第三方 JS 放宽 `webSecurity`。
- **codename 稳定（规则 4）**：db 名 `muzero-db` / id 前缀 / 表名不变；`streamSourceId` 取稳定值 `"bili"|"netease"|"youtube"`，跨品牌/跨壳不变。

---

## 9. Related Documents

- 参考实现：[cwuom/NeriPlayer](https://github.com/cwuom/NeriPlayer)（`core/api/{netease,bili,youtube}/`、`core/player/url/PlayerUrlResolver.kt`、`core/di/AppContainer.kt`）
- [CLAUDE.md](../../../CLAUDE.md) — 硬规则 1(本地优先)/2(BYOK)/3(无 hidden flag)/5(provider 边界)/6(zustand)/7(vitest)/9(桌面+播放)/10(桌面壳抽象)
- [`musicgen/provider.ts`](../../../src/musicgen/provider.ts) / [`registry.ts`](../../../src/musicgen/registry.ts) — 被平行参照的 provider 模式
- [`src/lib/desktop/bridge.ts`](../../../src/lib/desktop/bridge.ts) / [`electron/fetch-proxy.cjs`](../../../electron/fetch-proxy.cjs) — 改造点
- 相关 PRD：[多语言转写搜索](../20260610-muzero-multilingual-transliteration-search-prd/)（worker+crypto+桌面同纪律）、[cloud musicgen provider](../20260607-muzero-cloud-musicgen-provider-selection-prd/)（三纯函数 vendor 隔离范式）
- Memory：[electron-shell-pivot](../../../.claude/projects/-Users-doodlebear-Documents-code-MUZERO/memory/electron-shell-pivot.md)、[folder-import-feature](../../../.claude/projects/-Users-doodlebear-Documents-code-MUZERO/memory/folder-import-feature.md)、[error-ux-architecture](../../../.claude/projects/-Users-doodlebear-Documents-code-MUZERO/memory/error-ux-architecture.md)

---

## 10. Open Questions

| # | 问题 | 状态 |
|---|---|---|
| Q1 | v1 源范围与顺序 | ✅ 已定（2026-06-10）：**三源全做**，YouTube 单列 Phase 4 |
| Q2 | 外部歌曲落库模型 | ✅ 已定：**默认入库为 streamed track，尽量持久化存储**（音频字节 Phase 5 可选离线缓存）|
| Q3 | YouTube sig/n + PoToken 在 Electron 的 JS 执行上下文 | ✅ 已定（best practice）：**单个隐藏离屏 sandboxed `BrowserWindow`，sig/n 与 PoToken 共用**；排除 `node:vm`（非安全沙箱）与 QuickJS-wasm（第二 runtime 且无法做 PoToken）。见 §4.5 |
| Q4 | `streamSourceId` 是否建二级索引 | ✅ 已定（best practice）：**不索引**——stream 字段附加非索引、**零迁移**（仿 `coverThumbhash`），筛选/查重走内存；索引推迟到实测有需要。见 §3.2 |
| Q5 | Tauri 媒体 seek 的自定义协议方案 | ✅ 已定：**v1 仅 Electron**，Tauri parity 推迟（§7）；能力 gate 保持壳无关 |

---

## 11. Document Change Log

| Date | Author | Change |
|---|---|---|
| 2026-06-10 | DoodleBear | 初稿：基于 NeriPlayer 调研落地三源接入方案；确认三源全做 + 默认入库；Q3-Q5 待 spike |
| 2026-06-10 | DoodleBear | 解决 Q3/Q4/Q5（best practice）：YT 用单隐藏 sandboxed BrowserWindow；stream 字段零迁移不索引；v1 仅 Electron（Tauri 推迟）。同步 §2.1/2.2/2.4/3.2/4.3/4.5/Phase1/Phase4/§7 |
