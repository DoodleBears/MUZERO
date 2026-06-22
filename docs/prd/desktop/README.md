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
| [20260621-muzero-playlist-playback-context-resolution](20260621-muzero-playlist-playback-context-resolution-prd/20260621-muzero-playlist-playback-context-resolution-prd.md) | Final | **播放队列模型重构**（可见队列即播放顺序，且来自当前界面）。**Part A 上下文解析**：修复「同一首歌多歌单时从 Y 点播却切到 X」（根因 `Track.sessionId` 被 `playTrack` 误当播放上下文）→ 上下文感知入口 `playTrackInContext`，含发现 tab 第 5 项 Online 歌单同源场景。**Part B 随机播放 × 点歌**：调研 Spotify/Apple/YT 后采用 **materialized shuffle（洗一次进 `entries`）+ Next-in-Queue 优先 FIFO**，删并行 `shuffleOrder`，修复「shuffle 跳过点歌的下一首 / 可见队列≠实播」。复用 `PlayQueueEntry.requested`，无 schema 变更 |
| [20260621-muzero-now-playing-backlight-derivative-missing](20260621-muzero-now-playing-backlight-derivative-missing-prd/20260621-muzero-now-playing-backlight-derivative-missing-prd.md) | ✅ Final（方案 C 已实现） | **Now Playing 静置态封面 backlight（背光）不显示** 回归排查。根因：`c8d93ccc` 同 commit 既把静置消费端改 `generateOnMiss:false`（只读派生图）、又删掉 `use-playback-warmup` 的 `warmBacklight` 预热——backlight 派生图三路（预热 / 按需 / 导入）全断、永不生成。拖拽 overlay 卡片走 CSS 模糊原图不依赖派生图，故「拖拽有、松手/切歌后无」。修复：A 恢复预热 / B 按需兜底 / C 静置改 CSS 模糊去派生依赖 |
| [20260622-muzero-stream-download-dedup-refactor](20260622-muzero-stream-download-dedup-refactor-prd/20260622-muzero-stream-download-dedup-refactor-prd.md) | Draft | **行为保持型代码质量重构**（无新功能 / 无 schema 变更）。把「收藏夹 re-sync 走持久化下载队列」WIP 提交前的去重：抽私有 `addAndQueuePlaylistVideos` 公共脊柱，收敛 `downloadPlaylistVideos` / `downloadPlaylistVideosToSet` 逐字节相同的下载尾部（`download-action.ts`）；删掉 `AddHitsResult.tracks` 1:1 契约下的 `tracks[i] &&` 死守卫；收敛三份 per-item 入队循环到 `enqueueHitsForDownload`（退役 dev-only `downloadHitsAsVideo`）。源自 thermo-nuclear code review；承接 20260622 统一通知 + 20260621 下载队列 PRD |
