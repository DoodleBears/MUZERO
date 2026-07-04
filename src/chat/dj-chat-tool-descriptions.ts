/**
 * Localized overrides for the LLM-facing tool `description` strings (voice-DJ PRD
 * §12 Phase 8). The inline English descriptions in `dj-chat-tools.ts` stay the
 * canonical source AND the fallback — this only ADDS zh/ja/ko, so a missing or
 * blank translation safely keeps English (and tool-selection accuracy) intact.
 *
 * Literal tokens the model must reproduce verbatim are kept UNTRANSLATED inside
 * the translated prose: local-ref sigils (#T/#S/#R/#Q/#M), tool names
 * (library_search, set_add_tracks, …), API params (queries/types/fields,
 * cursor/nextCursor, "any"/"all", "track"/"set"/"lyrics"), and TrackBriefs.
 */

export type ChatPromptLocale = "en" | "zh" | "ja" | "ko";

const ZH: Record<string, string> = {
  library_search:
    '在音乐库里做一次搜索，按 `types` 过滤（默认 ["track"]）。结果用本地 id（#T 歌曲、#S 歌单）加本结果窗口的 resultRef #R。关键词放进 `queries`（match "any" 汇集一个流派，"all" 收窄）。`types` 可含："track"（标题/文案/标签/备注/回忆/风格流派——导入曲目也可按补齐的风格搜，如 "city pop"/"lo-fi"）、"set"（匹配歌单名称）、"lyrics"（用歌词词句找歌，每个命中返回片段+时间戳）。track 组按 `fields` 投影（默认 id+title，加 "artist"/"genre" 便于判断风格；"genre"=文件 + 补齐的风格数组），用 `cursor`/`nextCursor` 翻页。要把一个流派收进歌单，按 title/artist 判断哪些合适，再用 set_add_tracks 加这些 #T id。始终先搜这里。本工具只搜本地曲库、不搜互联网——若返回为空（结果含 onlineFallbackAvailable）且听众要某首具体歌，改用 online_search_tracks。',
  library_tree:
    '用简短本地 id 以树形浏览用户音乐库。scope "library" 看所有歌单加未分类歌曲，scope "set" 配 #S id 查看单个歌单，scope "unassigned" 整理不在任何歌单里的歌。结果用 cursor/nextCursor 翻页，含 resultRef 及每条结果的序号；操作要用 #T1/#S1 这样的实体 id。',
  library_list_tags: "列出各个本地标签及其使用次数。",
  now_playing_get:
    "读取当前播放队列与「正在播放自」的歌单上下文。返回一个 resultRef #R 以及本地 #Q 队列条目、#T 歌曲引用、#S 上下文歌单引用。",
  set_list:
    "查找/列出本地歌单。可选 `query` 匹配歌单名称（省略/留空 = 全部歌单、最近更新在前）。用 `cursor`/`limit` 翻页——若 `nextCursor` 非空就带上它再调。在 resultRef #R 窗口里返回紧凑的 #S 歌单引用。用它先找到可复用的已有歌单（set_add_tracks），再决定是否新建近乎重复的。",
  set_get:
    "按 #S id 读取单个本地歌单及其有序歌曲。在 resultRef #R 窗口里把歌单作为 #S、歌曲作为 #T 返回。",
  set_create:
    "创建一个本地歌单，可选用现有 #T 歌曲 id（按顺序）作种子，让「用这些歌建个歌单」一次调用完成。返回新歌单为 #S。带种子的 DJ 歌单可自动续歌；手动策展/上传的歌单不应续。",
  set_update: "更新歌单的自由元数据，如名称或种子 prompt。目标歌单用 #S 传入。",
  set_add_tracks:
    "把现有 #T 歌曲 id 加进 #S 歌单。对任意歌单都可用：来自 set_list/set_get 的已有歌单或刚创建的。幂等；只加入已知的本地歌曲。用于少量手挑的 id。",
  set_switch: "把某个 #S 歌单的歌曲载入播放队列，并返回编码后的队列摘要。",
  queue_add: "把 #T 歌曲 id 加进播放队列（next 下一首或 append 追加），并返回编码后的队列摘要。",
  queue_edit: "更新播放队列的循环模式。",
  queue_clear: "清空播放队列（播放列表）。不删除任何歌单。",
  play_set: "立即开始播放某个 #S 歌单：把它的歌曲载入播放队列（替换当前播放列表）并从头开始。",
  play_track: "把当前正在播放的歌切换到指定的 #T 歌曲并立即播放。",
  memory_search:
    "按关键词搜索听众的歌曲回忆（queries[]，match any/all）。返回一个 resultRef #R；每个命中带一个 #M 回忆引用和一个 #T 歌曲引用，便于你对那首歌操作。",
  add_memory:
    "给一首 #T 歌曲附上一条回忆备注。省略 trackId 则加到当前正在播放的歌上。返回 #M/#T 引用。",
  dj_say:
    '对听众说一句简短、自然的回话（整体一两句）——说明你做了或即将做什么，用 DJ 的口吻。每回合最多调用一次。把 `say` 传成 parts 数组，让声音在回话中途切换情绪：每个 part 有 `text` 和可选的 `emotion`（如 "happy"、"excited"、"gentle"、"apologetic"）——朗读的声音会套用它，屏幕上的文字保持纯文本。多数回话只有一个 part，只有语气真的变化时才拆分。不要念工具机制或 id；保持口语化。',
  online_search_tracks:
    "在用户启用的流媒体来源（YouTube / Bilibili / 网易云）里搜歌。只读且免费——不消耗生成额度。",
  online_add_tracks: "把此前一次在线搜索的歌曲导入一个 #S 本地歌单（不自动播放）。免费且可撤销。",
  dj_propose_briefs:
    "校验并汇总提议的 TrackBriefs 供用户确认。这不会创建歌曲或消耗 provider 额度。",
  dj_generate_tracks:
    "用已校验的 TrackBriefs 在一个 #S 会话里创建待生成的歌曲。这会消耗 provider 额度并返回创建的 #T 引用。",
};

