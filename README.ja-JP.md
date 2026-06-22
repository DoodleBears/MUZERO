<div align="center">
  <img src="./public/muzero-logo-dark.png" width="96" alt="MUZERO app icon" />

# MUZERO

**あなたのプライベートな音楽バンク、ビジュアルプレーヤー、そして AI DJ。**

MUZERO はローカルファーストの音楽 / ビデオプレーヤーです。自分だけのライブラリ、複数サービスに散らばった楽曲、動的なビジュアル、クラウドドライブ同期、LLM で動く DJ Agent をひとつのアプリにまとめます。

[English](./README.md) · [简体中文](./README.zh-CN.md) · [日本語](./README.ja-JP.md) · [한국어](./README.ko-KR.md)

[mu0.app](https://mu0.app) · [Docs](https://mu0.app/docs) · [Changelog](./CHANGELOG.md) · [Product PRD](./docs/prd/20260612-muzero-product-positioning-readme-prd/20260612-muzero-product-positioning-readme-prd.md)

<br/>

<img src="./docs/media/now-playing.gif" width="760" alt="MUZERO の没入型再生画面 — カバーパレット、フロー背景、リアルタイムスペクトラム" />

</div>

---

## スクリーンショット

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="./docs/media/visualizer.gif" alt="リアルタイムビジュアライザーと歌詞" /><br/>
      <sub><b>リアルタイムビジュアライザー &amp; 歌詞</b> — スペクトラムを切り替え、歌詞モードへ。</sub>
    </td>
    <td width="50%" valign="top">
      <img src="./docs/media/switch-song.gif" alt="スワイプで曲送り" /><br/>
      <sub><b>スワイプで曲送り</b> — タッチで操る 3D カバーフロー。</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="./docs/media/search.png" alt="グローバル検索" /><br/>
      <sub><b>グローバル ⌘F 検索</b> — 曲・タグ・歌詞・オンラインソースを横断。</sub>
    </td>
    <td width="50%" valign="top">
      <img src="./docs/media/library.png" alt="セットギャラリー" /><br/>
      <sub><b>セットギャラリー</b> — セット・アルバム・アーティスト・スマートプレイリストを一覧。</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="./docs/media/dj.png" alt="Agent DJ の設定" /><br/>
      <sub><b>Agent DJ</b> — LLM をつないで、DJ のようにセットを編成しリクエストに応える。</sub>
    </td>
    <td width="50%" valign="top">
      <img src="./docs/media/settings.png" alt="カスタマイズ可能なビジュアル" /><br/>
      <sub><b>細部までカスタマイズできるビジュアル</b> — フロー背景、パレット、エフェクト、テーマ。</sub>
    </td>
  </tr>
</table>

## MUZERO とは

MUZERO は、private music bank、あるいは private museum という発想から始まりました。
曲ごとにメモ、タグ、カバー写真、記憶の断片を残せます。ある曲を聴いた瞬間に、その頃の時間へ戻れるように。

今の MUZERO は、次の 4 つの体験をつなぎます。

- **プライベート音楽ミュージアム**: 音声や MV を取り込み、曲ごとにメモ、タグ、カバー、記憶の写真を追加できます。
- **マルチソース音楽ハブ**: デスクトップで NetEase Cloud Music、Bilibili、YouTube を検索して再生し、MUZERO のライブラリに保持できます。
- **ビジュアルプレーヤー**: Poweramp に着想を得た再生 UI、リアクティブ背景、カバー由来の色、音声ビジュアライザー。
- **Agent DJ**: ローカルモデルやオンライン LLM API をつなぎ、ライブラリ検索、セットのキュレーション、音楽生成 API による次の曲作りを任せられます。

無料の [mu0.app](https://mu0.app) を使うことも、リポジトリを clone して Web ビルドや任意の共有コントロールプレーンを Cloudflare にデプロイすることもできます。主要データはローカルに残ります。クロスデバイス同期は、ユーザー自身が設定した R2、S3 互換ストレージ、または今後の WebDAV 系プライベートクラウドを利用します。

## 約束

| 原則 | 意味 |
|------|------|
| **ローカルファースト** | 曲、セット、メモ、タグ、カバー、設定、再生統計、メディアメタデータは端末内 IndexedDB `muzero-db` に保存されます。 |
| **MUZERO はメディアを預からない** | MUZERO はあなたの音楽ファイルをホストしません。クラウド同期はあなたが所有し設定したストレージを使います。 |
| **BYOK** | LLM key、音楽生成 key、サービスのログインセッション、クラウド資格情報は端末内に保存されます。 |
| **無料の hosted service** | `mu0.app` は配布、Web アクセス、任意の共有権限管理のための無料サービスです。ライブラリを預かるものではありません。 |
| **共有境界が明確** | 共有短縮リンクと権限メタデータだけが `mu0` サービスを必要とします。音声 / ビデオの bytes はローカル端末または自分のクラウドから取得されます。 |

## ドキュメント

詳しいガイド、ハイライト、アーキテクチャは **[mu0.app/docs](https://mu0.app/docs)** にあります：

- [はじめに](https://mu0.app/docs/getting-started/) — アプリを開いて最初の曲を取り込む
- [ソースと取り込み](https://mu0.app/docs/sources/) — アップロード + NetEase・Bilibili・YouTube
- [クラウド同期](https://mu0.app/docs/sync/) — すべての端末を同じライブラリに
- [Agent DJ](https://mu0.app/docs/agent-dj/) — モデルをつないでキューを任せる
- [セルフホスト / デプロイ](https://mu0.app/docs/self-host/) — Web ビルドを自分で動かす
- [アーキテクチャ](https://mu0.app/docs/architecture/) — データモデル、DJ ループ、プロジェクトマップ、技術スタック

すぐ使いたい場合は [my.mu0.app](https://my.mu0.app) を開くか、[ダウンロードページ](https://mu0.app/download) からデスクトップ版を入手してください。

## ローカル実行

Node.js 24.16+、pnpm、（デスクトップ / モバイルのビルドには）Rust + Tauri の前提、Xcode、Android SDK/NDK が必要です。

```bash
fnm install
fnm use
make install
make dev            # Web dev server → http://localhost:41730
make electron-dev   # Electron デスクトップ shell
make check          # 型チェック + lint + テスト
```

完全なビルド / デプロイと Tauri / モバイルのコマンドは[セルフホストガイド](https://mu0.app/docs/self-host/)にあります。

## License

Apache-2.0. See [`LICENSE`](./LICENSE).
