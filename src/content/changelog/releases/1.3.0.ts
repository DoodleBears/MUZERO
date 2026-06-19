import type { ChangelogRelease } from "../types";

const release: ChangelogRelease = {
  version: "1.3.0",
  date: "2026-06-20",
  title: {
    en: "Much more accurate lyrics matching, and a friendlier empty library",
    zh: "更准的歌词自动匹配，以及更友好的空曲库",
    ja: "格段に正確になった歌詞マッチングと、やさしい空のライブラリ",
    ko: "훨씬 정확해진 가사 매칭과 더 친절한 빈 라이브러리",
  },
  summary: {
    en: "Automatic lyrics matching got a lot smarter: titles and artists are normalized before lookup, a relaxation ladder recovers misses without caching the wrong version, a duration gate rejects same-length covers, and across sources MUZERO now prefers word-by-word karaoke. A match-progress toast shows what's happening with a one-tap Search fallback. Starting from an empty library is easier too — direct import actions and a one-click sample song — while large local folder sync and overall import/playback stay smoother with lower memory.",
    zh: "歌词自动匹配变聪明了很多：查找前先归一化标题与歌手，用多变体阶梯找回漏匹配且不再把错版本写进缓存，时长闸门会拒掉同长度的翻唱，并且在多来源之间优先选逐字 karaoke 歌词。匹配进度提示会显示当前状态，并提供一键“搜索”兜底。从空曲库起步也更容易了——直接导入入口加一键示例歌曲——同时大型本地文件夹同步与整体导入 / 播放更顺滑、内存更低。",
    ja: "歌詞の自動マッチングが大幅に賢くなりました。検索前にタイトルとアーティストを正規化し、緩和ラダーで取りこぼしを救いつつ誤った版をキャッシュせず、長さの近いカバーは時間ゲートで弾き、複数ソース間では単語単位のカラオケ歌詞を優先します。マッチ進捗トーストで状況がわかり、ワンタップの「検索」フォールバックも付きます。空のライブラリからの開始も簡単になり、直接取り込みアクションとワンクリックのサンプル曲を用意。大きなローカルフォルダ同期や取り込み・再生全体もメモリを抑えつつ滑らかになりました。",
    ko: "자동 가사 매칭이 훨씬 똑똑해졌습니다. 조회 전에 제목과 아티스트를 정규화하고, 완화 사다리로 놓친 곡을 되살리되 잘못된 버전을 캐시하지 않으며, 길이가 비슷한 커버는 재생 시간 게이트로 걸러내고, 여러 소스 사이에서는 한 단어씩 표시되는 가라오케 가사를 우선합니다. 매칭 진행 토스트가 상황을 보여주고 한 번 탭하는 검색 대체 동작도 제공합니다. 빈 라이브러리에서 시작하기도 쉬워져 바로 가져오기 동작과 원클릭 샘플 곡을 추가했고, 대용량 로컬 폴더 동기화와 전반적인 가져오기·재생도 메모리를 줄이며 더 매끄러워졌습니다.",
  },
  items: [
    {
      area: "lyrics",
      category: "highlight",
      platform: "all",
      title: {
        en: "Much more accurate automatic lyrics matching",
        zh: "更准的歌词自动匹配",
        ja: "格段に正確になった歌詞の自動マッチング",
        ko: "훨씬 정확해진 자동 가사 매칭",
      },
      description: {
        en: "MUZERO now normalizes titles and artists (stripping version, feat., and full-width brackets) before looking up lyrics, then walks a relaxation ladder so a near-miss still finds a match without caching the wrong version. A duration gate rejects same-length covers, and when several sources have lyrics it prefers word-by-word karaoke — so a NetEase per-syllable file can win over a first-arriving plain text one.",
        zh: "MUZERO 现在会在查词前先归一化标题与歌手（去掉版本、feat. 与全角括号），再沿多变体阶梯放宽查找，让差一点的情况也能匹配到，而不会把错版本写进缓存。时长闸门会拒掉同长度的翻唱；当多个来源都有歌词时，优先选逐字 karaoke——因此网易云的逐字文件可以胜过先到的纯文本歌词。",
        ja: "MUZERO は歌詞検索の前にタイトルとアーティストを正規化し（version・feat.・全角括弧を除去）、緩和ラダーをたどることで惜しい取りこぼしも誤った版をキャッシュせずにマッチさせます。時間ゲートが長さの近いカバーを弾き、複数ソースに歌詞がある場合は単語単位のカラオケを優先します。そのため NetEase の音節単位ファイルが、先に届いたプレーンテキストに勝てます。",
        ko: "MUZERO는 가사를 조회하기 전에 제목과 아티스트를 정규화하고(version, feat., 전각 괄호 제거), 완화 사다리를 따라가 아슬아슬하게 놓친 경우에도 잘못된 버전을 캐시하지 않고 매칭합니다. 재생 시간 게이트가 길이가 비슷한 커버를 걸러내고, 여러 소스에 가사가 있을 때는 한 단어씩 표시되는 가라오케를 우선합니다. 그래서 NetEase의 음절 단위 파일이 먼저 도착한 일반 텍스트를 이길 수 있습니다.",
      },
    },
    {
      area: "lyrics",
      category: "feature",
      platform: "all",
      title: {
        en: "Match-progress toast with a one-tap Search fallback",
        zh: "匹配进度提示，附一键“搜索”兜底",
        ja: "マッチ進捗トーストとワンタップ「検索」フォールバック",
        ko: "매칭 진행 토스트와 한 번 탭하는 검색 대체",
      },
      description: {
        en: "While a track auto-fetches lyrics, a small toast shows matching → matched, and when MUZERO is unsure or finds nothing it offers a Search action that jumps straight to manual lyric search on Now Playing. Low-confidence results are no longer written to the negative cache, so a later retry can still find the right words. A Settings toggle turns the toasts off.",
        zh: "当某首歌在自动抓词时，会有一个小提示显示“正在匹配 → 已匹配”；当 MUZERO 不确定或没找到时，会给出“搜索”操作，直接跳到正在播放页的手动歌词搜索。低置信结果不再写入负缓存，因此之后重试仍有机会找到正确歌词。可在 Settings 关闭这些提示。",
        ja: "曲が歌詞を自動取得する間、小さなトーストが「マッチ中 → 一致」を表示し、MUZERO が確信できない／見つからない場合は「検索」アクションを出して再生中画面の手動歌詞検索へ直接ジャンプします。低信頼の結果はネガティブキャッシュに書かないため、後で再試行すれば正しい歌詞を見つけられます。トーストは Settings でオフにできます。",
        ko: "곡이 가사를 자동으로 가져오는 동안 작은 토스트가 매칭 중 → 일치를 보여주고, MUZERO가 확신하지 못하거나 찾지 못하면 Now Playing의 수동 가사 검색으로 바로 이동하는 검색 동작을 제공합니다. 낮은 신뢰도 결과는 더 이상 네거티브 캐시에 기록되지 않아 나중에 다시 시도하면 올바른 가사를 찾을 수 있습니다. 토스트는 Settings에서 끌 수 있습니다.",
      },
    },
    {
      area: "library",
      category: "feature",
      platform: "all",
      title: {
        en: "Get started from an empty library",
        zh: "从空曲库快速起步",
        ja: "空のライブラリからすぐ始められる",
        ko: "빈 라이브러리에서 바로 시작",
      },
      description: {
        en: "The empty-library screen now offers direct import actions — pick files or a folder right there — plus a one-click sample song so you can hear MUZERO play before importing anything of your own. Search reaches the same actions when it has nothing to show yet.",
        zh: "空曲库界面现在直接提供导入入口——可当场选择文件或文件夹——并加了一键示例歌曲，让你在导入自己的内容之前就能先听 MUZERO 播放。搜索在还没有结果时也能用到同样的入口。",
        ja: "空のライブラリ画面に直接の取り込みアクション（その場でファイルやフォルダを選択）と、ワンクリックのサンプル曲が加わり、自分のコンテンツを取り込む前に MUZERO の再生を試せます。検索結果がまだ無いときも同じアクションに届きます。",
        ko: "빈 라이브러리 화면에 바로 가져오기 동작(그 자리에서 파일이나 폴더 선택)과 원클릭 샘플 곡이 추가되어, 자신의 콘텐츠를 가져오기 전에 MUZERO 재생을 들어볼 수 있습니다. 검색도 아직 보여줄 것이 없을 때 같은 동작으로 연결됩니다.",
      },
    },
    {
      area: "library",
      category: "improvement",
      platform: "desktop",
      title: {
        en: "Large local folder sync stays smooth",
        zh: "大型本地文件夹同步更顺滑",
        ja: "大きなローカルフォルダ同期が滑らかに",
        ko: "대용량 로컬 폴더 동기화가 매끄럽게",
      },
      description: {
        en: "Syncing big local folders no longer stalls the app: the import path was optimized and appending freshly found tracks to the active queue is deferred during a sync, so the first songs stay playable while the rest stream in.",
        zh: "同步大型本地文件夹不再卡住应用：优化了导入路径，并在同步期间延迟把新发现的曲目追加进当前队列，因此前面的歌曲保持可播放，其余则在后台陆续进入。",
        ja: "大きなローカルフォルダの同期でアプリが詰まらなくなりました。取り込み経路を最適化し、同期中は新たに見つかった曲をアクティブキューへ追加するのを遅延させるため、先頭の曲は再生可能なまま残りが順次入ってきます。",
        ko: "대용량 로컬 폴더를 동기화해도 앱이 멈추지 않습니다. 가져오기 경로를 최적화하고 동기화 중에는 새로 찾은 트랙을 활성 큐에 추가하는 것을 지연시켜, 앞쪽 곡은 재생 가능한 상태로 두고 나머지가 차례로 들어옵니다.",
      },
    },
    {
      area: "player",
      category: "improvement",
      platform: "all",
      title: {
        en: "Less jank and lower memory in import and playback",
        zh: "导入与播放更少卡顿、更低内存",
        ja: "取り込みと再生のカクつき減・メモリ低減",
        ko: "가져오기와 재생의 끊김 감소와 메모리 절감",
      },
      description: {
        en: "A round of profiling trimmed jank across importing and playback and reduced how much memory the Now Playing background holds, so long listening sessions and big libraries stay lighter on the machine.",
        zh: "经过一轮性能剖析，减少了导入与播放过程中的卡顿，并降低了正在播放背景占用的内存，让长时间收听与大型曲库对机器更轻量。",
        ja: "プロファイリングにより取り込みと再生のカクつきを抑え、再生中の背景が保持するメモリも削減しました。長時間のリスニングや大きなライブラリでもマシンへの負荷が軽くなります。",
        ko: "프로파일링을 통해 가져오기와 재생의 끊김을 줄이고 Now Playing 배경이 차지하는 메모리도 낮췄습니다. 긴 청취 세션과 큰 라이브러리에서도 기기 부담이 가벼워집니다.",
      },
    },
  ],
};

export default release;