const JA: Record<string, string> = {
  library_search:
    'ライブラリを `types` で絞って一度検索（既定 ["track"]）。結果はローカル id（#T 曲、#S セット）とこの結果ウィンドウの resultRef #R を使う。キーワードは `queries` に（match "any" はジャンルを集め、"all" は絞る）。`types` に含められるもの："track"（タイトル/キャプション/タグ/メモ/メモリー/ジャンル——取り込んだ曲は補完されたジャンルでも検索可、例 "city pop"/"lo-fi"）、"set"（プレイリスト名で一致）、"lyrics"（歌詞の語で曲を探す。各ヒットはスニペット+タイムスタンプを返す）。track グループは `fields` に射影（既定 id+title、"artist"/"genre" を足すと判断しやすい；"genre"=ファイル + 補完されたジャンル配列）し、`cursor`/`nextCursor` でページング。ジャンルをセットに集めるには title/artist で合うものを判断し、その #T id を set_add_tracks で追加。常にまずここを検索。このツールはローカルライブラリのみ検索しインターネットは検索しない——空（結果に onlineFallbackAvailable）で聴き手が特定の曲を求めるなら online_search_tracks に切り替える。',
  library_tree:
    '短いローカル id でユーザーライブラリをツリー表示。scope "library" は全セット＋未割り当ての曲、scope "set" は #S id で単一セットを、scope "unassigned" はどのセットにもない曲を整理。結果は cursor/nextCursor でページングし resultRef と各結果の序数を含む。操作は #T1/#S1 のような実体 id を使う。',
  library_list_tags: "ローカルの各タグと使用回数を一覧表示。",
  now_playing_get:
    "現在の再生キューと「再生元」セットのコンテキストを読む。resultRef #R とローカルの #Q キュー項目、#T 曲参照、#S コンテキストセット参照を返す。",
  set_list:
    "ローカルセットを検索/一覧。任意の `query` はセット名に一致（省略/空 = 全セット・更新の新しい順）。`cursor`/`limit` でページング——`nextCursor` が非 null ならそれを cursor にして再度呼ぶ。resultRef #R ウィンドウ内でコンパクトな #S セット参照を返す。ほぼ重複を作る前に、再利用できる既存セットを見つける（set_add_tracks）のに使う。",
  set_get:
    "#S id で単一のローカルセットとその順序付き曲を読む。resultRef #R ウィンドウ内でセットを #S、曲を #T として返す。",
  set_create:
    "ローカルセットを作成。任意で既存の #T 曲 id（順序どおり）を種にして「この曲でプレイリストを作って」を一度で。新セットを #S で返す。種ありの DJ セットは自動延長でき、キュレーション/アップロードのセットはすべきでない。",
  set_update: "名前や seed prompt などセットの自由メタデータを更新。対象セットは #S で渡す。",
  set_add_tracks:
    "既存の #T 曲 id を #S セットに追加。set_list/set_get の既存セットでも作りたてでも動く。冪等で、既知のローカル曲のみ追加。手選びの少数 id に使う。",
  set_switch: "ある #S セットの曲を再生キューに読み込み、エンコードされたキュー要約を返す。",
  queue_add:
    "#T 曲 id を再生キューに（next 次に or append 末尾に）追加し、エンコードされたキュー要約を返す。",
  queue_edit: "再生キューのリピートモードを更新。",
  queue_clear: "再生キュー（プレイリスト）を空にする。どのセットも削除しない。",
  play_set:
    "ある #S セットを今すぐ再生開始：その曲を再生キューに読み込み（現在のプレイリストを置換）先頭から始める。",
  play_track: "現在再生中の曲を指定の #T 曲に切り替えて今すぐ再生。",
  memory_search:
    "リスナーの曲メモリーをキーワードで検索（queries[]、match any/all）。resultRef #R を返し、各ヒットは #M メモリー参照と #T 曲参照を持つので、その曲に対して操作できる。",
  add_memory:
    "#T 曲にメモリーのメモを付ける。trackId を省くと今再生中の曲に付ける。#M/#T 参照を返す。",
  dj_say:
    'リスナーへ短く自然な返答を（全体で 1〜2 文）——何をした/これからするかを DJ の口調で。1 ターンにつき最多 1 回。`say` は parts 配列で渡し、返答の途中で感情を切り替えられる：各 part に `text` と任意の `emotion`（"happy"・"excited"・"gentle"・"apologetic" など）——読み上げる声はそれを反映し、画面のテキストはプレーンのまま。多くは 1 part、口調が実際に変わるときだけ分割。ツールの仕組みや id は口にせず、会話調で。',
  online_search_tracks:
    "ユーザーが有効化したストリーミングソース（YouTube / Bilibili / NetEase）で曲を検索。読み取り専用かつ無料——生成クレジットは使わない。",
  online_add_tracks:
    "先のオンライン検索の曲を #S ローカルセットに取り込む（自動再生しない）。無料で取り消し可能。",
  dj_propose_briefs:
    "提案された TrackBriefs を検証・要約してユーザーの確認に回す。曲の作成や provider クレジットの消費はしない。",
  dj_generate_tracks:
    "検証済みの TrackBriefs から #S セッションに保留中の生成曲を作成。provider クレジットを消費し、作成した #T 参照を返す。",
};

