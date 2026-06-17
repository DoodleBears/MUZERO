import type { ChangelogRelease } from "../types";

const release: ChangelogRelease = {
  version: "1.1.1",
  date: "2026-06-16",
  title: {
    en: "Live chat song requests",
    zh: "直播弹幕点歌",
    ja: "ライブチャットのリクエスト",
    ko: "라이브 채팅 신청곡",
  },
  summary: {
    en: "Viewers can request songs from your live chat — through Social Stream Ninja or any webhook — and MUZERO maps each request to a query and routes it to library search or the AI DJ. The hosted mu0.app web build can take requests too, over the SSN relay.",
    zh: "观众可以通过直播弹幕点歌——经 Social Stream Ninja 或任意 webhook——MUZERO 会把每条请求映射成查询词并路由到曲库搜索或 AI DJ。托管的 mu0.app 网页版也能经 SSN 中继接收请求。",
    ja: "視聴者がライブチャットから——Social Stream Ninja や任意の webhook 経由で——曲をリクエストでき、MUZERO は各リクエストをクエリにマッピングして検索や AI DJ に振り分けます。ホスティングされた mu0.app の Web 版も SSN リレー経由でリクエストを受け取れます。",
    ko: "시청자가 라이브 채팅에서——Social Stream Ninja나 임의의 webhook을 통해——곡을 신청할 수 있고, MUZERO는 각 요청을 쿼리로 매핑해 검색이나 AI DJ로 라우팅합니다. 호스팅되는 mu0.app 웹 빌드도 SSN 릴레이로 요청을 받을 수 있습니다.",
  },
  items: [
    {
      area: "settings",
      category: "highlight",
      platform: "all",
      title: {
        en: "Take song requests from live chat",
        zh: "从直播弹幕接收点歌",
        ja: "ライブチャットから曲をリクエスト",
        ko: "라이브 채팅에서 신청곡 받기",
      },
      description: {
        en: "Connect Social Stream Ninja (or any webhook) and let viewers request songs from chat. Each request is matched against your library or sent to the AI DJ, with per-user cooldowns, a rate limit, and duplicate suppression.",
        zh: "接入 Social Stream Ninja（或任意 webhook），让观众在弹幕里点歌。每条请求会在曲库里匹配，或交给 AI DJ；带每用户冷却、每分钟限流和去重。",
        ja: "Social Stream Ninja（または任意の webhook）をつなぎ、視聴者がチャットから曲をリクエストできます。各リクエストはライブラリと照合するか AI DJ に送られ、ユーザーごとのクールダウン・レート制限・重複抑制が効きます。",
        ko: "Social Stream Ninja(또는 임의의 webhook)를 연결해 시청자가 채팅에서 곡을 신청하도록 할 수 있습니다. 각 요청은 라이브러리와 매칭되거나 AI DJ로 전달되며, 사용자별 쿨다운·레이트 제한·중복 억제가 적용됩니다.",
      },
    },
    {
      area: "settings",
      category: "feature",
      platform: "all",
      title: {
        en: "Build a mapping from a real request",
        zh: "用真实请求来配置映射",
        ja: "実際のリクエストからマッピングを作成",
        ko: "실제 요청으로 매핑 구성",
      },
      description: {
        en: "Each source starts in testing mode: send it a request to capture a sanitized sample, then click fields in the JSON tree to build the mapping and see a live preview of the resolved query — using presets (Social Stream Ninja, generic) or custom {{ payload.… }} templates. Go live when it looks right.",
        zh: "每个来源先进入测试模式：向它发一条请求即可捕获一份脱敏样本，然后在 JSON 树里点字段来配置映射，并实时预览解析出的查询词——可用预设（Social Stream Ninja、通用）或自定义 {{ payload.… }} 模板。确认无误后再上线。",
        ja: "各ソースはまずテストモードで始まります。リクエストを送ると安全に整理されたサンプルを取得でき、JSON ツリーのフィールドをクリックしてマッピングを作成し、解決後のクエリをライブプレビューできます。プリセット（Social Stream Ninja、汎用）やカスタム {{ payload.… }} テンプレートが使えます。問題なければ公開します。",
        ko: "각 소스는 먼저 테스트 모드로 시작합니다. 요청을 보내면 민감 정보가 제거된 샘플을 캡처하고, JSON 트리에서 필드를 클릭해 매핑을 만들며, 변환된 쿼리를 실시간으로 미리볼 수 있습니다. 프리셋(Social Stream Ninja, 일반)이나 커스텀 {{ payload.… }} 템플릿을 사용할 수 있습니다. 문제없으면 공개하세요.",
      },
    },
    {
      area: "app",
      category: "feature",
      platform: "web",
      title: {
        en: "mu0.app takes requests over the SSN relay",
        zh: "mu0.app 经 SSN 中继接收请求",
        ja: "mu0.app が SSN リレー経由でリクエストを受信",
        ko: "mu0.app가 SSN 릴레이로 요청 수신",
      },
      description: {
        en: "The hosted web app subscribes outbound to the Social Stream Ninja relay with your session ID, so it can take live chat requests with no MUZERO backend. AI generation and online sourcing remain desktop-first (they depend on the browser allowing CORS).",
        zh: "托管网页版用你的 session ID 出站订阅 Social Stream Ninja 中继，因此无需任何 MUZERO 后端即可接收弹幕点歌。AI 生成与联网搜歌仍以桌面端为主（在浏览器中依赖 CORS 放行）。",
        ja: "ホスティングされた Web 版はセッション ID で Social Stream Ninja リレーへ外向きに購読するため、MUZERO のバックエンドなしでチャットのリクエストを受け取れます。AI 生成やオンライン取得は引き続きデスクトップ優先です（ブラウザの CORS 許可に依存します）。",
        ko: "호스팅되는 웹 앱은 세션 ID로 Social Stream Ninja 릴레이에 아웃바운드 구독하므로, MUZERO 백엔드 없이 채팅 신청을 받을 수 있습니다. AI 생성과 온라인 소싱은 계속 데스크톱 우선입니다(브라우저의 CORS 허용에 의존).",
      },
    },
    {
      area: "settings",
      category: "feature",
      platform: "desktop",
      title: {
        en: "Multiple webhook sources, routed independently",
        zh: "多个 webhook 来源，各自路由",
        ja: "複数の webhook ソースを個別にルーティング",
        ko: "여러 webhook 소스를 개별 라우팅",
      },
      description: {
        en: "The desktop app exposes a local /v1/intake/<source> webhook per source. Give each one its own mapping and route it to library search or the AI DJ — e.g. one platform to search, another to generation.",
        zh: "桌面端为每个来源暴露一个本地 /v1/intake/<source> webhook。可给每个来源单独配置映射，并分别路由到曲库搜索或 AI DJ——比如一个平台走搜索、另一个走生成。",
        ja: "デスクトップ版はソースごとにローカルの /v1/intake/<source> webhook を公開します。それぞれに独自のマッピングを設定し、検索や AI DJ に振り分けられます——例えば一方を検索、もう一方を生成に。",
        ko: "데스크톱 앱은 소스마다 로컬 /v1/intake/<source> webhook을 노출합니다. 각각에 고유한 매핑을 지정하고 라이브러리 검색이나 AI DJ로 라우팅할 수 있습니다——예를 들어 한 플랫폼은 검색, 다른 하나는 생성으로.",
      },
    },
  ],
};

export default release;
