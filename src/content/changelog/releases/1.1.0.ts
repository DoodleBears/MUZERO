import type { ChangelogRelease } from "../types";

const release: ChangelogRelease = {
  version: "1.1.0",
  date: "2026-06-15",
  title: {
    en: "Smoother playback, smarter browsing, and desktop controls",
    zh: "更顺滑的播放、更聪明的浏览和桌面控制",
    ja: "より滑らかな再生、賢いブラウズ、デスクトップ操作",
    ko: "더 부드러운 재생, 똑똑한 탐색, 데스크톱 제어",
  },
  summary: {
    en: "Now Playing switches faster and stays visually in sync, the library gains system playlists, A-Z navigation, and online discovery, and desktop users get tray controls, global shortcuts, pinned lyrics, and live request intake.",
    zh: "Now Playing 切歌更快且封面/背景/背光保持同步；媒体库加入系统歌单、A-Z 导航与在线发现；桌面端新增托盘控制、全局快捷键、置顶歌词和直播点歌入口。",
    ja: "Now Playing の曲切り替えは速くなり、カバー、背景、バックライトの同期も安定しました。ライブラリにはシステムプレイリスト、A-Z ナビゲーション、オンライン発見が加わり、デスクトップではトレイ操作、グローバルショートカット、固定歌詞、ライブリクエスト取り込みを使えます。",
    ko: "Now Playing 전환은 더 빨라지고 커버, 배경, 백라이트가 안정적으로 동기화됩니다. 라이브러리에는 시스템 플레이리스트, A-Z 탐색, 온라인 발견이 추가되었고, 데스크톱에서는 트레이 제어, 전역 단축키, 고정 가사, 라이브 요청 수집을 사용할 수 있습니다.",
  },
  items: [
    {
      area: "player",
      category: "highlight",
      platform: "all",
      title: {
        en: "Fast, synchronized Now Playing switches",
        zh: "更快且同步的 Now Playing 切换",
        ja: "高速で同期した Now Playing 切り替え",
        ko: "빠르고 동기화된 Now Playing 전환",
      },
      description: {
        en: "Cover, background, backlight, and queue identity now move together through rapid next/previous bursts, with persistent Pixi backgrounds, settled cover work, and off-thread image decoding reducing switch jank.",
        zh: "快速连按上一首/下一首时，封面、背景、背光和队列身份会一起切换；持久 Pixi 背景、稳定后再做封面派生工作，以及离主线程图片解码共同减少切歌卡顿。",
        ja: "前後の曲を素早く連続操作しても、カバー、背景、バックライト、キュー上の曲情報が一緒に動きます。常駐 Pixi 背景、安定後のカバー処理、別スレッド画像デコードで切り替え時の引っかかりを抑えました。",
        ko: "이전/다음 곡을 빠르게 연속으로 눌러도 커버, 배경, 백라이트, 큐의 곡 정보가 함께 전환됩니다. 지속되는 Pixi 배경, 안정화 후 커버 작업, 메인 스레드 밖 이미지 디코딩으로 전환 끊김을 줄였습니다.",
      },
    },
    {
      area: "library",
      category: "feature",
      platform: "all",
      title: {
        en: "System playlists and A-Z library navigation",
        zh: "系统歌单与 A-Z 媒体库导航",
        ja: "システムプレイリストと A-Z ライブラリナビゲーション",
        ko: "시스템 플레이리스트와 A-Z 라이브러리 탐색",
      },
      description: {
        en: "The library now has built-in system playlist cards and details, stats-aware sorting, reading-aware name sort, A-Z fast jump rails, and hover scrollbars for large set, album, and artist walls.",
        zh: "媒体库新增内置系统歌单卡片与详情页、按统计排序、按读音排序名称、A-Z 快速跳转栏，以及适合大型歌单/专辑/歌手墙的悬浮滚动条。",
        ja: "ライブラリにシステムプレイリストのカードと詳細、統計を使った並び替え、読みを考慮した名前順、A-Z 高速ジャンプレール、大きなセット/アルバム/アーティスト一覧向けのホバースクロールバーを追加しました。",
        ko: "라이브러리에 내장 시스템 플레이리스트 카드와 상세 화면, 통계 기반 정렬, 읽기 기준 이름 정렬, A-Z 빠른 이동 레일, 대형 세트/앨범/아티스트 벽을 위한 호버 스크롤바가 추가되었습니다.",
      },
    },
    {
      area: "streaming",
      category: "feature",
      platform: "all",
      title: {
        en: "Discover tab for online recommendations",
        zh: "在线推荐的发现页",
        ja: "オンラインおすすめ用の Discover タブ",
        ko: "온라인 추천을 위한 Discover 탭",
      },
      description: {
        en: "NetEase daily recommendations and recommended playlists can be browsed, played, saved, rerolled, and opened in a dedicated online playlist detail flow.",
        zh: "网易云每日推荐与推荐歌单现在可以在发现页浏览、播放、保存、换一批，并进入专门的在线歌单详情流程。",
        ja: "NetEase のデイリーおすすめとおすすめプレイリストを、Discover で閲覧、再生、保存、再取得でき、専用のオンラインプレイリスト詳細にも進めます。",
        ko: "NetEase 일일 추천곡과 추천 플레이리스트를 Discover에서 탐색, 재생, 저장, 다시 뽑기 할 수 있고 전용 온라인 플레이리스트 상세 흐름으로 열 수 있습니다.",
      },
    },
    {
      area: "lyrics",
      category: "feature",
      platform: "all",
      title: {
        en: "Cascade lyrics and lyrics-only stage mode",
        zh: "瀑布歌词与纯歌词舞台模式",
        ja: "カスケード歌詞と歌詞専用ステージ",
        ko: "캐스케이드 가사와 가사 전용 스테이지",
      },
      description: {
        en: "A new lyric layout engine powers cascade word timing, inertial follow, row motion, and a lyrics-only visualizer mode with dedicated tuning for cover color and backlight.",
        zh: "新的歌词布局引擎支持瀑布式逐词时序、惯性跟随、行运动，以及纯歌词可视化模式，并提供封面颜色与背光的专门调节。",
        ja: "新しい歌詞レイアウトエンジンにより、カスケード式の単語タイミング、慣性追従、行モーション、歌詞専用ビジュアライザーモード、カバー色とバックライトの専用調整が使えます。",
        ko: "새 가사 레이아웃 엔진이 캐스케이드 단어 타이밍, 관성 추적, 줄 모션, 가사 전용 비주얼라이저 모드, 커버 색상과 백라이트 전용 튜닝을 제공합니다.",
      },
    },
    {
      area: "app",
      category: "feature",
      platform: "desktop",
      title: {
        en: "Tray, global shortcuts, and pinned lyrics",
        zh: "托盘、全局快捷键与置顶歌词",
        ja: "トレイ、グローバルショートカット、固定歌詞",
        ko: "트레이, 전역 단축키, 고정 가사",
      },
      description: {
        en: "Electron desktop now supports a native tray playback menu, close-to-tray lifecycle, system global shortcuts, DevTools shortcuts in development, window pinning, and lockable pinned lyrics controls.",
        zh: "Electron 桌面端现在支持原生托盘播放菜单、关闭到托盘生命周期、系统级全局快捷键、开发环境 DevTools 快捷键、窗口置顶，以及可锁定的置顶歌词控制。",
        ja: "Electron デスクトップで、ネイティブトレイ再生メニュー、トレイへ閉じるライフサイクル、システムグローバルショートカット、開発用 DevTools ショートカット、ウィンドウ固定、ロック可能な固定歌詞操作を追加しました。",
        ko: "Electron 데스크톱은 네이티브 트레이 재생 메뉴, 트레이로 닫기 라이프사이클, 시스템 전역 단축키, 개발 환경 DevTools 단축키, 창 고정, 잠금 가능한 고정 가사 제어를 지원합니다.",
      },
    },
    {
      area: "dj",
      category: "feature",
      platform: "desktop",
      title: {
        en: "Live requests can reach the AI DJ",
        zh: "直播点歌可接入 AI DJ",
        ja: "ライブリクエストを AI DJ へ接続",
        ko: "라이브 요청을 AI DJ로 전달",
      },
      description: {
        en: "Live request intake now has Electron runtime support, webhook presets, secure request parsing, library search, routing primitives, and an AI DJ handoff path.",
        zh: "直播点歌入口新增 Electron 运行时支持、Webhook 预设、安全请求解析、媒体库搜索、路由原语，以及转交给 AI DJ 的路径。",
        ja: "ライブリクエスト取り込みに Electron ランタイム対応、Webhook プリセット、安全なリクエスト解析、ライブラリ検索、ルーティング基盤、AI DJ への引き渡し経路を追加しました。",
        ko: "라이브 요청 수집에 Electron 런타임 지원, 웹훅 프리셋, 안전한 요청 파싱, 라이브러리 검색, 라우팅 기본 요소, AI DJ 전달 경로가 추가되었습니다.",
      },
    },
    {
      area: "dj",
      category: "improvement",
      platform: "all",
      title: {
        en: "AI DJ understands local library references",
        zh: "AI DJ 能理解本地媒体库引用",
        ja: "AI DJ がローカルライブラリ参照を理解",
        ko: "AI DJ가 로컬 라이브러리 참조를 이해",
      },
      description: {
        en: "The chat tools now expose compact local IDs, a library tree tool, tool metadata, and activity UI so DJ workflows can refer to sets, tracks, albums, and artists more precisely.",
        zh: "聊天工具现在提供紧凑本地 ID、媒体库树工具、工具元数据和活动 UI，让 DJ 工作流能更准确地引用歌单、曲目、专辑和艺人。",
        ja: "チャットツールは短いローカル ID、ライブラリツリーツール、ツールメタデータ、アクティビティ UI を持ち、DJ ワークフローがセット、曲、アルバム、アーティストをより正確に参照できます。",
        ko: "채팅 도구는 짧은 로컬 ID, 라이브러리 트리 도구, 도구 메타데이터, 활동 UI를 제공해 DJ 워크플로가 세트, 트랙, 앨범, 아티스트를 더 정확히 참조할 수 있습니다.",
      },
    },
    {
      area: "settings",
      category: "improvement",
      platform: "all",
      title: {
        en: "Performance, cache, and import controls",
        zh: "性能、缓存与导入控制",
        ja: "パフォーマンス、キャッシュ、インポート操作",
        ko: "성능, 캐시, 가져오기 제어",
      },
      description: {
        en: "Settings now includes a Performance pane with graphics quality presets and GPU backend controls, storage usage and cache tools, recursive folder sync, local cache opening, and cover repair progress.",
        zh: "设置新增性能页，包含图形质量预设和 GPU 后端控制；同时加入存储占用与缓存工具、递归文件夹同步、打开本地缓存目录，以及封面修复进度。",
        ja: "設定に Performance ペインを追加し、グラフィック品質プリセットと GPU バックエンド操作を用意しました。ストレージ使用量、キャッシュ操作、再帰フォルダ同期、ローカルキャッシュを開く操作、カバー修復進捗も追加しています。",
        ko: "설정에 그래픽 품질 프리셋과 GPU 백엔드 제어가 있는 Performance 패널이 추가되었습니다. 저장 공간 사용량과 캐시 도구, 재귀 폴더 동기화, 로컬 캐시 폴더 열기, 커버 복구 진행률도 포함됩니다.",
      },
    },
    {
      area: "visualizer",
      category: "improvement",
      platform: "all",
      title: {
        en: "Unified visualizer tuning",
        zh: "统一的可视化调节",
        ja: "統一されたビジュアライザー調整",
        ko: "통합된 비주얼라이저 튜닝",
      },
      description: {
        en: "Visualizer controls are now unified across styles with per-style help, updated defaults, better placement, background tuning, and cleaner mode icons.",
        zh: "可视化控制在各样式间统一，并加入按样式的帮助说明、更新后的默认值、更好的摆放、背景调节和更清晰的模式图标。",
        ja: "ビジュアライザー操作をスタイル間で統一し、スタイル別ヘルプ、新しい既定値、配置改善、背景調整、見やすいモードアイコンを追加しました。",
        ko: "비주얼라이저 제어가 스타일 전반에서 통합되었고, 스타일별 도움말, 업데이트된 기본값, 개선된 배치, 배경 튜닝, 더 명확한 모드 아이콘이 추가되었습니다.",
      },
    },
    {
      area: "library",
      category: "fix",
      platform: "all",
      title: {
        en: "Covers stay sharp without scroll flashes",
        zh: "封面更清晰，滚动不闪烁",
        ja: "スクロール中もカバーを鮮明に保持",
        ko: "스크롤 중에도 선명하고 깜박임 없는 커버",
      },
      description: {
        en: "Cover derivatives are cached and repaired in batches, imported cover metadata extraction is workerized with backpressure, and list scrolling keeps already loaded covers instead of flashing placeholders.",
        zh: "封面派生图会缓存并可批量修复；导入封面元数据改由 worker 处理并带背压；列表滚动时会保留已加载封面，不再闪回占位图。",
        ja: "カバー派生画像をキャッシュし、バッチ修復できるようにしました。インポート時のカバーメタデータ抽出はバックプレッシャー付きで worker 化し、リストスクロール中も読み込み済みカバーを保持してプレースホルダーの点滅を避けます。",
        ko: "커버 파생 이미지를 캐시하고 배치로 복구할 수 있습니다. 가져온 커버 메타데이터 추출은 백프레셔가 있는 worker로 처리되며, 목록 스크롤 중에는 이미 로드된 커버를 유지해 플레이스홀더 깜박임을 피합니다.",
      },
    },
    {
      area: "player",
      category: "fix",
      platform: "all",
      title: {
        en: "More reliable playback state",
        zh: "更可靠的播放状态",
        ja: "より信頼できる再生状態",
        ko: "더 안정적인 재생 상태",
      },
      description: {
        en: "Volume persists, selected current tracks resume correctly, held transport shortcuts are throttled, stale cover loads are ignored, and remote/local cover assets are deduped before they can disturb playback.",
        zh: "音量会持久化，选中的当前曲目能正确恢复；长按播放控制会节流；过期封面加载会被忽略，远端/本地封面资源也会去重，避免干扰播放。",
        ja: "音量は保持され、選択中の現在曲は正しく復元されます。押し続けたトランスポートショートカットは抑制され、古いカバー読み込みは無視し、リモート/ローカルのカバー資産は重複排除して再生への影響を避けます。",
        ko: "볼륨이 유지되고 선택된 현재 트랙이 올바르게 복원됩니다. 길게 누른 재생 제어 단축키는 조절되고, 오래된 커버 로드는 무시되며, 원격/로컬 커버 자산은 중복 제거되어 재생을 방해하지 않습니다.",
      },
    },
  ],
};

export default release;