const KO: Record<string, string> = {
  library_search:
    '라이브러리를 `types`로 필터링해 한 번 검색(기본 ["track"]). 결과는 로컬 id(#T 곡, #S 세트)와 이 결과 창의 resultRef #R을 사용. 키워드는 `queries`에(match "any"는 장르를 모으고 "all"은 좁힘). `types`에는 "track"(제목/캡션/태그/메모/메모리/장르——가져온 곡은 채워진 장르로도 검색 가능, 예 "city pop"/"lo-fi"), "set"(플레이리스트 이름 일치), "lyrics"(가사 단어로 곡 찾기; 각 히트는 스니펫+타임스탬프 반환)이 들어갈 수 있음. track 그룹은 `fields`로 투영(기본 id+title, "artist"/"genre"를 더하면 장르 판단에 도움; "genre"=파일 + 채워진 장르 배열)하고 `cursor`/`nextCursor`로 페이징. 장르를 세트로 모으려면 title/artist로 맞는 것을 판단해 그 #T id를 set_add_tracks로 추가. 항상 여기부터 검색. 이 도구는 로컬 라이브러리만 검색하며 인터넷은 검색하지 않음——비어 있고(결과에 onlineFallbackAvailable) 청취자가 특정 곡을 원하면 online_search_tracks로 전환.',
  library_tree:
    '짧은 로컬 id로 사용자 라이브러리를 트리로 탐색. scope "library"는 모든 세트와 미분류 곡, scope "set"은 #S id로 단일 세트를, scope "unassigned"는 어떤 세트에도 없는 곡을 정리. 결과는 cursor/nextCursor로 페이징하며 resultRef와 결과별 순번을 포함; 작업은 #T1/#S1 같은 실체 id를 사용.',
  library_list_tags: "로컬 태그별 사용 횟수를 나열.",
  now_playing_get:
    "현재 재생 큐와 '재생 출처' 세트 컨텍스트를 읽음. resultRef #R과 로컬 #Q 큐 항목, #T 곡 참조, #S 컨텍스트 세트 참조를 반환.",
  set_list:
    "로컬 세트 찾기/목록. 선택적 `query`는 세트 이름과 일치(생략/공백 = 모든 세트, 업데이트 최신순). `cursor`/`limit`로 페이징 — `nextCursor`가 non-null이면 그 값을 cursor로 다시 호출. resultRef #R 창 안에 간결한 #S 세트 참조를 반환. 거의 중복을 만들기 전에 재사용할 기존 세트를 찾는 데(set_add_tracks) 사용.",
  set_get:
    "#S id로 단일 로컬 세트와 정렬된 곡을 읽음. resultRef #R 창 안에 세트를 #S, 곡을 #T로 반환.",
  set_create:
    "로컬 세트를 생성. 선택적으로 기존 #T 곡 id(순서대로)를 시드로 두어 '이 곡들로 플레이리스트 만들기'를 한 번에. 새 세트를 #S로 반환. 시드가 있는 DJ 세트는 자동 확장 가능하고, 큐레이션/업로드 세트는 그러지 않아야 함.",
  set_update: "이름이나 seed prompt 같은 세트의 자유 메타데이터를 업데이트. 대상 세트는 #S로 전달.",
  set_add_tracks:
    "기존 #T 곡 id를 #S 세트에 추가. set_list/set_get의 기존 세트든 방금 만든 세트든 동작. 멱등이며 알려진 로컬 곡만 추가. 직접 고른 소수 id에 사용.",
  set_switch: "어떤 #S 세트의 곡을 재생 큐에 로드하고 인코딩된 큐 요약을 반환.",
  queue_add: "#T 곡 id를 재생 큐에(next 다음 또는 append 뒤에) 추가하고 인코딩된 큐 요약을 반환.",
  queue_edit: "재생 큐의 반복 모드를 업데이트.",
  queue_clear: "재생 큐(플레이리스트)를 비움. 어떤 세트도 삭제하지 않음.",
  play_set:
    "어떤 #S 세트를 지금 재생 시작: 그 곡들을 재생 큐에 로드(현재 플레이리스트 대체)하고 맨 위부터 시작.",
  play_track: "현재 재생 중인 곡을 지정한 #T 곡으로 바꿔 지금 재생.",
  memory_search:
    "청취자의 곡 메모리를 키워드로 검색(queries[], match any/all). resultRef #R을 반환하며, 각 히트는 #M 메모리 참조와 #T 곡 참조를 가져 그 곡에 대해 작업 가능.",
  add_memory:
    "#T 곡에 메모리 메모를 붙임. trackId를 생략하면 지금 재생 중인 곡에 붙음. #M/#T 참조를 반환.",
  dj_say:
    '청취자에게 짧고 자연스러운 답변을(전체 한두 문장) — 무엇을 했는지/할 것인지 DJ 말투로. 한 턴에 최대 한 번. `say`는 parts 배열로 넘겨 답변 도중 감정을 바꿀 수 있음: 각 part에 `text`와 선택적 `emotion`("happy", "excited", "gentle", "apologetic" 등) — 낭독 음성은 이를 반영하고 화면 텍스트는 평문 유지. 대부분 1개 part, 어조가 실제로 바뀔 때만 분할. 도구 메커니즘이나 id는 말하지 말고 대화체로.',
  online_search_tracks:
    "사용자가 활성화한 스트리밍 소스(YouTube / Bilibili / NetEase)에서 곡 검색. 읽기 전용이며 무료 — 생성 크레딧 없음.",
  online_add_tracks:
    "이전 온라인 검색의 곡을 #S 로컬 세트에 가져옴(자동 재생 안 함). 무료이며 취소 가능.",
  dj_propose_briefs:
    "제안된 TrackBriefs를 검증·요약해 사용자 확인에 올림. 곡을 만들거나 provider 크레딧을 쓰지 않음.",
  dj_generate_tracks:
    "검증된 TrackBriefs로 #S 세션에 대기 중 생성 곡을 만듦. provider 크레딧을 소비하고 만들어진 #T 참조를 반환.",
};

const OVERRIDES: Partial<Record<ChatPromptLocale, Record<string, string>>> = {
  zh: ZH,
  ja: JA,
  ko: KO,
};

/**
 * Localized tool description for `id`, or "" to keep the inline English default.
 * `locale` accepts a full BCP-47 tag ("zh-CN") — only the primary subtag matters.
 */
export function toolDescription(id: string, locale: string | undefined): string {
  const primary = (locale ?? "en").slice(0, 2) as ChatPromptLocale;
  return OVERRIDES[primary]?.[id] ?? "";
}

/** Tool ids that carry a localized override in at least one non-English locale. */
export const LOCALIZED_TOOL_IDS = Object.keys(ZH);
