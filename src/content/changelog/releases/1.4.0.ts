import type { ChangelogRelease } from "../types";

const release: ChangelogRelease = {
  version: "1.4.0",
  date: "2026-06-21",
  title: {
    en: "Download Bilibili & YouTube videos to your library",
    zh: "把 Bilibili、YouTube 视频下载进你的曲库",
    ja: "Bilibili・YouTube の動画をライブラリにダウンロード",
    ko: "Bilibili·YouTube 영상을 라이브러리에 다운로드",
  },
  summary: {
    en: "MUZERO is now a real video downloader. Pick a quality and save Bilibili or YouTube videos as local, playable tracks — no FFmpeg, no extra tools. Paste a link (or just a BV ID / video ID) in ⌘F to grab one, or import a whole 收藏夹 / playlist and download every item as video. A persistent download queue resumes after a restart, retries failures, limits concurrency, and shows progress in a panel and a floating badge. You can also subscribe a favlist or playlist so new items sync in automatically.",
    zh: "MUZERO 现在是一个真正的视频下载器。选择清晰度，把 Bilibili 或 YouTube 视频保存为可播放的本地曲目——不打包 FFmpeg、无需额外工具。在 ⌘F 里粘贴链接（或只输入 BV 号 / 视频 ID）即可下载单个，或导入整个收藏夹 / 歌单并把每一项都下载为视频。持久下载队列会在重启后续传、失败自动重试、限制并发，并在面板和悬浮角标里显示进度。你还可以订阅收藏夹或歌单，让新内容自动同步进来。",
    ja: "MUZERO は本格的な動画ダウンローダーになりました。画質を選んで Bilibili や YouTube の動画を再生可能なローカル曲として保存できます（FFmpeg は同梱せず、追加ツールも不要）。⌘F にリンク（または BV 番号 / 動画 ID だけ）を貼れば 1 本ずつ、お気に入り / プレイリストごと取り込めば各項目を動画としてまとめてダウンロード。永続ダウンロードキューは再起動後に再開し、失敗は自動再試行、同時実行数を制限し、パネルとフローティングバッジに進捗を表示します。お気に入りやプレイリストを購読すれば新着が自動同期されます。",
    ko: "MUZERO가 본격적인 영상 다운로더가 되었습니다. 화질을 선택해 Bilibili나 YouTube 영상을 재생 가능한 로컬 트랙으로 저장하세요 — FFmpeg 미포함, 추가 도구 불필요. ⌘F에 링크(또는 BV 번호 / 영상 ID만) 붙여넣어 하나씩, 또는 보관함 / 재생목록 전체를 가져와 각 항목을 영상으로 한꺼번에 다운로드할 수 있습니다. 지속 다운로드 큐는 재시작 후 이어받고, 실패를 자동 재시도하며, 동시 실행을 제한하고, 패널과 플로팅 배지에 진행률을 표시합니다. 즐겨찾기나 재생목록을 구독하면 새 항목이 자동으로 동기화됩니다.",
  },
  items: [
    {
      area: "streaming",
      category: "highlight",
      platform: "desktop",
      title: {
        en: "Download Bilibili & YouTube videos to your library",
        zh: "把 Bilibili、YouTube 视频下载进曲库",
        ja: "Bilibili・YouTube 動画をライブラリへダウンロード",
        ko: "Bilibili·YouTube 영상을 라이브러리에 다운로드",
      },
      description: {
        en: "Resolve a video, pick a resolution, and save it as a local, playable track — video and audio merged into a standard file (copy-remux, no FFmpeg bundled). Defaults to 1080p and degrades to the closest available quality when your pick isn't offered. Log in to a source to unlock higher / VIP qualities.",
        zh: "解析视频、选择分辨率，保存为可播放的本地曲目——视频与音频合并为标准文件（copy-remux，不打包 FFmpeg）。默认 1080p，所选清晰度不可用时自动降到最接近的可用清晰度。登录对应源可解锁更高 / VIP 清晰度。",
        ja: "動画を解決して解像度を選び、再生可能なローカル曲として保存します。映像と音声は標準ファイルに結合されます（copy-remux、FFmpeg は同梱しません）。既定は 1080p で、選んだ画質が無い場合は最も近い利用可能な画質に下げます。各ソースにログインすると高画質 / VIP 画質が解放されます。",
        ko: "영상을 해석하고 해상도를 선택해 재생 가능한 로컬 트랙으로 저장합니다. 영상과 오디오는 표준 파일로 병합됩니다(copy-remux, FFmpeg 미포함). 기본값은 1080p이며 선택한 화질이 없으면 가장 가까운 사용 가능 화질로 낮춥니다. 소스에 로그인하면 고화질 / VIP 화질이 해제됩니다.",
      },
    },
    {
      area: "search",
      category: "feature",
      platform: "desktop",
      title: {
        en: "Paste a link or ID in ⌘F to download",
        zh: "在 ⌘F 粘贴链接或 ID 即可下载",
        ja: "⌘F にリンクや ID を貼ってダウンロード",
        ko: "⌘F에 링크나 ID를 붙여넣어 다운로드",
      },
      description: {
        en: "Paste a Bilibili or YouTube URL — or just a BV ID / video ID / shorts / playlist link — into ⌘F search and MUZERO resolves it directly instead of running a keyword search. Press Enter to download the video at your default quality (a Settings toggle keeps Enter = play), or use the audio / video buttons.",
        zh: "在 ⌘F 搜索框粘贴 Bilibili 或 YouTube 链接——或只输入 BV 号 / 视频 ID / shorts / 歌单链接——MUZERO 会直接定位解析，而不是按关键词搜索。回车即按默认清晰度下载视频（可在设置里把回车改回播放），也可用音频 / 视频按钮。",
        ja: "⌘F 検索に Bilibili や YouTube の URL（または BV 番号 / 動画 ID / shorts / プレイリストのリンクだけ）を貼ると、キーワード検索ではなく直接解決します。Enter で既定画質の動画をダウンロード（設定で Enter を再生に戻せます）、または音声 / 動画ボタンを使用します。",
        ko: "⌘F 검색에 Bilibili나 YouTube URL(또는 BV 번호 / 영상 ID / shorts / 재생목록 링크만)을 붙여넣으면 키워드 검색 대신 바로 해석합니다. Enter로 기본 화질 영상을 다운로드하고(설정에서 Enter를 재생으로 되돌릴 수 있음), 오디오 / 영상 버튼도 사용할 수 있습니다.",
      },
    },
    {
      area: "streaming",
      category: "feature",
      platform: "desktop",
      title: {
        en: "Import whole 收藏夹 / playlists as video",
        zh: "把整个收藏夹 / 歌单导入并下载为视频",
        ja: "お気に入り / プレイリストをまるごと動画として取り込み",
        ko: "보관함 / 재생목록 전체를 영상으로 가져오기",
      },
      description: {
        en: "Import a Bilibili 收藏夹 or a YouTube / YouTube Music playlist as its own set and download every item as video by default (a Settings toggle turns this off). YouTube Music entries with no real video fall back to audio. Each item shows its own progress, and Bilibili multi-part (分P) videos let you pick parts or grab them all.",
        zh: "把 Bilibili 收藏夹或 YouTube / YouTube Music 歌单导入为独立歌单，并默认把每一项都下载为视频（可在设置里关闭）。没有真正视频的 YouTube Music 条目会回退为音频。每一项都有独立进度，Bilibili 多分 P 视频可选择分 P 或全部下载。",
        ja: "Bilibili のお気に入りや YouTube / YouTube Music のプレイリストを独立したプレイリストとして取り込み、既定で各項目を動画としてダウンロードします（設定でオフにできます）。動画が無い YouTube Music の項目は音声にフォールバックします。各項目に進捗が表示され、Bilibili のマルチパート（分P）動画はパート選択や一括取得ができます。",
        ko: "Bilibili 보관함이나 YouTube / YouTube Music 재생목록을 별도 재생목록으로 가져오고 기본으로 각 항목을 영상으로 다운로드합니다(설정에서 끌 수 있음). 실제 영상이 없는 YouTube Music 항목은 오디오로 대체됩니다. 각 항목에 진행률이 표시되며, Bilibili 멀티파트(分P) 영상은 파트 선택 또는 전체 받기를 지원합니다.",
      },
    },
    {
      area: "sync",
      category: "feature",
      platform: "desktop",
      title: {
        en: "Subscribe a favlist or playlist for auto-sync",
        zh: "订阅收藏夹 / 歌单实现自动同步",
        ja: "お気に入り / プレイリストを購読して自動同期",
        ko: "즐겨찾기 / 재생목록 구독으로 자동 동기화",
      },
      description: {
        en: "Bind a 收藏夹 / playlist to a set and let MUZERO pull in new items automatically — choose a cadence (manual, on app start, or every 15 / 30 / 60 minutes) and optionally auto-download new videos. It runs only while the app is visible and online, with jitter and failure backoff to stay gentle on the source.",
        zh: "把收藏夹 / 歌单绑定到一个歌单，让 MUZERO 自动拉取新内容——可选频率（手动、启动时，或每 15 / 30 / 60 分钟），并可选自动下载新视频。仅在应用可见且在线时运行，带抖动与失败退避，对源更友好。",
        ja: "お気に入り / プレイリストをセットに紐付け、新着を自動取得します。頻度（手動・起動時・15 / 30 / 60 分ごと）を選べ、新着動画の自動ダウンロードも任意で有効化できます。アプリが表示中かつオンラインのときだけ実行し、ジッターと失敗時バックオフでソースに優しく動作します。",
        ko: "보관함 / 재생목록을 세트에 연결해 새 항목을 자동으로 가져옵니다. 주기(수동, 앱 시작 시, 15 / 30 / 60분마다)를 선택하고 새 영상 자동 다운로드도 선택할 수 있습니다. 앱이 보이고 온라인일 때만 실행되며, 지터와 실패 백오프로 소스에 부담을 줄입니다.",
      },
    },
    {
      area: "streaming",
      category: "feature",
      platform: "desktop",
      title: {
        en: "Persistent download queue",
        zh: "持久下载队列",
        ja: "永続ダウンロードキュー",
        ko: "지속 다운로드 큐",
      },
      description: {
        en: "Downloads run through a queue that survives a restart: interrupted jobs resume on next launch, failures retry with backoff, and a concurrency limit keeps things from overwhelming your machine or the source. Track everything in the Downloads panel (Settings) and a floating progress badge.",
        zh: "下载通过一个可在重启后存活的队列运行：中断的任务会在下次启动时续传，失败按退避重试，并发上限避免压垮设备或源。可在「下载」面板（设置内）和悬浮进度角标里查看全部。",
        ja: "ダウンロードは再起動後も残るキューで実行されます。中断したジョブは次回起動時に再開し、失敗はバックオフで再試行、同時実行数の上限で端末やソースへの負荷を抑えます。ダウンロードパネル（設定内）とフローティング進捗バッジで一覧できます。",
        ko: "다운로드는 재시작 후에도 유지되는 큐로 실행됩니다. 중단된 작업은 다음 실행 시 이어받고, 실패는 백오프로 재시도하며, 동시 실행 제한으로 기기나 소스에 과부하를 주지 않습니다. 다운로드 패널(설정)과 플로팅 진행 배지에서 전체를 확인할 수 있습니다.",
      },
    },
    {
      area: "streaming",
      category: "improvement",
      platform: "desktop",
      title: {
        en: "Smoother, more informative downloads",
        zh: "下载更顺滑、信息更清晰",
        ja: "よりスムーズで分かりやすいダウンロード",
        ko: "더 부드럽고 정보가 풍부한 다운로드",
      },
      description: {
        en: "Official covers are preferred for downloaded videos, real byte-level progress shows for both single and batch downloads, and the audio + video merge runs off the main thread so the UI stays responsive.",
        zh: "下载的视频优先使用官方封面，单个与批量下载都显示真实字节级进度，音视频合并在主线程之外运行，界面保持流畅。",
        ja: "ダウンロードした動画は公式カバーを優先し、単体・一括どちらも実バイト単位の進捗を表示します。映像と音声の結合はメインスレッド外で実行され、UI は滑らかなままです。",
        ko: "다운로드한 영상은 공식 커버를 우선 사용하고, 단일·일괄 다운로드 모두 실제 바이트 단위 진행률을 표시하며, 영상과 오디오 병합은 메인 스레드 밖에서 실행되어 UI가 매끄럽게 유지됩니다.",
      },
    },
    {
      area: "streaming",
      category: "fix",
      platform: "desktop",
      title: {
        en: "YouTube download reliability + quieter console",
        zh: "YouTube 下载更可靠 + 控制台更安静",
        ja: "YouTube ダウンロードの安定化 + コンソールを静かに",
        ko: "YouTube 다운로드 안정성 + 콘솔 잡음 감소",
      },
      description: {
        en: "Fixed YouTube items that failed to merge with a 'timestamps must be non-negative' error, and audio-only YouTube Music entries now download as audio instead of failing. Also quieted occasional non-fatal console errors (transient network-proxy failures and YouTube parser warnings).",
        zh: "修复了部分 YouTube 条目因「时间戳不能为负」而合并失败的问题，纯音频的 YouTube Music 条目现在会下载为音频而非失败。同时降低了偶发的非致命控制台报错（瞬时网络代理失败与 YouTube 解析告警）。",
        ja: "一部の YouTube 項目が「タイムスタンプは非負である必要があります」で結合に失敗する問題を修正し、音声のみの YouTube Music 項目は失敗せず音声としてダウンロードされるようになりました。さらに、まれに出る致命的でないコンソールエラー（一時的なネットワークプロキシ失敗や YouTube パーサーの警告）を抑えました。",
        ko: "일부 YouTube 항목이 '타임스탬프는 음수가 아니어야 합니다' 오류로 병합에 실패하던 문제를 수정했고, 오디오 전용 YouTube Music 항목은 실패 대신 오디오로 다운로드됩니다. 또한 가끔 나타나던 치명적이지 않은 콘솔 오류(일시적 네트워크 프록시 실패와 YouTube 파서 경고)를 줄였습니다.",
      },
    },
  ],
};

export default release;
