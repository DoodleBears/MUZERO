# PRD: MUZERO 发版流水线 — Changelog 规范 + 多平台构建 + R2 分发 + 应用内版本下载

**Status:** Draft
**Created:** 2026-06-11
**Author:** DoodleBear / Product
**Module:** Release Engineering — 版本号契约 / Changelog / Electron 打包 / R2 分发清单 / Settings 下载中心

> 参考实现：ClipCombo（[`doodlekuma.com`](../../../../doodlekuma.com)）的 [`20260531-clipcombo-changelog-and-desktop-release-prd`](../../../../doodlekuma.com/docs/prd/clip-prd/20260531-clipcombo-changelog-and-desktop-release-prd/20260531-clipcombo-changelog-and-desktop-release-prd.md)。本 PRD 在其「electron-vite + electron-builder + electron-updater + generic R2 feed + 类型化 changelog 数据」范式之上，针对 MUZERO 的差异（**双壳层 Electron+Tauri**、**完全无后端**、**已有 BYOK R2 但无分发 R2**、**用户要求 manifest.json 全量版本历史 + 应用内历史下载**）做适配落地。

---

## 📋 Phase Progress Overview

| Phase | Name | Status | Link |
|-------|------|--------|------|
| 1 | 版本号单一真相 + 注入 + 比较（三文件同步 bump + Vite define + compareSemver；Settings 显示移 P5） | ✅ Completed | [Phase 1 Checklist](#phase-1-checklist) |
| 2 | Changelog 规范 + 类型化数据模型 + 历史大版本回填 + 「What's New」面板 | ✅ Completed | [Phase 2 Checklist](#phase-2-checklist) |
| 3 | Electron 发布打包硬化（publish provider + per-OS targets + app-update + 安全/外部依赖收口） | ✅ Completed | [Phase 3 Checklist](#phase-3-checklist) |
| 4 | Makefile 多平台发布指令 + R2 分发 + `manifest.json` 版本索引（合并式上传） | 🔲 Pending | [Phase 4 Checklist](#phase-4-checklist) |
| 5 | 自动更新（electron-updater IPC + 渲染层提示）+ Settings 历史版本下载侧栏 | 🔲 Pending | [Phase 5 Checklist](#phase-5-checklist) |

> Status Legend: ✅ Completed | 🔄 In Progress | 🔲 Pending

---

## 1. Overview

### 1.1 Background

MUZERO 至今（2026-06-06 ~ 2026-06-11，461 commits）已经积累了非常完整的功能面：AI DJ 续歌、混合视频/上传集、歌曲记忆、R2 云盘同步、专辑/歌手实体、多语转写搜索、外部流媒体源（网易云/B 站/YouTube）、富歌词（LRC/yrc/qrc/TTML 逐字卡拉 OK）、封面取色流光背景……但**它至今没有任何「发版」能力**：

| 能力 | 现状 | 缺口 |
|------|------|------|
| 版本号 | `0.1.0` 硬编码在 [`package.json`](../../../package.json)、[`tauri.conf.json`](../../../src-tauri/tauri.conf.json)、`src-tauri/Cargo.toml` 三处，手动保持同步 | 无单一真相、无 bump 工具、未注入进 bundle、UI 不显示 |
| Changelog | 无 | 无规范、无数据、无 UI |
| 桌面打包 | Tauri（`make mac/win/linux`，全是 `tauri build`）+ Electron（[`package.json`](../../../package.json) 内联 `build` 块）并存 | 无统一 `make release`、无 cross-OS 编排、Electron 产物没进 `desktop-locate` |
| 自动更新 | **完全没有**（无 `electron-updater`、无 `publish` provider、无 update feed、无 IPC） | 整套缺失 |
| 应用分发 | **没有**任何分发 R2 / wrangler / 公共读路径 | 只有 BYOK **用户库** R2（`muzero-r2-manifest-v1`，是用户数据，**不是**应用分发） |
| 应用内下载历史 | 无 | 无版本历史 manifest、无 Settings 下载 UI |

> ⚠️ **必须区分的两套 R2（全程不可混淆）**：
> - **用户库 R2**（已存在，[`src/sync/`](../../../src/sync/)，84 文件）= 用户**自己的 BYOK 桶**存自己的歌单/歌曲/记忆，hand-rolled SigV4，`muzero-r2-manifest-v1` 是**库内容清单**。这是「硬规则 #1 本地优先」语境下用户**自配**的云盘。
> - **应用分发 R2**（本 PRD 新建）= **MUZERO 官方拥有**的一个**公共读**桶，只放**安装包 + 更新 feed + 发布 manifest.json**。它是「下载服务器」，**不持有任何用户数据、无账号、无遥测**——等价于 GitHub Releases / 一个 `download` 页面。详见 [§2.4 决策记录](#24-决策记录--分发-r2-不违反本地优先)。

本 PRD 一次性把「**版本号契约 → changelog 规范 → 多平台构建 → R2 分发 + manifest.json → 应用内历史下载**」这条发版链路落地，对齐 ClipCombo 已验证的 best practice，并补上 ClipCombo 没有、而本项目用户明确要求的两块：**全量版本历史 manifest.json** 与 **应用内历史版本下载中心**。

### 1.2 Target Users

| Role | Description | Permissions |
|------|-------------|-------------|
| **维护者（你）** | 在 macOS 上构建 mac 包、在 Windows 上构建 win/linux 包，`make` 一条命令发版到 R2 并更新 manifest | 持有官方分发 R2 桶的 S3 凭证（在构建机 env / CI secret，**永不进 bundle**） |
| **桌面用户** | 用 Electron 桌面端，启动后自动检查更新（Win/Linux 静默下载、就地安装；macOS 未签名 → 提示手动下载） | 收到「有新版本」提示 → 一键安装 / 跳转下载 |
| **任意用户** | 在 Settings「关于 / 版本」看到当前版本 + 完整更新日志，并能从历史版本列表下载任意旧版安装包 | 浏览 changelog、下载历史安装包（读 `manifest.json`） |

> 无后端、无账号、无权限系统（硬规则 #1）。自动更新是否触发、用户看到哪些版本，全由本地状态（`localStorage` 已读标记）+ 公共 `manifest.json` 决定。

### 1.3 Core Value

1. **可发版**：从「只能本地 `dev`」升级为「一条 `make` 指令多平台构建 + 同步发布 + 用户自动收到更新」，是产品从 demo 走向可分发的前提。
2. **可追溯**：每次发版强制配套 changelog（release gate），版本号三处自动同步、注入 bundle、UI 可见；`manifest.json` 记录全量版本历史。
3. **best practice 对齐**：increment update 复用 `electron-updater` + `.blockmap` 差量下载 + generic R2 feed（ClipCombo 已验证），不自研更新器；changelog 用**类型化数据**（编译期校验 area/category/platform + i18n 4 语兜底）而非手写 markdown。
4. **用户掌控**：更新永远「用户可见控件触发」（无静默强制重启）；历史版本可在 Settings 自由下载回滚——对齐硬规则 #3「不引入 hidden backend flags，回滚 = 重新发版」。

---

## 2. System Architecture

### 2.1 Architecture Overview

```
                         ┌──────────────────── 单一版本真相 ────────────────────┐
                         │  package.json "version" (semver)  ← bump 脚本同步写三处 │
                         │     ├─ src-tauri/tauri.conf.json "version"             │
                         │     └─ src-tauri/Cargo.toml [package] version          │
                         └───────────────┬──────────────────────────────────────┘
                                         │ Vite define 注入 __APP_VERSION__
                                         │ + scripts 生成 src/generated/release-meta.ts
                                         ▼
        ┌──────────── 构建期（bundle 内） ────────────┐        ┌────────── 运行期 ──────────┐
        │ src/content/changelog/releases/<ver>.ts     │        │ src/lib/app-version.ts     │
        │  （类型化 ChangelogRelease，import.meta.glob）│───────▶│  APP_VERSION / RELEASE_ID  │
        │ release-gate: 缺 <ver>.ts 直接 fail build    │        │ Settings「关于」+ What's New │
        └─────────────────────────────────────────────┘        └────────────────────────────┘

  发版（每个 OS 各跑一次，Makefile 编排）
  ─────────────────────────────────────────────────────────────────────────────────────────
   macOS:  make release-mac   → electron-builder --mac   → MUZERO-<ver>.dmg/.zip + latest-mac.yml
   Windows: make release-win  → electron-builder --win   → MUZERO-<ver>-Setup.exe(+.blockmap) + latest.yml
            make release-linux → electron-builder --linux → MUZERO-<ver>.AppImage/.deb + latest-linux.yml
                                          │
                                          ▼  make release-publish（rclone + 合并脚本）
                          ┌──────────────────────────────────────────────┐
                          │  官方分发 R2（公共读）  assets.mu0.app/desktop/   │
                          │   ├─ latest.yml / latest-mac.yml / latest-linux.yml   ← electron-updater feed（每平台只描述最新）
                          │   ├─ manifest.json              ← 全量版本历史索引（合并式 append，驱动应用内下载）
                          │   └─ <ver>/  MUZERO-<ver>.dmg/.exe/.AppImage(+.blockmap/.sha256)
                          └───────────────┬───────────────────┬──────────┘
                自动更新（Electron 桌面）    │                   │   应用内历史下载（全平台）
                  electron-updater 拉 *.yml ▼                   ▼  getAppFetch() 拉 manifest.json
            6h/启动/手动 check → available → download → quitAndInstall      Settings「版本历史」列表 → 点击下载安装包
            （macOS 未签名 → manual-required → openExternal 下载页）
```

### 2.2 Technology Stack

| 组件 | 技术 | 理由 |
|------|------|------|
| **桌面发布壳** | **Electron**（主力）+ electron-builder 26（已是 devDep） | CLAUDE.md 已定「桌面转向 Electron」；electron-updater 生态成熟、`.blockmap` 差量、generic provider 直连 R2，ClipCombo 已验证。**Tauri 桌面构建保留可跑但不是 desktop 自动更新载体**（见 [§2.3 决策](#23-决策记录--桌面发布载体--electron不是-tauri)） |
| **构建编排** | electron-vite 5（**新增**）或沿用现有 `vite build` + electron-builder | Electron 主进程需要 bundle（排除 node_modules）。推荐引入 electron-vite 对齐 ClipCombo（3-target，把 `electron-updater` inline 进 main）；若不引入，则用 esbuild 单独 bundle `electron/main.cjs`，但需自建「外部依赖」校验 |
| **自动更新** | electron-updater 6（**新增** devDep） | 标配，配 `publish: generic` 指 R2，自动读 `latest*.yml` 比对 `app.getVersion()` |
| **Changelog** | 类型化 TS 数据模块（`src/content/changelog/releases/*.ts`） | 编译期强制 area/category/platform enum + en 必填；零运行时解析；i18n 4 语兜底。**不用** changesets/semantic-release/conventional-changelog（手写内容、脚本只做 bump+scaffold+gate） |
| **R2 上传** | **rclone**（统一传输）+ node 合并脚本（仅 manifest.json 的 JSON munging） | MUZERO 无 wrangler；rclone 对 R2 S3 端点零依赖、能设 `Content-Type`/`Cache-Control`、多段传 dmg/exe，是 best practice。**传输全程 rclone**：产物上传 + manifest 的「拉→改→回传」都走 `rclone copyto`，中间那步合并是纯 JSON 脚本，**不再开第二套 SigV4 凭证路径**（决议 Q3） |
| **版本比较** | 自研 `compareSemver`（**新增** 小工具） | 需支持 prerelease（`0.8.0-beta.1` < `0.8.0`），`localeCompare` 会错排。约 30 行，不引 `semver` 包 |
| **发布元数据** | `scripts/generate-release-meta.mjs`（**新增**） | 生成 `src/generated/release-meta.ts`：`app_version` + `git sha` + `build timestamp` + `shell target`，供 Settings 诊断行 + telemetry build id |

### 2.3 决策记录 — 桌面发布载体 = **Electron**（不是 Tauri）

- **背景**：MUZERO 双壳层并存（[`src/lib/desktop/bridge.ts`](../../../src/lib/desktop/bridge.ts) 抽象 electron/tauri/web）。两个壳都能打桌面包。
- **决策**：**桌面端的「分发 + 自动更新」只走 Electron**。Tauri 的 `make mac/win/linux` 保留为开发/移动用途，**不**接入本 PRD 的 R2 feed / 自动更新。
- **理由**：(a) CLAUDE.md 已明确「因 WebView 不稳定，桌面已转向 Electron」，Electron 是「主力」；(b) 维护**两套更新器**（electron-updater + tauri-updater，各自的 feed 格式 `latest.yml` vs `latest.json`、各自签名体系）成本翻倍、且两壳是**不同 origin/独立 IndexedDB**（切壳不迁移数据，CLAUDE.md 规则 10），同时分发只会让用户困惑「我装的是哪个壳」；(c) electron-builder 的 `.blockmap` 差量 + generic provider 是本 PRD increment update 的核心，Tauri updater 无等价的免签名差量体验。
- **移动端（iOS/Android via Tauri）**：**本 PRD 范围外**——走 App Store / Play Store 各自的分发与更新，不进 R2 feed（见 [§7 Out of Scope](#7-out-of-scope)）。
- **回退**：若未来要让 Tauri 桌面也自动更新，再开独立 PRD 引入 `@tauri-apps/plugin-updater` + 复用同一 R2 桶下 `desktop-tauri/` 前缀，不影响本设计。

### 2.4 决策记录 — 分发 R2 **不违反**本地优先

- **背景**：硬规则 #1「本地优先 = 存储层无后端无云」。新建一个 MUZERO 官方 R2 桶看似引入「云」。
- **决策**：分发 R2 桶**合规**，但必须严格限定为「**只读静态分发**」：只放安装包二进制、`*.yml` 更新 feed、`manifest.json` 版本索引；**永不**写入任何用户数据、无账号、无服务端逻辑、无遥测回传。
- **理由**：规则 #1 约束的是「**用户数据**的持久化」（必须留在 IndexedDB）。应用自身的**安装包分发**是另一回事——它等价于把 app 托管在一个网站、或挂在 GitHub Releases。用户产生的一切（歌单/歌曲/记忆/设置）依旧 100% 在本地 `muzero-db`，依旧无 MUZERO 用户数据后端。分发 CDN ≠ 用户数据后端。
- **凭证纪律**（对齐规则 #2）：分发桶的 S3 写凭证是**维护者自己的基础设施凭证**，只存在构建机 env / CI secret（`MUZERO_RELEASE_R2_*`），**绝不**进 bundle / `.env`(committed) / 日志。这与「用户 BYOK LLM/musicgen key」是两类东西，互不混淆。
- **唯一出站新增**：桌面端运行期会**多一个出站只读请求**——拉 `latest*.yml`（自动更新）与 `manifest.json`（下载列表）。读公共 URL，不带任何凭证、不回传用户信息。走 [`getAppFetch()`](../../../src/lib/platform.ts) → `muzfetch://` 代理（绕 CORS）。

### 2.5 决策记录 — 版本号契约（MUZERO 无后端下的「前后端 + 整体版本」映射）

用户要求「配合**前后端版本号** + **整体版本号**」发版。MUZERO **没有服务端**，所以直接照搬 ClipCombo 的 FE(`clipcombo`) / BE(`clipcombo-api`) 双包模型并不成立。映射如下：

- **整体版本号（唯一真相）= App semver** = [`package.json`](../../../package.json) `version`。这是 changelog 的版本、`app.getVersion()`、注入 bundle 的 `__APP_VERSION__` 的**唯一来源**。bump 脚本负责把它**同步写进** `tauri.conf.json` + `Cargo.toml`（消除当前三处手动同步的漂移风险）。
- **「前后端」在 MUZERO 的真实分界 = 渲染层 vs 原生壳层**：
  - **渲染层变更**（`src/**`，React/Vite bundle）：在 **web/PWA 上刷新即生效**；在桌面端随 app 二进制更新而更新。
  - **原生壳层变更**（`electron/**` 主进程/IPC/`muzfetch`/fs allowlist，或 `src-tauri/**`）：**必须重装桌面二进制**，无法热替换。
  - 这就是 MUZERO 版「前端变了 vs 后端变了 → 发版影响不同」：**渲染层-only 的版本**对 web 用户零摩擦、对桌面用户走自动更新；**触及壳层的版本**对桌面用户意味着一次完整二进制更新。
- **承载「什么内容变了」的字段 = changelog item 的 `platform: "web" | "desktop" | "all"`**（直接标注每条变更影响哪一端）+ manifest 里该 release 的 `platforms` 字典（标注本次发布了哪些平台的新二进制）。
- **构建追踪（与 semver 正交）= `release_id = "YYYYMMDD.HHMMSS+<gitsha>"`**，由 `generate-release-meta.mjs` 生成，仅用于诊断/支持，不参与版本比较。
- **运行期不做「客户端过旧」门控**：本地优先、无服务端协议协商，故不存在 FE-vs-BE 兼容性校验。版本比较只用于 (a) changelog 未读集计算、(b) electron-updater feed 比对。

> 一句话：**整体 = App semver（一处真相，同步三文件）；「前后端」= 渲染层/壳层之分，用 changelog `platform` 标 + manifest `platforms` 标；正交的 release_id 只为追踪。**

### 2.6 决策记录 — 自动更新 = electron-updater，**未签名**，stable（+ 可选 beta）通道

- **更新器**：`electron-updater`，`publish: { provider: generic, url: "https://assets.mu0.app/desktop" }`，`generateUpdatesFilesForAllChannels: true`。check 节奏：启动后 ~5s + 每 6h + 手动。
- **未签名现实**（与 ClipCombo 一致）：暂不做 code signing / notarization。**Win/Linux 未签名仍能 NSIS/AppImage 自动更新**；**macOS 未签名无法静默 Squirrel 应用更新** → 主进程上报 `kind: "manual-required"` + 下载页 URL（`https://mu0.app/download` 或直接 `assets.mu0.app/desktop/`），渲染层提示「有新版本 → 去下载」。
- **通道**：v1 默认只 `stable`（`latest*.yml`）。`beta` 通道**保留完整接口**（feed/`muzero:update:channel`/`compareSemver` prerelease 支持都做），Settings 提供**可见切换控件让用户切到 beta**（决议 Q4），默认 stable——未来推 beta 时零改动开启。
- **回退**：硬规则 #3——不藏 runtime kill switch；回滚 = 发新版本 / 用户从 Settings 历史列表手动下装旧版。通道选择是 Settings 可见控件（持久化 `localStorage["muzero:update:channel"]`），不是 hidden flag。

### 2.7 Project Structure（新增 / 改动）

```
MUZERO/
├── package.json                              # ✏️ version 真相；硬化 build 块(publish/per-OS/extra)；加 release scripts
├── Makefile                                  # ✏️ 新增 release-* / publish / version-bump / changelog-check 目标
├── electron.vite.config.ts                   # 🆕（可选，推荐）3-target；externalize 排除 electron-updater
├── electron/
│   ├── main.cjs                              # ✏️ initDesktopUpdater()；窗口标题去掉 "Probe"；whenReady 接更新器
│   ├── updater.cjs                           # 🆕 electron-updater 编排（check/download/install/channel + IPC 广播）
│   └── preload.cjs                           # ✏️ contextBridge 暴露 window.muzero.update + getAppVersion
├── scripts/
│   ├── bump-version.mjs                       # 🆕 bump semver → 写 package.json + tauri.conf.json + Cargo.toml + scaffold changelog
│   ├── scaffold-changelog.mjs                # 🆕 生成 releases/<ver>.ts 骨架（4 语，en 必填）
│   ├── check-changelog.mjs                   # 🆕 release gate：缺 releases/<当前ver>.ts 直接 exit 1
│   ├── generate-release-meta.mjs             # 🆕 写 src/generated/release-meta.ts（app_version + sha + ts + shell）
│   └── publish-release.mjs                   # 🆕 拉 R2 manifest.json → 合并本平台 release → 回传（rclone/SigV4）
├── src/
│   ├── content/changelog/
│   │   ├── types.ts                          # 🆕 ChangelogRelease/Item + enums
│   │   ├── index.ts                          # 🆕 import.meta.glob 加载 + compareSemver 排序 + latestVersion
│   │   ├── changelog.test.ts                 # 🆕 不变量：版本匹配文件名、newest-first、enum/en 校验
│   │   └── releases/
│   │       ├── 0.1.0.ts … 0.7.0.ts           # 🆕 历史大版本回填（§3.4）+ 本次首发 0.7.0
│   ├── lib/
│   │   ├── app-version.ts                     # 🆕 唯一版本读取点：APP_VERSION / RELEASE_ID
│   │   ├── compare-semver.ts                 # 🆕 prerelease-aware 比较 + test
│   │   ├── changelog-seen.ts                 # 🆕 localStorage lastSeenVersion + 未读集逻辑 + test
│   │   ├── release-manifest-schema.ts        # 🆕 Zod muzero-release-manifest-v1（应用内下载用）
│   │   └── desktop-update.ts                 # 🆕 渲染层 hook：订阅 window.muzero.update 状态
│   ├── generated/release-meta.ts             # 🆕（生成物，git 忽略或提交均可）
│   └── components/settings/
│       ├── settings-nav.ts                    # ✏️ 加 navSecAbout 段 + about / version-history 两项
│       ├── about-settings.tsx                # 🆕 当前版本 + 检查更新 + What's New 入口 + 诊断行
│       └── version-history-settings.tsx      # 🆕 读 manifest.json → 历史版本下载列表
├── src/components/player/                     # ✏️（可选）ChangelogModal「What's New」自动弹窗
├── src/i18n/locales/{en,zh,ja,ko}/common.json # ✏️ settings.navSecAbout / changelog.* / update.* 文案
├── src-tauri/tauri.conf.json                  # ✏️ version 由 bump 脚本写（保持与 package.json 一致）
├── src-tauri/Cargo.toml                       # ✏️ version 由 bump 脚本写
└── vite.config.ts                             # ✏️ define __APP_VERSION__（读 package.json）
```

---

## 3. Data Model Design

> ⚠️ 本 PRD 不动 IndexedDB（`muzero-db`）——发版/changelog/更新状态全是**构建期常量 + localStorage 标记 + 公共静态文件**，零 schema 迁移。

### 3.1 Changelog 数据形状（构建期 bundle，对齐 ClipCombo 但本地化到 MUZERO）

无数据库。Changelog 是**版本控制的类型化 TS 模块**，`src/content/changelog/releases/<version>.ts` 一文件一发布，`import.meta.glob` 构建期 eager 加载。

```typescript
// src/content/changelog/types.ts
export type ChangelogCategory = "highlight" | "feature" | "improvement" | "fix" | "breaking";
export type ChangelogArea =
  | "dj" | "player" | "library" | "sets" | "memory" | "lyrics"
  | "visualizer" | "search" | "streaming" | "sync" | "settings" | "app"; // MUZERO 功能域
export type ChangelogPlatform = "web" | "desktop" | "all";               // §2.5「前后端」标
export type ChangelogLocale = "en" | "zh" | "ja" | "ko";                 // CLAUDE.md §i18n

export interface ChangelogItem {
  area: ChangelogArea;        // 左侧醒目「功能域」chip
  category: ChangelogCategory;// 变更「类型」彩色图标，渲染顺序 highlight→feature→improvement→fix→breaking
  platform: ChangelogPlatform;// 标 desktop-only / web-only
  title: Record<"en", string> & Partial<Record<ChangelogLocale, string>>; // en 必填，其余兜底 en
  description?: Partial<Record<ChangelogLocale, string>>;
}

export interface ChangelogRelease {
  version: string;            // semver，必须 === 文件名 + 发布 commit 时的 package.json
  date: string;               // YYYY-MM-DD
  title: Partial<Record<ChangelogLocale, string>>;
  summary?: Partial<Record<ChangelogLocale, string>>;
  items: ChangelogItem[];
}
```

```typescript
// src/content/changelog/index.ts
import { compareSemver } from "@/lib/compare-semver";
const modules = import.meta.glob<ChangelogRelease>("./releases/*.ts", { eager: true, import: "default" });
export const changelog = Object.values(modules).sort((a, b) => compareSemver(b.version, a.version)); // 新→旧
export const latestVersion = changelog[0]?.version ?? "0.0.0";
```

> **为什么类型化 TS 而非 markdown frontmatter**（ClipCombo 同款决策）：类型系统强制每条 item 有合法 area/category/platform + 非空 en title，零运行时解析、零手写 parser。per-release 文案就地放在模块里（release-specific，不进共享 `common.json` catalog）；UI chrome 文案（chip 标签、按钮）走 `common.json` 的 `changelog.*` namespace（4 语）。

### 3.2 localStorage 状态（已读标记，无隐藏行为门控）

沿用 MUZERO 既有 `muzero:` / `muzero-*` 前缀习惯（如 `muzero-locale`）：

| Key | Value | 用途 |
|-----|-------|------|
| `muzero:changelog:lastSeenVersion` | semver 串，如 `"0.7.0"` | 用户已确认的最高版本，驱动未读集 |
| `muzero:changelog:lastShownAt` | ISO 时间戳 | 调试：上次自动弹窗时间 |
| `muzero:update:channel` | `"stable" \| "beta"` | 桌面专属，可见 Settings 控件；映射 `latest.yml`/`beta.yml`（v1 仅 stable） |

全部 try/catch 包裹（隐私模式/壳层差异安全）。**只记录「用户看过什么」，绝不门控功能**——对齐硬规则 #3。

### 3.3 版本比较 + 未读集逻辑

```
latestVersion   = changelog[0].version                       (构建期常量，无网络)
lastSeenVersion = localStorage["muzero:changelog:lastSeenVersion"]  (可能 null)

首次安装 (lastSeenVersion == null):
    → 写入 latestVersion，**不**自动弹窗（新装不该被历史积压糊一脸）
回访 (lastSeenVersion < latestVersion):
    unseen = changelog.filter(r => compareSemver(r.version, lastSeenVersion) > 0)
    → 自动弹窗，按 release 分组（新→旧）展示全部未读
手动打开 (Settings「What's new」):
    → 展示最新/全量历史，无视已读
关闭/确认时:
    → 写 latestVersion 进 localStorage
```

`compareSemver` **必须**是真 semver 比较（支持 prerelease：`0.8.0-beta.1` 排在 `0.8.0` 之下），不用 `localeCompare`。

### 3.4 历史大版本回填（用户要求 #2：回顾 commit 历史，整理成几个大版本）

至今 461 commits 全在 6 天内（2026-06-06 ~ 06-11），**从未真实发布**。为让首发版本带着一段「成长故事」而非单墙糊脸，将历史**策展回填**为 7 个大版本（curated retrospective，非真实曾发布；首个**真实发布**版本是 `0.7.0`，含本发版流水线本身）：

| 版本 | 主题 | 日期 | 代表性 commit 群（功能簇） |
|------|------|------|------|
| **0.1.0** | 地基 — AI DJ 续歌 + 播放器壳 + 数据模型 | 06-06/07 | scaffold；cloud musicgen 预设(ACE-Step/Mureka, BYOK 成本提示)；混合视频/上传集 + 注释 + i18n + theming；PlayerDock 三行壳 + 扁平 nav + view-transition；移动全屏 Now Playing；Set/PlayQueue/Memory 数据模型(v2→v3→v4)；歌单 Gallery 两级；多文件粘贴 ingest；快捷键 P1-2；可视化 registry + canvas 频谱；幻灯片设置；Set 详情(建/传/编)；歌曲记忆数据层 |
| **0.2.0** | AI DJ Chat Agent | 06-07 | chat runtime 基座 / shell surfaces / DJ tool core；session branching；LLM provider 预设；context budget；queued prompt runtime；brief proposal tool；tool approvals；model picker / session home |
| **0.3.0** | 记忆瞬间 & Now Playing 沉浸 | 06-08 | sticky note 瀑布 / masonry；记忆 rail / 折叠记忆时间线；swipeable now-playing stage + 封面过渡；从记忆照片设封面；记忆 composer 粘贴/键盘流 |
| **0.4.0** | R2 云盘同步 & 播放统计 | 06-09 | R2 manifest 协议 + 公共 preview；远端搜索目录 / 远端集流媒体 / 缓存远端媒体；云盘 registry + 健康检查 + wizard；R2 publish/pull diff；播放统计 + 设备 registry + presence；冲突解决 + set mutation 合并；媒体元数据导入导出 |
| **0.5.0** | 库实体、转写搜索 & 可配置快捷键 | 06-10 | 专辑/歌手实体(派生/浏览/交叉链接/faceted 搜索/统计)；entity cover 同步；多语转写搜索(pinyin/kana/romaji + worker)；可配置快捷键(registry + recorder + rebinding)；Settings 两栏 master-detail |
| **0.6.0** | 外部流媒体源 & 同步/富歌词 | 06-10/11 | 外部源(网易云/B 站/YouTube) + 登录(cookie 捕获 / QR 登录)；同步歌词(LRCLIB + Apple-Music 风格显示)；富歌词(LRC/elrc/yrc/qrc/TTML 逐字卡拉 OK + 翻译/罗马音)；流媒体离线缓存 |
| **0.7.0** | 沉浸流光、平滑滚动、拖拽排序 **& 本发版流水线** | 06-11 | 封面取色流光背景(14 色 color4bg 自研)；Lenis 平滑滚动；歌单内多选拖拽排序(分数序 + R2 同步)；歌词/可视化打磨；**+ 本 PRD：版本契约 / changelog / 多平台构建 / R2 分发 / 应用内下载** |

> 实施时每个 `releases/<ver>.ts` 用 3~6 条精炼 item（不逐 commit 罗列），**4 语全量回填**（en/zh/ja/ko，决议 Q6 — 不留 pending translation）。日期取该簇最后一个 commit 日。

### 3.5 应用分发 manifest.json（用户要求 #4：合理版本机制 + 全量版本历史）

**这是 ClipCombo 没有、MUZERO 新增的关键件**。ClipCombo 仅靠 electron-updater 的 `latest*.yml`（每平台**只描述最新**一版），无法驱动「应用内列出**所有**历史版本下载」。故 MUZERO 在 R2 同时维护一个**自有版本索引** `manifest.json`：

```typescript
// src/lib/release-manifest-schema.ts （Zod，对齐 src/sync 既有 manifest 风格）
const releaseAsset = z.object({
  file: z.string(),          // 相对 key，如 "0.7.0/MUZERO-0.7.0-arm64.dmg"
  url: z.string().url(),     // 绝对下载 URL（RELEASE_BASE_URL + key）
  size: z.number().int(),    // 字节
  sha256: z.string(),        // 完整性校验（复用 r2-s3.ts 的 sha256Hex）
});
const releaseEntry = z.object({
  version: z.string(),
  date: z.string(),                       // YYYY-MM-DD
  channel: z.enum(["stable", "beta"]).default("stable"),
  notesRef: z.string(),                   // → changelog releases/<ver>.ts 的 version key
  platforms: z.record(
    z.enum(["mac-arm64","mac-x64","win-x64","linux-x64-appimage","linux-x64-deb"]),
    releaseAsset,
  ),
});
export const releaseManifestSchema = z.object({
  schema: z.literal("muzero-release-manifest-v1"), // codename 层稳定（规则 #4）
  productName: z.literal("MUZERO"),
  latest: z.string(),                     // stable 最新版
  latestBeta: z.string().optional(),
  updatedAt: z.string(),                  // ISO
  releases: z.array(releaseEntry),        // 新→旧
});
```

**合并式上传（关键）**：因为**每个 OS 各自独立发布**（mac 在 Mac 上、win/linux 在 Windows 上），manifest 不能整体覆盖——否则后跑的平台会冲掉先跑平台的资产。`publish-release.mjs` 必须：**拉现存 `manifest.json` → 找/建本 `version` 的 entry → 把本平台的 asset 合并进 `entry.platforms[<plat>]`（其他平台保留）→ 重排 releases + 更新 `latest`/`updatedAt` → 回传**。这与 MUZERO 用户库同步已有的「per-track 加性合并」纪律同源（[`r2-publish.ts`](../../../src/sync/r2-publish.ts) 的加性 merge 思路），不是新发明。

> `manifest.json` 与 `latest*.yml` **职责分离**：`*.yml` = electron-updater 的「最新版自动更新」机器协议（不要手改）；`manifest.json` = MUZERO 自有的「全量历史 + 多平台下载」人/UI 协议（驱动 Settings 下载列表）。二者都上传、都 `no-cache`。

---

## 4. API / Integration Design

MUZERO 本地优先，**无新增 HTTP API**。「接口」是 (a) 桌面更新 IPC 契约、(b) 静态 R2 feed/manifest、(c) Makefile 发布命令。

### 4.1 桌面更新 IPC 契约（Phase 5，`contextBridge` 暴露，无 nodeIntegration）

| Channel | 方向 | 用途 |
|---------|------|------|
| `muzero:update:status` | main → renderer（广播） | `{ kind: "idle"\|"checking"\|"available"\|"downloading"\|"downloaded"\|"manual-required"\|"error", version?, percent?, error?, downloadUrl? }` |
| `muzero:update:check` | renderer → main（invoke） | Settings「检查更新」手动触发，返回最新状态 |
| `muzero:update:install` | renderer → main（invoke） | 用户接受（Win/Linux）：`autoUpdater.quitAndInstall(true, true)`；macOS：`shell.openExternal(下载页)` |
| `muzero:update:setChannel` | renderer → main（invoke） | `"stable"\|"beta"`，持久化 + `allowDowngrade`（beta→stable）+ 重新 check（v1 可省） |
| `muzero:app:getVersion` | renderer → main（invoke） | 暴露 `app.getVersion()` 给渲染层（桌面权威版本号） |

check 节奏：启动后 ~5s + 每 6h + 手动。更新安装**永远用户可见控件触发**（无静默强制重启）。**macOS 未签名**：主进程 `kind:"manual-required"` + `downloadUrl`，渲染层提示去下载页，不试 `quitAndInstall`。

### 4.2 R2 分发布局（Phase 4）

electron-builder `publish: { provider: generic, url: "https://assets.mu0.app/desktop" }` + `generateUpdatesFilesForAllChannels: true`。R2 桶（MUZERO 官方、公共读，绑 `assets.mu0.app`）：

```
https://assets.mu0.app/desktop/
├── manifest.json                              # 全量版本索引（muzero-release-manifest-v1，驱动应用内下载）
├── latest.yml / latest-mac.yml / latest-linux.yml   # electron-updater stable feed
├── (beta.yml / beta-mac.yml / beta-linux.yml)        # 可选 beta 通道
└── <version>/
    ├── MUZERO-<version>-arm64.dmg / -x64.dmg / .zip   # macOS（未签名→手动下载）
    ├── MUZERO-<version>-Setup.exe + .blockmap         # Windows NSIS（.blockmap 差量）
    └── MUZERO-<version>.AppImage / .deb (+ .blockmap)  # Linux
```

**Cache-Control 纪律**（关键，照搬 ClipCombo）：
- `*.yml` / `manifest.json` → `Cache-Control: no-cache, max-age=0, must-revalidate`（客户端必须每次见到新版本）。
- 安装包二进制 → `Cache-Control: public, max-age=31536000, immutable`。

`.blockmap` 给 Win/Linux **差量下载**（只拉变化块，块差异时回退全量）。macOS 资产仅供**手动下载**（未签名）。

### 4.3 Makefile 发布命令（用户要求 #3 + #4）

新增目标（具体配方见 [§6 Phase 4](#phase-4-makefile-多平台发布--r2-分发--manifestjson-版本索引)）：

| 目标 | 平台门控 | 作用 |
|------|---------|------|
| `make version-bump TYPE=major\|minor\|patch\|beta` | 任意 | bump semver → 同步写三文件 → scaffold `releases/<ver>.ts` → 生成 release-meta |
| `make changelog-check` | 任意 | release gate：缺 `releases/<当前ver>.ts` → exit 1（被所有 release 目标依赖） |
| `make release-mac` | **硬门控 Darwin** | `changelog-check` → electron-vite build → `electron-builder --mac`（dmg/zip + latest-mac.yml） |
| `make release-win` | Windows（或带 Wine 的 Linux，警告） | `electron-builder --win`（nsis + .blockmap + latest.yml） |
| `make release-linux` | Linux（维护者在 Windows 机的 **WSL2** 里跑，见 §10 Q1） | `electron-builder --linux`（AppImage/deb + latest-linux.yml） |
| `make release-publish` | 任意（需 rclone + R2 凭证） | 上传 `release/*` 到 R2（按扩展名设 content-type/cache-control）+ **合并** manifest.json |
| `make release-locate` | 任意 | 列出 electron-builder `release/` 产物（补现 `desktop-locate` 只看 Tauri 的缺口） |

**多平台流程**（用户场景：macOS + Windows 两台机）：
```
# 一次性（任意机）：定版 + 写 changelog 内容 + 提交
make version-bump TYPE=minor      # 0.7.0 → 0.8.0，三文件同步，scaffold 0.8.0.ts
$EDITOR src/content/changelog/releases/0.8.0.ts   # 手写本版 item
git commit -am "release: 0.8.0"   # package.json + tauri.conf + Cargo + changelog 同一提交

# macOS 机：
make release-mac && make release-publish

# Windows 机（同一 commit）：
make release-win && make release-publish          # Windows 原生
# 同机的 WSL2 里（当 Linux 环境）：
make release-linux && make release-publish
```
因 feed 是**每平台独立**（`latest.yml` vs `latest-mac.yml` vs `latest-linux.yml`，互不碰），且 manifest 是**加性合并**，各平台在各自机器上 publish 会**渐进填满**同一个 R2 `desktop/` 前缀，无需汇总步骤。

### 4.4 错误处理 & 遥测白名单

- **更新错误**（网络/校验/磁盘）→ `status.kind="error"`，Settings 可关闭提示，绝不硬崩；下个周期自动重试。
- **遥测**：MUZERO 本地优先**默认无遥测**（CLAUDE.md 规则 1）。若未来加，白名单**只**允许：`changelog_shown(reason, from, to, unseen_count)` / `changelog_dismissed` / `update_checked` / `update_downloaded` / `update_installed` / `update_error(code)`。**永不**上报 changelog 文案、用户媒体文件名/路径/字节、歌单内容、API key。

---

## 5. Frontend Design

### 5.1 页面结构 / 组件

```
src/components/settings/
├── settings-nav.ts            # ✏️ SETTINGS_NAV 加一段：
│                              #    { labelKey: "settings.navSecAbout", items: [
│                              #       { id: "about",           labelKey: "settings.navAbout" },
│                              #       { id: "version-history", labelKey: "settings.navVersionHistory" } ] }
├── about-settings.tsx         # 🆕 activeItem === "about"
│     • 当前版本（APP_VERSION）+ 通道 + RELEASE_ID（诊断行，可复制）
│     • 「检查更新」按钮（桌面：调 muzero:update:check；web：隐藏/灰）
│     • 更新状态条（available/downloading%/downloaded→重启安装 / manual-required→去下载 / error）
│     • 「查看更新日志 What's New」→ 派发 CHANGELOG_OPEN 事件
└── version-history-settings.tsx  # 🆕 activeItem === "version-history"
      • useReleaseManifest()：getAppFetch(manifest.json) → Zod 校验 → releases[]
      • 每行：version + date + 该版 changelog summary + 按当前 OS/arch 高亮的下载按钮
      • 展开看全部平台资产（dmg/exe/AppImage + size + sha256 复制）
      • 加载/错误/空态（manifest 拉取失败 → 提示 + 重试）
```

`settings-page.tsx` 按既有 `{activeItem === "x" && <Panel/>}` 模式接两个新分支——与 [`flow-settings.tsx`](../../../src/components/settings/flow-settings.tsx) 等既有 per-panel 组件同构，**不**内联进巨型 page。

### 5.2 What's New 弹窗（可选但推荐，对齐 ClipCombo）

`src/components/player/changelog-modal.tsx`（或挂在 App 壳）：mount 时按 [§3.3](#33-版本比较--未读集逻辑) 判断未读集自动弹（分组、新→旧）；监听 `CHANGELOG_OPEN` 事件供 Settings 手动唤起。每条 item 渲染：彩色 category 图标（Sparkles/Plus/ArrowUpCircle/Wrench/TriangleAlert）+ 醒目 area chip + 本地化 title/description + `(web)`/`(desktop)` 平台标。i18n 走 `t("changelog.area.*")`/`t("changelog.category.*")` + en 兜底。**Web 与桌面共用**（桌面更新后重启 → 同样 mount 逻辑触发）。

### 5.3 状态管理

- **版本/changelog 数据**：构建期常量（`import.meta.glob` + `__APP_VERSION__`），无 store、无网络。
- **已读标记**：`localStorage`（[§3.2](#32-localstorage-状态已读标记无隐藏行为门控)），轻量 helper，try/catch。
- **桌面更新状态**：[`desktop-update.ts`](../../../src/lib/desktop/) hook 订阅 `window.muzero.update.onStatus`，组件最小 selector 消费（对齐规则 #6，不整 store 订阅）。web 上 `window.muzero` 为 undefined → hook 返回 `{ kind: "idle", supported: false }`，UI 自然降级。
- **manifest 拉取**：TanStack Query（`useQuery(['release-manifest'], …)`）——请求式异步、缓存、错误/重试态，正合 CLAUDE.md「TanStack Query 管请求式异步」定位。

---

## 6. Implementation Plan

### Phase 1: 版本号单一真相 + 注入 + 显示

**Goal:** 消灭三处手动同步的版本漂移；版本注入 bundle、运行期单点读取、Settings 可见。

**Tasks:**
- [x] `scripts/bump-version.mjs` + `make version-bump TYPE=…`：读 `package.json.version` → `nextVersion`（含 `beta` 次版 prerelease）→ 写 `package.json` + `src-tauri/tauri.conf.json` + `src-tauri/Cargo.toml` 三处（`--dry-run` 可预演；不 commit，提示同提交）。✅ 6 测（pure `nextVersion` + dry-run 集成）+ 实跑 write→revert 验证三文件齐改。`scaffold-changelog` 钩子留 Phase 2 接（release-meta 已按上条简化掉）。
- [x] **release-meta（简化决定）**：不再生成 `src/generated/release-meta.ts`，改为 `vite.config.ts` + `vitest.config.ts` 的 `define` 直接注入 `__APP_VERSION__`/`__GIT_SHA__`/`__BUILD_TIME__`（config 求值期读 package.json + `git rev-parse`，try/catch 兜底），消除生成物 churn 与「测试期文件不存在」问题。✅
- [x] `vite.config.ts` + `vitest.config.ts` 加 `define` + `src/vite-env.d.ts` 声明三个 `__*__` global。✅
- [x] `src/lib/app-version.ts`：`export const APP_VERSION = __APP_VERSION__` + `GIT_SHA`/`BUILD_TIME`/派生 `RELEASE_ID`（唯一读取点，注释「别处不许硬写版本」）。✅ 3 测（APP_VERSION===package.json version）。
- [x] `src/lib/compare-semver.ts` + test（prerelease 排序）。✅ `parseSemver`/`compareSemver`/`isNewerVersion`，遵 semver §11 precedence，12 测全绿。
- [→] **移至 Phase 5**：`electron/preload.cjs` 暴露 `getAppVersion` + `about-settings.tsx` 显示版本/release-id。理由：preload `getAppVersion` 与 Phase 5 的 update IPC 同在一个 preload bridge；about 面板与 Phase 5 的「版本历史」侧栏同属新 `navSecAbout` 段 + 同套 i18n key——一次建好不返工。Phase 1 收口为「版本真相 + 注入 + 比较」纯地基（全单测覆盖），UI 显示随 Phase 5 落地。

### Phase 1 Checklist
- [x] `make version-bump TYPE=patch` 后三文件版本一致，可 `git diff` 验证 ✅（0.1.0→0.1.1 三文件齐改，已 revert）
- [x] bundle 内 `APP_VERSION` 正确（`define` 注入，app-version.test.ts 证 `APP_VERSION===package.json version`；`pnpm build` 全量构建暂被 base 的既有 tsc 错误挡住，与本改动无关）；🔲 Settings 显示当前版本（Phase 1 末 about-settings 雏形）
- [x] `compareSemver` 单测覆盖 release/prerelease/相等 ✅

### Phase 2: Changelog 规范 + 数据模型 + 历史回填 + What's New

**Goal:** 落地 changelog 规范（用户要求 #1）+ 回填历史大版本（用户要求 #2）+ 可视化。

**Tasks:**
- [x] `src/content/changelog/{types.ts,index.ts}` + `changelog.test.ts`（不变量）。✅ 类型化模型（area/category/platform/locale enums + `localize` en 兜底）+ glob loader（compareSemver 新→旧）+ 9 不变量测。
- [x] `scripts/scaffold-changelog.mjs`（4 语骨架，en 必填）+ `scripts/check-changelog.mjs`（release gate，`--version` 可覆盖）。✅ 接进 `bump-version`（bump 后自动 scaffold）+ `make changelog-check`。
- [x] 回填 `releases/0.1.0.ts … 0.7.0.ts`（[§3.4](#34-历史大版本回填用户要求-2回顾-commit-历史整理成几个大版本)，每版 4~5 条 item，**en/zh/ja/ko 全量**，决议 Q6）。✅ 7 文件，4 语全量（测强制每条 title+description 四语非空）。
- [x] `src/lib/changelog-seen.ts` + test（未读集 + 首装不弹）。✅ `resolveChangelogAutoOpen`（首装 seed 不弹 / 回访按 compareSemver 取未读 / 已读不弹）+ localStorage 安全读写，7 测。
- [x] `changelog-modal.tsx`（自动弹 + `openChangelog()` 事件唤起）+ `common.json` 4 语加 `changelog.*` chrome 文案 + 挂进 `App.tsx`。✅ category 图标 + area chip + platform 标 + 按 category 顺序；5 render 测（未读自动弹 / 已读不弹 / 首装 seed / 全史事件 / Got it 确认）；i18n 4 语 minimal-insert 不碰用户 WIP 区。
- [→] `about-settings.tsx` 接「查看更新日志」入口（随 Phase 5 about 面板一起建，调 `openChangelog()`）。

### Phase 2 Checklist
- [x] changelog 按 semver 新→旧加载，`latestVersion === 0.7.0` ✅
- [x] 回填 7 版均通过 `changelog.test.ts`（版本=文件名、enum 合法、4 语非空）✅
- [x] 改 `lastSeenVersion` 能复现「未读自动弹」；首装不弹 ✅（changelog-seen.test）
- [x] `make changelog-check` 在缺当前版文件时 exit 1 ✅（gate test：缺 0.0.999 → 非零；present → 0）

### Phase 3: Electron 发布打包硬化

**Goal:** 让 Electron 成为可分发、可自动更新的 desktop 载体。

**Tasks:**
- [x] **选 esbuild bundle 路线**（不引 electron.vite）：`scripts/build-electron-main.mjs` 用 esbuild 把 `electron/main.cjs` + `preload.cjs` 打成 `dist-electron/`（`external: ["electron"]`，inline 一切 npm 依赖含 P5 的 electron-updater）。`main.cjs` 无外部 npm 依赖时输出仍含本地 require inline；`dist-electron/` 与 `dist/` 同级，保持 `../dist` + `./preload.cjs` 相对路径。✅ + 「外部 bare-require 校验」测（leak 任何非 electron/node 包即 fail——即 ClipCombo 的 verify-externals 守卫）。
- [x] 硬化 `package.json` `build` 块：`publish: { provider: generic, url: "https://assets.mu0.app/desktop" }` + `generateUpdatesFilesForAllChannels: true` + `compression: maximum` + **排除 node_modules**（renderer 已进 dist/、main 已 bundle，最大体积杠杆）；统一 `appId: "app.mu0.muzero"`（决议 Q5，**同步改 `src-tauri/tauri.conf.json` identifier**）；`executableName: muzero`；mac `[dmg,zip]×[arm64,x64]`（updater 需 zip）+ icon、win `nsis×x64` + icon + nsis 选项、linux `AppImage,deb` + icon。✅
- [x] `electron/main.cjs`：窗口标题 `"MUZERO Electron Probe"` → `"MUZERO"`；`main` 字段 → `dist-electron/main.cjs`；`electron:build` script = `vite build && bundle main && electron-builder`。（`initDesktopUpdater()` 在 Phase 5 接）✅
- [x] 图标复用 `src-tauri/icons/{icon.icns,icon.ico,icon.png}`（无需新建 build/）。✅
- [x] devDep 加 `electron-updater`（^6.8.9，bundle 时 inline）。✅ `dist-electron/` + `release/` 进 .gitignore。

### Phase 3 Checklist
- [~] `make release-mac`（Mac 上）产出可启动 `.dmg` + `latest-mac.yml` — release-mac 目标在 Phase 4 加；本阶段先跑 `electron-builder --mac --dir` 验证配置（见提交说明）
- [x] 打包后 app 标题/图标/版本正确，无 "Probe" 残留 ✅（标题改 MUZERO，icon 指向 icns/ico/png）
- [x] bundle 内无 `node_modules` 残留导致的 `ERR_MODULE_NOT_FOUND`（外部依赖校验通过）✅（externals 守卫测：只允许 electron + node: + 相对）

### Phase 4: Makefile 多平台发布 + R2 分发 + manifest.json 版本索引

**Goal:** 一条 `make` 链路多平台构建 + 同步发布 R2 + 维护全量版本历史（用户要求 #3 + #4）。

**Tasks:**
- [x] Makefile 新增 vars（决议 Q2/Q3）：`RELEASE_R2_BUCKET` / `RELEASE_R2_PREFIX ?= desktop` / `RELEASE_BASE_URL ?= https://assets.mu0.app/desktop` / `RELEASE_RCLONE_REMOTE ?= r2:` / `RELEASE_CHANNEL ?= stable`（`export` 给脚本）。✅
- [x] `make release-mac/win/linux`（共享 `release-build` = changelog-check + vite build + bundle main，无 tsc；per-OS 门控：mac 硬门控 Darwin；win 警告 Darwin；linux WSL2）。✅ + `release-locate` 列 `release/` 产物。
- [x] `make release-publish` / `release-publish-dry`：调 `publish-release.mjs`（rclone 守卫）。✅ 上传逻辑在脚本内（按扩展名设 content-type/cache-control：`*.yml`→`text/yaml`+no-cache、`manifest.json`→`application/json`+no-cache、二进制→`octet-stream`+immutable）。
- [x] `scripts/publish-release.mjs`：`scanArtifacts` 算 `sha256`/`size` + `platformKeyFor` 映射 → **拉现存 `manifest.json`** → `mergeRelease` 加性合并本平台 asset 进 `releases[version].platforms[<plat>]`（保留其他平台）→ 更新 `latest`/`latestBeta`/`updatedAt` + newest-first 排序 → 回传。✅ 6 测（含「第二个 OS 不覆盖第一个」加性不变量 + dry-run 真 sha256，跳过 .blockmap/.yml）。
- [x] `src/lib/release-manifest-schema.ts`（Zod `muzero-release-manifest-v1`，`z.partialRecord` 平台键）+ 4 测。✅
- [→] 文档化：R2 桶创建 + 公共读 + CORS + 自定义域 — 留作部署 runbook（见提交说明的运维清单）。

### Phase 4 Checklist
- [x] 加性合并不互相覆盖：`mergeRelease` 单测证「同 version 第二平台并入不冲掉第一平台」✅（待真机 mac+win 端到端复验）
- [x] `*.yml` / `manifest.json` → `no-cache`；二进制 → `immutable`（脚本按扩展名设头）✅
- [x] manifest.json 形状由 `releaseManifestSchema` 把关；`sha256` 由 `scanArtifacts` 真算（dry-run 测断言 64-hex）✅

### Phase 5: 自动更新 + Settings 历史版本下载侧栏

**Goal:** 桌面端自动收到更新（用户要求落地）+ 全平台应用内历史下载（用户要求 #5）。

**Tasks:**
- [ ] `electron/updater.cjs`：`autoUpdater` 配置（autoDownload、6h+启动+手动 check）、`updaterSupported()`（`app.isPackaged && !isMac`）、macOS `manual-required` 分支、状态广播 `muzero:update:status`、`install`/`setChannel` IPC。
- [ ] `electron/preload.cjs` 暴露 `window.muzero.update.{onStatus,check,install,setChannel}`。
- [ ] `src/lib/desktop/desktop-update.ts` hook（订阅 + web 降级 `supported:false`）。
- [ ] `about-settings.tsx`：检查更新按钮 + 状态条 + 通道（可选）。
- [ ] `version-history-settings.tsx`：`useReleaseManifest()`（TanStack Query + getAppFetch + Zod）→ 历史列表 + 按当前平台高亮下载 + 展开全平台资产 + 加载/错误/空态。
- [ ] `settings-nav.ts` 加 `navSecAbout` 段两项；`settings-page.tsx` 接分支；`settings-nav.test.ts` 更新。
- [ ] `common.json` 4 语加 `settings.navSecAbout/navAbout/navVersionHistory` + `update.*` + 下载相关文案。

### Phase 5 Checklist
- [ ] 桌面端（打包态）启动后能 check 到 R2 更高版本 → 显示 available；Win/Linux 可下载并 `quitAndInstall`
- [ ] macOS 收到 `manual-required` → 点按打开下载页
- [ ] Settings「版本历史」列出 manifest 全部版本，点击下载对应平台安装包（桌面经 muzfetch / web 直链）
- [ ] web 上更新区灰掉/隐藏，下载列表仍可用

---

## 7. Out of Scope

- **代码签名 / 公证**（macOS notarization、Windows Authenticode）：v1 明确未签名（与 ClipCombo 一致）。macOS 因此走手动下载更新。**后续单独 PRD**（拿到证书后开 mac 静默更新）。
- **Tauri 桌面自动更新**：保留 Tauri 可跑/移动用途，但**不**接 R2 feed（[§2.3](#23-决策记录--桌面发布载体--electron不是-tauri)）。
- **移动端（iOS/Android）分发**：走 App Store / Play Store，不在本 R2 流水线内。
- **CI/CD 自动化**（GitHub Actions matrix 自动构建三平台）：本期是**本地 `make` 手动多机**；CI 是后续增强（仓库当前无 `.github/workflows/`）。
- **PWA / web 的 service-worker 更新提示**：web 刷新即拿新 bundle，本期不做 SW 更新 UX。
- **beta 通道完整体验**：留接口（feed/通道字段/`compareSemver` 支持 prerelease），但 v1 默认仅 stable。
- **增量更新「服务端打 patch」/ 自研差量**：直接用 electron-builder `.blockmap`，不自研。
- **IndexedDB schema 变更**：本 PRD 零迁移。

---

## 8. Security & Operational Considerations

- **凭证纪律（规则 #2）**：分发 R2 桶的 S3 写凭证（`MUZERO_RELEASE_R2_*`）= 维护者基础设施凭证，**只**在构建机 env / CI secret，绝不进 bundle/`.env`(committed)/日志/前端。与用户 BYOK key 两条线。运行期前端拉 manifest/feed 是**无凭证公共读**。
- **完整性**：每个安装包发布时算 `sha256` 写入 `manifest.json`；下载页展示供用户核对。`.blockmap`/electron-updater 自带 sha512 校验。**未签名**是已知风险，UI 不假装已签名；macOS Gatekeeper 提示如实告知用户「右键打开」。
- **无隐藏行为门控（规则 #3）**：更新通道、自动检查都是 Settings 可见控件；回滚 = 发新版本 / 用户手动下旧版，不藏 kill switch。
- **codename 层稳定（规则 #4）**：`manifest.json` 的 `schema: "muzero-release-manifest-v1"`、`appId`、id 前缀跨发布不变。**统一 `appId = "app.mu0.muzero"`**（决议 Q5，`mu0.app` 反向 DNS + 产品名），Electron `build.appId` 与 Tauri `identifier` 同步改为此值并记入 CLAUDE.md codename 层（消除当前 `com.doodlekuma.muzero` vs `com.muzero.app` 不一致）。注意：改 `appId` 会改 macOS userData 路径——因尚无已发布版本、无存量用户，现在统一零迁移成本。
- **出站收口（规则 #5/#10）**：渲染层拉 manifest/feed 一律 `getAppFetch()` → `muzfetch://` 代理，不直接 `window.fetch` 外部。
- **更新永不打断创作**：无静默强制重启；下载完成只提示，安装由用户点。
- **隐私**：无遥测默认；若加，严格白名单（[§4.4](#44-错误处理--遥测白名单)），永不上报用户内容。

---

## 9. Related Documents & Reference Patterns

- **参考实现**：[ClipCombo `20260531-clipcombo-changelog-and-desktop-release-prd`](../../../../doodlekuma.com/docs/prd/clip-prd/20260531-clipcombo-changelog-and-desktop-release-prd/20260531-clipcombo-changelog-and-desktop-release-prd.md) — 本 PRD 的范式来源（electron-vite + electron-builder + electron-updater + generic R2 feed + 类型化 changelog + FE/BE 版本契约 + bump/scaffold/gate 脚本 + What's New 弹窗）。
- **R2 同步范式复用**：[`20260609-muzero-r2-cloud-drive-sync-prd`](../20260609-muzero-r2-cloud-drive-sync-prd/) — 加性合并、Zod manifest、SigV4（[`src/sync/r2-s3.ts`](../../../src/sync/r2-s3.ts)、[`r2-manifest-schema.ts`](../../../src/sync/r2-manifest-schema.ts)）；**注意区分用户库 R2 ≠ 分发 R2**。
- **Settings IA**：[`20260609-muzero-settings-cloud-drive-ux-prd`](../20260609-muzero-settings-cloud-drive-ux-prd/) — 两栏 master-detail + 配置驱动 `SETTINGS_NAV`（新「关于/版本」段的插入点）。
- **桌面壳层**：CLAUDE.md 规则 9/10 + [`src/lib/desktop/`](../../../src/lib/desktop/bridge.ts)、[`electron/`](../../../electron/main.cjs)。
- **i18n**：CLAUDE.md §i18n + [`src/i18n/locales/en/common.json`](../../../src/i18n/locales/en/common.json)（en 类型源，`settings.*` flat key 习惯）。

---

## 10. Resolved Decisions（原 Open Questions，2026-06-11 全部拍板）

| # | 问题 | ✅ 决议 |
|---|------|--------|
| **Q1** | 「在 Windows 上编译 linux 和 win」可行性（electron-builder 不原生支持在 Windows 上构建 Linux AppImage）。 | **确认可行**：维护者在 Windows 机上本就用 **WSL2** 工作 → Win 目标在 Windows 原生构建、Linux 目标在 WSL2（当 Linux 环境）构建。`make release-linux` 在 WSL2 里跑即可，无需 Docker。 |
| **Q2** | 分发 R2 桶用自定义域还是 `r2.dev`？ | **自定义域**：主域名 `mu0.app`，分发用 subdomain **`assets.mu0.app`**（绑 R2 公共桶）。`RELEASE_BASE_URL = https://assets.mu0.app/desktop`。 |
| **Q3** | manifest 合并 / 上传走 rclone 还是 SigV4？ | **统一 rclone**（best practice）：产物上传 + manifest「拉→改→回传」全程 `rclone copyto`，中间合并是纯 JSON node 脚本，不开第二套凭证路径。 |
| **Q4** | 本期是否上 beta 通道？ | **保留完整接口**（feed/IPC channel/prerelease 比较都做）+ **Settings 可见切换控件**，默认 stable；未来推 beta 零改动开启。 |
| **Q5** | 统一 `appId` 选哪个？ | **`app.mu0.muzero`**（`mu0.app` 反向 DNS + 产品名；`muzero.app` 域名买不到，故以 `mu0.app` 为准）。Electron `build.appId` 与 Tauri `identifier` 同步改、记入 CLAUDE.md codename 层。 |
| **Q6** | changelog 历史回填的 ja/ko 是否本期补齐？ | **4 语全量回填**（en/zh/ja/ko），不留 pending translation。 |

---

## 11. Document Change Log

| Date | Author | Change |
|------|--------|--------|
| 2026-06-11 | DoodleBear / Product | 初稿（Draft）。调研 ClipCombo 发版/changelog/R2 架构，适配 MUZERO 双壳层 + 无后端 + manifest 全量历史 + 应用内下载场景。 |
| 2026-06-11 | DoodleBear / Product | Q1-Q6 全部拍板（见 §10）：Linux 经 WSL2 构建；分发域 `assets.mu0.app`；统一 rclone；beta 留接口+可切；`appId = app.mu0.muzero`；changelog 4 语全量回填。概念已定稿，待开发实现。 |
