# PRD — Web（mu0.app 营销站 / docs / 公共内容面）

本目录收纳**公共 web 内容面**相关的 PRD：`mu0.app` 营销落地页、文档（docs / 教程）、下载中心、未来分享页等**面向搜索引擎与新用户的内容站**。它与 app 本体（React SPA）、桌面端、移动端是不同的产品表面。

> **目录分层**：MUZERO 的 PRD 按表面归档：
> - `docs/prd/web/` —— 本目录：`mu0.app` 营销 / docs / 公共内容站
> - `docs/prd/desktop/` —— 桌面端（Electron 主力 + Tauri + web app 壳）
> - `docs/prd/mobile/` —— 移动端（iOS / Android）
> - `docs/prd/*-prd/`（根目录）—— 2026-06-16 之前的历史 PRD，**保持原位不迁移**。
>
> 本目录 PRD 因多一层目录，引用源码 / 根文件的相对路径要多一个 `../`（如 `../../../../src/...`、`../../../../README.md`）。

## 索引

| PRD | 状态 | 摘要 |
|---|---|---|
| [20260622-muzero-marketing-docs-site](20260622-muzero-marketing-docs-site-prd/20260622-muzero-marketing-docs-site-prd.md) | Draft | **Astro + Starlight 营销/docs 站**承接 `mu0.app` 根域（SEO 内容 + 长尾教程 + 下载中心），React app 迁到 **`my.mu0.app`**（「我的」私人曲库）。含 README→docs 单一来源迁移、i18n(en/zh/ja/ko)+hreflang、域名切换 runbook、**换 origin 导致现有 web 端 IndexedDB 孤立**的风险与恢复路径 |
