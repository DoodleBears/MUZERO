import type { ChangelogRelease } from "../types";

const release: ChangelogRelease = {
  version: "1.2.1",
  date: "2026-06-18",
  title: {
    en: "Sortable Hearted playlist and rock-solid covers",
    zh: "可排序的红心歌单与稳如磐石的封面",
    ja: "並べ替えできるハートのプレイリストと、ぶれないカバー",
    ko: "정렬 가능한 하트 플레이리스트와 흔들림 없는 커버",
  },
  summary: {
    en: "Sort the Hearted playlist — newest-hearted first by default, or by name, added, played, or duration. Remote/R2 covers now show on the web and can be saved to your device, while covers stay solid everywhere: no blanking while you scroll, and no sticking on the previous track when you skip a streamed song. The Dock queue drawer is now a pure up-next list.",
    zh: "红心歌单现在可排序——默认按最近红心时间排列，也可按名称、加入时间、最近播放或时长。远程 / R2 封面现可在网页端显示并下载到本地；同时封面在各处都更稳：滚动时不再空白，切换在线歌曲时也不再停留在上一首的封面。Dock 队列抽屉现在是纯粹的「接下来播放」列表。",
    ja: "ハートのプレイリストを並べ替えできるようになりました。既定は最近ハートした順で、名前・追加日・再生・長さでも並べ替え可能です。リモート／R2 のカバーがウェブでも表示でき、端末に保存できるようになり、カバーはどの画面でも安定します。スクロール中に空白にならず、ストリーミング曲をスキップしても前の曲のカバーに留まりません。Dock のキュー引き出しは純粋な「次に再生」リストになりました。",
    ko: "하트 플레이리스트를 정렬할 수 있습니다. 기본은 최근에 하트한 순이며 이름·추가일·재생·길이로도 정렬됩니다. 원격/R2 커버가 웹에서도 표시되고 기기에 저장할 수 있으며, 커버는 어디서나 안정적입니다. 스크롤 중에 비지 않고, 스트리밍 곡을 건너뛰어도 이전 곡 커버에 머무르지 않습니다. Dock 대기열 서랍은 순수한 ‘다음 재생’ 목록이 되었습니다.",
  },
  items: [
    {
      area: "library",
      category: "feature",
      platform: "all",
      title: {
        en: "Sort the Hearted playlist",
        zh: "红心歌单排序",
        ja: "ハートのプレイリストを並べ替え",
        ko: "하트 플레이리스트 정렬",
      },
      description: {
        en: "The Hearted playlist gains gallery-style sort chips: by when you hearted each song (the new default — most recently hearted first), or by name, added, last played, or duration. Tap the active chip again to flip the direction.",
        zh: "红心歌单新增与曲库一致的排序标签：可按红心时间排序（新的默认项——最近红心的排最前），也可按名称、加入时间、最近播放或时长。再次点击当前激活的标签即可翻转升 / 降序。",
        ja: "ハートのプレイリストに、ライブラリと同じ並べ替えチップが加わりました。ハートした時刻（新しい既定＝最近ハートした順）のほか、名前・追加日・最終再生・長さで並べ替えられます。アクティブなチップをもう一度タップすると昇順／降順が切り替わります。",
        ko: "하트 플레이리스트에 라이브러리와 같은 정렬 칩이 추가되었습니다. 하트한 시각(새 기본값 — 가장 최근에 하트한 순) 외에 이름·추가일·최근 재생·길이로 정렬할 수 있습니다. 활성 칩을 다시 누르면 오름차순/내림차순이 전환됩니다.",
      },
    },
    {
      area: "library",
      category: "feature",
      platform: "all",
      title: {
        en: "Remote covers on the web, and download covers to your device",
        zh: "网页端显示远程封面，并可下载封面到本地",
        ja: "ウェブでもリモートカバーを表示、カバーを端末に保存",
        ko: "웹에서 원격 커버 표시 및 커버를 기기에 저장",
      },
      description: {
        en: "Remote / R2 covers now display across the web shell — now-playing stage, Dock, gallery grid, and track-row list — instead of falling back to a blank or thumbhash. On desktop you can also save a streamed track's cover to a local blob (single or whole-set), with optional auto-caching on first play.",
        zh: "远程 / R2 封面现在能在网页端各处显示——正在播放舞台、Dock、画廊网格与列表行——不再回退到空白或缩略哈希。在桌面端，你还可以把在线歌曲的封面下载为本地 blob（单首或整集），并可选在首次播放时自动缓存。",
        ja: "リモート／R2 のカバーが、再生中ステージ・Dock・ギャラリーグリッド・トラック行リストなどウェブ全体で表示されるようになり、空白やサムハッシュへのフォールバックがなくなりました。デスクトップでは、ストリーミング曲のカバーをローカル blob に保存（単曲またはセット全体）でき、初回再生時の自動キャッシュも選べます。",
        ko: "원격/R2 커버가 재생 스테이지·Dock·갤러리 그리드·트랙 행 목록 등 웹 전반에서 표시되어 빈 화면이나 섬해시로 대체되지 않습니다. 데스크톱에서는 스트리밍 곡의 커버를 로컬 blob으로 저장(단일 또는 세트 전체)할 수 있고, 첫 재생 시 자동 캐시도 선택할 수 있습니다.",
      },
    },
    {
      area: "player",
      category: "improvement",
      platform: "all",
      title: {
        en: "Dock queue drawer is a pure up-next list",
        zh: "Dock 队列抽屉成为纯「接下来播放」列表",
        ja: "Dock のキュー引き出しが純粋な「次に再生」リストに",
        ko: "Dock 대기열 서랍이 순수한 ‘다음 재생’ 목록으로",
      },
      description: {
        en: "The Dock queue drawer now mirrors only the current playback queue. The pinned Hearted / Recently Played / Most Played sources moved to the library page, so the drawer stays a focused up-next view and no longer reads the whole library to build them.",
        zh: "Dock 队列抽屉现在只映射当前播放队列。固定的红心 / 最近播放 / 最多播放入口已移到曲库页面，抽屉因此保持为聚焦的「接下来播放」视图，也不再为构建它们而读取整个曲库。",
        ja: "Dock のキュー引き出しは現在の再生キューだけを映すようになりました。固定の「ハート／最近再生／最も再生」のソースはライブラリページへ移り、引き出しは「次に再生」に集中したビューのままになり、それらを作るためにライブラリ全体を読み込まなくなりました。",
        ko: "Dock 대기열 서랍은 이제 현재 재생 대기열만 반영합니다. 고정된 하트/최근 재생/가장 많이 재생 소스는 라이브러리 페이지로 옮겨져, 서랍은 ‘다음 재생’에 집중한 뷰로 유지되며 이를 구성하려고 전체 라이브러리를 읽지 않습니다.",
      },
    },
    {
      area: "player",
      category: "fix",
      platform: "all",
      title: {
        en: "Skipping a streamed song no longer leaves the previous cover",
        zh: "切换在线歌曲不再停留在上一首封面",
        ja: "ストリーミング曲のスキップで前のカバーが残らない",
        ko: "스트리밍 곡을 건너뛰어도 이전 커버가 남지 않음",
      },
      description: {
        en: "When you skipped via the next button or a Dock drag, a streamed / R2 cover that resolves over the network could leave the stage showing the previous track's cover while the title, artist, and audio had already advanced. Every commit path now waits for the new cover to paint before handing off.",
        zh: "此前用下一首按钮或 Dock 拖动切歌时，需要联网解析的在线 / R2 封面可能让舞台仍显示上一首的封面，而标题、艺人和音频已经切换。现在所有提交路径都会等待新封面绘制完成后再交接。",
        ja: "次へボタンや Dock のドラッグで切り替えたとき、ネットワーク越しに解決するストリーミング／R2 のカバーで、タイトル・アーティスト・音声はもう進んでいるのにステージが前の曲のカバーを表示し続けることがありました。すべてのコミット経路で、新しいカバーが描画されてから引き継ぐようになりました。",
        ko: "다음 버튼이나 Dock 드래그로 전환할 때, 네트워크로 해석되는 스트리밍/R2 커버에서 제목·아티스트·오디오는 이미 넘어갔는데 스테이지가 이전 곡 커버를 계속 보여줄 수 있었습니다. 이제 모든 커밋 경로가 새 커버가 그려진 뒤에 전환합니다.",
      },
    },
    {
      area: "library",
      category: "fix",
      platform: "all",
      title: {
        en: "Remote cover thumbnails stay visible while scrolling",
        zh: "滚动时远程封面缩略图保持显示",
        ja: "スクロール中もリモートカバーのサムネイルが表示され続ける",
        ko: "스크롤 중에도 원격 커버 썸네일이 계속 표시됨",
      },
      description: {
        en: "In the virtualized track list, an already-loaded remote / R2 cover used to blank back to its thumbhash while you scrolled, reappearing only when you stopped. It now keeps showing during the scroll — matching how local covers behave — while never-seen covers still defer so a fast fling doesn't trigger a fetch-per-row storm.",
        zh: "在虚拟化列表里，已加载的远程 / R2 封面过去在滚动时会退回缩略哈希，停下才重新出现。现在它在滚动期间持续显示——与本地封面一致——而从未见过的封面仍会延迟加载，避免快速滑动引发逐行抓取风暴。",
        ja: "仮想化されたトラックリストで、読み込み済みのリモート／R2 カバーがスクロール中にサムハッシュへ戻り、止めると再表示されていました。今はスクロール中も表示され続け（ローカルカバーと同じ挙動）、未表示のカバーは引き続き遅延読み込みされるため、勢いよくフリックしても行ごとの取得が殺到しません。",
        ko: "가상화된 트랙 목록에서 이미 로드된 원격/R2 커버가 스크롤 중에 섬해시로 돌아갔다가 멈춰야 다시 나타났습니다. 이제 스크롤 중에도 계속 표시되며(로컬 커버와 동일), 본 적 없는 커버는 여전히 지연 로드되어 빠른 플링에도 행마다 가져오기가 몰리지 않습니다.",
      },
    },
    {
      area: "app",
      category: "fix",
      platform: "desktop",
      title: {
        en: "Dragging a cover no longer triggers the drop overlay",
        zh: "拖动封面不再触发拖放遮罩",
        ja: "カバーのドラッグでドロップオーバーレイが出なくなった",
        ko: "커버를 드래그해도 드롭 오버레이가 뜨지 않음",
      },
      description: {
        en: "Dragging an in-app cover (e.g. the artist page album strip) falsely tripped the “drop to add” overlay, which should react only to external OS files. Covers are now non-draggable everywhere, and the overlay gains a close button as an escape hatch for the rare case a browser drops the drag-end event and leaves it stuck.",
        zh: "拖动应用内封面（如艺人页的专辑条）会误触发「拖放添加」遮罩，而该遮罩本应只对来自系统的外部文件作出反应。现在封面在各处都不可拖拽，遮罩还新增了关闭按钮——以应对浏览器偶尔丢失拖拽结束事件、导致遮罩卡住的罕见情况。",
        ja: "アプリ内のカバー（アーティストページのアルバム帯など）をドラッグすると、本来は OS の外部ファイルにのみ反応すべき「ドロップして追加」オーバーレイが誤って表示されていました。カバーはどこでもドラッグ不可になり、ブラウザがドラッグ終了イベントを取りこぼしてオーバーレイが固まる稀なケースに備え、閉じるボタンも追加されました。",
        ko: "앱 내 커버(아티스트 페이지의 앨범 띠 등)를 드래그하면 OS 외부 파일에만 반응해야 할 ‘드롭하여 추가’ 오버레이가 잘못 떴습니다. 이제 커버는 어디서나 드래그할 수 없으며, 브라우저가 드래그 종료 이벤트를 놓쳐 오버레이가 멈추는 드문 경우를 위한 닫기 버튼이 추가되었습니다.",
      },
    },
  ],
};

export default release;
