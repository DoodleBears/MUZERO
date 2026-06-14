# PRD: MUZERO 封面质量与滚动体验(导入去重 + 滚动不闪 thumbhash + 网格高清)

**Status:** Draft
**Created:** 2026-06-14
**Author:** Claude
**Module:** Library(Tab 2)封面渲染 + 导入派生管线 - 三个用户实测问题

---

## Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | 滚动不再把已加载封面降级成 thumbhash(#C,UX 最痛) | ✅ 代码完成(待实测) | [Phase 1](#phase-1-滚动不闪-thumbhash) |
| 2 | 导入封面解码去重(palette+thumbhash 合并一次)(#1) | ✅ 代码完成(待导入实测) | [Phase 2](#phase-2-导入解码去重) |
| 3 | 专辑/歌手网格用更高清封面(#A) | 🔲 Pending | [Phase 3](#phase-3-网格高清封面) |
| 4 | 详情页返回网格不再重解码闪 thumbhash(#D,跨挂载缓存) | ✅ 代码完成(待实测) | [Phase 4](#phase-4-返回不闪派生缓存) |
| 5 | 坏封面不连累音频导入(#E,启动即刷 `InvalidStateError`,每次重试) | ✅ 代码完成(待实测) | [Phase 5](#phase-5-导入封面解码失败优雅降级) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

三个 QA 实测问题(均为封面相关):

- **#C(最痛):全部歌曲列表滚动时,已经加载好的封面被瞬间降级成模糊的 thumbhash,停下才恢复。** 体验很差。
- **#1:导入时每张封面被 worker 解码两次**(`["thumbhash"]` 和 `["palette"]` 分别一次,各解码整图)——本可一次 `["palette","thumbhash"]` 出两样。worker 侧、一次性,但白花一倍解码。
- **#A:专辑/歌手网格封面偏糊**——网格卡片用的是 160px 缩略派生,桌面 4 列网格在 2x DPI 下渲染宽 ~180px > 160px → 糊。
- **#B:虚拟列表滚动卡顿**——虚拟化本身必要(大库);卡顿来自滚动时大量行进视口触发 worker 派生 + ResizeObserver 频繁重测。**#C 修好后churn 大降**。
- **#E(新,每次开机即刷):导入时 NCM 嵌入封面无法被 `createImageBitmap` 解码,整首歌导入失败——音频 blob 被一并删除、track 从不落库。** track 从不落库 → 其 `sourcePath` 永不进「已知」集合 → 启动 2.5s 后的 `syncImportFolders` 每次都把它当新文件重扫重试 → 这批 `cover.worker failed / fallback` + `Uncaught InvalidStateError: The source image could not be decoded.` + `failed to import folder file …ncm` **每次启动都刷一遍**(同一批 VIP `.ncm`)。

### 1.1 Core Value

1. **滚动丝滑不闪**:已加载封面在滚动中保持,不再降级 thumbhash(#C)。
2. **导入更快**:每张封面只解码一次(#1)。
3. **网格更清晰**:网格卡片用足够分辨率的派生(#A)。
4. **导入更稳**:坏封面绝不连累音频——封面解不了就降级(回退远端 albumPic → thumbhash → 标题),音频照常入库、track 落库,不再每次启动无谓重试(#E)。

---

## 2. 根因(均带 file:line)

### #C 滚动闪 thumbhash(主因)
- [`virtual-track-list.tsx:138`](../../../src/components/library/virtual-track-list.tsx#L138):`deferRowCoverLoad = rowVirtualizer.isScrolling`。
- [`track-row.tsx:117`](../../../src/components/library/track-row.tsx#L117):`useCoverDerivativeUrl(deferRowCoverLoad ? undefined : track, "thumbnail")` —— 滚动时传 `undefined`。
- [`use-media.ts:132`](../../../src/hooks/use-media.ts#L132):track 为空 → 返回 `null`。
- [`cover-image.tsx:120`](../../../src/components/ui/cover-image.tsx#L120):`{preview && (!url || !loaded) && <img src={preview}/>}` + [`:129`](../../../src/components/ui/cover-image.tsx#L129) `{url && <img .../>}`。
- **结果**:滚动一开始 `url` 变 null → 真封面从 DOM 移除、thumbhash 盖上 → **已加载的封面被主动降级**。defer 的本意是「滚动时不要启动新解码」,却误伤了「已经加载好的」。

### #1 导入双重解码
- [`repositories.ts:79-93`](../../../src/db/repositories.ts#L79) `deriveCoverThumbhash`(targets `["thumbhash"]`)与 [`:95-110`](../../../src/db/repositories.ts#L95) `deriveCoverPalette`(`["palette"]`)分别调 worker;in-flight 去重 key 含 targets,故**两者不互相去重、各解码一次**。`deriveCoverMetadata`(`["palette","thumbhash"]`)本可一次出两样。导入路径分开调了它们。

### #A 网格糊
- 网格卡 [`entity-grid.tsx:94`](../../../src/components/library/entity-grid.tsx#L94) `useTrackThumbnailUrl` → 160px 缩略派生([`cover-derivative-core.ts:9`](../../../src/workers/cover-derivative-core.ts#L9) `THUMBNAIL_MAX_EDGE=160`)。桌面网格卡渲染宽 ~90px@1x → 180px@2x > 160px → 放大糊。无更大尺寸派生。

### #D 返回网格重解码闪 thumbhash(QA 追加)
- **现象**:从专辑/歌手点进详情、再返回网格,封面整体重新加载——先现 thumbhash 再切真图。
- **根因:派生封面路径缺「跨挂载 URL 缓存」**。整图封面走 [`useTrackCoverResource`](../../../src/hooks/use-media.ts),有 `coverUrlCache.peek()` **同步**命中(re-mount 帧 0 即拿到 URL,零闪);但**缩略/backlight 派生**走 [`useCoverDerivativeUrl`](../../../src/hooks/use-media.ts),旧实现:`entry` 初始 `null` → effect 里 `await ensureCoverThumbnailDerivative()`(Promise,即便命中 DB 也是异步)→ `useKeyedObjectUrl` **每次挂载新建 object URL、卸载即 revoke**。
- 网格卡 [`entity-grid.tsx`](../../../src/components/library/entity-grid.tsx) / 列表行 [`track-row.tsx`](../../../src/components/library/track-row.tsx) 都用派生路径 → 每次返回重挂 = `null`(帧 0)→ thumbhash → 异步解析 → fade。URL 串还每次变 → [`cover-image.tsx`](../../../src/components/ui/cover-image.tsx) 的 `decodedCoverUrls` 防闪也失效(新 URL 不在集合里 → 重放 fade)。**双重闪因**。

### #E 坏封面解码失败连锁中止整曲导入(QA 追加,启动即现、每次重试)

**现象**:开机 ~2.5s 后日志连刷三连——`cover.worker failed … errorKind: media_decode` → `cover.worker fallback … phase: retry` → `Uncaught (in promise) InvalidStateError: The source image could not be decoded.` → `player failed to import folder file …ncm`,**每次启动都重复**同一批 VIP `.ncm`(`You Are The Jumpmaster` / `κ` / `想い出は遠くの日々` / `雛鳥` …)。

**解码链(带 file:line)**:
- [`App.tsx:113`](../../../src/App.tsx#L113):启动 2.5s 后 `syncImportFolders()` → [`runFolderSync`](../../../src/stores/player-store.ts#L1780)。
- [`player-store.ts:1861`](../../../src/stores/player-store.ts#L1861) `ingestScannedFileBytes` → [`:1744`](../../../src/stores/player-store.ts#L1744) `ingestNcmBytes` → [`:1402`](../../../src/stores/player-store.ts#L1402) `persistDecodedNcmTrack` → [`createUploadedTrack`(repositories.ts:920)](../../../src/db/repositories.ts#L920) → [`deriveCoverMetadata`(:64)](../../../src/db/repositories.ts#L64)。
- worker 解码失败 → [`cover-client.ts:179`](../../../src/workers/cover-client.ts#L179) `.catch` 回退主线程 `inlineExtract` → [`cover-derivative-core.ts:126`](../../../src/workers/cover-derivative-core.ts#L126) `await createImageBitmap(blob)` **再次** 抛 `InvalidStateError`。这次 `extractFresh` 的 `.catch` 没有第二层兜底(直接 `await inlineExtract`)→ 异常冒泡出 `deriveCoverMetadata`。

**致命点**:[`createUploadedTrack` 的 catch(repositories.ts:936-940)](../../../src/db/repositories.ts#L936) 把刚存进去的**音频 media blob + 封面 blob 一起 `deleteMediaBlob` 并 `throw`**——封面派生被当成**强依赖**,一个解不了的封面让整首歌(连同好端端的音频)整体回滚,track 从不落库。

**连锁(为何每次开机都刷)**:track 不落库 → [`knownSourcePaths`](../../../src/stores/player-store.ts) 永远不含它 → [`selectNewFiles`](../../../src/stores/player-store.ts) 每次都把它当「新文件」→ `syncImportFolders` 每次启动重试同一批 → **永久循环、永久刷错**。这正是「首次载入画面就会出现」的成因——不是首次,是**每次**。

**雪上加霜(连远端封面也丢了)**:[`ingest-core.ts:101`](../../../src/workers/ingest-core.ts#L101) `albumPicUrl: embeddedCover ? undefined : albumPicUrl`——只要**存在**嵌入封面就抑制远端 URL。于是嵌入封面「存在但解不了」时,既丢了 thumbhash/palette,又**主动放弃了本可用的 CDN 封面**(这批 VIP 文件恰恰带 `albumPic`)。

**封面是否「处理一次就持久」?是,设计本就如此——是 #E 的回滚让它失效**:封面 blob 经 [`putSizeAwareImageBlob`(media-blob-storage.ts:140)](../../../src/db/media-blob-storage.ts#L140) 落 `mediaBlobs`(<512KB→IndexedDB;≥512KB→默认 provider,可 **OPFS** / electron-file),thumbhash+palette 落 track 行。**处理一次即持久化、下次不再解码**本就是现有设计;问题不在缺缓存,而在 #E 把整笔事务回滚了 → 什么都没存下 → 每次重来。修好 #E 后,持久化自然生效。

## 3. Implementation Plan

### Phase 1: 滚动不闪 thumbhash

**Goal:** 滚动中**保留已解码封面**,只对「尚未解码」的封面用 thumbhash;defer 只阻止「启动新解码」,不丢弃已有。

**方案(择一,实现时定):**
- (a) **缓存命中即返回**:`useCoverDerivativeUrl(track, kind, { defer })` —— defer=true 时,若派生 URL 已在缓存(同步可取)→ 仍返回它;仅缓存未命中才不启动 worker、返回 null。这样已加载封面(缓存命中)滚动中照常显示,只有没缓存的走 thumbhash。**首选**——精准,不误伤。
- (b) track-row 记住「本行当前 track 的最后已解析 URL」,defer 时沿用(注意虚拟行复用:必须按 `track.id` 绑定,track 变了立刻失效,避免串图)。

**实现(落地版,比原方案更稳):** 不依赖「缓存同步 peek」,而是**让 hook 保留 state 里已解析的 entry**:`useCoverDerivativeUrl(track, kind, { defer })`,defer=true 时 `setEntry(prev => keepDeferredCover(prev, coverKey))` 并**直接 return 不启动 worker**;`entry` 带 `forKey`(= coverBlobId+crop+remote),只有「本行 track 没变」才保留,虚拟行复用换 track 时 `forKey` 不匹配 → 转 placeholder,绝不串图。

**Tasks:**
- [x] 纯助手 [`keepDeferredCover(resolved, coverKey)`](../../../src/lib/cover-defer.ts)(3 例单测):同 cover 保留、换 cover 丢弃、未解析 null。
- [x] [`useCoverDerivativeUrl`](../../../src/hooks/use-media.ts) 加 `options.defer`;defer 时保留匹配 entry、不启动 worker;entry 加 `forKey`。默认 `defer=false`,其他调用方不变。
- [x] [`track-row.tsx`](../../../src/components/library/track-row.tsx):`useCoverDerivativeUrl(track, "thumbnail", { defer: deferCoverLoad })`(不再传 `undefined`)。

**QA 跟进(滚动停下的二次闪):** 实测滚动中已不闪,但**停下瞬间会闪一下 thumbhash 再回来**。根因:`defer` 翻回 false 时,effect 对**已解析的封面也重跑 `ensure()`** → 换了新 object URL → `CoverImage` 的 `loaded` 复位 → 闪一帧。修法:effect 顶部加守卫——**`entryRef.current.forKey === coverKey` 即已解析过该封面 → 直接 return,不重解析、不换 URL**(用 ref 读最新 entry,避免把 entry 设成依赖导致每次变更都重跑)。已解析的封面停下时不再重解码 → 不闪。

**Checklist:**
- [x] `keepDeferredCover` 单测(3 例)+ use-media/library 单测(71)全绿;`tsc`/Biome 通过;`src` 全量 2383 例通过(player-store debounce 计时测试满载下偶发 flaky,re-run 全绿)。
- [ ] **待实测**:全部歌曲滚动中 + **停下** 都不再闪 thumbhash;仅真没解析过的封面短暂 thumbhash。

### Phase 2: 导入解码去重

**Goal:** 导入每张封面只解码一次,出齐 palette+thumbhash。

**Tasks:**
- [ ] 定位导入路径(folder import → `createUploadedTrack`/ingest)里**分开调** `deriveCoverThumbhash` + 后续 palette 的地方,合并为单次 `deriveCoverMetadata`(`["palette","thumbhash"]`),把 thumbhash 与 palette 一起拿。
- [ ] 确认 display 侧(`visualizer-dynamic-color`)能命中导入时已存的 palette 派生(避免再解码)。
- [ ] (可选)`extractCoverMetadataViaWorker` 的 in-flight key 对「子集 targets」也能复用(`["thumbhash"]` 命中正在跑的 `["palette","thumbhash"]`),进一步省。

**实现(落地):** 所有导入(upload / NCM / 文件夹)都汇聚到 `createUploadedTrack`。把它从「`deriveCoverThumbhash`(解码1)+ 近似 palette + 后台 `deriveCoverPalette`(解码2)flush」改为**一次 `deriveCoverMetadata`(`["palette","thumbhash"]`,一次解码出两样)**,直接写精确 palette(worker 无果时回退 thumbhash 近似)。**删掉整套延迟 flush 机制**(`queue/flush/schedule/runQueued` + `scheduleIdleTask`);`deriveCoverPalette` 仍被 backfill 用、保留。更新对应单测。

**Tasks:**
- [x] `createUploadedTrack` 改 `deriveCoverMetadata` 一次出 thumbhash+精确 palette;移除后台 palette flush 调用 + 整套机制。
- [x] 更新 `cover-thumbhash-repo.test.ts`:断言导入后**立即**有精确 palette(不再 flush)。

**Checklist:**
- [x] `tsc`/Biome 通过;`src` 全量 2383 例通过。
- [ ] **待导入实测**:trace 里每张封面 worker `enqueue` 从 2 次降到 1 次(targets=`["palette","thumbhash"]`)。

### Phase 3: 响应式封面派生(Pinterest 式)

**Goal:** 像 Pinterest 那样「按 显示尺寸×DPR 取刚好够大的那一档」——网格清晰、内存低。**不是用原图、不是一刀切 320。**

**做法(4 招里我们只缺第 1 招):**
1. **多档预生成尺寸** ← 本 Phase 要做。新增一组缩略派生档(如 `sm=160`(列表行)/ `md=320`(网格卡)/ `lg=512`(大图/详情头)),按 surface + `devicePixelRatio` 选。
2. **按 URL 直出、浏览器原生解码/缓存** ← 已有(`muzfetch://local-media` 协议,electron-local-media-protocol PRD Phase 1/2)。
3. **thumbhash blur-up 占位** ← 已有(且 #C 已修不闪)。
4. **虚拟化** ← 已有(`virtual-card-grid`)。

**Tasks:**
- [ ] [`cover-derivative-core.ts`](../../../src/workers/cover-derivative-core.ts) + [`cover-derivatives.ts`](../../../src/db/cover-derivatives.ts):缩略派生参数化为多档尺寸(`sm/md/lg` 或显式 max-edge),各档独立缓存 + 预算([`enforceCoverDerivativeBudget`](../../../src/db/cover-derivatives.ts))。
- [ ] 纯选择器 `pickCoverSize(surface, dpr)`(可单测):列表行→160、网格→320、详情头→512,2x 屏取对应更大档。
- [ ] `useTrackThumbnailUrl` / `useCoverDerivativeUrl` 支持指定尺寸档;[`entity-grid.tsx`](../../../src/components/library/entity-grid.tsx) 网格用 `md`,[`track-row.tsx`](../../../src/components/library/track-row.tsx) 列表用 `sm`。
- [ ] 派生走协议直出(Electron),保持浏览器原生解码/缓存(对齐 Pinterest 第 2 招)。

**尺寸(用户已拍板 2026-06-14):列表行 `sm=160`,网格卡 `lg=512`**(用户:「可以用 512 px」——网格直接用 512 而非 320,更清晰)。按 `Math.min(devicePixelRatio,2)` 选一档,不存双份。详情大图也可复用 512。

**Checklist:**
- [ ] `pickCoverSize` 单测;桌面网格卡 2x DPI 下清晰;各档进预算管理;不上采样、不下载原图。
- [ ] `tsc`/Biome/`src` 全量通过。

### Phase 4: 返回不闪(派生封面跨挂载缓存)

**Goal:** 让派生(缩略/backlight)路径和整图路径**同等待遇**——re-mount 帧 0 同步命中缓存 URL,返回网格不再重解码、不闪 thumbhash。

**实现(落地):**
- 新增 [`coverDerivativeUrlCache`](../../../src/lib/object-url-cache.ts):独立于 `coverUrlCache` 的第二个 `ObjectUrlCache`(cap 128)——网格大量小缩略不会挤掉 dock 正在显示的整图,反之亦然。
- 新增同步键 [`coverImageDerivativeKey(track, kind)`](../../../src/db/cover-derivatives.ts):由行字段直接算出 `ensureCover*Derivative` 最终落的那个 `cvd_…` id(remote-only 返回 null)。
- 重写 [`useCoverDerivativeUrl`](../../../src/hooks/use-media.ts):`acquire/release` 引用计数 + **渲染期 `peek` 同步读**(命中即帧 0 返回 URL)+ miss 时异步 `ensure→createObjectURL→store`(缓存拥有生命周期,**卸载不 revoke**)。退役 `keepDeferredCover`(缓存 peek 天然在 defer 翻转时保住同一封面),删 [`cover-defer.ts`] + 其测试。
- 受益面:[`entity-grid`](../../../src/components/library/entity-grid.tsx)(专辑/歌手网格)、[`track-row`](../../../src/components/library/track-row.tsx)(列表行)、[`media-stage`](../../../src/components/player/media-stage.tsx)/[`swipeable-media-stage`](../../../src/components/player/swipeable-media-stage.tsx)(now-playing backlight)全部走派生路径,一并不闪。

**Tasks:**
- [x] `coverDerivativeUrlCache` 单例 + `coverImageDerivativeKey` 纯键(单测:与 `coverDerivativeId` 一致、crop/kind 分区、remote/coverless 返回 null)。
- [x] `useCoverDerivativeUrl` 改走缓存(帧 0 `peek`、miss 异步 store、defer 仍不启动解码);删 `cover-defer`。
- [x] 跨挂载 hook 回归测试([`use-media.test.tsx`](../../../src/hooks/use-media.test.tsx)):一次解析 → 卸载不 revoke → re-mount **首帧**同步返回同一 URL、不二次解码;defer 期间不解码、settle 后解一次。

**Checklist:**
- [x] 上述单测全绿;`tsc`/Biome 通过;`src` 全量 2403 例通过。
- [ ] **待实测**:从专辑/歌手详情返回网格,封面**不再**先 thumbhash 再切真图;列表行、now-playing backlight 同样不闪;长时间浏览大库内存有界(派生缓存 cap 128 + 预算)。

### Phase 5: 导入封面解码失败优雅降级

**Goal:** 坏封面绝不连累音频——`createUploadedTrack` 把封面派生当**尽力而为(best-effort)**:解不了就降级,音频 media blob 保留、track 必落库 → 不再每次启动重试;能回退远端 `albumPic` 的就补上一张能用的封面。

**根因复述(详见 [#E](#e-坏封面解码失败连锁中止整曲导入qa-追加启动即现每次重试)):** 封面派生现为整曲导入的**强依赖**——`deriveCoverMetadata` 抛 `InvalidStateError` → `createUploadedTrack` catch 删音频+rethrow → track 从不落库 → `syncImportFolders` 每次启动重试。

**实现(落地):**
- **保音频、落 track**:[`createUploadedTrack`(repositories.ts:864)](../../../src/db/repositories.ts#L864) 把封面拆成两段——封面(`putSizeAwareImageBlob` + `deriveCoverMetadata`)单独 try/catch、**在 track 事务之外**;解码/存储失败时**不**删音频、**不** rethrow,只 `coverBlobId=undefined` + 清掉坏 blob。track 落库改为单独事务:**仅当 track 行本身写失败**才回滚音频+封面(真孤儿才回滚)。
- **清掉坏 cover blob**:`createImageBitmap` 都解不了 → `<img>` 也渲染不了 → catch 里 `deleteMediaBlob(cover.id)`(别留裂图引用),显示链自然回退 thumbhash → 标题。
- **回退远端 albumPic**:封面无效即视作「无封面」——两条 NCM/导入路径都把 `hasCover` 改成 **`Boolean(track.coverBlobId)`**(而非「是否有嵌入封面」),并据此透出 `albumPicUrl`:[`ingest-core.ts:101/200`](../../../src/workers/ingest-core.ts#L101)(worker/inline 路径)+ [`player-store.ts persistDecodedNcmTrack`](../../../src/stores/player-store.ts#L1417)(Electron renderer 路径)。于是 [`runFolderSync`](../../../src/stores/player-store.ts#L1874) 的 bounded 远端 fetch pass 用 CDN 封面补上。
- **(未做,可选治本)** 让 `extractCoverMetadataInline`/worker 在解码失败时返回空结果而非 throw,以消掉 `Uncaught (in promise) InvalidStateError` 并免去各处 try/catch——留作后续(见 Open Q5)。

**Tasks:**
- [x] `createUploadedTrack`:封面派生失败 → 保音频、落 track、清坏 cover blob、`coverBlobId` 置空;**不 rethrow**(仅 track 行写失败才回滚)。
- [x] NCM/导入两路径:`hasCover = Boolean(track.coverBlobId)` + 据此透出 `albumPicUrl`,坏嵌入封面回退远端。
- [x] 单测([`cover-thumbhash-repo.test.ts`](../../../src/db/cover-thumbhash-repo.test.ts)):注入「派生抛 `InvalidStateError`」→ track 仍落库(`ready`、音频 blob 在)、无 thumbhash/palette、坏 cover blob 已清(无孤儿)。
- [x] 端到端([`folder-sync-covers.test.ts`](../../../src/stores/folder-sync-covers.test.ts)):坏嵌入封面 `.ncm` → 导入成功 → 回退远端 albumPic(4 bytes)→ **第二次 `runFolderSync` 导入 0**(不再重试)。

**Checklist:**
- [x] `tsc` / Biome 通过;相关测试全绿(cover-thumbhash 单测 + folder-sync-covers e2e + ingest-core + player-store)。
- [ ] **待实测**:导入这批 VIP `.ncm` → 音频入库可播;带 `albumPic` 的补上 CDN 图、没有的回退标题;**重启后不再刷** `failed to import folder file` / `InvalidStateError`(同一文件不再被反复重试)。

---

## 4. Out of Scope / 说明

- **#B 虚拟化本身**:保留(大库必需)。#C 修好 + 派生不在滚动中暴涨后,卡顿应大降;若仍有,再单独看 ResizeObserver 节流 / overscan。
- 不动存储后端、不动协议(本地媒体协议是另一 PRD)。
- 远端封面走 muzfetch 不变。
- **本次日志里的非封面噪声(均与本 PRD 无关,记录以免误判)**:
  - `Electron Security Warning (Insecure Content-Security-Policy / unsafe-eval)` —— **dev-only**:Vite HMR 需 `unsafe-eval`;Electron 自己也提示「once the app is packaged 不再出现」。打包构建无此问题,不在本 PRD 处理。
  - `pixi-background-controller.ts:153 The powerPreference option is currently ignored … on Windows` + `PixiJS Warning: ImageSource: Image element passed, converting to canvas` —— 来自**像素背景(pixi)**,属另一功能/PRD:前者是 Chromium WebGPU 的无害提示(crbug 369219127),后者是 pixi 把 `HTMLImageElement` 转 canvas 的轻微一次性开销。本 PRD 不动。

---

## 5. Related Documents

| Document | Description |
|----------|-------------|
| [cover-render-pipeline-performance PRD](../20260613-muzero-cover-render-pipeline-performance-prd/20260613-muzero-cover-render-pipeline-performance-prd.md) | 封面派生管线(worker 化 thumbnail/backlight/palette);本 PRD 是其质量/体验续作 |
| [electron-local-media-protocol PRD](../20260614-muzero-electron-local-media-protocol-prd/20260614-muzero-electron-local-media-protocol-prd.md) | 本地封面零拷贝直出(内存);与本 PRD 互补 |

---

## 6. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | #C 用「缓存命中即返回」还是「track-row 记住上次 URL」? | Open | 首选 (a) 缓存命中即返回(精准、不串图);实现时确认缓存可同步 peek |
| 2 | #A 新派生尺寸取多大?(256 / 320 / 跟随最大网格列宽) | Open | 默认 ~320px(覆盖桌面 2x 网格);实测再调 |
| 3 | #1 合并是否影响已导入库(老封面已分开存)? | Open | 仅改新导入路径;老库走 Phase 3 的派生重算或保持现状 |
| 4 | #E 坏嵌入封面:删 cover blob + 回退远端,还是保留 blob 仅跳过派生? | Open | 倾向删坏 blob + 回退 `albumPic`(裂图无意义;这批 VIP 都带 albumPic) |
| 5 | #E 治本是否改 `extractCoverMetadataInline` 解码失败「返回空」而非 throw? | Open | 可选;先在 `createUploadedTrack` 局部兜底保导入,治本(消 `Uncaught` + 各处免 try)另议 |
| 6 | #E 这批 VIP `.ncm` 嵌入封面为何 `createImageBitmap` 都解不了(格式/截断/非图数据)? | Open | 不阻塞修复(降级即可);可另起排查 dump 几张坏封面字节确认真因 |

---

## 7. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-14 | Claude | 初稿:#C 滚动不闪(主)+ #1 导入去重 + #A 网格高清;#B 归因虚拟化非主因 |
| 2026-06-14 | Claude | Phase 1(#C)代码完成:`keepDeferredCover` + `useCoverDerivativeUrl` defer 选项(保留已解析封面、滚动中不启动 worker)+ track-row 改造。`src` 全量 2383 例通过。待实测 |
| 2026-06-14 | Claude | QA 跟进:修「滚动停下二次闪 thumbhash」——effect 顶部加 `entryRef.forKey === coverKey` 守卫,已解析封面不再重跑 ensure/换 URL。`src` 全量通过 |
| 2026-06-14 | Claude | Phase 2(#1)代码完成:`createUploadedTrack` 改一次 `deriveCoverMetadata`(thumbhash+精确 palette),删整套延迟 palette flush;每张封面导入解码 2→1 次。`src` 全量 2383 例通过 |
| 2026-06-14 | User+Claude | Phase 3 尺寸拍板:列表 `sm=160` / 网格 `lg=512`(用户「可以用 512 px」)。Phase 3 由用户另开 session 实现 |
| 2026-06-14 | Claude | QA 追加 #D:详情返回网格重解码闪 thumbhash。根因=派生路径缺整图那套跨挂载 URL 缓存 |
| 2026-06-14 | Claude | Phase 4(#D)代码完成:新增 `coverDerivativeUrlCache` + 同步键 `coverImageDerivativeKey`,`useCoverDerivativeUrl` 改帧 0 `peek`/异步 `store`(卸载不 revoke);**退役 Phase 1 的 `keepDeferredCover`/`forKey` 守卫**(缓存 peek 已天然覆盖,删 `cover-defer.ts`)。新增跨挂载 hook 回归测试 + 键单测。`src` 全量 2403 例通过 |
| 2026-06-14 | User+Claude | QA 追加 #E(排查启动日志):导入 NCM 嵌入封面 `createImageBitmap` 解码失败 → [`createUploadedTrack` catch(repositories.ts:936)](../../../src/db/repositories.ts#L936) 删音频 blob + rethrow → track 从不落库 → [`App.tsx:113`](../../../src/App.tsx#L113) 启动 `syncImportFolders` 每次把它当新文件重试(每开机刷 `InvalidStateError` / `failed to import folder file`)。新增 **Phase 5**:封面派生改 best-effort(保音频、落 track、清坏 cover blob、回退 `albumPic`)。澄清日志里 CSP(dev-only)/ pixi(他 PRD)噪声不在本范围。澄清封面「处理一次即持久」本就是设计(小图→IndexedDB / ≥512KB→OPFS·electron-file + thumbhash/palette 落 track),是 #E 的整笔回滚让持久化失效 |
| 2026-06-14 | Claude | Phase 5(#E)代码完成:`createUploadedTrack` 封面拆为事务外 best-effort 段(解码/存储失败 → 清坏 blob、`coverBlobId=undefined`、不删音频、不 rethrow;仅 track 行写失败才回滚孤儿);NCM/导入两路径 `hasCover=Boolean(track.coverBlobId)` 据此回退远端 albumPic([`ingest-core.ts`](../../../src/workers/ingest-core.ts) worker/inline + [`player-store.ts`](../../../src/stores/player-store.ts) renderer)。新增单测(派生抛 `InvalidStateError` → track 仍落库、坏 blob 已清)+ 端到端(坏嵌入封面 `.ncm` → 回退远端 → 第二次 sync 导入 0,不再重试)。`tsc`/Biome 通过、相关测试全绿。待实测 |
