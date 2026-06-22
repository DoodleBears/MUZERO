---
title: セルフホスト / デプロイ
description: プロジェクトをローカルで動かし、静的ファイルとしてビルドし、自分の Web ビルドを Cloudflare Pages にデプロイ。ローカル利用に MUZERO アカウントは不要です。
sidebar:
  order: 5
---

MUZERO は Vite アプリです。ローカルで実行し、静的ファイルとしてビルドし、自分の Web ビルドをデプロイできます。ローカル再生、ローカルライブラリ管理、自分のクラウド同期に MUZERO アカウントは不要です。

## ローカル実行

要件：

- Node.js 24.16+ と pnpm
- デスクトップ / モバイルの Tauri ビルド用 Rust + Tauri 前提
- iOS は Xcode、Android は SDK/NDK

```bash
fnm install
fnm use
make install
make dev          # Web dev server → http://localhost:41730
```

デスクトップ shell：

```bash
make electron-dev   # Electron（主要なデスクトップ shell）
make desktop        # Tauri 同等
```

品質ゲート：

```bash
make check          # 型チェック + lint + テスト
```

## ビルドとデプロイ

```bash
make build          # tsc + vite build → dist/
```

`dist/` を **Cloudflare Pages** にデプロイして個人用 Web 版に。カスタムリクエストヘッダーが必要なオンラインソース再生など、デスクトップ専用機能は Electron shell が最も安定します。

## ホスト型 vs セルフホスト

- **`mu0.app`** は公式の無料 hosted surface（マーケティング + ドキュメント + ダウンロード）。アプリ本体は **`my.mu0.app`**。
- 任意の**共有リンク control plane** は Cloudflare Workers + D1 + KV を前提に設計され、その phase が来ればセルフホストできます。
- コアデータはローカルに残り、クロスデバイス同期は**自分の** R2 / S3 互換ストレージ（または将来の WebDAV）を使います。

## 次へ

- [アーキテクチャ](/ja/docs/architecture/)
