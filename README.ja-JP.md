<div align="center">
  <img src="./public/muzero-logo-dark.png" width="96" alt="MUZERO app icon" />

# MUZERO

**あなたのプライベートな音楽バンク、ビジュアルプレーヤー、そして AI DJ。**

MUZERO はローカルファーストの音楽 / ビデオプレーヤーです。自分だけのライブラリ、複数サービスに散らばった楽曲、動的なビジュアル、クラウドドライブ同期、LLM で動く DJ Agent をひとつのアプリにまとめます。

[English](./README.md) · [简体中文](./README.zh-CN.md) · [日本語](./README.ja-JP.md) · [한국어](./README.ko-KR.md)

[mu0.app](https://mu0.app) · [Changelog](./CHANGELOG.md) · [Product PRD](./docs/prd/20260612-muzero-product-positioning-readme-prd/20260612-muzero-product-positioning-readme-prd.md)

</div>

---

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

## ハイライト機能

### 速く、キーボード中心

- 多数のショートカットをカスタマイズできます。再生、キュー、検索、ナビゲーション、ライブラリ管理の主要操作をキーボードだけで完結できます。
- `Command/Ctrl + F` で曲、アルバム、アーティスト、セット、歌詞、タグ、メモ、オンラインソースを横断検索できます。
- MUZERO はローカルの大規模ライブラリ検索を前提に設計されています。6,000 曲のプレイリストで、使い始めるまで 30 秒近く待たされるべきではありません。

### 一度設定して、どの端末でも再生

- クラウドドライブを一度設定すれば、trusted setup link をコピーするだけで別のスマホや PC を同じライブラリにつなげられます。
- セット、曲、カバー、メモ、記憶、歌詞、再生メタデータを自分の端末間で同期できます。MUZERO がメディアを預かる必要はありません。
- 友人には読み取り専用のライブラリ / 共有リンクで素早く音楽を渡せます。より豊かな `mu0.app` 短縮リンク、取り消し可能な招待、権限管理はロードマップで進めています。

### 高度にカスタマイズできるビジュアル

- 背景動画、背景画像、カバー由来の背景、スペクトラム背景、波形スタイル、shader scene、テーマカラーのプリセットを選べます。
- 背景エフェクト、ビジュアライザー、パレット、歌詞エフェクト、翻訳、ローマ字、単語単位の歌詞表示を、聴く場面に合わせて調整できます。

### Vibe Coding のための AI DJ

- MUZERO をサブディスプレイに置けば、コードを書く時、デザインする時、文章を書く時、長く集中したい時の DJ / Radio になります。
- Agent に今のムードを伝えたり、seed となるセットを渡したり、ライブラリを検索させたりしながら、キューを自然に続けられます。

## 機能

### プライベート音楽バンク

- 音声ファイル、フォルダ、MV を取り込み、混在したセットを作れます。
- 曲ごとにメモ、タグ、記憶の写真、カスタムカバーを追加できます。
- タイトル、アーティスト、アルバム、タグ、メモ、歌詞、表記ゆれ、ソースメタデータで検索できます。
- アーティスト、アルバム、セット、記憶、歌詞、再生履歴を同じローカルライブラリで扱えます。

### 自分のクラウドへ同期

- 自分が所有するクラウドドライブへライブラリを publish / pull できます。
- 現在の production path: Cloudflare R2 / S3 互換オブジェクトストレージ。
- ストレージ provider のロードマップ: Nextcloud、Synology、rclone serve などに向けた WebDAV support。
- メディア bytes は内容アドレスで保存され、軽量な track 行には入れないため、大きなライブラリでも検索を保ちやすくします。

### オンラインソース

- デスクトップで次のソースを検索 / 解決できます。
  - NetEase Cloud Music
  - Bilibili
  - YouTube
- ソース側が必要とする場合、ログイン状態をローカルに保存して高音質やアカウント限定コンテンツを扱えます。
- ストリーミング曲とカバーをローカルにキャッシュし、オフライン再生できます。

### ビジュアルプレーヤー

- プレーヤーファーストの bottom dock: カバー / タイトル、幅いっぱいの progress、ステータス、ナビゲーションをひとつの面に統合。
- Now Playing stage は video、cover art、title fallback、audio-only mode、immersive background に対応。
- spectrum、waveform、radial、LED reflex、liquid、aurora、cover-palette flow などのビジュアライザーを内蔵。
- デスクトップ優先で作りつつ、モバイルにも対応する responsive layout。

### Agent DJ

- DJ は `TrackBrief` を書きます: caption、lyrics、style、BPM、key、structure、generation hints。
- 音楽生成 provider は差し替え可能: デフォルトは offline mock、実生成には cloud BYOK provider。
- Agent はライブラリ検索、タグやメモの文脈利用、セットのキュレーション、DJ のようなキュー継続ができます。
- LLM と provider は adapter の背後に隔離され、ライブラリは特定 vendor に依存しません。

## ローカル実行

Node.js 24.16+ と pnpm が必要です。fnm を使う場合は、このリポジトリの `.node-version` をそのまま使えます:

```bash
fnm install
fnm use
make install
make dev
```

Web dev server は `http://localhost:41730` です。

デスクトップ:

```bash
make electron-dev
```

Tauri / モバイル:

```bash
make desktop
make ios-init && make ios
make android-init && make android
```

品質チェック:

```bash
make check
```

## デプロイ / セルフホスト

MUZERO は Vite アプリなので、静的ファイルとしてビルドできます。

```bash
make build
```

`dist/` を Cloudflare Pages にデプロイして個人用 Web 版として使えます。オンラインソース再生のようにカスタム request header が必要な機能は、Electron デスクトップ shell が最も安定します。

`mu0.app` は公式の無料 hosted surface です。任意の共有リンク control plane は Cloudflare Workers + D1 + KV を前提に設計されており、その phase が実装された後はセルフホストできます。ローカル再生、ローカルライブラリ管理、自分のクラウドドライブ同期に MUZERO アカウントは不要です。

## プロジェクトマップ

| 領域 | Path |
|------|------|
| App shell / routes | [`src/App.tsx`](./src/App.tsx), [`src/pages/`](./src/pages/) |
| Player / media engine | [`src/player/`](./src/player/), [`src/components/player/`](./src/components/player/) |
| AI DJ engine | [`src/dj/`](./src/dj/) |
| Music-generation providers | [`src/musicgen/`](./src/musicgen/) |
| Online source providers | [`src/streamsrc/`](./src/streamsrc/) |
| Local database | [`src/db/`](./src/db/) |
| Cloud sync | [`src/sync/`](./src/sync/) |
| Visualizers | [`src/visualizer/`](./src/visualizer/) |
| Desktop / mobile shell | [`src-tauri/`](./src-tauri/), [`electron/`](./electron/) |
| Product requirements | [`docs/prd/`](./docs/prd/) |

## 技術スタック

Tauri 2、Electron、Vite、React 19、TypeScript、Tailwind CSS v4、COSS UI、Base UI、Dexie、IndexedDB、Zustand、TanStack Query、TanStack Virtual、Vercel AI SDK、Zod、Vitest、Biome、Cloudflare R2、任意の hosted control plane 向け Cloudflare Workers。

## Roadmap

- WebDAV storage adapter と cloud-drive provider abstraction。
- `mu0.app` share links、取り消し可能な invites、ブラウザ playback page。
- 検索、キュレーション、説明、音楽生成のための Agent tools。
- モバイルの background audio と touch-first browsing の磨き込み。
- 追加 visualizer presets と cover-driven immersive scenes。

## License

Apache-2.0. See [`LICENSE`](./LICENSE).
