# PRD: MUZERO QQ 音乐在线源接入（QQ Music Stream Source）

**Status:** Draft
**Created:** 2026-06-16
**Author:** DoodleBear
**Module:** `src/streamsrc/qq/`（新增）· `src/streamsrc/{registry,qr-login,login}.ts`（扩）· `src/db/types.ts`（`StreamSourceId` 加 `"qq"`）· Settings · Search

> **本 PRD 是 [`20260610 外部流媒体源接入`](../20260610-muzero-external-streaming-sources-prd/20260610-muzero-external-streaming-sources-prd.md) 的增量续作。** 那一期已把**整套基础设施**做完（`StreamSourceProvider` 抽象 + registry + muzfetch header 注入 + `mediaProxyUrl` + Range/206 + 数据模型 `origin:"streamed"` + 源无关 QR 登录状态机 + 登录窗口 bridge + Settings 面板 + 歌单同步 + 离线缓存）。**接入 QQ 音乐 = 加一个 provider**：新建 `src/streamsrc/qq/`、给 `StreamSourceId` union 加 `"qq"`、registry 加一个 `case`、QR 登录配置加一组端点/状态码。**不重做任何基础设施**。

> **⚠️ 调研结论先行（必读，决定范围）：**
> 1. **命名参考项目 [NeriPlayer](https://github.com/cwuom/NeriPlayer)（Android/Kotlin）对 QQ 音乐只做了「搜索 + 歌曲详情 + 歌词」元数据，没有登录、没有播放、没有 vkey/直链解析**（仓库里只有 `QQMusicSearchApi.kt`，没有 `core/api/qq` 包）。**不能像三源 PRD 那样把 NeriPlayer 的 QQ 代码整体移植**——它根本没有播放部分。
> 2. 真正的「可播放」知识来自另外两个项目：**[NeriPlayer-Desktop](https://github.com/cwuom/NeriPlayer-Desktop)（Rust/Tauri）** 用**静态混淆参数**（`g_tk=5381`/`guid=10000`/`uin=0`）做 guest 直链解析、无动态签名；**[luren-dc / L-1124 QQMusicApi](https://github.com/luren-dc/QQMusicApi)（Python，GPL-3.0，2026-06 仍活跃）** 实现完整现代流程（zzc 签名 + QIMEI 设备指纹 + `music.vkey.GetVkey`/`GetEVkey` + 三路 QR 登录 + `musicid/musickey` 凭据模型）。
> 3. **法律红线是本特性的首要约束（而非技术难度）**：2022-11-04 腾讯音乐对 [unlock-music 及其 497 个 fork](https://github.com/unlock-music/unlock-music)（至今仍 HTTP 451，block reason `dmca`）发起 DMCA，并把**加密音频（`.mflac`/`.mgg`/`.qmc`，RC4 512-bit 每文件密钥 + TEA 包裹）框定为「控制版权内容访问的技术措施」**，按 GitHub 的 **§1201 反规避**子表提交——这是比普通 ToS/版权主张**更高一档**的法律风险类别。**故本 PRD 的硬边界：只做 guest/登录态下的搜索 + 元数据 + 明文音频流播放；绝不内置 `.mflac`/`.mgg`/`.qmc` 解密器**（与 [`folder-import-feature`](../../../.claude/projects/-Users-doodlebear-Documents-code-MUZERO/memory/folder-import-feature.md) 红线一脉相承）。

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | QQ guest provider 纯核心：`hash33`/`g_tk` + 音质码表 + search/detail/vkey/cover 纯映射 + sip+purl 直链组装（TDD） | ✅ Completed | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | registry 接入 + 运行时 muzfetch(Referer) + Electron 端到端**手测可播放**（验证 Open Q：标准音质能否 resolve） | ✅ **已验证（2026-06-17 Electron）**：搜索可达、登录态明文歌可播出声、VIP/加密档正确判 no-permission（红线生效）。Open Q1/Q6 已回填 | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | 登录：**登录窗口路线**（`STREAM_LOGIN_CONFIGS.qq` + `g_tk=hash33(musickey)`，Q4 定）；QR API（QQ PTLogin+微信 OAuth code→凭据兑换）降 v2 | ✅ 登录可用（**Electron 手测 cookie 抓取已验证**，2026-06-17）；QR API 仍 v2 | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | 歌单同步 + 粘贴链接（`getUserPlaylists`/`getTracksByIds`/`getPlaylistMeta`/`importPlaylist` + QQ 链接解析） | 🔄 代码就位（含 `getUserPlaylists`，登录解锁后实现 + 单测；**待手测**真实 `fcg_user_created_diss`/`aiDissInfo` 端点 + 粘贴链接入库） | [Phase 4 Checklist](#phase-4-checklist) |
| 5 | `zzc` 签名 + QIMEI 设备指纹（**仅当 guest/web 签名在运行时被拒的回退路径**，按需启用） | ⏸️ **未触发（2026-06-17）**：登录态 WEB `g_tk`+`comm.authst` 已能播明文，前两档未被拒 → 按 YAGNI 不实现 | [Phase 5 Checklist](#phase-5-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending
>
> **顺序理由**：Phase 1→2 先把**最低风险、最低工作量**的 guest 明文播放打通（对标已有的网易云匿名里程碑），并在运行时验证关键 Open Question（guest 直链今天是否还可用）。Phase 3（登录）只在 guest 不足时才是必需，且引入 QQ 特有的 **OAuth code→凭据兑换**环节（比网易/B站「成功即落 cookie」多一步）。Phase 5（zzc）是签名硬骨头，**仅作回退**，能不做就不做。

### 调研溯源（Provenance）

本 PRD 的 QQ 端点、签名配方、登录状态机、项目对比，全部来自一次 deep-research（6 angle / 24 源 / 89 claims → 25 三票对抗验证 → 23 confirmed / 2 killed）。关键源（均 primary，直接读代码核实）：

| 源 | 角色 | 提供了什么 |
|---|---|---|
| [cwuom/NeriPlayer](https://github.com/cwuom/NeriPlayer)（Kotlin，命名参考） | ⚠️ **仅元数据** | `client_search_cp` 搜索 / `musicu.fcg` 详情 / `fcg_query_lyric_new.fcg` 歌词；`g_tk=5381` 静态。**无登录/播放/vkey** |
| [cwuom/NeriPlayer-Desktop](https://github.com/cwuom/NeriPlayer-Desktop)（Rust） | **guest 直链解析参考** | 静态参数（`g_tk=5381`/`guid=10000`/`platform=20`/`loginflag=1`/`uin=0`），sip+purl 组装，音质码表与降级，**无动态签名** |
| [luren-dc/QQMusicApi](https://github.com/luren-dc/QQMusicApi)（Python，GPL-3.0，活跃） | **完整现代流程参考** | `music.vkey.GetVkey`/`GetEVkey`、`zzc` 签名（`sign.py`）、`hash33`/`g_tk`（`common.py`）、三路 QR 登录（`login.py`）、`musicid/musickey` 凭据（`request.py`） |
| [jsososo/QQMusicApi](https://github.com/jsososo/QQMusicApi)（Node，GPL-3.0） | 简化版参考 | 直接存 `cookie` 字符串 + `uin`；部分搜索端点已衰减 |
| [VenenoFSD/QQMusic-api](https://github.com/VenenoFSD/QQMusic-api)（Koa，~2018-19） | 历史变体 | `/song/vkey` 旧式直链 `isure.stream.qqmusic.qq.com/C400{mid}.m4a?guid=...&vkey=...&uin=0`（已过时，仅理解用） |
| [unlock-music DMCA 通知](https://github.com/github/dmca/blob/master/2022/11/2022-11-04-qqmusic.md) | **法律红线证据** | 腾讯把 `.mflac/.mgg/.qmc` 解密框定为 §1201 反规避 |

> **两条被 killed 的 claim（写进来防后人重复踩坑）**：① 「NeriPlayer-Desktop 与 MUZERO 同栈、有 `src-tauri/src/api/{qq,...}` 分源 provider 目录、可近乎直接照搬」→ **0-3 否决**（它不是 MUZERO 那套抽象，别假设能整体照搬）。② 「加密格式 = 收费墙机制、unlock-music 让用户免 VIP 播放」→ **1-2 否决**（加密变体跨多档存在，并非严格等价 VIP；精确规则是「受版权保护内容」，常常但不总是 = VIP）。

---

## 1. Overview

### 1.1 Background

MUZERO 已通过 [`src/streamsrc/`](../../../src/streamsrc/) 接入**网易云 / Bilibili / YouTube** 三个在线源（[20260610 PRD](../20260610-muzero-external-streaming-sources-prd/20260610-muzero-external-streaming-sources-prd.md)），用户可把这些平台的歌纳入 MUZERO 的策展 / 记忆 / DJ 上下文。**QQ 音乐是华语用户的另一大主力曲库**，本期把它补齐。

由于基础设施已就位，QQ 音乐的**工程量集中在「QQ 特有的端点 + 签名 + 登录」**这一层，而非整套播放/代理/数据/UI 管线。本 PRD 因此比三源 PRD 轻得多——它是一篇「**按既有 provider 纪律新增一个源**」的聚焦文档。

### 1.2 Target Users

| Role | Description | Permissions |
|------|-------------|-------------|
| **本地高级用户（owner）** | 在自己设备上把已有的 QQ 音乐曲目纳入 MUZERO 库做策展、加记忆、喂 DJ。BYOK：可选自带 QQ/微信登录态。 | 全功能；**默认关闭**，需在 Settings 显式开启；guest 即可搜索/播明文，登录解锁歌单同步（音质仍封顶明文档） |

> 单角色（本地优先、无账号系统）。**个人使用的高级功能**，见 §8 红线。

### 1.3 Core Value

1. **把 QQ 音乐的歌纳入 MUZERO 记忆体系**：与三源、生成、上传曲目同等待遇——可加 tag / 写记忆 / 配封面 / 被搜索 / 喂 DJ。
2. **guest 优先、零门槛**：不强制登录即可搜索 + 播放明文标准音质（对标网易云匿名体验），把「先能用」的门槛压到最低。
3. **复用全部既有管线**：同一播放队列、同一 `<audio>`/`<video>`、同一可视化/Now Playing、同一离线缓存、同一 Settings/搜索/歌单同步 UI——**QQ 只是 registry 里多出来的一个 id**。
4. **零后端、BYOK、守红线**：无 MUZERO 服务器中转；登录态只存设备本地；**绝不解密 `.mflac/.mgg`**——音质封顶在明文档，把法律风险锁在 ToS 级而非 §1201 级。

---

## 2. System Architecture

### 2.1 复用什么 / 新增什么（全景）

```
═══════════ 已存在（20260610，零改动复用）═══════════════════════════════
StreamSourceProvider 契约 · registry 分发 · source-detect · StreamHttp(注入)
muzfetch header 注入(x-muzero-h-*) · mediaProxyUrl(Referer 注入) · Range/206
数据模型 origin:"streamed" + streamSourceId/streamExternalId/streamMeta(零迁移)
QR 登录状态机(qr-login-provider: generate→waiting→scanned→success/expired)
登录窗口 bridge(openSourceLogin/readSourceCookies) · login.ts cookie 助手
Settings「在线音源」面板(按 registry 自动列源) · 歌单同步/导入 · 离线缓存(Phase5)
hasStreamingSources() 能力 gate(Electron-only v1)
═══════════ 本 PRD 新增（QQ 特有的脏活，隔离在 qq/）═══════════════════════
src/streamsrc/qq/
  ├── qq-sign.ts        # hash33 / g_tk(=hash33(musickey,5381)) / ptqrtoken(=hash33(qrsig))
  │                     #   （zzc 签名 + QIMEI 押后到 Phase 5，按需）
  ├── qq-quality.ts     # 音质码表(明文 SongFileType 前缀→格式→码率) + 降级链(明文封顶)
  ├── qq-resolve.ts     # 解析 GetVkey 响应 → sip[]+purl 组装直链；加密档(EVkey)→标记不可播
  ├── qq-playlists.ts   # 纯解析器(搜索/详情/歌单/用户歌单 → StreamSearchHit/StreamPlaylist)
  └── qq-source.ts      # 实现 StreamSourceProvider：search/resolve/getUserPlaylists/...
扩既有(各一两行)：
  registry.ts           # STREAM_SOURCE_IDS 加 "qq" + createStreamSource case
  db/types.ts           # StreamSourceId union 加 "qq"
  qr-login.ts           # QQ PTLogin + 微信 两组 generate/poll 端点 + 状态码映射
  login.ts              # STREAM_LOGIN_CONFIGS.qq（authCookie: "qqmusic_key"）
  i18n locales × 4      # 源名 "QQ 音乐" + 红线/音质封顶文案
```

### 2.2 两个签名「档位」（决定工作量的关键分叉）

QQ 音乐的请求鉴权有**三套并存**的机制，工作量天差地别。**本 PRD 默认走最简的 guest 档，登录档次之，zzc 档仅作回退**（Q2 已按 best practice 定为「渐进式分层、最低档优先、zzc 不预建」，见 §10）：

| 档位 | 机制 | 参数 | 工作量 | 何时用 |
|---|---|---|---|---|
| **① guest（默认）** | 退化静态参数：`g_tk=5381`（= `hash33("")` 空 skey 的退化值）、`uin=0`、`guid=10000`、`platform=20`、`loginflag=1` | 无动态计算 | **最低** | Phase 1-2。NeriPlayer-Desktop / VenenoFSD 路线。**先验证今天还能用**（Open Q1/Q2） |
| **② WEB 登录** | `g_tk = hash33(musickey, 5381)`——腾讯 `hash33` 算法：`h=5381; for c: h=(h<<5)+h+ord(c); return h & 0x7fffffff`（**非 AES/MD5**） | `musickey`（登录得）+ `g_tk` | 低（纯函数 + 凭据） | Phase 3。登录后 WEB 平台请求 |
| **③ Android client（回退）** | `zzc` 签名：`SHA1(json.dumps(payload))` 大写 hex → 按固定下标取两段子串（`PART_1=[23,14,6,36,16,7,19]`/`PART_2=[16,1,32,12,19,27,8,5]`）→ 20 个 `SCRAMBLE_VALUES` XOR 打乱 → base64(去 `\/+=`)→ `zzc{part1}{b64}{part2}`.lower()，挂 `params.sign`；另带 QIMEI 设备指纹（`guid=device.open_udid`）+ 毫秒时间戳 `_` | `sign` + `QIMEI` + `_` | **高**（设备指纹 + 逆向签名，腾讯按 zza→zzb→zzc 轮换） | Phase 5，**仅当 ①② 在运行时被服务端拒绝** |

> **关键不确定性（必须 Phase 2 运行时验证，见 Open Q）**：guest 档（`g_tk=5381`/`uin=0`）今天能否仍 resolve 出可播放的标准音质（M500/M800/C400）直链？这是**不可静态确定**的——这些是非官方逆向私有 API，腾讯持续收紧。若 guest 被拒，最小可用集就要从 ①跳到 ②（需登录）甚至 ③（zzc）。**Phase 2 的手测就是为回答这个问题而设**。

### 2.3 「必须经代理」的两条链路（与三源一致，已实现）

QQ 与三源同样需要 muzfetch 代理，且改动点**已经存在**（20260610 Phase 1）：

| 链路 | QQ 的特殊要求 | 复用的既有能力 |
|---|---|---|
| **API 调用**（search/detail/vkey/登录） | 跨域 + 需带 `Referer: https://y.qq.com`（部分端点）、`Cookie`（登录态）；渲染层 `fetch` 禁设这些 forbidden header | `StreamHttp` + `x-muzero-h-*` 别名 → `electron/fetch-proxy.cjs` 还原（已实现） |
| **媒体流播放**（`<audio src>` GET CDN 直链） | QQ 的 `dl.stream.qqmusic.qq.com` / `isure.stream.qqmusic.qq.com` 直链一般**不强制 Referer**（待 Phase 2 实测确认），但仍需 Range/206 才能 seek | `mediaProxyUrl` + Range/206 透传（已实现）；若 QQ CDN 不要 header，甚至可不经代理直 `<audio>` 播（同网易云匿名直链） |

> 沿用三源结论：**v1 仅 Electron**，Tauri/web 经 `hasStreamingSources()` 能力 gate 隐藏（不 `if(kind==="electron")` 硬判）。

### 2.4 Technology Stack

| Component | Technology | Rationale |
|---|---|---|
| **源 provider** | 新建 `createQqSource` 实现既有 `StreamSourceProvider`，registry 注册 | 规则 5：复用三源同款 provider 边界纪律，**不**在 UI/store 散落 `if(source==="qq")` |
| **签名/哈希** | 纯 TS：`hash33`（位运算）+ `SHA1`（Web Crypto / 复用 `src/streamsrc/crypto/`）；zzc 的 XOR/base64 纯函数 | 规则 7：纯函数注入式可确定性单测，放 worker（与网易/B站 crypto 同位置） |
| **QIMEI 设备指纹（仅 Phase 5）** | 设备 udid + appid（`qimei_qq_android`）——逆向自 luren-dc | 仅在 zzc 回退档需要；能不做就不做 |
| **出站 HTTP** | `getAppFetch()` → muzfetch（已有 header 注入 + Range） | 规则 10 |
| **存储** | 复用 `AppSettings.streamSources.qq`（既有 `StreamSourceConfig` 字段够用，见 §3） | 规则 1/4：零迁移、codename 稳定 |
| **登录** | 复用既有 QR 状态机 + 登录窗口 bridge；QQ 增 OAuth code→凭据兑换钩子 | QQ 特有：成功后多一步 code 兑换（§4.4） |

### 2.5 Project Structure（仅列新增/改动）

```
src/streamsrc/
├── qq/                          # ★ 新增（QQ 脏活隔离，平行于 netease/ bili/ youtube/）
│   ├── qq-sign.ts   qq-sign.test.ts        # hash33 / g_tk / ptqrtoken（zzc 押后）
│   ├── qq-quality.ts qq-quality.test.ts    # 明文码表 + 降级链
│   ├── qq-resolve.ts qq-resolve.test.ts    # GetVkey 响应 → sip+purl 直链；加密档→不可播
│   ├── qq-playlists.ts qq-playlists.test.ts# 搜索/详情/歌单纯解析器
│   └── qq-source.ts  qq-source.test.ts     # StreamSourceProvider 纵向（stub transport）
├── registry.ts                  # ✎ + "qq" / + createQqSource case
├── qr-login.ts                  # ✎ + QQ PTLogin + 微信 generate/poll/状态码
└── login.ts                     # ✎ + STREAM_LOGIN_CONFIGS.qq
src/db/types.ts                  # ✎ StreamSourceId += "qq"
src/i18n/locales/{en,zh,ja,ko}/  # ✎ 源名 + 红线/音质文案
```

---

## 3. Data Model Design

### 3.1 零新增持久化结构（全部复用）

**QQ 不需要任何新表、新字段、新索引、新迁移**。既有 `streamed` track 与 `StreamSourceConfig` 字段完全够用：

```
Track(origin:"streamed")                       —— 复用，无改动
  ├── streamSourceId:   "qq"                    （union 新增成员，TS-only）
  ├── streamExternalId: <songmid>               （QQ 稳定 id；vkey 还需 strMediaMid，见下）
  ├── streamMeta:       {artist,album,coverUrl,durationSec}  （展示快照，离线渲染）
  ├── blobId?:          缓存的明文字节（Phase 5 离线，复用）
  └── tags/memories/cover/playCount             （与其它 origin 一致）

AppSettings.streamSources.qq: StreamSourceConfig  —— 复用既有形状
  ├── enabled?:    boolean
  ├── cookie?:     "qqmusic_uin=<uin>; qqmusic_key=<musickey>"  （登录态，BYOK 设备本地）
  ├── accessToken?/refreshToken?/expiresAt?:     （QQ OAuth 刷新用，既有字段正好对上）
  └── quality?:    "320"|"flac"|"high"|...        （音质偏好，明文封顶）
```

> **唯一的 TS 改动**：`StreamSourceId = "netease" | "bili" | "youtube" | "qq"`（[`src/db/types.ts:33`](../../../src/db/types.ts)）。这是**非索引 union 扩值**，与三源同理——**零 Dexie 版本 bump、零迁移**（仿 `coverThumbhash` 路径，规则 4 codename `"qq"` 稳定）。

### 3.2 QQ 的 externalId 形状（一个要注意的细节）

网易用纯 `songId`、B站用 `bvid#cid`。**QQ 的 vkey 解析既要 `songmid` 也常要 `strMediaMid`（媒体 mid，多数歌等于 songmid 但不总是）**。处理方式（不破坏既有契约）：

- `streamExternalId` 存 `songmid`（稳定主键，搜索/详情/歌词都用它）；
- vkey 解析时若需要 `strMediaMid`，从 `streamMeta` 或一次 `song/detail` 取回（`songmid → {strMediaMid, ...}`）——**不**把它塞进 externalId 复合键，保持与三源的 `detectStreamSource` 纯函数一致。
- 去重键仍是 `(sessionId, "qq", songmid)`，复用既有内存查重。

### 3.3 凭据 → 既有字段的映射（登录档）

QQ 登录得到的核心凭据是 **`musicid` + `musickey`**（外加 OAuth 的 `openid/access_token/refresh_token/refresh_key/unionid/str_musicid/expired_at`，QQ 与微信**共用同一模型**，由 `login_type` 区分：`musickey` 以 `W_X` 开头→微信，否则→QQ）。映射到既有 `StreamSourceConfig`：

| QQ 凭据 | 存进 | 用途 |
|---|---|---|
| `qqmusic_uin`(=musicid) + `qqmusic_key`(=musickey) | `cookie`（拼成 cookie 串，复用 `assembleCookieHeader`/`cookieStringHasAuth`） | 每请求带上；`g_tk=hash33(musickey)` |
| `access_token`/`refresh_token`/`refresh_key` | `accessToken`/`refreshToken`（既有字段） | `music.login.LoginServer/Login` `loginMode:2` 刷新 |
| `expired_at` | `expiresAt`（既有字段） | 过期重登提示 |

> 简化路线（若不做 OAuth 刷新）：可只存 `cookie` 串（`qqmusic_uin`+`qqmusic_key`），与 jsososo 的「raw cookie + uin」一致，过期就重新扫码。**v1 建议先走简化路线**。

---

## 4. Provider / API Design

> 所有端点/参数来自调研对 NeriPlayer(-Desktop) + luren-dc/L-1124 + VenenoFSD 源码的直接核实。**这些是非官方逆向私有 API，会随时间衰减**（jsososo 的搜索端点已部分失效）；实现要把端点/参数做成易改的常量，并在失败时走结构化降级。

### 4.1 端点表（QQ 音乐）

| 用途 | 端点 | 关键参数 | 鉴权档 | 来源核实 |
|---|---|---|---|---|
| **关键词搜索** | `GET https://u.y.qq.com/cgi-bin/musicu.fcg`（现代统一搜索） | `data=`JSON：`{music_search:{module:"music.search.SearchCgiService", method:"DoSearchForQQMusicDesktop", param:{query,num_per_page,page_num,search_type:0,grp:1}}}` + `g_tk`；响应 `<req>.data.body.song.list[]` | guest/登录 | luren-dc ✓（**2026-06-17 运行时切换**：旧 `c.y.qq.com/.../client_search_cp` 实测 500，见 §11） |
| **歌曲详情** | `POST/GET https://u.y.qq.com/cgi-bin/musicu.fcg` | `data=`JSON：`{songinfo:{method:"get_song_detail_yqq", module:"music.pf_song_detail_svr", param:{song_mid:<mid>}}}` | guest | NeriPlayer ✓ |
| **取直链（明文，主路径）** | `POST https://u.y.qq.com/cgi-bin/musicu.fcg` | method `music.vkey.GetVkey` / module `UrlGetVkey`；批量 ≤100 mid；每档 `filename = <typePrefix><mid><mid><ext>`；guest 参数 `guid=10000`/`platform=20`/`loginflag=1`/`uin=0` | guest/登录 | luren-dc `song.py:247` ✓ |
| **取直链（加密档）** | 同上 method `music.vkey.GetEVkey` / module `CgiGetEVkey` | 返回 `.mflac/.mgg` 加密直链 | 登录/VIP | luren-dc ✓ — **🚩 本 PRD 不调用此路径（红线）** |
| **CDN 派发（现代）** | `musicu.fcg` method `CDN.SrfCdnDispatchServer` / `GetCdnDispatch` | 动态返回 `sip[]` 服务器列表 | guest | luren-dc / NeriPlayer-Desktop ✓ |
| **歌词** | `GET https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg` | `songmid` `format=json` `inCharset=utf8` `outCharset=utf-8` `nobase64=1` `g_tk=5381` + **`Referer: https://y.qq.com`**；响应需 Base64 解码 | guest | NeriPlayer ✓ |
| **封面** | `https://y.qq.com/music/photo_new/T002R800x800M000<albumMid>.jpg` | `<albumMid>` | guest | NeriPlayer ✓ |
| **歌单/用户歌单** | `musicu.fcg`（歌单详情 / `music.srfDissInfo.aiDissInfo` 等模块）+ 用户歌单需登录 | `disstid` / 登录态 | guest/登录 | luren-dc（Phase 4 实现时再精确化端点）|

**直链组装（明文）**：`GetVkey` 返回 `req_0.data.midurlinfo[].purl`（相对路径）+ `req_0.data.sip[]`（CDN host 列表，默认 `https://dl.stream.qqmusic.qq.com/`，回退 `https://isure.stream.qqmusic.qq.com/`）。最终 `mediaUrl = pick(sip, 过滤 http) + purl`。`purl` 为空 = 该档不可播（无版权/需 VIP/仅加密档）→ 走降级链。

### 4.2 签名/哈希配方（纯函数，TDD）

```ts
// src/streamsrc/qq/qq-sign.ts —— 纯函数，注入式，穷举单测

// 腾讯 hash33（g_tk / ptqrtoken 的基石）。seed=5381。
export function hash33(str: string, seed = 5381): number {
  let h = seed;
  for (let i = 0; i < str.length; i++) h = (h << 5) + h + str.charCodeAt(i);
  return h & 0x7fffffff; // 2147483647
}
export const gTkGuest = 5381;                       // = hash33("")，guest 退化值
export const gTk = (musickey: string) => hash33(musickey, 5381);   // 登录 WEB 档
export const ptqrtoken = (qrsig: string) => hash33(qrsig);         // QQ QR 轮询 token

// zzc 签名（Phase 5 回退档，仅在 guest/web 被拒时实现）：
//   sha1 = SHA1(JSON.stringify(payload)).toUpperCase()        // 40-hex
//   part1 = PART_1_INDEXES.map(i => sha1[i]).join("")          // [23,14,6,36,16,7,19]
//   part2 = PART_2_INDEXES.map(i => sha1[i]).join("")          // [16,1,32,12,19,27,8,5]
//   mid   = base64( xorScramble(sha1Bytes, SCRAMBLE_VALUES) ).replace(/[\/+=]/g,"")
//   sign  = ("zzc" + part1 + mid + part2).toLowerCase()
// 来源：luren-dc sign.py（逐字节核实）。SCRAMBLE_VALUES 是 20 个硬编码常量。
```

> **不是 AES/MD5**：QQ 的核心是 `hash33`（g_tk）与 SHA1-based zzc，加上 QIMEI 设备指纹。`hash33` 与 `ptqrtoken` 是几行位运算，**Phase 1 即可纯函数单测对拍**（参考实现交叉验证）。zzc 复杂但**仅回退**。

### 4.3 音质档 + 明文封顶（红线落到码表）

QQ 音质用「类型码前缀 + 扩展名」。**本 PRD 只用明文档（`SongFileType`），永不构造加密档（`EncryptedSongFileType`）的 filename**（Q3 已按 best practice 定：「永不解密」是**策略层**决策，运行时只决定明文实际天花板，见 §10）：

| 档位 | 明文前缀.扩展 | 码率/格式 | 本 PRD | 对应加密档（**不用**） |
|---|---|---|---|---|
| Master | `AI00`.flac | 臻品母带 | ❌ 通常仅加密下发 | — |
| Atmos | `Q000`.flac | 臻品全景声 | ❌ 通常仅加密下发 | — |
| FLAC | `F000`.flac | 无损 999k | ⚠️ 仅当服务端给明文（罕见）；否则跳过 | `F0M0`.mflac 🚫 |
| OGG320 | `O800`.ogg | 320k ogg | ✅ | `O8M0`.mgg 🚫 |
| **MP3 320** | **`M800`.mp3** | **320k** | ✅ **主力** | — |
| **MP3 128** | **`M500`.mp3** | **128k** | ✅ **保底** | — |
| AAC | `C600`/`C400`/`C200`.m4a | 96–192k | ✅ | — |

**降级链（[`qq-quality.ts`](../../../src/streamsrc/qq/qq-quality.ts)，纯函数）**：用户偏好 `flac/320/high` → 候选 `[F000?, M800, C400, M500]`（**剔除所有加密档**）→ 逐档 `GetVkey`，第一个 `purl` 非空即播；全空 → `no-permission`（提示「该曲在 QQ 音乐需 VIP / 仅加密音质，本应用不解密」）。**任何 `*M0`/`.mflac`/`.mgg` 档不进候选**。

> 调研校正：`.mflac/.mgg` 并非严格 = VIP（加密变体跨多档存在，如 `O4M0` 是 ogg96 加密）；精确规则是「受版权保护内容」。**但对本 PRD 无影响**——无论它是不是 VIP，**只要是加密档我们一律不碰**。

### 4.4 QR 登录状态机（QQ 两路：QQ 账号 + 微信）

复用既有源无关状态机（[`qr-login-provider.ts`](../../../src/streamsrc/qr-login-provider.ts) 的 `generate→waiting→scanned→success/expired`），给 [`qr-login.ts`](../../../src/streamsrc/qr-login.ts) 加 QQ 的两组端点与状态码映射。**两路共享同一 `QrStatus` 枚举**，与网易/B站完全一致。

**(a) QQ 账号（腾讯 PTLogin，注意：用的是 QQ 互联，不是 QQ 音乐自己的登录服务器）**

```
generate: GET https://ssl.ptlogin2.qq.com/ptqrshow
          ?appid=716027609&e=2&l=M&s=3&d=72&v=4&daid=383&pt_3rd_aid=100497308
          Referer: https://xui.ptlogin2.qq.com/        → 返回 QR 图 + 写 qrsig cookie
poll:     GET https://ssl.ptlogin2.qq.com/ptqrlogin?...&ptqrtoken=hash33(qrsig)
          响应是 ptuiCB('<code>',...) 回调串，code 见下
success 兑换链（QQ 特有，比网易/B站多）:
          ptqrlogin 成功(0) 回调里含 ptsigx + uin
          → GET ssl.ptlogin2.graph.qq.com/check_sig ...        (写 p_skey cookie)
          → GET graph.qq.com/oauth2.0/authorize ...            (得 OAuth code)
          → musicu.fcg module QQConnectLogin.LoginServer/QQLogin (tmeLoginType=2)
          → 返回 Credential(musicid/musickey/...)
```

**(b) 微信（独立 OAuth2，appid 不同）**

```
generate: GET https://open.weixin.qq.com/connect/qrconnect
          ?appid=wx48db31d50e334801&scope=snsapi_login&redirect_uri=...&login_type=jssdk
          → 抓页面里的 uuid；QR 图 = https://open.weixin.qq.com/connect/qrcode/<uuid>
poll:     GET https://lp.open.weixin.qq.com/connect/l/qrconnect?uuid=<uuid>&_=<ts>
          响应是 window.wx_errcode=<code>; window.wx_code='<code or empty>';
success:  wx_code → musicu.fcg module music.login.LoginServer/Login (tmeLoginType=1)
          → 返回 Credential
```

**状态码映射（统一到 `QrStatus`，源自 `QRCodeLoginEvents`，第一值=QQ ptqrlogin code，第二值=微信 wx_errcode）：**

| 统一 `QrStatus` | QQ code | 微信 wx_errcode | 含义 |
|---|---|---|---|
| `waiting` | `66` | `408` | 二维码有效、未扫 |
| `scanned` | `67` | `404` | 已扫、待手机确认 |
| `success` | `0` | `405` | 确认登录（QQ→进兑换链；微信→拿 wx_code）|
| `expired` | `65`(timeout) / `68`(refuse) | `402`(timeout) / `403`(refuse) | 过期或拒绝 |

> **本 PRD 给既有状态机加的唯一新东西**：QQ 的 `success` 不像网易/B站「成功即落 session cookie」，而要**多走一步 OAuth code → 凭据兑换**才能拿到 `musickey`。在 `qr-login-provider` 的 success 分支加一个**可选的 per-source `onSuccess(exchange)` 钩子**：网易/B站为空（直接读 cookie），QQ 注入兑换函数（PTLogin 跑 check_sig→authorize→QQLogin；微信跑 Login）。这是干净的扩展点，不破坏既有两源。

> **登录窗口路线（更简方案，建议 v1 先用）**：也可不调 QR API，直接复用 [`login.ts`](../../../src/streamsrc/login.ts) 的 `STREAM_LOGIN_CONFIGS` + `openSourceLogin`——在 Electron 子窗口打开 QQ 音乐官方登录页（`y.qq.com` 扫码登录），登录后从 session 抓 `qqmusic_uin`/`qqmusic_key` cookie（`authCookie: "qqmusic_key"`）。这条路**完全复用既有 L2 机制、零新状态机**，但依赖官网页面在内嵌窗口能正常渲染扫码（与网易模态登录同风险）。**✅ Q4 已定（best practice）：Phase 3 主路径 = 登录窗口路线**（复用 L2、零新状态机；`y.qq.com` 官网登录页自带 QQ/微信扫码，已满足「扫码登录」诉求，且 OAuth code 兑换由官网内部完成，绕开 §4.4(a) 的兑换钩子）。**应用内自绘 QR（QR API + code→凭据兑换钩子）降级为 v2 增强**（§14 式）。

### 4.5 Error Handling & URL 过期

- **直链过期**：`PlayableStream.expiresAt`——QQ vkey 直链有时效（小时级），复用既有 `playIndex`/prefetch 的 `expiresAt < now+slack` 重 resolve。
- **purl 为空 / 仅加密档**：返回 `{ kind: "no-permission", reason: "vip-or-encrypted" }` → player-store 复用既有 toast +**自动跳过下一可播曲**（[`nextStreamSkipIndex`](../../../src/player/queue.ts)，20260610 §18 已实现），混合歌单仍能播得过去。
- **guest 被拒（关键）**：若 guest 档 `GetVkey` 返回鉴权错误 → 提示「QQ 音乐需登录」并引导 Phase 3 登录；这也是 Open Q1 的运行时答案落点。
- **Telemetry**：规则 1/8——**绝不**上报 cookie/musickey/直链/外部 id/搜索词。

---

## 5. Frontend Design

> **几乎零新 UI**——既有 Settings 面板与搜索按 registry 自动列源，QQ 加进 union + registry 后**自动出现**。

### 5.1 改动点

```
components/settings/stream-sources-settings.tsx   # 自动多出「QQ 音乐」卡（登录/音质/启用/缓存）
                                                  #   + 音质下拉去掉无损以上档 + 一行红线说明
components/stream/qr-login-dialog.tsx             # QQ 登录加「QQ 账号 / 微信」两个 tab（若走 QR API 路线）
hooks/use-online-source-search.ts                 # 自动并行查 qq（启用且登录满足时）
i18n locales/{en,zh,ja,ko}/                        # 源名 + 音质封顶提示 + 红线文案
```

### 5.2 UI / 交互

- **Settings·QQ 音乐卡**：开关（默认关）、登录/登出、音质下拉（**只列明文档：320/128/m4a，不列无损以上**）、缓存管理（复用既有）。卡片底部一行 i18n 文案：「QQ 音乐仅支持明文标准音质；无损 / 臻品以加密格式下发，本应用不解密。」
- **搜索**：勾「在线」后并行查已启用源（含 QQ）；结果按源分组，每条 `▶ 试听` + `+ 收藏入库`（复用 `playStreamedHit`）。
- **登录**（Phase 3）：登录窗口路线 = 一个「登录」按钮开官网扫码页；QR API 路线 = dialog 两 tab（QQ 账号 / 微信），各画二维码 + 状态文案（待扫/已扫/已过期/成功）。
- **能力 gate**：`hasStreamingSources()` 为 false（web/Tauri）→ 整块隐藏。

### 5.3 State / i18n

- 登录态走既有 settings + provider `getCookie("qq")` 注入；不进 player-store state（规则 6）。
- 搜索结果 TanStack Query（规则 6）。
- i18n 4 locale 全量：源名「QQ 音乐 / QQ Music」、音质封顶提示、红线说明、登录/扫码状态文案。先 en 后 zh/ja/ko，缺则 PR 标 "pending translation"。

---

## 6. Implementation Plan

> 顺序：**先 guest 明文（最低风险/工作量）并运行时验证可行性 → 再登录 → 再歌单 → zzc 仅回退**。每单元 TDD（test→impl→green→路径化 commit），纯核心可 vitest 完整验证，运行时件（muzfetch/登录窗/live resolve）标「待 Electron 手测」。

### Phase 1: QQ guest provider 纯核心

**Goal:** `hash33`/`g_tk` + 音质码表 + 搜索/详情/vkey/封面纯映射 + sip+purl 直链组装，全部纯函数单测；`createQqSource` 纵向（stub transport）跑通；registry 注册 `"qq"`。**不接真实网络**。

**Tasks:**
- [ ] `qq-sign.ts`：`hash33` / `gTkGuest=5381` / `gTk(musickey)` / `ptqrtoken(qrsig)`（参考实现交叉验证）。
- [ ] `qq-quality.ts`：明文 `SongFileType` 码表（`M800/M500/C400/F000?` 前缀→格式→码率）+ 降级链（**剔除所有加密档**）。
- [ ] `qq-resolve.ts`：`GetVkey` 响应解析 → `sip[]`(过滤 http) + `midurlinfo[].purl` 组装 `mediaUrl`；`purl` 空→该档不可播；`EVkey`/加密档→直接标 `no-permission`（**不组装**）。
- [ ] `qq-playlists.ts`：`client_search_cp`/`get_song_detail_yqq` → `StreamSearchHit`（含封面 URL 模板、`songmid`→`strMediaMid`）。
- [ ] `qq-source.ts`：实现 `StreamSourceProvider`（`id:"qq"`, `requiresLogin:false`, `search`/`resolve`）；guest 静态参数。
- [ ] `registry.ts` + `db/types.ts`：`STREAM_SOURCE_IDS += "qq"`、`createStreamSource` 加 case、union 扩值。

#### Phase 1 Checklist
- [x] `hash33` 单测：`hash33("")===5381`、手算 djb2 向量（`"0"`→177621、`"12"`→5861576）、`gTk`(seed 5381) vs `ptqrtoken`(seed 0) 区分、`parseQqMusicKey` cookie 解析。⚠️ **长 musickey 的精度与 luren-dc `common.py` 是否逐位一致 = 运行时对拍项**（guest 不用 g_tk 计算，Phase 1 不阻塞；见 §4.2 注 + Open Q2）。
- [x] 音质降级链单测：码表只含明文档（断言无 `.mflac/.mgg`、无 `*M0` 前缀）；偏好剔除上档；`qq-source` resolve 测覆盖「flac 空 purl → 命中 320」与「全空 → `no-permission: vip-or-encrypted`」。
- [x] `qq-resolve` 纯映射单测：canned `GetVkey`（有 purl / 空 purl / 多 sip / 非法 json）→ entries+sip；`qqStreamHost`(https 优先/http 升级/回退)；`qqStreamUrl` 拼接。（**加密档**由「永不请求 EVkey + 空 purl 回退」覆盖，不解析加密容器。）
- [x] `qq-source` 纵向单测（stub transport）：search→hits（含 JSONP 容错）、resolve→`PlayableStream`（带 Referer）、guest `g_tk=5381` 注入。
- [x] `registry.test.ts` 含 `"qq"`（4 源）；全项目 `tsc --noEmit` 绿（0 错）；biome `check --write` 绿；focused vitest 453 测全绿（qq+registry+chat+sync，无回归）。`StreamSourceId` 扩值连带修 4 处窄 union（dj-chat enum / r2-manifest enum / dj-chat-availability 列表 / stream-cache 标签 Record）。

### Phase 2: 运行时接入 + Electron 手测 guest 可播放（验证 Open Q1/Q2）

**Goal:** 接 muzfetch（必要时注入 `Referer: https://y.qq.com`）；Electron 端到端**手测**：搜索 → 收藏入库 → guest resolve → 播放出声、可 seek。**回答关键不确定性**：guest（`g_tk=5381`/`uin=0`）今天能否 resolve 标准音质明文直链。

**Tasks:**
- [x] `StreamHttp` 生产路径接 QQ —— **零改动复用**：`use-online-source-search` 直接迭代 `STREAM_SOURCE_IDS`，QQ 入 registry 后自动经 `createStreamHttp()`(muzfetch) 走通，按端点注入 Referer(`https://y.qq.com`)/UA。
- [x] player-store streamed 分支自动覆盖 QQ —— **零改动复用**：`origin:"streamed"` → `resolve` → `mediaProxyUrl`/直 `<audio>` 与三源同路。
- [~] **登录态 resolve 鉴权修复（2026-06-17）**：实测登录后播放仍 `no-permission`——根因 resolve 一直发 guest 参数（`uin=0`、body 无 auth）。musicu 鉴权看 body 的 `comm` 块而非仅 cookie，故已登录也被当匿名 → 权限档空 purl。修复：vkey 请求体加 `comm`（登录态带真实 `uin`+`authst`(musickey)+`tmeLoginType`，guest 仍 `uin=0` 无 auth）；resolve 用 cookie 真实 uin；no-permission 前加诊断日志（authed/sip 数/逐档 hasPurl）。**待用户重测**。
- [x] ⌘F 在线 chips 加 QQ（`ONLINE_SOURCES` + `SOURCE_LABEL`）；**`@` 提及过滤加 QQ**（[`global-search-filter.ts`](../../../src/lib/global-search-filter.ts) `FILTER_OPTIONS`，别名 `qq/qqmusic/qq音乐/腾讯`，2026-06-17 补漏）；Settings 卡新增 QQ（`SOURCES`，音质下拉只列明文档 `flac/320/m4a/128`，默认 320）。
- [x] i18n —— 源名为**品牌名**（设计上非 i18n，与三源一致硬编码 `QQ 音乐`）；红线文案复用既有 `streamSources.redline`；音质天花板由「下拉只列明文档」自我表达。无需新增 key。

#### Phase 2 Checklist
- [~] **Electron 手测：guest 搜索返回结果**——⚠️ 2026-06-17 实测旧 `client_search_cp` 返回 **HTTP 500 空 body**（QQ 服务端衰减）；已切到现代 `u.y.qq.com/musicu.fcg music.search.SearchCgiService`（GET，query 入 `data` JSON）+ 失败日志加 HTTP status。**待用户重测新接口**。
- [x] **Electron 手测：`GetVkey` 返回非空 purl 的标准音质直链**——✅ 登录态明文歌可 resolve（`authed:true`、`sipCount>0`、命中档 `hasPurl:true`）。Open Q1 答案：**guest 静态档不再单测**（已走登录），登录态明文档可播。
- [x] 明文直链经 `<audio>`（或 `mediaProxyUrl`）**播放出声**——✅ 确认可听。（seek/206 + 切 tab 不断播随既有源无关管线提供，未逐项压测。）
- [~] QQ CDN 是否需要 Referer（Open Q6）：播放经现有 muzfetch 路径（注入 Referer）即通；是否**严格**必须 Referer 未单独隔离测——非阻塞（现路径已可播）。
- [x] 加密档/VIP 曲：resolve → `no-permission`（`vip-or-encrypted`）——✅ 实测 VIP 歌正确拒（4 档 purl 全空 + `authed:true`），红线生效；toast + 自动跳下一可播曲走既有源无关逻辑。

### Phase 3: 登录（解锁歌单同步；音质仍封顶明文）

**Goal:** QQ/微信登录捕获 `musickey/uin` 落 `settings.streamSources.qq.cookie`；WEB 请求 `g_tk=hash33(musickey)`。**优先登录窗口路线**（复用既有 `openSourceLogin`），QR API 路线作可选增强。

**Tasks:**
- [x] **登录窗口路线**：`STREAM_LOGIN_CONFIGS.qq = { loginUrl:"https://y.qq.com/", cookieUrls:["https://y.qq.com","https://c.y.qq.com"], authCookie:"qqmusic_key" }`；复用 `streamSourcesAfterLogin/Logout` + `cookieStringHasAuth`（Settings 卡 `id==="netease"?QR:externalLogin` 已让 qq 走 externalLogin 登录窗口）。
- [x] provider `isAuthed()` + `getCookie("qq")` 注入；WEB 请求 `g_tk=hash33(musickey)`（Phase 1 `qq-source.gtk()` 已实现，本期加测：登录态 g_tk≠5381 且 Cookie 头带 `qqmusic_key`）。
- [ ] （**v2 增强，按 Q4 推迟**）QR API 路线：`qr-login.ts` 加 QQ PTLogin + 微信 generate/poll/状态码；`qr-login-provider` 加 per-source `onSuccess` 兑换钩子（QQ：check_sig→authorize→QQLogin；微信：Login）；`qr-login-dialog` 加两 tab。

#### Phase 3 Checklist
- [x] 登录配置单测：`STREAM_LOGIN_CONFIGS.qq` authCookie=`qqmusic_key`、loginUrl 含 `y.qq.com`、cookieUrls 含 `https://y.qq.com`；`cookieStringHasAuth("…qqmusic_key=W_X_t","qqmusic_key")===true`。
- [x] 登录态 `g_tk=hash33(musickey)` provider 单测：search 请求 URL 带 `g_tk=<hash33>`（≠5381）且 `Cookie` 头含 `qqmusic_key`。
- [x] 登录窗口**手测**：登录后能从 session 抓到 `qqmusic_key`/`qqmusic_uin`（2026-06-17 Electron 手测通过——`y.qq.com` 登录窗口 cookie 抓取可用，无需转 v2 QR API 路线）。
- [ ] 登出清 `streamSources.qq.cookie`（复用 `streamSourcesAfterLogout`，已被 login.test 覆盖通用逻辑）。
- [ ]（**v2** QR 路线）状态码映射单测：QQ `0/66/67/65/68` + 微信 `405/408/404/402/403` → 统一 `QrStatus`；`onSuccess` 兑换钩子单测。

### Phase 4: 歌单同步 + 粘贴链接

**Goal:** 复用既有同步/导入/去重 UI（20260610 §15-17），给 QQ 实现 `getUserPlaylists`/`importPlaylist`/`getTracksByIds`/`getPlaylistMeta`。

**Tasks:**
- [x] `qq-source.ts` 实现可选方法：`getTracksByIds`（逐 mid 走**已验证**的 `get_song_detail_yqq`）、`getPlaylistMeta` + `importPlaylist`（`aiDissInfo` 取歌单元信息 + songlist→hits）。
- [x] **`getUserPlaylists`（同步「我的歌单」）已实现**（登录解锁后补齐，2026-06-17）：从 cookie 取 `qqmusic_uin` → `fcg_user_created_diss?hostuin=<uin>&g_tk=<hash33(musickey)>` → `parseQqUserPlaylists` 映射 `data.disslist[]`（容错 `tid/dissid`、`diss_name/dissname`、`diss_cover/logo`、`song_cnt/song_num`）。未登录（无 uin）优雅返回 `[]`。UI 经 `source?.getUserPlaylists?.()` 自动出现「同步我的歌单」（零改动）。端点 shape 属运行时核实项（容错解析器已就位）。
- [x] `stream-link.ts` 加 QQ 链接解析（`/songDetail/<mid>`、`/song/<mid>.html`、`/playlist/<disstid>`、移动 `taoge.html?id=`；忽略 album/非 y.qq.com 域）。base62 songmid（非纯数字）单列。
- [x] **QQ 短链（分享链接）展开（2026-06-17）**：`c.y.qq.com`/`c6.y.qq.com` 的 `base/fcgi-bin/u?__=<token>` 重定向短链无 id、纯 `parseStreamLink` 解不出 → 加 `qqShortLinkUrl`（纯检测）+ `expandStreamLink`（GET 跟随重定向→读最终 URL→复用 `parseStreamLink`）。muzfetch 代理回传 `x-muzero-final-url` 头（net.fetch 已 follow 重定向，`res.url`=最终），`StreamHttpResponse.url` 暴露之；hook 在直解失败时一跳展开并 `setLink`。
- [x] 复用 `PlaylistImportDialog`（增量同步/选 set/新建）+ `streamPlaylistRef` —— **零改动**（源无关，QQ hits 与三源同形）。

#### Phase 4 Checklist
- [x] 纯解析器单测：`parseQqPlaylistMeta`(dirinfo / 兼容 cdlist[0] / count 回退) + `parseQqPlaylistTracks`(songlist→hits) + `parseQqSongDetail` + **`parseQqUserPlaylists`(disslist→playlists，字段别名容错)** + **`parseQqUin`(cookie→uin)**；`parseStreamLink` QQ（songDetail/.html/playlist/taoge/忽略 album）；`qq-source` 四方法 stub 纵向（detail/aiDissInfo/`fcg_user_created_diss`）。**287 全 streamsrc 测全绿、tsc 0 错、biome 绿**。
- [ ] **手测**：⌘F 粘贴 QQ 歌曲/歌单链接 → 结果行 / 导入卡片 → 入库（端点 `aiDissInfo` module/method 属运行时核实项；解析器容错已就位，shape 漂移由 dirinfo/cdlist 双路吸收）。
- [~] **手测**：登录后 Settings·QQ 卡「同步我的歌单」→ `getUserPlaylists`。⚠️ 2026-06-17 首测**点击无反应无日志**——根因：`getUserPlaylists` 首步 `if(!uin) return []` 静默退出，登录 cookie 里 `parseQqUin` 没拿到 uin（y.qq.com uin cookie 命名不定）。修复：`parseQqUin` 兼容 `qqmusic_uin`→`uin`(剥 `o` 前缀+前导零)→`wxuin`；no-uin 时打印**可用 cookie 名**(只名不含值) + 成功打印歌单数。**待用户重测**（若仍空，看日志 `cookieNames` 定位 uin 在哪个 cookie）。

### Phase 5: `zzc` 签名 + QIMEI（仅回退，按需）

**Goal:** **仅当 Phase 2/3 实测 guest 与 WEB `g_tk` 档被服务端拒绝**，才实现 Android client API 档：`zzc` 签名 + QIMEI 设备指纹。

**Tasks:**
- [ ] `qq-sign.ts` 补 `zzcSign(payload)`（SHA1→下标取段→XOR 打乱→base64→拼装）+ `SCRAMBLE_VALUES`/`PART_*_INDEXES` 常量。
- [ ] QIMEI 设备指纹生成（`guid=open_udid`, `appid=qimei_qq_android`）+ `_`(ms 时间戳)。
- [ ] provider 按端点选签名档（guest/web/client），失败逐档升级。

#### Phase 5 Checklist
- [ ] `zzcSign` 对拍 luren-dc `sign.py`（固定 payload → 同 sign 串）。
- [ ] QIMEI 生成稳定且被服务端接受（手测）。
- [ ] client 档 `GetVkey` 成功返回明文直链（手测）。

---

## 7. Out of Scope

- **🚩 加密音频解密（硬红线）**：**绝不**内置 `.mflac`/`.mgg`/`.qmc` 解密器、**绝不**调用 `GetEVkey` 取加密直链去解密、**绝不**分发解密产物。这是腾讯 2022 DMCA（§1201 反规避）的精确打击面（unlock-music 至今 451）。QQ 音质**封顶在明文档**（≤320 MP3 / m4a / 偶有明文 FLAC）；无损 / 臻品母带 / 全景声以加密下发 → 对本应用即「不可播」。
- **Kugou 酷狗 / Kuwo 酷我 / Migu 咪咕**：本期**不含**。调研对这三家**零 verified claim**（端点/签名/登录全未证实），需单独 follow-up research（候选源：`lx-music` source scripts、`Superheroff/musicapi`、`keyule/KuGou-API`、`jsososo/MiguMusicApi`、`metowolf/*`）——且 lx-music 自身有 DMCA 历史，follow-up 要先评法律面。见 Open Q5。
- **写操作**：不收藏到 QQ 服务端、不评论/点赞。
- **视频 / MV 流**：QQ 默认取 audio；不做 MV 视频流。
- **Tauri / web parity**：沿用 20260610——v1 仅 Electron，`hasStreamingSources()` gate 隐藏；Tauri 将来补实现自动点亮。
- **R2 云分享导出 QQ 媒体字节**：streamed track 无我方持有/有权分发的字节，manifest 仅表 `origin`，不导出 media bytes。
- **多源聚合「全网搜一首」**：各源独立搜，不做跨源去重/最佳源自动选。

---

## 8. Security / Privacy / Compliance（含红线）

- **🚩 §1201 / DMCA 红线（最高优先）**：本特性**只**做 guest/登录态的搜索 + 元数据 + **明文**音频流播放——这是 **ToS 级**风险（与三源、folder-import 同级）。**解密 `.mflac/.mgg/.qmc` 是 §1201 反规避级**风险（更高一档，腾讯主动执法、unlock-music 至今封禁），**明确不做**。实现 review 必须确认：候选音质码表里没有任何 `*M0`/加密扩展；没有 `GetEVkey` 调用进入播放路径；没有任何解密代码。
- **个人使用 / 默认关闭 / BYOK（规则 2）**：功能默认 disabled，需显式开启；`musickey`/cookie 只存 `AppSettings.streamSources.qq`（设备本地 IndexedDB）；**禁止**写进 bundle / committed `.env` / URL / 日志 / 遥测；提供「忘记登录」一键清除。MUZERO **不内置任何官方 key / cookie**，无后端中转（规则 1）。
- **无 hidden flag（规则 3）**：开关 = 可见 Settings 控件；回滚 = `git revert` + 重发版（删 registry 的 `"qq"` case + union 成员，老 streamed track 走 `unsupported` 通道），不藏 `localStorage`/URL/`window.*`。
- **出站 HTTP 收口（规则 10）**：QQ 请求全走 `getAppFetch()`/muzfetch；属用户显式启用的第三方调用，与 BYOK LLM/musicgen 同类，不构成 MUZERO 自有后端。
- **Telemetry whitelist**：本地优先、不上报。**永不**记录 cookie/`musickey`/`uin`/直链/`songmid`/搜索词/播放历史到任何外部端。
- **codename 稳定（规则 4）**：`StreamSourceId` 新成员取稳定值 `"qq"`，跨品牌/跨壳不变；db 名/id 前缀/表名不动。
- **逆向 API 时效声明**：QQ 端点/签名是非官方逆向私有 API（`g_tk=5381` 仅因是空 skey 的 `hash33` 退化值才能 guest；zzc 按 zza→zzb→zzc 轮换；isure CDN 是旧变体，现代走 `GetCdnDispatch`）。端点**会衰减**——常量集中、失败结构化降级、不把脆弱性扩散进业务层。

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [20260610 外部流媒体源接入 PRD](../20260610-muzero-external-streaming-sources-prd/20260610-muzero-external-streaming-sources-prd.md) | **本 PRD 的基础设施母体**（provider 抽象 / muzfetch / mediaProxyUrl / 数据模型 / QR 状态机 / 登录窗 / 歌单同步 / 离线缓存）|
| [`src/streamsrc/provider.ts`](../../../src/streamsrc/provider.ts) · [`registry.ts`](../../../src/streamsrc/registry.ts) | QQ 要实现/注册的契约与分发点 |
| [`src/streamsrc/qr-login.ts`](../../../src/streamsrc/qr-login.ts) · [`login.ts`](../../../src/streamsrc/login.ts) | QQ 登录配置要扩的两处 |
| [`src/streamsrc/netease/`](../../../src/streamsrc/netease/) | **最近的镜像参考**（QQ 的 `qq/` 结构/纵向/同步/链接全仿网易） |
| [CLAUDE.md](../../../CLAUDE.md) | 硬规则 1/2/3/4/5/6/7/9/10 |
| 参考项目 | [NeriPlayer](https://github.com/cwuom/NeriPlayer)（⚠️ QQ 仅元数据）· [NeriPlayer-Desktop](https://github.com/cwuom/NeriPlayer-Desktop)（guest 直链）· [luren-dc/QQMusicApi](https://github.com/luren-dc/QQMusicApi)（完整流程）· [jsososo/QQMusicApi](https://github.com/jsososo/QQMusicApi) · [VenenoFSD/QQMusic-api](https://github.com/VenenoFSD/QQMusic-api) |
| 法律 | [腾讯 unlock-music DMCA 通知 (2022-11-04)](https://github.com/github/dmca/blob/master/2022/11/2022-11-04-qqmusic.md) |
| Memory | [folder-import-feature](../../../.claude/projects/-Users-doodlebear-Documents-code-MUZERO/memory/folder-import-feature.md)（DRM 红线同源）· [electron-shell-pivot](../../../.claude/projects/-Users-doodlebear-Documents-code-MUZERO/memory/electron-shell-pivot.md) |

---

## 10. Open Questions

| # | 问题 | 状态 | 落点 |
|---|---|---|---|
| Q1 | **guest（`uin=0`/`g_tk=5381`）今天能否仍 resolve 出可播的标准音质（M500/M800/C400）明文直链？** 还是连标准播放都已要 `musickey`？ | ✅ **已回填（2026-06-17 Electron）**：**登录态**明文歌可 resolve 播放（vkey 鉴权走 body `comm.authst`，非仅 cookie）；VIP/加密档即便登录也仅加密下发 → 正确 no-permission。guest 静态档未单独隔离测（已走登录路径，对个人用户够用）。| 登录为推荐路径；guest-only 可行性留作后续 if-needed |
| Q2 | 最小可用集需要哪个签名档？静态 `g_tk=5381` 够（NeriPlayer-Desktop 式）还是已被拒、必须 `hash33(musickey)`（登录）甚至 `zzc`+QIMEI？ | ✅ **已定（best practice，2026-06-16）：渐进式分层、最低档优先**——guest 静态 `g_tk=5381` 起步；运行时被拒则升 `hash33(musickey)`（登录）；`zzc`+QIMEI **仅在实测前两档均被拒时**才实现（不预建，YAGNI）。具体落地哪档由 Q1 运行时结果决定，**但策略已定** | Phase 1→3→5 逐档升级；Phase 5 保持「按需」 |
| Q3 | 在「不解密」前提下，无损/VIP 能否**完全**不提供？即 QQ 是否**永远**以加密容器下发高码率（明文 FLAC 是否存在）？ | ✅ **已定（best practice，2026-06-16）：策略层 = 永不解密**。音质封顶在服务端返回的**明文**档；仅以加密容器下发的档（无损/臻品）对 MUZERO 即「不可播」。运行时只决定**实际天花板**（明文 FLAC 是否偶现），**不改策略、无需决策** | 码表写死剔除所有加密档（§4.3）|
| Q4 | 登录走「登录窗口路线」（复用 L2，省事）还是「QR API 路线」（更稳但需 OAuth code 兑换钩子）？ | ✅ **已定（best practice，2026-06-16）：登录窗口路线先行**——复用 L2 `openSourceLogin`、零新状态机；`y.qq.com` 官网登录页**自带 QQ/微信扫码**，已满足「扫码登录」诉求，且 OAuth code 兑换由官网内部完成（绕开 §4.4(a) 兑换钩子）。**应用内自绘 QR（QR API + code→凭据兑换钩子）降级为 v2 增强** | Phase 3 主路径 = 登录窗口；QR API = §14 式 v2 |
| Q5 | Kugou/Kuwo/Migu 的端点/签名/登录？ | 🔲 **已认可推迟（2026-06-16）**：本期不做，单独 follow-up research PRD（本轮 0 verified claim）| 独立 PRD；先评 lx-music DMCA 法律面 |
| Q6 | QQ vkey 直链是否需要 CDN `Referer`？（影响是否必须经 `mediaProxyUrl` 还是可直 `<audio>` 播） | 🟡 **非阻塞（2026-06-17）**：经现有 muzfetch 代理路径（注入 Referer）播放已通；是否**严格**必须 Referer 未隔离测——保持走代理即可，无需进一步决策 | 现路径已可播；如需直 `<audio>` 优化再隔离测 |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-16 | DoodleBear | 初稿：基于一次 deep-research（24 源 / 23 confirmed claims）+ 既有 `src/streamsrc/` 架构核实，落地 QQ 音乐作为「加一个 provider」的增量方案。核心决策：guest/明文优先、登录次之、zzc 仅回退；**硬红线 = 不解密 `.mflac/.mgg`（DMCA §1201）**；音质封顶明文档。校正命名参考：NeriPlayer Android 对 QQ 仅元数据，可播放知识取自 NeriPlayer-Desktop + luren-dc/QQMusicApi。Kugou/Kuwo/Migu 移出范围待 follow-up。Q1-Q6 待运行时/决策。 |
| 2026-06-16 | DoodleBear | 按反馈处置 Open Questions：**Q2/Q3/Q4 按 best practice 定稿**（Q2 渐进式分层签名、zzc 不预建；Q3 永不解密为策略层决策、音质封顶明文；Q4 登录窗口路线先行、官网自带扫码、QR API 降 v2）；Q1/Q6 framing 认可、保持运行时验证；Q5 认可推迟单独 follow-up research。同步 §2.2 / §4.3 / §4.4 标注。设计层决策已收敛，定稿（Draft→Final）仅余 Q1/Q6 的 Phase 2 运行时验证。 |
| 2026-06-16 | DoodleBear（TDD 实现）| **Phase 1 ✅ 落地**（worktree `feat/qq-music-stream-source`）：`src/streamsrc/qq/` 5 文件（`qq-sign`/`qq-quality`/`qq-resolve`/`qq-playlists`/`qq-source`）+ 各 `.test.ts`，全纯函数/注入式 stub 单测；registry 注册 `"qq"`、`StreamSourceId` 扩值（连带修 4 处窄 union）。guest provider：`client_search_cp` 搜索 + `musicu GetVkey` 明文批量取直链（sip+purl）+ 明文音质降级（剔除加密档）+ 空 purl→`no-permission`。**41 qq/registry 测 + 453 全域（qq+registry+chat+sync）全绿，tsc 0 错，biome 绿**。运行时项（真实 API/CORS/播放）属 Phase 2 Electron 手测。 |
| 2026-06-16 | DoodleBear（实现）| **Phase 2 🔄 代码就位**：QQ 接入 ⌘F 在线 chips（`ONLINE_SOURCES`/`SOURCE_LABEL`）+ Settings 卡（`SOURCES`，音质只列明文 `flac/320/m4a/128`）。搜索/播放/代理为源无关、QQ 入 registry 后**零改动复用**。源名为品牌名（非 i18n），红线复用 `streamSources.redline`。tsc 0 错、search/settings/hooks 82 测全绿。**剩 Electron 手测 guest 可播放（Open Q1/Q2/Q6）**——无桌面运行时不冒充已验证。 |
| 2026-06-16 | DoodleBear（TDD 实现）| **Phase 3 🔄 代码就位（登录窗口路线，Q4）**：`STREAM_LOGIN_CONFIGS.qq`（authCookie `qqmusic_key` / `y.qq.com` 登录窗，复用 `externalLogin`+`streamSourcesAfterLogin/Logout`）；provider 登录态 `g_tk=hash33(musickey)`（Phase 1 已实现，本期加测：g_tk≠5381 且 Cookie 头带 key）。login+qq-source 18 测全绿，tsc 0 错。QR API（PTLogin/微信 + OAuth code 兑换钩子）按 Q4 降 **v2**。**剩 Electron 手测 cookie 抓取**（y.qq.com 或 localStorage→定 v2 取舍）。 |
| 2026-06-16 | DoodleBear（TDD 实现）| **Phase 4 🔄 代码就位**：`stream-link.ts` 加 QQ 链接解析（songDetail/.html/playlist/taoge，base62 mid 单列）；`qq-playlists` 加 `parseQqPlaylistMeta`/`parseQqPlaylistTracks`（dirinfo / 兼容 cdlist[0]，容错 shape 漂移）；`qq-source` 加 `getTracksByIds`（走**已验证** get_song_detail_yqq）+ `getPlaylistMeta`/`importPlaylist`（aiDissInfo）。`PlaylistImportDialog` 源无关零改动复用。**`getUserPlaylists` 降 v2**（用户歌单端点 0 verified，UI optional 链优雅退化）。58 qq+link 测 + 280 全 streamsrc 测全绿，tsc 0 错。**剩手测**真实 aiDissInfo 端点 + v2「我的歌单」。 |
| 2026-06-17 | DoodleBear（运行时修复，TDD）| **QQ 短链（分享链接）粘贴无反应修复**：用户粘贴 `c6.y.qq.com/base/fcgi-bin/u?__=<token>` 短链无反应——它是 302 重定向短链、不含 disstid，纯 `parseStreamLink` 解不出。新增 `qqShortLinkUrl`（纯检测 `*.y.qq.com/base/fcgi-bin/u`）+ `expandStreamLink`（GET 跟随重定向→读最终 URL→复用 `parseStreamLink`）。基建：muzfetch 代理回传 `x-muzero-final-url` 头（net.fetch 已 follow 重定向，`res.url`=最终目标）、`StreamHttpResponse.url` 暴露之（web 端=原生 `Response.url`）；`use-online-source-search` 把 `link` 改 state、直解失败时一跳展开并 `setLink`（保证链接结果区/导入卡片正常显示）。304 全 streamsrc 测全绿、tsc 0、biome 绿。**待用户重测**。 |
| 2026-06-17 | DoodleBear（运行时修复，TDD）| **「同步我的歌单」点击无反应修复**：用户点 Settings·QQ「同步我的歌单」无反应无日志。根因——`getUserPlaylists` 首步 `if(!uin) return []` 静默退出，登录 cookie 里 `parseQqUin` 取不到 uin（y.qq.com 的 uin cookie 命名不固定）。修复：`parseQqUin` 兼容 `qqmusic_uin`→`uin`(剥 `o` 前缀+前导零)→`wxuin`；no-uin 时 warn 打印**可用 cookie 名**（`qqCookieNames`，只名不含值，隐私安全）+ 成功 info 打印歌单数。61 qq 测 + 297 全 streamsrc 全绿、tsc 0、biome 绿。**待用户重测**（若仍空，日志 `cookieNames` 直接揭示 uin 在哪个 cookie，再补一名即可）。 |
| 2026-06-17 | DoodleBear（运行时验证）| **✅ Phase 2 端到端验证通过（Electron）**：用户实测——搜索可达、**登录态明文歌可播放出声**、**VIP/加密档正确判 `no-permission`**（诊断日志确认 `authed:true`+`sipCount:2`+4 档 purl 全空 = 真 VIP/加密独占，红线生效，非 bug）。回填 **Open Q1**（登录态明文可播；vkey 鉴权走 body `comm.authst`）、**Open Q6**（经 muzfetch 代理路径已可播，是否严格需 Referer 非阻塞）。**Phase 5（zzc+QIMEI）按 YAGNI 不触发**（前两档未被拒）。QQ 接入主链路（搜索→播放→红线）打通；剩 Phase 4 歌单/粘贴链接手测。 |
| 2026-06-17 | DoodleBear（运行时修复，TDD）| **登录态 resolve 鉴权修复（播放 no-permission）**：用户搜索通后点播放仍 `permission_denied`。根因——`resolve` 一直用 guest 参数请求 GetVkey（`uin=0`、body 无 auth），即便已登录；QQ musicu 的鉴权读 **body 的 `comm` 块**（uin + `authst`=musickey + `tmeLoginType`），不是仅靠 cookie 头，故登录态也被当匿名 → 权限档返回空 purl → 误判 no-permission。修复：`qqVkeyRequestBody` 加 `comm`（guest=uin0 无 auth；登录=真实 uin+authst+tmeLoginType，`W_X*`→微信1 否则 QQ2）；`resolve` 用 cookie 真实 `uin`+`musickey`；no-permission 前加诊断日志（authed/sipCount/逐档 hasPurl，便于区分「真无权限」vs「filename 不匹配的 shape 漂移」）。58 qq 测 + 294 全 streamsrc 全绿、tsc 0、biome 绿。**待用户重测**。 |
| 2026-06-17 | DoodleBear（运行时修复，TDD）| **搜索切现代 musicu 接口（旧 `client_search_cp` 实测 500）**：用户 Electron 手测 guest 搜索 → 旧 `c.y.qq.com/soso/fcgi-bin/client_search_cp` 返回 **HTTP 500 空 body**（`qq search response is not JSON, head: ""`）。改用现代 `u.y.qq.com/cgi-bin/musicu.fcg music.search.SearchCgiService`/`DoSearchForQQMusicDesktop`（GET，keyword 入 `data` JSON，响应 `<req>.data.body.song.list[]`，与 luren-dc/现代客户端一致），与 resolve/detail/playlist 同 host 同路径。新增 `parseQqMusicuSearch`（容错命名 req 包裹 / 直 `data.body.song.list`），失败日志加 HTTP `status` 便于后续定位。54 qq 测 + 290 全 streamsrc 全绿、tsc 0 错、biome 绿。**待用户重测**。 |
| 2026-06-17 | DoodleBear（修复）| **⌘F `@` 提及过滤补漏 QQ**：merge 时只给在线 chips（`ONLINE_SOURCES`/`SOURCE_LABEL`）加了 QQ，漏了 `@` 提及过滤的真源 [`global-search-filter.ts`](../../../src/lib/global-search-filter.ts) `FILTER_OPTIONS`——故 `@qq` 无法筛 QQ。补 `id` union + FilterOption（别名 `qq/qqmusic/qq音乐/腾讯`）；桌面端 `filterOptions=FILTER_OPTIONS` 自动纳入、UI `labelFor` 经既有 `SOURCE_LABEL[qq]` 自动出名（零 UI 改动）。TDD：`matchFilterOptions` 测加 qq latin/CJK 别名。13 测全绿、tsc 0 错、biome 绿。 |
| 2026-06-17 | DoodleBear（TDD 实现）| **Phase 3 登录 ✅ 手测通过 + Phase 4 `getUserPlaylists` 实现（v2 项提前完成）**：用户确认 `y.qq.com` 登录窗口路线可用（Electron 抓到 `qqmusic_key`/`qqmusic_uin`），Phase 3 由「代码就位」转**已验证可用**。登录解锁后补齐 `getUserPlaylists`（TDD）：`parseQqUin`(cookie→uin) + `parseQqUserPlaylists`(`fcg_user_created_diss` `data.disslist[]`→playlists，`tid/dissid`·`diss_name/dissname`·`diss_cover/logo`·`song_cnt/song_num` 别名容错) + provider 方法（未登录优雅 `[]`，登录态带 `hostuin`+`g_tk=hash33(musickey)`）。Settings·QQ 卡经既有泛型 `SourcePlaylists` 自动出现「同步我的歌单」（零 UI 改动）。**287 全 streamsrc 测全绿（+10 新测）、tsc 0 错、biome 绿**。剩手测：真实 `fcg_user_created_diss` 响应 shape。 |

---

> **Note:** 本 PRD 强调复用既有 `src/streamsrc/` 基础设施，QQ 仅新增隔离在 `qq/` 的源特有逻辑。所有 QQ 端点/签名/登录细节均来自对开源参考项目源码的直接核实（见 §调研溯源），但属**非官方逆向私有 API、会随时间衰减**。**设计层决策已收敛**（Q2 签名分层策略、Q3 永不解密策略、Q4 登录窗口路线均按 best practice 定稿）；**定稿（Status: Draft → Final）仅余 Q1（guest 标准音质可行性）与 Q6（CDN 是否需 Referer）的 Phase 2 运行时验证**，以及由其结果回填的实际签名档/音质天花板。
