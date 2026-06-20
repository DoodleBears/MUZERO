# PRD — Desktop（Electron / Tauri / web）

本目录收纳**桌面端**（Electron 主力 + Tauri 保留 + web）相关的**新** PRD。命名沿用根 [`prd-create.md`](../../../.cursor/commands/prd-create.md) 约定：`YYYYMMDD-<topic>-prd/`。

> **目录分层（2026-06-16 起）**：MUZERO 进入「桌面 + 移动」双端阶段后，PRD 按平台归档：
> - `docs/prd/desktop/` —— 桌面端（本目录，新 PRD）
> - `docs/prd/mobile/` —— 移动端（iOS / Android）
> - `docs/prd/*-prd/`（根目录）—— 2026-06-16 之前的历史 PRD，**保持原位不迁移**（它们用 `../../../src/...` 相对链接引用源码，移动会成片断链）。已实现的桌面功能历史记录仍在根目录查阅。
>
> 桌面端 PRD 因多一层目录，引用源码的相对路径要多一个 `../`（如 `../../../../src/...`）。

## 索引

| PRD | 状态 | 摘要 |
|---|---|---|
| [20260620-muzero-video-quality-download-import](20260620-muzero-video-quality-download-import-prd/20260620-muzero-video-quality-download-import-prd.md) | ✅ Merged (PR #1) | Bilibili/YouTube 视频清晰度选择 + 直接下载到本地导入；DASH 分轨用 mediabunny **copy-remux**（无重编码、原生容器 mp4/webm，**不打包 FFmpeg**）。含收藏夹/playlist 同步 + 整单下载。external-streaming-sources 的视频向扩展 |
| [20260621-muzero-download-queue-resume-autosync](20260621-muzero-download-queue-resume-autosync-prd/20260621-muzero-download-queue-resume-autosync-prd.md) | Draft | 持久**下载队列**（并发/重试/重启恢复）+ **断点续传**（Range 分片 + 直链过期重解析 + 分片落盘）+ 歌单/收藏夹**自动定时同步**（镜像 cloud auto-sync-scheduler，可选「同步即下载」）。承接视频下载 PRD 的后续增强 |
