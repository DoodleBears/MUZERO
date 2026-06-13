# PRD: MUZERO Electron 本地媒体协议(`muzmedia://`,封面零拷贝直出)

**Status:** Draft
**Created:** 2026-06-14
**Author:** Claude
**Module:** Electron 壳 / 桌面 bridge / 封面显示 - 用自定义协议让 Chromium 原生加载本地封面,绕开 JS Blob → object URL → 解码进堆

---

## Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | storageKey → 本地媒体 URL 基建(复用现有 token 系统) | ✅ 代码完成(待桌面实测) | [Phase 1](#phase-1-storagekey--本地媒体-url-基建复用现有-token-系统) |
| 2 | Now Playing 背景封面走本地协议 URL(Electron 零 Blob/解码) | 🔲 Pending | [Phase 2](#phase-2-背景封面走协议) |
| 3 | 扩展:stage 封面(裁剪派生文件)+ 音视频(future) | 🔲 Pending | [Phase 3](#phase-3-扩展future) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 0. 设计修订(2026-06-14,实现前发现现有基建)

**不新建 `muzmedia://` scheme。** 实现 Phase 1 时发现 Electron **已有**一套等价基建,直接复用即可:

- [`electron/local-media.cjs`](../../../electron/local-media.cjs):token 注册表(`registerLocalMedia(path, mime)` → `lm_…` token,TTL 6h)。
- [`electron/fetch-proxy.cjs`](../../../electron/fetch-proxy.cjs) `handleLocalMedia`:`muzfetch://local-media/?__mztoken=…` → 解析 token → 流式返回文件(已支持 Range/206)。
- [`electron/ipc.cjs`](../../../electron/ipc.cjs) `mediaStorageExistingTarget(storageKey)`:**已有**安全 storageKey→绝对路径解析(防穿越/软链/越界)。
- bridge 已有 `localMediaUrl({path, mime, trace})`(异步:`localMediaToken` IPC → token → URL),用于**导入文件夹的本地媒体播放**([`player-store.ts`](../../../src/stores/player-store.ts) sourcePath)。

**修订后的做法**:给「拿 token」的 IPC 加一个 **storageKey 入口**(`localMediaToken({storageKey, mime})` → `mediaStorageExistingTarget` 解析 → `registerLocalMedia`),渲染端就能把**封面 storageKey** 换成 `muzfetch://local-media/?__mztoken=…` URL,`<img>` 原生加载——**复用现有协议/handler/token,无新 scheme**。渲染端按 storageKey 缓存 URL(token 稳定复用,Chromium 按 URL 缓存解码)。下面 §2/§4/§5 以此为准(原 `muzmedia://` 段落作废)。

---

## 1. Overview

### 1.1 Background

切歌掉帧的 QA trace 实证:快切时每首封面被多个消费者 `URL.createObjectURL(blob)` → `<img>` 解码成位图,`heapMb` 一次 burst 涨 ~130MB、GC 长任务 83ms → 掉帧(详见 [now-playing-switch-background-perf PRD](../20260613-muzero-now-playing-switch-background-perf-prd/20260613-muzero-now-playing-switch-background-perf-prd.md) 的 Q5)。已用「背景按 settledTrack 去抖」削掉一大块,但**显示路径本身仍是 `blob → object URL → 解码进 JS 堆`**,与存储后端无关。

存储层已抽象好([`media-storage-provider.ts`](../../../src/db/media-storage-provider.ts)):**Electron 默认把媒体存成 `userData/persistent-media/<storageKey>` 真实文件**(`electron-file` provider)。既然封面在磁盘上有文件,就能让 Chromium **原生**加载——像现有 `muzfetch://` / `app://` 那样注册一个自定义协议 `muzmedia://`,`<img src="muzmedia://media/?k=<storageKey>">` → 主进程流文件 → **Chromium 负责解码、HTTP-cache、内存淘汰**。

**关键收益:渲染端只需读 `mediaBlobs` 行里的 `storageKey`(元数据,便宜),拼一个 URL 字符串——完全不 load blob 字节、不建 object URL、不在 JS 堆里持有位图。** 直接砍掉 trace 里那部分堆 churn。

### 1.2 适用边界(诚实)

- **仅 Electron** 且媒体是 `electron-file` 后端(有 `storageKey`)。浏览器(OPFS/IndexedDB)无法把文件直接当 URL,继续走 object URL(靠缓存 + 去抖控 churn)。
- **首期只做「原图直出」**:背景是模糊/全幅 `object-cover`,**不需要方形裁剪** → 直接拿原图文件最划算,且避开裁剪难题。stage 专辑封面的裁剪版留到 Phase 3(用裁剪派生文件)。

### 1.3 Core Value

1. **削堆**:Electron 下背景封面不再进 JS 堆(无 Blob/object URL/JS 持有位图)→ 直击 QA#1 的 GC 掉帧。
2. **原生缓存**:Chromium 管解码与内存淘汰,比手写 `coverUrlCache` 更省、更稳。
3. **零字节读取**:渲染端只读 `storageKey` 拼 URL,不再 `resolveMediaBlob` 读全图字节。

---

## 2. System Architecture

### 2.1 协议流(Electron)

```
<img src="muzmedia://media/?k=cover%2F…__blb_x.jpg">
        │ (Chromium 发起,按 URL 缓存/解码)
        ▼
electron main: protocol.handle("muzmedia", …)
        │  parse k → storageKey → 安全映射到 persistent-media/<key>
        │  (复用 storageKeyParts + assertPathInsideRoot:防穿越/软链)
        ▼
net.fetch(pathToFileURL(filePath))  → 流式返回文件(含 content-type)
```

### 2.2 URL 形态

`muzmedia://media/?k=<encodeURIComponent(storageKey)>`(query param,稳健,避开 path 归一化;对齐 `muzfetch` 的 `__mzurl` query 风格)。

### 2.3 安全

- scheme 注册为 privileged `standard + secure + stream`(`supportFetchAPI`;按需 `bypassCSP`,当前无显式 CSP)。
- handler 复用 [`ipc.cjs`](../../../electron/ipc.cjs) 同款 `storageKeyParts`(拒绝绝对路径/`..`/NUL)+ `assertPathInsideRoot`(realpath 必须落在 `persistent-media` 内)+ 拒绝软链。**只读、只在 media 根内**。
- 仅 `GET`;非法 key → 400/404,不泄漏路径。

---

## 3. Data Model

**无新增表/字段**——`MediaBlob.storageKey` / `storageBackend` 已存在([`db/types.ts:224`](../../../src/db/types.ts))。仅**读取**它拼 URL。

---

## 4. 模块边界

| 模块 | 改动 |
|------|------|
| [`src/lib/desktop/local-media-url.ts`](../../../src/lib/desktop/local-media-url.ts)(新) | 纯工具:`buildLocalMediaUrl(storageKey)` / `parseLocalMediaStorageKey(url)` / `LOCAL_MEDIA_PROTOCOL`。可单测 |
| [`bridge.ts`](../../../src/lib/desktop/bridge.ts) + electron/web/tauri 三实现 | `DesktopBridge.localMediaUrl?(storageKey): string | null`(Electron 返回 URL,其余 undefined)+ `resolveLocalMediaUrl()` helper(走 bridge,遵守规则 10) |
| [`electron/main.cjs`](../../../electron/main.cjs) | `registerSchemesAsPrivileged` 加 `muzmedia` + `protocol.handle("muzmedia", …)` |
| [`electron/media-protocol.cjs`](../../../electron/media-protocol.cjs)(新) | handler + 安全 storageKey→path 解析(复用 ipc 的同款校验) |
| Phase 2:封面/背景 hook | 新 `useLocalCoverUrl(track)`:读 `mediaBlobs` 行 storageKey → `resolveLocalMediaUrl` → 命中则背景用它,否则回退 object URL |

---

## 5. Implementation Plan

### Phase 1: storageKey → 本地媒体 URL 基建(复用现有 token 系统)

**Goal:** 渲染端能把封面 `storageKey` 换成现有 `muzfetch://local-media` URL(经 token),`<img>` 原生加载。复用现有协议/handler,无新 scheme。

**Tasks:**
- [x] [`electron/ipc.cjs`](../../../electron/ipc.cjs):`muzero:localMedia:token` 处理器加 `{storageKey, mime}` 分支 → `mediaStorageExistingTarget(storageKey)`(复用现有 traversal/软链安全解析)→ `registerLocalMedia`;`{path}` 老路径不变。preload 透传 input,无需改。
- [x] [`bridge.ts`](../../../src/lib/desktop/bridge.ts)(`LocalMediaStorageUrlInput` + `localMediaUrlForStorageKey?`)+ [electron 实现](../../../src/lib/desktop/electron.ts)(`api.localMediaToken({storageKey, mime})` → `electronLocalMediaUrl`);web/tauri 不实现。
- [x] 纯决策 [`canServeLocalCover`](../../../src/lib/local-cover.ts)(`storageBackend==="electron-file" && !!storageKey`,带类型守卫);4 例单测。

**Checklist:**
- [x] `canServeLocalCover` 单测全绿;`tsc`/Biome 通过;`src` 全量 2380 例通过。
- [ ] **待桌面实测**:`bridge.localMediaUrlForStorageKey({storageKey})` 返回的 URL 能被 `<img>` 加载出图;非法 storageKey 被 ipc 安全层拒。

### Phase 2: 背景封面走协议

**Goal:** Electron 下 Now Playing **背景**封面用 `muzmedia://` 原图,不再走 blob/object URL;其余环境/裁剪场景回退原路径。

**Tasks:**
- [ ] `useLocalCoverUrl(track)`:`useLiveQuery` 读该 track cover 的 `mediaBlobs` 行 → 若 `canServeLocalCover` 且 bridge 有 `localMediaUrlForStorageKey` → 异步取 URL(模块级 `Map<storageKey, Promise|string>` 缓存,token 稳定复用)→ 返回;否则 null。
- [ ] [`now-playing-background.tsx`](../../../src/components/player/now-playing-background.tsx):`backgroundUrl` 在 source==="cover" 时优先用 `useLocalCoverUrl(current) ?? coverUrl`(背景不需要裁剪,原图即可);Pixi/blur/image 三条渲染分支都吃这个 URL。
- [ ] 保持 stage(`media-stage`)走原裁剪 object URL 不变(Phase 3 再优化)。

**Checklist:**
- [ ] 决策函数单测全绿。
- [ ] **待桌面实测 + 新 trace**:Electron 切歌时背景不再产生该封面的 `object-url-miss`、`blobsLive` 不再随背景封面增长;heap 峰值下降。

### Phase 3: 扩展(future)

- stage 专辑封面的**裁剪版**:把裁剪结果作为 cover 派生文件持久化([`cover-derivatives.ts`](../../../src/db/cover-derivatives.ts) 已有派生文件管线),再用 `muzmedia://` 直出。
- 音视频:`media-engine` 的 `<video>` 也可用 `muzmedia://` 取代 7.8MB audio blob 的 object URL(trace 见 `loadBlob audio size:7884045`)。
- 留到背景这块实测见效后再排期。

---

## 6. Out of Scope

- 浏览器(非 Electron):无文件协议,继续 object URL + 缓存 + 去抖。
- 远端封面(`remoteCoverUrl`):走 `muzfetch://` 代理,不在本协议范围。
- 存储后端选择(IndexedDB/OPFS/electron-file):归 OPFS PRD,本 PRD 只**消费** `storageKey`。

---

## 7. Security / 本地优先

- 只读本地 `persistent-media` 根内文件;穿越/软链/绝对路径全拒(复用 ipc 校验)。
- 无出站、无后端、无遥测;协议是本地 IPC 直出。
- codename 不变;`muzmedia` 是新增 scheme,不动 db 名/id 前缀。

---

## 8. Related Documents

| Document | Description |
|----------|-------------|
| [now-playing-switch-background-perf PRD](../20260613-muzero-now-playing-switch-background-perf-prd/20260613-muzero-now-playing-switch-background-perf-prd.md) | QA trace 证明堆 churn 来自封面解码;本 PRD 是其内存续作 |
| [opfs-persistent-media-storage PRD](../20260612-muzero-opfs-persistent-media-storage-prd/) | 媒体存储后端(electron-file/opfs);本 PRD 消费其 `storageKey` |

---

## 9. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | URL 用 query(`?k=`)还是 path 段? | ✅ Resolved | query param(避开 path 归一化,对齐 muzfetch) |
| 2 | 背景用原图(不裁剪)是否可接受? | ✅ Resolved | 可——背景是模糊/全幅,裁剪无意义,原图直出最省 |
| 3 | 是否需要 `bypassCSP`? | Open | 当前无显式 CSP;实测若 `<img>` 被 CSP 拦再加 |
| 4 | 协议响应是否要带 cache 头让 Chromium 长缓存? | Open | 默认 `net.fetch(file://)` 已可缓存;按实测调 |

---

## 10. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-14 | Claude | 初稿:`muzmedia://` 本地封面协议,Electron 背景封面零拷贝直出;Phase 3 扩展 stage 裁剪 + 音视频 |
| 2026-06-14 | Claude | **设计修订(§0)**:实现前发现 Electron 已有等价基建(`muzfetch://local-media` + token + `mediaStorageExistingTarget`)。改为**复用**:给 token IPC 加 storageKey 入口,不建新 scheme。已撤回 `muzmedia://` 代码 |
| 2026-06-14 | Claude | Phase 1 代码完成:ipc token 加 storageKey 分支 + bridge `localMediaUrlForStorageKey` + electron 实现 + 纯 `canServeLocalCover`(4 例)。`src` 全量 2380 例通过。待桌面实测 |
