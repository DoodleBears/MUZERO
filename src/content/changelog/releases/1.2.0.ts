import type { ChangelogRelease } from "../types";

const release: ChangelogRelease = {
  version: "1.2.0",
  date: "2026-06-18",
  title: {
    en: "QQ Music, coverflow, and silky-smooth big libraries",
    zh: "QQ 音乐、封面流（Coverflow）与丝滑的大曲库",
    ja: "QQ Music、カバーフロー、そして大規模ライブラリの滑らかさ",
    ko: "QQ Music, 커버플로우, 그리고 매끄러운 대용량 라이브러리",
  },
  summary: {
    en: "Search and import from QQ Music, switch songs by dragging a 3D coverflow where the cover, background, palette, and backlight move as one, and keep smooth playback, search, and editing even on libraries of thousands of tracks. Live requests gain command-prefix gating, and the flow background now glides between covers.",
    zh: "可搜索并导入 QQ 音乐；拖动 3D 封面流（Coverflow）切歌，封面、背景、取色与背光一同移动；即便上千首的大曲库，播放、搜索、编辑依旧流畅。弹幕点歌新增命令前缀门控，流光背景在切歌时平滑过渡。",
    ja: "QQ Music を検索・インポートでき、3D カバーフローをドラッグして曲を切り替え（カバー・背景・配色・バックライトが一体で動く）、数千曲のライブラリでも再生・検索・編集が滑らかなまま。ライブリクエストにコマンド接頭辞ゲートが加わり、フロー背景は曲間でグライドします。",
    ko: "QQ Music를 검색·가져오고, 3D 커버플로우를 드래그해 곡을 전환하며(커버·배경·팔레트·백라이트가 하나처럼 이동), 수천 곡 라이브러리에서도 재생·검색·편집이 매끄럽게 유지됩니다. 라이브 신청에 명령 접두사 게이팅이 추가되고, 플로우 배경이 곡 사이를 부드럽게 전환합니다.",
  },
  items: [
    {
      area: "streaming",
      category: "highlight",
      platform: "desktop",
      title: {
        en: "QQ Music as an online source",
        zh: "QQ 音乐作为在线音源",
        ja: "オンラインソースとしての QQ Music",
        ko: "온라인 소스로서의 QQ Music",
      },
      description: {
        en: "Search QQ Music and play tracks right inside MUZERO. Log in through a built-in window to reach your own library, sync 我的歌单 (your playlists), and import any playlist by pasting its link or share short-link. Guest playback stays within the plaintext quality ceiling — encrypted VIP files are never decrypted.",
        zh: "在 MUZERO 内直接搜索并播放 QQ 音乐。通过内置登录窗口接入你自己的曲库、同步「我的歌单」，并可粘贴歌单链接或分享短链来导入任意歌单。游客播放封顶在明文音质——绝不解密加密的 VIP 文件。",
        ja: "MUZERO 内で QQ Music を検索して再生できます。内蔵のログインウィンドウから自分のライブラリにアクセスし、「我的歌单（マイプレイリスト）」を同期し、リンクや共有短縮リンクを貼り付けて任意のプレイリストをインポートできます。ゲスト再生は平文音質が上限で、暗号化された VIP ファイルは復号しません。",
        ko: "MUZERO 안에서 QQ Music를 검색해 바로 재생합니다. 내장 로그인 창으로 내 라이브러리에 접속하고 「我的歌单(내 플레이리스트)」을 동기화하며, 링크나 공유 단축 링크를 붙여넣어 어떤 플레이리스트든 가져올 수 있습니다. 게스트 재생은 평문 음질이 상한이며 암호화된 VIP 파일은 복호화하지 않습니다.",
      },
    },
    {
      area: "player",
      category: "highlight",
      platform: "all",
      title: {
        en: "Coverflow Now Playing",
        zh: "封面流（Coverflow）正在播放",
        ja: "カバーフローの再生中ビュー",
        ko: "커버플로우 재생 화면",
      },
      description: {
        en: "Drag the album cover to flip through your queue in a 3D coverflow. The cover, blurred background, color palette, backlight, and shadow all travel and crossfade together — with no black frames or flicker at the hand-off, on both drag and external switches.",
        zh: "拖动专辑封面，在 3D 封面流里翻看队列。封面、模糊背景、取色、背光与阴影一同移动并交叉淡入——无论拖动还是外部切歌，交接处都不再有黑帧或闪烁。",
        ja: "アルバムカバーをドラッグして 3D カバーフローでキューをめくれます。カバー・ぼかし背景・配色・バックライト・影が一緒に移動してクロスフェードし、ドラッグでも外部からの切り替えでも、引き継ぎ時に黒フレームやちらつきが出ません。",
        ko: "앨범 커버를 드래그해 3D 커버플로우로 대기열을 넘깁니다. 커버·블러 배경·팔레트·백라이트·그림자가 함께 이동하며 크로스페이드되어, 드래그든 외부 전환이든 전환 지점에서 검은 프레임이나 깜빡임이 없습니다.",
      },
    },
    {
      area: "player",
      category: "improvement",
      platform: "all",
      title: {
        en: "Smooth on libraries of thousands of tracks",
        zh: "上千首曲库依旧流畅",
        ja: "数千曲のライブラリでも滑らか",
        ko: "수천 곡 라이브러리에서도 매끄럽게",
      },
      description: {
        en: "Switching songs and editing track metadata no longer drop frames on very large queues and libraries. Likes and play counts moved off the catalog row into side tables, the queue and search indexes were split so a single edit re-renders one row instead of the whole list, and hidden tabs stop reconciling on every playback heartbeat.",
        zh: "在超大队列与曲库上，切歌与编辑歌曲信息不再掉帧。红心与播放次数从主表移到旁路侧表，队列与搜索索引被拆分——一次编辑只重渲一行而非整列；隐藏标签页也不再随每次播放心跳重渲。",
        ja: "非常に大きなキューやライブラリでも、曲の切り替えやメタデータ編集でフレーム落ちしなくなりました。いいねと再生回数をカタログ行からサイドテーブルへ移し、キューと検索インデックスを分割して 1 回の編集でリスト全体ではなく 1 行だけ再描画し、隠れたタブは再生ハートビートごとの再調整を止めました。",
        ko: "매우 큰 대기열과 라이브러리에서도 곡 전환과 메타데이터 편집 시 프레임이 끊기지 않습니다. 좋아요와 재생 횟수를 카탈로그 행에서 보조 테이블로 옮기고, 대기열·검색 인덱스를 분리해 한 번의 편집이 전체 목록이 아닌 한 행만 다시 렌더링하며, 숨겨진 탭은 재생 하트비트마다 재조정하지 않습니다.",
      },
    },
    {
      area: "search",
      category: "improvement",
      platform: "all",
      title: {
        en: "Faster global search on large libraries",
        zh: "大曲库下更快的全局搜索",
        ja: "大規模ライブラリでより速いグローバル検索",
        ko: "대용량 라이브러리에서 더 빠른 전역 검색",
      },
      description: {
        en: "Global search opens and responds instantly even with thousands of tracks. Search-variant indexes are precomputed, the open-window index burst is pre-warmed, and facet/set/lyrics matching runs off the keystroke frame so typing stays fluid.",
        zh: "即使上千首歌，全局搜索也能瞬开瞬应。搜索变体索引提前预计算，开窗时的索引峰值被预热，分面/集/歌词匹配从按键帧移出——打字始终顺滑。",
        ja: "数千曲あってもグローバル検索が瞬時に開いて応答します。検索バリアントのインデックスを事前計算し、ウィンドウを開く際のインデックス処理を先行ウォームアップし、ファセット/セット/歌詞のマッチングをキー入力フレームの外で実行するため、タイピングが滑らかなままです。",
        ko: "수천 곡이 있어도 전역 검색이 즉시 열리고 응답합니다. 검색 변형 인덱스를 미리 계산하고, 창을 열 때의 인덱스 부하를 사전 예열하며, 패싯/세트/가사 매칭을 키 입력 프레임 밖에서 실행해 타이핑이 매끄럽게 유지됩니다.",
      },
    },
    {
      area: "settings",
      category: "feature",
      platform: "all",
      title: {
        en: "Command-prefix gating for live requests",
        zh: "弹幕点歌的命令前缀门控",
        ja: "ライブリクエストのコマンド接頭辞ゲート",
        ko: "라이브 신청의 명령 접두사 게이팅",
      },
      description: {
        en: "Require chat messages to start with a command prefix — entered as chips — before they count as song requests, so ordinary chatter is ignored. Requests run through a FIFO queue, and play-now / play-next cut in relative to the track you're actually on.",
        zh: "可要求弹幕消息以命令前缀开头（以标签 chip 形式录入）才算点歌，普通聊天会被忽略。请求按先进先出队列处理，立即播放 / 下一首播放会相对你当前所在的歌曲插入。",
        ja: "チャットメッセージがコマンド接頭辞（チップとして入力）で始まる場合のみ曲リクエストとして扱うようにでき、通常の雑談は無視されます。リクエストは FIFO キューで処理され、今すぐ再生／次に再生は実際に再生中の曲を基準に割り込みます。",
        ko: "채팅 메시지가 명령 접두사(칩으로 입력)로 시작할 때만 신청곡으로 인정하도록 할 수 있어 일반 잡담은 무시됩니다. 요청은 FIFO 대기열로 처리되며, 지금 재생 / 다음 재생은 실제로 재생 중인 곡을 기준으로 끼어듭니다.",
      },
    },
    {
      area: "visualizer",
      category: "improvement",
      platform: "all",
      title: {
        en: "Flow background glides between songs",
        zh: "流光背景在切歌间平滑过渡",
        ja: "フロー背景が曲間でグライド",
        ko: "플로우 배경이 곡 사이를 전환",
      },
      description: {
        en: "The cover-painted flow background now crossfades its color palette from one song to the next instead of snapping, and the spectrum's cover-derived accent color glides along with it.",
        zh: "由封面取色的流光背景，现在会在歌曲之间交叉淡变取色，而非生硬跳变；频谱的封面派生主色也随之平滑滑动。",
        ja: "カバーから色を取るフロー背景が、曲ごとに配色をパッと切り替えるのではなくクロスフェードするようになり、スペクトラムのカバー由来のアクセントカラーも一緒にグライドします。",
        ko: "커버에서 색을 추출한 플로우 배경이 곡 간에 팔레트를 갑자기 바꾸지 않고 크로스페이드하며, 스펙트럼의 커버 기반 강조색도 함께 부드럽게 전환됩니다.",
      },
    },
    {
      area: "player",
      category: "feature",
      platform: "all",
      title: {
        en: "Dim-layer backdrop blur control",
        zh: "暗化层背景模糊调节",
        ja: "ディムレイヤーの背景ぼかし調整",
        ko: "딤 레이어 배경 흐림 조절",
      },
      description: {
        en: "Now Playing gains a slider to blur the backdrop behind the dim layer, for a softer, more focused stage.",
        zh: "正在播放新增滑杆，可模糊暗化层后方的背景，让舞台更柔和、更聚焦。",
        ja: "再生中ビューに、ディムレイヤーの背後の背景をぼかすスライダーが加わり、より柔らかく集中できるステージになります。",
        ko: "재생 화면에 딤 레이어 뒤 배경을 흐리는 슬라이더가 추가되어 더 부드럽고 집중되는 무대를 만듭니다.",
      },
    },
    {
      area: "app",
      category: "improvement",
      platform: "desktop",
      title: {
        en: "Window border reacts to cover drag",
        zh: "窗口边框随封面拖动而变化",
        ja: "ウィンドウ枠がカバーのドラッグに反応",
        ko: "창 테두리가 커버 드래그에 반응",
      },
      description: {
        en: "On Windows, the desktop window border color follows the cover-drag progress, stays uniform on every edge, and disappears in F-key fullscreen.",
        zh: "在 Windows 上，桌面窗口边框颜色会跟随封面拖动进度变化，各边保持一致，并在 F 键全屏时隐去。",
        ja: "Windows では、デスクトップウィンドウの枠色がカバーのドラッグ進行に追従し、すべての辺で均一になり、F キーのフルスクリーンでは消えます。",
        ko: "Windows에서 데스크톱 창 테두리 색이 커버 드래그 진행에 따라 변하고 모든 가장자리에서 균일하게 유지되며, F 키 전체화면에서는 사라집니다.",
      },
    },
    {
      area: "app",
      category: "fix",
      platform: "all",
      title: {
        en: "Error notifications copy the full stack trace",
        zh: "错误通知复制完整堆栈",
        ja: "エラー通知が完全なスタックトレースをコピー",
        ko: "오류 알림이 전체 스택 트레이스를 복사",
      },
      description: {
        en: "Copying an error notification now always includes the complete stack trace, making problems easier to report and diagnose.",
        zh: "复制错误通知时现在始终包含完整堆栈，便于上报与排查。",
        ja: "エラー通知をコピーすると常に完全なスタックトレースが含まれるようになり、問題の報告と診断が容易になりました。",
        ko: "오류 알림을 복사하면 이제 항상 전체 스택 트레이스가 포함되어 문제 보고와 진단이 쉬워집니다.",
      },
    },
    {
      area: "memory",
      category: "fix",
      platform: "all",
      title: {
        en: "Memory mode uses a quote icon",
        zh: "记忆模式改用引号图标",
        ja: "メモリーモードが引用アイコンに",
        ko: "메모리 모드가 인용 아이콘 사용",
      },
      description: {
        en: "The memory (DJ context) mode now shows a quote icon, a better fit for “music carries memories.”",
        zh: "记忆（DJ 上下文）模式现在显示引号图标，更贴合「音乐承载回忆」。",
        ja: "メモリー（DJ コンテキスト）モードが引用アイコンを表示するようになり、「音楽は思い出を運ぶ」によりふさわしくなりました。",
        ko: "메모리(DJ 컨텍스트) 모드가 인용 아이콘을 표시해 “음악은 추억을 담는다”에 더 잘 어울립니다.",
      },
    },
  ],
};

export default release;
