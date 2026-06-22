---
title: アーキテクチャ
description: MUZERO の組み立て方——データモデル、DJ → 生成 → キューのループ、デスクトップ shell、プロジェクトマップ。貢献者向け。
sidebar:
  order: 6
---

貢献者と好奇心のある人へ、MUZERO がどう組み立てられているかの高レベルな地図。

## データフロー

```text
ローカルファイル / オンラインソース / AI 生成
              |
              v
        Track + MediaBlob
              |
              v
 IndexedDB `muzero-db`  <---->  任意のユーザー所有クラウド
              |
              v
        プレーヤー + ビジュアライザー
              |
              v
        Agent DJ / 検索 / 共有
```

track は軽量な行で、音声・動画・カバーの **bytes は別の `mediaBlobs` ストア**にあり、track 行には決して入りません——だからリスト検索は速く、仮想化が意味を持ちます。

## DJ ループ

```text
思い出 + ムード + 最近の曲
          |
          v
    LLM Agent が TrackBrief を書く
          |
          v
    音楽生成 provider が音声をレンダリング
          |
          v
 pending track -> ready track -> キュー補充
```

`TrackBrief` は DJ、音楽生成 provider、データベースの唯一の契約です。DJ は provider 非依存の brief を書き、adapter が翻訳するので、vendor の概念が DJ や DB に漏れません。

## Shell

アプリ全体がフロントエンドで、デスクトップ shell 抽象の背後で動きます：

- **Electron** —— 主要なデスクトップ shell（CORS-free fetch、ローカルファイルアクセス）。
- **Tauri 2** —— 動作を維持し、モバイルに使用。
- **Web** —— ブラウザビルド。

すべての native アクセスはひとつの bridge を通るので、provider・プレーヤー・UI はどの shell にいるかで分岐しません。

## 技術スタック

Tauri 2、Electron、Vite、React 19、TypeScript、Tailwind CSS v4、COSS UI、Base UI、Dexie、IndexedDB、Zustand、TanStack Query、TanStack Virtual、Vercel AI SDK、Zod、Vitest、Biome、Cloudflare R2、任意の hosted control plane 向け Cloudflare Workers。

## ソースマップ

コードは [MUZERO リポジトリ](https://github.com/DoodleBears/MUZERO)にあります。主な領域：AI DJ エンジン、音楽生成 provider、オンラインソース provider、ローカルデータベース、クラウド同期、ビジュアライザー、Electron / Tauri shell。

> 貢献する？リポジトリの `CLAUDE.md` / `AGENTS.md` に完全なアーキテクチャ手引きと規約があります。
