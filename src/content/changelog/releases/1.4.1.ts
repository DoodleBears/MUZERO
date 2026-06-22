import type { ChangelogRelease } from "../types";

const release: ChangelogRelease = {
  version: "1.4.1",
  date: "2026-06-23",
  title: {
    en: "Playback that does exactly what you see",
    zh: "所见即所播：播放队列大修",
    ja: "見えているとおりに再生する",
    ko: "보이는 그대로 재생되는 재생 경험",
  },
  summary: {
    en: "A refinement release built around one idea: the queue you see is the queue that plays. Songs now play from the playlist you're actually viewing — not wherever they were first saved — and the visible queue is the real play order, shuffle included, so 'play next' and song requests land exactly where you expect and your queue survives a restart. Background progress for downloads, song loading, and syncing collapses into a single notification stack with real, cancelable progress. Search can now find Japanese songs by romaji (type 'sakura' to find 桜), cover art looks sharper, favlist / playlist downloads are sturdier, and several Now Playing and tab-switching glitches are fixed.",
    zh: "一次以「所见即所播」为核心的打磨更新。歌曲现在从你正在浏览的歌单播放——而不是它最初被保存的那个歌单——可见队列就是真实的播放顺序（含随机播放），所以「下一首播放」和点歌都会精准落在你预期的位置，队列也能在重启后保留。下载、切歌加载、同步的后台进度收敛到同一个通知栈，带真实可取消的进度。搜索现在能用罗马音找到日文歌（输入 sakura 找到 桜），封面更清晰，收藏夹 / 歌单下载更稳健，并修复了若干 Now Playing 与 tab 切换的问题。",
    ja: "「見えているキューがそのまま再生される」を軸にした調整リリースです。曲は最初に保存した場所ではなく、いま開いているプレイリストから再生され、見えているキューがそのまま再生順（シャッフル含む）になります。だから「次に再生」やリクエストは思ったとおりの位置に入り、キューは再起動後も残ります。ダウンロード・曲の読み込み・同期の進捗は 1 つの通知スタックにまとまり、実進捗とキャンセルが可能になりました。検索はローマ字で日本語曲を見つけられ（sakura で 桜 にヒット）、カバー画像はよりシャープに、お気に入り / プレイリストのダウンロードはより堅牢になり、Now Playing とタブ切り替えの不具合も複数修正しています。",
    ko: "'보이는 큐가 그대로 재생된다'는 한 가지 아이디어를 중심으로 한 다듬기 릴리스입니다. 이제 곡은 처음 저장된 곳이 아니라 지금 보고 있는 재생목록에서 재생되고, 보이는 큐가 실제 재생 순서(셔플 포함)가 됩니다. 그래서 '다음에 재생'과 신청곡이 예상한 위치에 정확히 들어가고, 큐는 재시작 후에도 유지됩니다. 다운로드·곡 로딩·동기화 진행 상황은 하나의 알림 스택으로 모여 실제 진행률과 취소를 제공합니다. 검색은 로마자로 일본어 곡을 찾을 수 있고(sakura로 桜 검색), 커버 아트가 더 선명해지고, 즐겨찾기 / 재생목록 다운로드가 더 견고해졌으며, 여러 Now Playing 및 탭 전환 문제를 수정했습니다.",
  },
  items: [
    {
      area: "player",
      category: "highlight",
      platform: "all",
      title: {
        en: "Songs play from the playlist you're in — and the queue you see is the queue that plays",
        zh: "从你所在的歌单播放——所见队列即播放队列",
        ja: "いま開いているプレイリストから再生。見えているキューがそのまま再生される",
        ko: "보고 있는 재생목록에서 재생 — 보이는 큐가 곧 재생 큐",
      },
      description: {
        en: "Start a song and it now plays from the playlist you're actually viewing, instead of jumping to wherever the song was first saved (which could silently play nothing, or switch you to a different set). The visible queue is now the real play order — shuffle materializes into the list you see — so 'play next' and song requests land exactly next instead of being skipped, and the queue, its source, and its order all survive a restart.",
        zh: "现在点一首歌，它从你正在浏览的歌单播放，而不是跳到这首歌最初被保存的那个歌单（那曾会导致「点了没声音」或被切到别的歌单）。可见队列现在就是真实的播放顺序——随机播放会物化进你看到的列表——所以「下一首播放」和点歌会精准地排到下一首，而不是被跳过；队列、它的来源和顺序都能在重启后保留。",
        ja: "曲を再生すると、最初に保存した場所へ飛ぶのではなく、いま開いているプレイリストから再生されるようになりました（以前は「押しても無音」や別のセットに切り替わることがありました）。見えているキューがそのまま再生順になり、シャッフルも見えているリストに反映されます。だから「次に再生」やリクエストはスキップされず確実に次へ入り、キュー・その出所・並び順は再起動後も残ります。",
        ko: "이제 곡을 재생하면 처음 저장된 곳으로 이동하지 않고, 지금 보고 있는 재생목록에서 재생됩니다(이전에는 '눌러도 무음'이거나 다른 세트로 바뀌기도 했습니다). 보이는 큐가 실제 재생 순서가 되고 셔플도 보이는 목록에 반영됩니다. 그래서 '다음에 재생'과 신청곡이 건너뛰어지지 않고 정확히 다음에 들어가며, 큐와 그 출처·순서가 재시작 후에도 유지됩니다.",
      },
    },
    {
      area: "player",
      category: "feature",
      platform: "all",
      title: {
        en: "Stable shuffle you can actually see",
        zh: "稳定且可见的随机播放",
        ja: "見えて安定したシャッフル",
        ko: "눈에 보이고 안정적인 셔플",
      },
      description: {
        en: "Shuffle now lays out a fixed order into the visible queue once, instead of silently re-rolling every time the queue changes (which used to throw away a just-inserted 'next' track). A new setting controls whether toggling shuffle reshuffles the order or keeps the current one.",
        zh: "随机播放现在会把一个固定顺序一次性铺进可见队列，而不是每次队列变化就悄悄重洗（这曾把刚插入的「下一首」甩走）。新增设置可控制：切换随机播放是重新洗牌，还是保留当前顺序。",
        ja: "シャッフルは、キューが変わるたびに静かに振り直す（差し込んだばかりの「次の曲」を捨てていた）のではなく、固定した並びを一度だけ見えるキューに展開するようになりました。シャッフルの切り替えで並びを振り直すか現状を保つかを選べる設定を追加しました。",
        ko: "이제 셔플은 큐가 바뀔 때마다 조용히 다시 섞는(방금 삽입한 '다음 곡'을 버리던) 대신, 고정된 순서를 보이는 큐에 한 번 펼칩니다. 셔플을 토글할 때 순서를 다시 섞을지 현재 순서를 유지할지 정하는 설정이 추가되었습니다.",
      },
    },
    {
      area: "app",
      category: "feature",
      platform: "all",
      title: {
        en: "All background progress in one place",
        zh: "所有后台进度集中到一处",
        ja: "すべてのバックグラウンド進捗を 1 か所に",
        ko: "모든 백그라운드 진행 상황을 한곳에",
      },
      description: {
        en: "Downloads, song loading, syncing, and imports now all report into a single notification stack with real progress bars you can cancel — no more hunting across a floating badge, a tiny cover spinner, and a separate toast. Quick local track switches stay silent; only loads that actually take a moment surface a 'Downloading …' notification with byte-level progress.",
        zh: "下载、切歌加载、同步、导入现在统一汇报到同一个通知栈，带可取消的真实进度条——不用再在悬浮角标、封面上的小转圈、单独的 toast 之间来回找。瞬时的本地切歌保持安静；只有真正需要等一会儿的加载才会弹出带字节级进度的「正在下载…」通知。",
        ja: "ダウンロード・曲の読み込み・同期・インポートが、すべて 1 つの通知スタックにまとまり、キャンセルできる実進捗バーが付きました。フローティングバッジ・カバー上の小さなスピナー・別のトーストを探し回る必要はありません。瞬時のローカル切り替えは静かなまま、時間がかかる読み込みだけがバイト単位の進捗付きで「ダウンロード中…」通知を出します。",
        ko: "다운로드·곡 로딩·동기화·가져오기가 이제 모두 하나의 알림 스택으로 보고되며 취소 가능한 실제 진행 막대가 함께 표시됩니다. 더 이상 떠 있는 배지, 커버 위 작은 스피너, 별도 토스트를 찾아다닐 필요가 없습니다. 즉각적인 로컬 곡 전환은 조용히 처리되고, 실제로 시간이 걸리는 로딩만 바이트 단위 진행률과 함께 '다운로드 중…' 알림을 띄웁니다.",
      },
    },
    {
      area: "search",
      category: "feature",
      platform: "all",
      title: {
        en: "Find Japanese songs by romaji",
        zh: "用罗马音搜索日文歌",
        ja: "ローマ字で日本語曲を検索",
        ko: "로마자로 일본어 곡 검색",
      },
      description: {
        en: "⌘F search now reads kanji the Japanese way, so typing 'sakura' finds 桜 even when the title has no kana at all. Chinese titles still match by pinyin, and a pure-kanji title is searchable by either reading.",
        zh: "⌘F 搜索现在能按日文方式读汉字，所以输入 sakura 就能找到 桜，即使标题里完全没有假名。中文标题仍可用拼音匹配，纯汉字标题用两种读音都能搜到。",
        ja: "⌘F 検索が漢字を日本語の読みで解釈するようになり、かなが一切なくても sakura で 桜 にヒットします。中国語タイトルは引き続きピンインで一致し、純漢字タイトルはどちらの読みでも検索できます。",
        ko: "⌘F 검색이 한자를 일본어 방식으로 읽게 되어, 제목에 가나가 전혀 없어도 sakura로 桜를 찾습니다. 중국어 제목은 여전히 병음으로 일치하고, 순한자 제목은 두 가지 읽기 모두로 검색할 수 있습니다.",
      },
    },
    {
      area: "search",
      category: "improvement",
      platform: "all",
      title: {
        en: "A smarter ⌘F",
        zh: "更聪明的 ⌘F",
        ja: "より賢い ⌘F",
        ko: "더 똑똑해진 ⌘F",
      },
      description: {
        en: "A new @songs filter narrows results to just track names, the Songs section always shows its header so it reads as a distinct group, a pasted link jumps to the top of results, and result covers load right away instead of only on hover.",
        zh: "新增 @songs 过滤器可把结果收窄到只匹配歌名，Songs 区块现在始终显示标题、作为独立分组呈现，粘贴的链接会置顶到结果最前，结果封面也会立即加载、不再只在悬停时出现。",
        ja: "新しい @songs フィルターで曲名だけに絞り込め、Songs セクションは常に見出しを表示して独立したグループとして読めます。貼り付けたリンクは結果の先頭に来て、結果のカバーはホバー時だけでなくすぐに読み込まれます。",
        ko: "새 @songs 필터로 결과를 곡 이름으로만 좁힐 수 있고, Songs 섹션은 항상 헤더를 표시해 독립된 그룹으로 보입니다. 붙여넣은 링크는 결과 맨 위로 올라오고, 결과 커버는 호버할 때만이 아니라 즉시 로드됩니다.",
      },
    },
    {
      area: "library",
      category: "improvement",
      platform: "all",
      title: {
        en: "Crisper cover art",
        zh: "更清晰的封面",
        ja: "よりくっきりしたカバー画像",
        ko: "더 선명한 커버 아트",
      },
      description: {
        en: "List thumbnails now render at higher resolution (320px / quality 0.9) so they no longer look soft on hi-DPI screens, and the gallery grid uses the full-resolution original cover. Existing thumbnails regenerate sharper the next time they're shown.",
        zh: "列表缩略图现在以更高分辨率（320px / 质量 0.9）渲染，在高 DPI 屏幕上不再发虚，画廊网格则使用全分辨率原始封面。已有缩略图会在下次显示时重新生成得更清晰。",
        ja: "リストのサムネイルがより高解像度（320px / 品質 0.9）で描画され、高 DPI 画面でも甘く見えなくなりました。ギャラリーのグリッドはフル解像度の元カバーを使います。既存のサムネイルは次に表示されるときによりシャープに再生成されます。",
        ko: "목록 썸네일이 더 높은 해상도(320px / 품질 0.9)로 렌더링되어 고DPI 화면에서 더 이상 흐릿하지 않으며, 갤러리 그리드는 전체 해상도 원본 커버를 사용합니다. 기존 썸네일은 다음에 표시될 때 더 선명하게 다시 생성됩니다.",
      },
    },
    {
      area: "streaming",
      category: "improvement",
      platform: "desktop",
      title: {
        en: "Sturdier favlist & playlist downloads",
        zh: "更稳健的收藏夹 / 歌单下载",
        ja: "より堅牢なお気に入り / プレイリストのダウンロード",
        ko: "더 견고한 즐겨찾기 / 재생목록 다운로드",
      },
      description: {
        en: "Re-syncing a 收藏夹 / playlist now routes through the persistent download queue and skips items you've already saved, so it resumes, retries, and shows progress like everything else. You can choose video or audio for auto-sync downloads, single ⌘F downloads get the same retry queue, and a failed download now shows a copyable, detailed error instead of a vague failure.",
        zh: "重新同步收藏夹 / 歌单现在会走持久下载队列，并跳过你已保存的条目，因此能像其他下载一样续传、重试、显示进度。你可以为自动同步下载选择视频或音频，单个 ⌘F 下载也接入了同一套重试队列，下载失败时还会显示可复制的详细错误，而不是含糊的失败提示。",
        ja: "お気に入り / プレイリストの再同期が永続ダウンロードキューを通るようになり、すでに保存済みの項目はスキップされます。だから他のダウンロードと同じく再開・再試行・進捗表示ができます。自動同期のダウンロードは動画か音声を選べ、単体の ⌘F ダウンロードも同じ再試行キューに乗り、失敗時はあいまいなエラーではなくコピー可能な詳細エラーを表示します。",
        ko: "즐겨찾기 / 재생목록 재동기화가 이제 지속 다운로드 큐를 거치며 이미 저장한 항목은 건너뜁니다. 그래서 다른 다운로드처럼 이어받기·재시도·진행률 표시가 됩니다. 자동 동기화 다운로드는 영상 또는 오디오를 선택할 수 있고, 단일 ⌘F 다운로드도 같은 재시도 큐를 사용하며, 실패 시 모호한 오류 대신 복사 가능한 자세한 오류를 표시합니다.",
      },
    },
    {
      area: "player",
      category: "fix",
      platform: "all",
      title: {
        en: "Now Playing video and glow fixes",
        zh: "Now Playing 视频与背光修复",
        ja: "Now Playing の動画とグローの修正",
        ko: "Now Playing 영상 및 글로우 수정",
      },
      description: {
        en: "Switching to a video track by dragging the cover or using a shortcut no longer leaves the Now Playing stage stuck on the still cover while the background plays the video — the foreground now follows the live current track. The cover backlight glow also shows at rest again, not only while you're dragging the cover.",
        zh: "现在通过拖拽封面或快捷键切到视频曲目时，Now Playing 前台不会再卡在静止封面上、而背景却在放视频——前台现在会跟随实时的当前曲目。封面背光辉光也恢复在静置状态下显示，而不再只在拖拽封面时出现。",
        ja: "カバーをドラッグしたりショートカットで動画トラックに切り替えても、Now Playing の前面が静止カバーのまま固まり背景だけ動画が再生される、という不具合がなくなりました。前面はライブの現在トラックに追従します。カバーの背光グローも、ドラッグ中だけでなく静止時にも再び表示されます。",
        ko: "커버를 드래그하거나 단축키로 영상 트랙으로 전환해도, Now Playing 전경이 정지된 커버에 멈춘 채 배경에서만 영상이 재생되던 문제가 사라졌습니다. 전경이 실시간 현재 트랙을 따라갑니다. 커버 백라이트 글로우도 드래그할 때뿐 아니라 정지 상태에서도 다시 표시됩니다.",
      },
    },
    {
      area: "app",
      category: "fix",
      platform: "all",
      title: {
        en: "Faithful tab switching",
        zh: "忠实的 tab 切换",
        ja: "忠実なタブ切り替え",
        ko: "충실한 탭 전환",
      },
      description: {
        en: "Switching tabs with Ctrl+1 / Ctrl+2 no longer resets your library scroll position, sort order, or selected set — keyboard switching now behaves exactly like clicking the nav or a Dock song.",
        zh: "用 Ctrl+1 / Ctrl+2 切换 tab 不再重置资料库的滚动位置、排序或所选歌单——键盘切换现在与点击导航或 Dock 歌曲的行为完全一致。",
        ja: "Ctrl+1 / Ctrl+2 でタブを切り替えても、ライブラリのスクロール位置・並び順・選択中のセットがリセットされなくなりました。キーボードでの切り替えが、ナビや Dock の曲をクリックしたときとまったく同じ挙動になります。",
        ko: "Ctrl+1 / Ctrl+2로 탭을 전환해도 라이브러리 스크롤 위치, 정렬 순서, 선택한 세트가 초기화되지 않습니다. 키보드 전환이 내비게이션이나 Dock 곡을 클릭할 때와 완전히 동일하게 동작합니다.",
      },
    },
  ],
};

export default release;
