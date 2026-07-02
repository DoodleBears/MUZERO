import type { ChangelogRelease } from "../types";

const release: ChangelogRelease = {
  version: "1.6.0",
  date: "2026-07-02",
  title: {
    en: "A home for your downloads",
    zh: "下载，有了自己的主场",
    ja: "ダウンロードに専用の居場所",
    ko: "다운로드를 위한 전용 공간",
  },
  summary: {
    en: "1.6.0 gives downloads a first-class home: a new Downloads tab in your library lists every download with live progress, a status filter (in progress / completed / failed), and clear-finished or clear-all — virtualized so a 500-song favorites batch stays smooth. Plus, ⌘F filtering now matches pinyin and Japanese kana/romaji, playlist imports run in the background with a progress notification (and import far faster for big lists), you can filter the online playlist list before importing, and live-video backgrounds render reliably.",
    zh: "1.6.0 让下载有了一等公民的主场：媒体库新增「下载」标签，列出每个下载及其实时进度、状态筛选（进行中 / 已完成 / 失败），并支持「清空已完成」或「清空全部」——且做了虚拟化，500 条收藏夹整批下载也依旧流畅。此外，⌘F 筛选现在支持拼音与日文假名/罗马字匹配；歌单导入改为后台运行并带进度通知（大列表导入也快得多）；导入前可筛选在线歌单列表；实时视频背景也能稳定渲染。",
    ja: "1.6.0 はダウンロードに一等地の居場所を用意しました。ライブラリに新しい「ダウンロード」タブが加わり、各ダウンロードをライブ進捗、ステータス絞り込み（進行中 / 完了 / 失敗）、「完了を消去」「すべて消去」とともに一覧表示します — 仮想化されているので 500 曲のお気に入り一括ダウンロードも滑らかです。さらに ⌘F 絞り込みがピンインと日本語のかな/ローマ字に対応し、プレイリストのインポートは進捗通知付きでバックグラウンド実行（大きなリストも大幅に高速）、インポート前にオンラインプレイリスト一覧を絞り込め、ライブ動画の背景も安定して描画されます。",
    ko: "1.6.0은 다운로드에 어엿한 전용 공간을 마련했습니다. 라이브러리에 새로운 '다운로드' 탭이 추가되어 각 다운로드를 실시간 진행률, 상태 필터(진행 중 / 완료 / 실패), '완료 지우기'·'전체 지우기'와 함께 보여줍니다 — 가상화되어 있어 500곡짜리 즐겨찾기 일괄 다운로드도 부드럽습니다. 또한 ⌘F 필터가 병음과 일본어 가나/로마자를 매칭하고, 재생목록 가져오기가 진행률 알림과 함께 백그라운드로 실행되며(대용량 목록도 훨씬 빠름), 가져오기 전에 온라인 재생목록 목록을 필터링할 수 있고, 라이브 비디오 배경도 안정적으로 렌더링됩니다.",
  },
  items: [
    {
      area: "library",
      category: "highlight",
      platform: "desktop",
      title: {
        en: "Downloads center — a dedicated tab for all your downloads",
        zh: "下载中心——所有下载的专属标签页",
        ja: "ダウンロードセンター — すべてのダウンロード専用タブ",
        ko: "다운로드 센터 — 모든 다운로드를 위한 전용 탭",
      },
      description: {
        en: "Your library gets a 6th tab, Downloads, next to Sets / Songs / Albums / Artists / Discover. It lists every download with live progress and a status filter (all / in progress / completed / failed), and it's virtualized — so downloading a whole 500-video favorites batch stays smooth. Clear finished or clear all from the header, and click a finished download to jump straight to where its track landed. The background download notification's 'View' now opens this tab too.",
        zh: "媒体库新增第 6 个标签「下载」，与 歌单 / 全部歌曲 / 专辑 / 歌手 / 发现 并列。它列出每一个下载并显示实时进度，带状态筛选（全部 / 进行中 / 已完成 / 失败），且做了虚拟化——即使把一个 500 条的收藏夹整批下载，列表也依然流畅。可在顶部「清空已完成」或「清空全部」，点击已完成的下载可直接跳到它的歌曲所在处。后台下载通知的「查看」现在也会打开这个标签页。",
        ja: "ライブラリに 6 番目のタブ「ダウンロード」が、セット / 全曲 / アルバム / アーティスト / 発見 の隣に加わりました。すべてのダウンロードをライブ進捗とステータス絞り込み（すべて / 進行中 / 完了 / 失敗）で一覧表示し、仮想化されているので 500 本のお気に入りを一括ダウンロードしても滑らかです。ヘッダーから「完了を消去」または「すべて消去」でき、完了したダウンロードをクリックするとその曲の場所へ直接移動します。バックグラウンドのダウンロード通知の「表示」もこのタブを開くようになりました。",
        ko: "라이브러리에 6번째 탭 '다운로드'가 세트 / 전체 곡 / 앨범 / 아티스트 / 발견 옆에 추가되었습니다. 모든 다운로드를 실시간 진행률과 상태 필터(전체 / 진행 중 / 완료 / 실패)로 보여주며, 가상화되어 있어 500개짜리 즐겨찾기를 한꺼번에 내려받아도 부드럽습니다. 헤더에서 '완료 지우기' 또는 '전체 지우기'를 할 수 있고, 완료된 다운로드를 클릭하면 해당 곡 위치로 바로 이동합니다. 백그라운드 다운로드 알림의 '보기'도 이 탭을 엽니다.",
      },
    },
    {
      area: "search",
      category: "feature",
      platform: "all",
      title: {
        en: "⌘F filter now matches pinyin and Japanese kana/romaji",
        zh: "⌘F 筛选现在支持拼音与日文假名/罗马字匹配",
        ja: "⌘F 絞り込みがピンインと日本語のかな/ローマ字に対応",
        ko: "⌘F 필터가 병음과 일본어 가나/로마자 매칭을 지원",
      },
      description: {
        en: "Typing in the ⌘F @filter menu now matches Chinese songs by pinyin and Japanese songs by kana or romaji, so you can find 邓丽君 by typing 'deng' or 君の名は by typing 'kimi' — no need to type the exact characters.",
        zh: "在 ⌘F 的 @筛选 菜单里输入时，现在可以用拼音匹配中文歌、用假名或罗马字匹配日文歌——输入「deng」就能找到邓丽君，输入「kimi」就能找到《君の名は》，不必打出完整原文。",
        ja: "⌘F の @絞り込み メニューでの入力が、中国語の曲をピンインで、日本語の曲をかなやローマ字で一致させられるようになりました。「deng」で邓丽君、「kimi」で『君の名は』を見つけられ、正確な文字を入力する必要はありません。",
        ko: "⌘F의 @필터 메뉴 입력이 이제 중국어 곡을 병음으로, 일본어 곡을 가나나 로마자로 매칭합니다. 'deng'만 입력해도 邓丽君을, 'kimi'만 입력해도 『君の名は』를 찾을 수 있어 정확한 문자를 입력할 필요가 없습니다.",
      },
    },
    {
      area: "streaming",
      category: "feature",
      platform: "desktop",
      title: {
        en: "Playlist imports run in the background with a progress notification",
        zh: "歌单导入改为后台运行，并带进度通知",
        ja: "プレイリストのインポートがバックグラウンド化し進捗通知付きに",
        ko: "재생목록 가져오기가 백그라운드로 진행되고 진행률 알림 제공",
      },
      description: {
        en: "Importing an online playlist (e.g. from NetEase or Bilibili) no longer blocks the UI — it runs in the background and shows a progress notification in the top-left, so you can keep browsing and playing while a big list imports.",
        zh: "导入在线歌单（如网易云或哔哩哔哩）不再卡住界面——它在后台运行，并在左上角显示进度通知，因此大歌单导入时你仍可继续浏览和播放。",
        ja: "オンラインプレイリスト（NetEase や Bilibili など）のインポートが UI をブロックしなくなりました — バックグラウンドで実行され、左上に進捗通知を表示するので、大きなリストのインポート中も閲覧や再生を続けられます。",
        ko: "온라인 재생목록(NetEase나 Bilibili 등) 가져오기가 더 이상 UI를 멈추지 않습니다 — 백그라운드에서 실행되고 왼쪽 상단에 진행률 알림을 표시하므로, 큰 목록을 가져오는 동안에도 탐색과 재생을 계속할 수 있습니다.",
      },
    },
    {
      area: "streaming",
      category: "improvement",
      platform: "desktop",
      title: {
        en: "Big playlist imports are dramatically faster",
        zh: "大歌单导入速度大幅提升",
        ja: "大きなプレイリストのインポートが大幅に高速化",
        ko: "대용량 재생목록 가져오기가 크게 빨라짐",
      },
      description: {
        en: "The batch import path was rewritten from O(n²) to O(n), so importing a large playlist (hundreds of tracks) is now dramatically faster and stays responsive.",
        zh: "批量导入的算法从 O(n²) 重写为 O(n)，因此导入大歌单（数百首）现在快得多，界面也保持流畅。",
        ja: "バッチインポートの処理を O(n²) から O(n) に書き換えたため、大きなプレイリスト（数百曲）のインポートが大幅に速くなり、操作も快適なままです。",
        ko: "일괄 가져오기 경로를 O(n²)에서 O(n)으로 재작성하여, 대용량 재생목록(수백 곡) 가져오기가 훨씬 빨라지고 반응성도 유지됩니다.",
      },
    },
    {
      area: "streaming",
      category: "improvement",
      platform: "desktop",
      title: {
        en: "Filter the online playlist list before importing",
        zh: "导入前可筛选在线歌单列表",
        ja: "インポート前にオンラインプレイリスト一覧を絞り込み",
        ko: "가져오기 전에 온라인 재생목록 목록을 필터링",
      },
      description: {
        en: "The online playlist import list now has a search box, so you can quickly filter to the playlist you want instead of scrolling a long list.",
        zh: "在线歌单导入列表现在带搜索框，可以快速筛选到想要的歌单，不必在长列表里翻找。",
        ja: "オンラインプレイリストのインポート一覧に検索ボックスが付き、長いリストをスクロールせずに目的のプレイリストへ素早く絞り込めます。",
        ko: "온라인 재생목록 가져오기 목록에 검색창이 추가되어, 긴 목록을 스크롤하지 않고 원하는 재생목록으로 빠르게 필터링할 수 있습니다.",
      },
    },
    {
      area: "player",
      category: "fix",
      platform: "all",
      title: {
        en: "Live-video backgrounds render reliably",
        zh: "实时视频背景稳定渲染",
        ja: "ライブ動画の背景が安定して描画",
        ko: "라이브 비디오 배경이 안정적으로 렌더링",
      },
      description: {
        en: "Fixed a case where a live video used as an immersive background could fail to sample as a GPU texture before its first frame decoded, so the background didn't render; MUZERO now waits for a decoded frame first.",
        zh: "修复了一个问题：作为沉浸式背景的实时视频，在首帧解码之前可能无法作为 GPU 纹理采样，导致背景不显示；MUZERO 现在会先等待解码出一帧。",
        ja: "没入型背景として使うライブ動画が、最初のフレームがデコードされる前に GPU テクスチャとしてサンプリングできず、背景が描画されないことがある問題を修正しました。MUZERO はまずデコード済みのフレームを待つようになりました。",
        ko: "몰입형 배경으로 사용하는 라이브 비디오가 첫 프레임이 디코딩되기 전에 GPU 텍스처로 샘플링되지 못해 배경이 렌더링되지 않던 문제를 수정했습니다. 이제 MUZERO는 디코딩된 프레임을 먼저 기다립니다.",
      },
    },
  ],
};

export default release;
