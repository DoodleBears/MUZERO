# PRD: Electron Reference-First Import + Visible Upload Progress

**Status:** In Progress
**Created:** 2026-06-18
**Author:** DoodleBears
**Module:** Import / Media Storage — drag-drop & file-picker ingest path（拖拽 / 文件选择器导入）

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | Visible import/upload progress（先解决「以为卡住」） | ✅ Completed | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | Electron reference-first import + folder-named sets（拖拽引用路径不 copy + 拖文件夹按名建集） | 🔲 Pending | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | Copy-fallback hardening + reference health（回退一致性 + 引用失效处理） | 🔲 Pending | [Phase 3 Checklist](#phase-3-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

MUZERO 现在有**两套**本地媒体导入策略，行为不一致，且大文件（视频）体验差：

| 导入方式 | Electron 当前行为 | 字节是否复制 | 决定字段 |
|---|---|---|---|
| **文件夹导入**（选文件夹 / folder sync，明文文件） | **引用磁盘原路径**，不复制 | ❌ 不复制 | `sourcePath`（`blobId` 留空） |
| **拖拽 / 文件选择器导入** | 读取整份字节 → 写入 `electron-file` 托管存储 | ✅ **复制一份** | `blobId` |
| 文件夹导入的 `.ncm` / Web / Tauri | 解密 / 读取字节 → 写入存储后端 | ✅ 复制 | `blobId` |

播放时 [`playbackSourceKind`](../../../src/streamsrc/source-detect.ts) 按 `blobId → "blob"`、`sourcePath → "local-file"` 决定来源：引用文件走 [`bridge.localMediaUrl({ path })`](../../../src/lib/desktop/electron.ts) 从原文件直读，复制文件走托管存储。

**两个现实问题：**

1. **拖拽视频会复制一份完整字节**。文件夹导入早已支持「引用不复制」（见 [`20260612-muzero-electron-local-library-index-prd`](../20260612-muzero-electron-local-library-index-prd/)），但拖拽 / 文件选择器没有 —— 用户把一个几 GB 的视频拖进来，会在 `userData` 媒体目录里再占一份磁盘，既慢又费空间。Electron 的合理预期是：**只要能拿到真实磁盘路径，就引用，不复制。**

2. **导入 / 复制过程没有进度反馈**。当前 store 只有一个 `isUploading: boolean`（[`player-store.ts`](../../../src/stores/player-store.ts) `addUploadsToSet`），UI 只在 [`global-drop-zone.tsx`](../../../src/components/upload/global-drop-zone.tsx) 的「Added N files」notice 里转一个 spinner，而且 notice 是在 `await addUploadsToSet(...)` **返回之后**才弹的 —— 也就是说大文件复制 / 解码的整段时间里，**用户看不到任何进度，以为卡死了**。

### 1.2 Target Users

| Role | Description | Permissions |
|------|-------------|-------------|
| **桌面用户（Electron）** | 把本地视频 / 音频拖进 MUZERO 做混合歌单 | 本地文件读取（运行时逐文件授权） |
| **Web / Tauri 用户** | 没有真实路径或没有 `localMediaUrl` 能力 | 只能走复制路径（需要进度） |

### 1.3 Core Value

1. **节省磁盘 / 加速导入**：Electron 拖拽大视频零拷贝、秒入库，与文件夹导入行为一致。
2. **消除「卡住」焦虑**：导入 / 复制有真实进度（文件计数 + 当前文件字节进度），用户知道在动。
3. **行为统一**：所有导入入口在 Electron 上**默认优先真实路径**，只有拿不到路径时才退回复制，且复制路径有进度。

---

## 2. System Architecture

### 2.1 Architecture Overview

```
拖拽 / 文件选择器 (global-drop-zone / track-list-menu)
        │  File[]
        ▼
  addUploadsToSet(setId, files)            ← 进度起点：发布 importProgress
        │  for each file
        ▼
  ingestMediaFile(setId, file)
        │
        ├─ Electron 且能解析真实路径(webUtils.getPathForFile) 且明文?
        │        └─ YES ─▶ ingestReferencedUploadFile ─▶ createReferencedUploadedTrack
        │                     (只记 sourcePath + grantFileAccess，blobId 留空，零拷贝)
        │
        └─ NO（Web/Tauri / 无路径 / .ncm 加密 / 需解码）
                 └─▶ ingestMediaFile 现有路径 ─▶ createUploadedTrack ─▶ putMediaBlob
                       (复制字节，按字节回报进度)
        ▼
  播放: playbackSourceKind → "local-file"(引用) | "blob"(复制)  ← 不变
```

### 2.2 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **Dropped-file path 解析** | Electron `webUtils.getPathForFile(file)`，preload 经 `contextBridge` 暴露 | 新版 Electron（sandbox + contextIsolation）已移除 `File.path`，必须用 `webUtils`；不破坏规则 10 的桥接纪律 |
| **引用导入** | 复用 [`createReferencedUploadedTrack`](../../../src/db/repositories.ts) + [`grantFolderAccess`/逐文件授权](../../../src/lib/desktop/bridge.ts) | 文件夹导入已验证的路径，零新数据形状 |
| **进度状态** | Zustand `player-store` 新增 `importProgress`（瞬时、非持久） | 与 `isUploading` 同源，遵守规则 6 selector 纪律 |
| **进度 UI** | 复用 `global-drop-zone` notice + 可选 dock 状态行 | 不新建悬浮组件 |

### 2.3 Project Structure（仅改动既有文件）

```
src/
├── components/upload/global-drop-zone.tsx     # 进度 UI：从 boolean → 计数 + 字节进度
├── components/library/track-list-menu.tsx     # 文件选择器上传同样接 reference-first
├── stores/player-store.ts                     # addUploadsToSet / ingestMediaFile：分流引用 vs 复制 + 发布 importProgress
├── db/repositories.ts                         # 复用 createReferencedUploadedTrack（已存在）
├── lib/desktop/
│   ├── bridge.ts                              # DesktopBridge 增 getDroppedFilePath?(file) 能力声明
│   ├── electron.ts                            # 实现：webUtils.getPathForFile + 逐文件授权
│   ├── tauri.ts / web.ts                      # 返回 undefined（无能力 → 走复制）
├── streamsrc/source-detect.ts                 # playbackSourceKind 不变（已支持 local-file）
electron/
├── preload.cjs                                # contextBridge 暴露 getPathForFile
└── ipc.cjs                                    # 逐文件 allowlist 授权（复用 realpath 校验）
src/i18n/locales/{en,zh,ja,ko}/common.json     # 进度文案（importing / copying / referenced）
```

---

## 3. Data Model Design

### 3.1 Core Concepts

⚠️ **零新表、零 schema 版本 bump。** 完全复用现有 `Track` 字段：

- **引用导入** → `Track.sourcePath` 设置、`Track.blobId` 留空（与文件夹引用导入完全一致）。
- **复制导入** → `Track.blobId` 设置（不变）。
- 播放分流 `playbackSourceKind` 已识别两者，无需改动。

### 3.2 Schema Changes

- **Current Schema:** [`src/db/types.ts`](../../../src/db/types.ts) `Track.blobId?` / `Track.sourcePath?`（见 [§4 字段语义](#4-api-design)）。
- **Required Changes:** 无 DB schema 变更。引用导入复用 `createReferencedUploadedTrack`。
- **瞬时状态（非 DB）:** `player-store` 新增 `importProgress`：

```typescript
interface ImportProgress {
  phase: "scanning" | "importing" | "done";
  total: number;          // 本批文件总数
  completed: number;      // 已完成文件数
  current?: {
    name: string;
    mode: "reference" | "copy";   // 引用 or 复制（影响是否有字节进度）
    bytesLoaded?: number;          // 仅 copy 模式有意义
    bytesTotal?: number;
  };
}
```

- **Rollback Plan:** `git revert` 注册改动；引用导入开关回退后，新拖入文件回到复制路径，已建的引用 track 仍可播（`sourcePath` 永久有效）。**不引入 runtime flag**（规则 3）。

### 3.3 引用 vs 复制 决策表

| 运行时 | 文件类型 | 能拿到真实路径 | 结果 |
|---|---|---|---|
| Electron | 明文音频/视频 | ✅ `webUtils.getPathForFile` 返回非空 | **引用**（`sourcePath`，零拷贝） |
| Electron | `.ncm`（加密，需解密） | — | 复制（解密后字节入库，不变） |
| Electron | 明文但路径解析失败（如剪贴板粘贴的内存文件） | ❌ | 复制（带进度） |
| Web / Tauri | 任意 | ❌（无 `getDroppedFilePath` 能力） | 复制（带进度） |

---

## 4. API Design

> 这是本地无后端 App，本节描述的是 **bridge 能力接口 + store action 契约**，不是 HTTP。

### 4.1 DesktopBridge 能力扩展

| Symbol | 位置 | 描述 |
|---|---|---|
| `getDroppedFilePath?(file: File): Promise<string \| undefined>` | [`bridge.ts`](../../../src/lib/desktop/bridge.ts) `DesktopBridge` | 解析一个拖拽/选择的 `File` 的真实磁盘绝对路径；无能力或解析失败返回 `undefined`。Electron 实现走 `webUtils.getPathForFile` + 授权该路径；tauri/web 返回 `undefined`。判定能否引用用 `Boolean(bridge.getDroppedFilePath)`，**不要** `isElectron()`（规则 10）。 |

`Track.blobId` vs `Track.sourcePath` 字段语义（既有，列出供实现对齐）：

```typescript
// src/db/types.ts
blobId?: string;     // 有 → 字节已复制进托管存储(electron-file / opfs / idb)；播放走 "blob"
sourcePath?: string; // 有 → 引用磁盘原文件；播放走 "local-file"(bridge.localMediaUrl)
                     // 文件夹导入与「拖拽引用导入」都用它；也是 re-sync 去重 key
```

### 4.2 Store Action 契约

```typescript
// player-store.ts
async addUploadsToSet(setId: string, files: File[]): Promise<void>
// 行为变化：
//  1) 开始时 set importProgress = { phase:"importing", total, completed:0 }
//  2) 每个文件：先尝试 bridge.getDroppedFilePath(file)
//       - 命中且明文 → ingestReferencedUploadFile（引用，current.mode="reference"）
//       - 否则        → ingestMediaFile 现有复制路径（current.mode="copy"，回报 bytes）
//  3) 每文件完成 completed++ 并更新 current
//  4) 全部完成 phase="done"，短暂保留后清空
```

### 4.3 Error Handling

- **引用授权失败 / realpath 校验不过** → 回退到复制路径（不让导入失败），记 `log.warn`。
- **引用文件之后被移动/删除** → 播放时 `localMediaUrl` 解析失败，走既有 `player.playbackError` 提示（与文件夹引用导入同行为）；§6 Phase 3 增加「定位文件 / 转为复制」修复入口（可复用已有 `repairLocalFile` 文案）。
- **Telemetry**：只上报 `import_mode`(`reference`|`copy`)、`file_count`、`kind`(audio/video)、`bytes_bucket`（分桶，非精确大小）；**永不上报**文件名 / 路径 / 字节内容（规则 2 + `feedback_no_hidden_backend_flags`）。

---

## 5. Frontend Design

### 5.1 进度 UI

- **Current Implementation:** [`global-drop-zone.tsx`](../../../src/components/upload/global-drop-zone.tsx) 的 notice 仅在上传**完成后**弹出，期间只有 `isUploading` 驱动一个 spinner，无量化进度。
- **Required Changes:**
  1. 导入**一开始**就显示进度（不要等 `await` 返回）：`importing 3 / 12`，当前文件名 + 模式标签（「引用」/「复制中 45%」）。
  2. **字节级进度（Q3 决策 = 按长期 best practice 做，不走临时「只计数」方案）**：复制单个大文件时显示该文件**真实字节百分比**，而非只显示「第 3 / 12 个」。要点：
     - 复制路径以**流式 / 分块**读写字节（`Blob.stream()` reader 或既有 worker 分块），每块累加 `bytesLoaded`，让大视频复制时进度平滑增长。
     - 两层进度：总体「文件计数」+ 当前文件「字节百分比」；多文件可选汇总总字节（`file.size` 已知，做整批 `ΣbytesLoaded / Σsize`）。
  3. 引用模式秒完成、无字节进度（标「引用，未复制」）—— 没有字节被搬运。
- **UI/Interaction:** 复用 dock 底部状态行 / notice 区域，不新建悬浮窗；reduced-motion 下用静态百分比文本。

### 5.2 State Management

- `importProgress` 进 `player-store`，组件用**最小 selector** 订阅（`usePlayerStore(s => s.importProgress)`），避免整 store 订阅（规则 6）。
- 进度更新**节流**（每 ~100ms 或每 ~256KB 一次 setState），避免大文件复制时每读一块就 setState 拖累主线程。

### 5.3 文件夹拖拽 → 按文件夹名建集（Q4 决策）

- **现状**：拖入一个文件夹时，[`filesFromTransferDeep`](../../../src/lib/file-drop.ts) 把目录递归展开成扁平 `File[]`，然后走 [`global-drop-zone`](../../../src/components/upload/global-drop-zone.tsx) 的统一 set 选择器（本轮已上线的 `SetPickerDialog`）。但**文件夹名丢失了** —— 选择器的「新建歌单」用的是通用名，没有体现「这是 XX 文件夹」。
- **Required Changes：**
  1. drop 时**保留顶层文件夹名**（`filesFromTransferDeep` 或 onDrop 处捕获被拖条目的目录名；多文件夹/混合则退回通用名）。
  2. set 选择器在文件夹 drop 场景下：
     - 「新建歌单」**默认用文件夹名预填**（一键即可建出与文件夹同名的歌单）。
     - 同时仍可选已有歌单（沿用本轮已加的「当前歌单」置顶 + 徽标）。
  3. 与既有「文件夹导入」（[`importFolder`](../../../src/stores/player-store.ts) 用 `basename(path)` 命名集）口径一致 —— 桌面「选文件夹导入」与「拖文件夹」都按文件夹名建集，行为统一。
- **关系**：本节复用并扩展 [`本轮 set 选择器改动`]，不新建弹窗；与 Phase 2 的引用导入正交（文件夹里的明文文件在 Electron 下同样优先引用、见 Q4 子文件路径核对）。

---

## 6. Implementation Plan

### Phase 1: Visible import/upload progress（先解决「以为卡住」）

**Goal:** 不改导入存储策略，先让现有复制路径**有进度**（含字节级，Q3 决策）。低风险、独立可上线，立即消除「卡死」焦虑。

**Tasks:**
- [x] `player-store` 加 `importProgress` 状态 + 在 `addUploadsToSet` 循环中发布（总体文件计数 + 当前文件字节进度）。
- [x] 复制路径改**流式 / 分块**读写（`Blob.stream()` reader 或既有 worker 分块），逐块累加 `bytesLoaded`，驱动单文件字节百分比。
- [x] `global-drop-zone` 在导入**开始即**渲染进度（计数 + 当前文件名 + 字节百分比），完成后转为 notice。
- [x] 进度更新节流（~100ms / ~256KB）；最小 selector 订阅。
- [x] i18n 文案（en→zh/ja/ko）：`importing` / `importingFile` / `importingBytes` / `imported`。

### Phase 1 Checklist

- [x] 拖入 1 个大视频（Web 或 Electron 复制路径）时，进度**立即出现**，且字节百分比平滑增长（不是只跳「1/1」）。
- [x] 拖入 N 个文件时显示 `x / N` + 当前文件字节进度。
- [x] 进度订阅不引起播放进度全树重渲染（规则 6 验证）。
- [x] 四语文案齐全。

### Phase 2: Electron reference-first drag/file import（拖拽也引用路径，不 copy）

**Goal:** Electron 上拖拽 / 文件选择器导入**默认优先真实路径**（引用、零拷贝），拿不到路径才复制（Q1 决策）。同时把「拖文件夹 → 按文件夹名建集 / 选集」做好（Q4 决策）。

> **前置 gate（Q2）**：开工前核对 `electron/` 实际版本是否支持 `webUtils.getPathForFile`；不支持则先升级 Electron 或评估替代方案。

**Tasks:**
- [ ] `electron/preload.cjs` 经 `contextBridge` 暴露 `getPathForFile`（`webUtils.getPathForFile`）。
- [ ] `electron/ipc.cjs` 增逐文件 allowlist 授权（复用 realpath 校验，镜像文件夹授权）。
- [ ] `DesktopBridge.getDroppedFilePath?` 声明 + electron/tauri/web 三实现（tauri/web 返回 `undefined`）。
- [ ] `addUploadsToSet` / `ingestMediaFile` 分流：命中路径且明文 → `createReferencedUploadedTrack`（引用）；否则复制。
- [ ] 引用导入 track 进度标「引用」即时完成。
- [ ] **文件夹拖拽（Q4）**：drop 时保留顶层文件夹名 → `SetPickerDialog` 的「新建歌单」用文件夹名预填；与 `importFolder` 的 `basename(path)` 命名口径一致。
- [ ] **核对文件夹展开后的子 `File` 在 Electron 下 `getPathForFile` 是否仍返回路径**（决定文件夹里的明文文件能否走引用；否则该批走复制）。
- [ ] 单测：分流决策表（reference vs copy）覆盖 Electron-明文 / Electron-ncm / web / 路径失败四种 + 文件夹名建集。

### Phase 2 Checklist

- [ ] Electron 拖入明文视频 → `userData` 媒体目录**不新增**副本，track 有 `sourcePath`、无 `blobId`，可正常播放（`local-file`）。
- [ ] Electron 拖入 `.ncm` → 仍走复制（解密入库）。
- [ ] Web / Tauri 拖入 → 走复制（带 Phase 1 进度）。
- [ ] 剪贴板粘贴的内存文件（无真实路径）→ 走复制，不报错。
- [ ] 拖入一个文件夹 → 弹 set 选择器，「新建歌单」预填文件夹名；选已有集 / 新建都正确入库。
- [ ] 文件选择器（[`track-list-menu`](../../../src/components/library/track-list-menu.tsx)）上传与拖拽行为一致。

### Phase 3: Copy-fallback hardening + reference health（回退一致性 + 引用失效处理）

**Goal:** 引用文件失效（移动/删除）时的可恢复体验，与文件夹引用导入对齐。

**Tasks:**
- [ ] 引用 track 播放失败时提示「定位文件 / 转为复制」（复用既有 `repairLocalFile` 入口与文案）。
- [ ] 「转为复制」action：读原文件 → `putMediaBlob` → 回填 `blobId`（保留 `sourcePath`）。
- [ ] 存储用量统计（如有 settings 存储面板）区分「引用」与「已复制」计数。

### Phase 3 Checklist

- [ ] 引用文件删除后播放报可理解错误，并能一键定位或转复制。
- [ ] 转复制后该 track 离线可播（`blobId` 生效）。

---

## 7. Out of Scope

- **移动端（iOS/Android）导入路径**：移动端文件访问模型不同，沿用既有平台行为，不在本期。
- **流媒体 / 远程源（QQ 音乐、NetEase、Bilibili）下载策略**：本 PRD 只管本地文件导入，不动 stream/remote 缓存。
- **改 DB schema / 迁移**：本期零 schema 变更。
- **把文件夹导入策略改成复制**：文件夹导入引用行为已正确，不动。
- **runtime kill switch / hidden flag**：回退一律 `git revert`（规则 3）。

---

## 8. Security Considerations

- **逐文件授权**：引用导入必须把该文件路径加进 Electron 主进程内存 allowlist 并经 realpath 校验（[`electron/ipc.cjs`](../../../electron/ipc.cjs)），不放宽到整盘；不开 `webSecurity:false`（规则 10）。
- **preload 最小暴露**：只经 `contextBridge` 暴露 `getPathForFile` 一个能力，保持 `contextIsolation:true + sandbox:true + nodeIntegration:false`。
- **隐私**：路径 / 文件名 / 字节内容**永不**进日志、遥测或 bundle（规则 2）。进度遥测只用分桶 / 枚举字段。

---

## 9. Related Documents

| Document | Description |
|----------|-------------|
| [20260612-muzero-electron-local-library-index-prd](../20260612-muzero-electron-local-library-index-prd/) | 文件夹导入的引用-by-path 机制（本 PRD 复用其 `createReferencedUploadedTrack` + 授权模型） |
| [20260614-muzero-electron-local-media-protocol-prd](../20260614-muzero-electron-local-media-protocol-prd/) | `bridge.localMediaUrl` 本地媒体协议（引用 track 播放路径） |
| [20260612-muzero-opfs-persistent-media-storage-prd](../20260612-muzero-opfs-persistent-media-storage-prd/) | 复制路径的存储后端（electron-file / opfs / idb） |
| [20260612-muzero-progressive-bulk-import-playback-prd](../20260612-muzero-progressive-bulk-import-playback-prd/) | 批量导入分批可见性（进度 UI 的上游） |
| [20260617-muzero-now-playing-jump-to-source-prd](../20260617-muzero-now-playing-jump-to-source-prd/) | Now Playing 跳到来源（与 `sourcePath` 语义相关） |

---

## 10. Open Questions

| # | Question | Status | Decision |
|---|----------|--------|----------|
| 1 | 引用 vs 复制：是否给用户一个可见 Settings 选项，还是 Electron 一律默认引用？ | ✅ Resolved | **Electron 默认引用、不加开关**（本地优先 + 省盘）。只有拿不到真实路径 / 加密文件才回退复制。回退路径不藏 flag（规则 3）。 |
| 2 | `webUtils.getPathForFile` 在目标 Electron 版本是否可用？ | 🔲 需确认 | Phase 2 开工前核对 `electron/` 实际版本；若低于支持版本则先升级 Electron 或评估替代。**这是 Phase 2 的前置 gate。** |
| 3 | 复制模式的进度是只做文件计数还是字节级？ | ✅ Resolved | **按长期 best practice 做字节级进度**（单文件复制显示字节百分比 + 多文件总体计数），不走「先只计数」的临时方案。见 [§5.1](#51-进度-ui) / Phase 1。 |
| 4 | 拖入「文件夹」时落到哪个歌单？ | ✅ Resolved | **拖入文件夹要能选目标歌单，或按文件夹名新建歌单**。文件夹 drop 走 set 选择器，且「新建歌单」默认用文件夹名预填。见 [§5.3](#53-文件夹拖拽--按文件夹名建集) / Phase 2。 |

---

## 11. Document Change Log

| Date | Author | Changes |
|------|--------|---------|
| 2026-06-18 | DoodleBears | Initial draft — Electron reference-first import + visible upload progress |
| 2026-06-18 | DoodleBears | Resolve Open Questions：Q1 Electron 默认引用无开关；Q3 字节级进度（best practice）；Q4 拖文件夹选集/按名建集；Q2 留为 Phase 2 前置 gate（确认 Electron 版本支持 `webUtils.getPathForFile`） |
| 2026-06-18 | Codex | Complete Phase 1：新增 `ImportProgress` 瞬时状态、分块读取复制进度、导入开始即显示的 drop progress UI、四语言导入进度文案与 `import-progress` 单测。 |
