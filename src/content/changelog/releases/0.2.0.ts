import type { ChangelogRelease } from "../types";

const release: ChangelogRelease = {
  version: "0.2.0",
  date: "2026-06-07",
  title: {
    en: "Chat with your DJ",
    zh: "与你的 DJ 对话",
    ja: "DJ とおしゃべり",
    ko: "DJ와 대화하기",
  },
  summary: {
    en: "A conversational AI DJ you can steer in natural language, with tool calls that curate and generate.",
    zh: "一个能用自然语言指挥的对话式 AI DJ，通过工具调用为你策展、为你生成。",
    ja: "自然な言葉で指示できる対話型の AI DJ。ツール呼び出しで選曲と生成をこなします。",
    ko: "자연어로 지휘할 수 있는 대화형 AI DJ. 도구 호출로 큐레이션하고 생성합니다.",
  },
  items: [
    {
      area: "dj",
      category: "highlight",
      platform: "all",
      title: {
        en: "Talk to the DJ",
        zh: "和 DJ 说话",
        ja: "DJ に話しかける",
        ko: "DJ에게 말 걸기",
      },
      description: {
        en: "Steer the music in natural language; the DJ proposes tracks and curates with tool calls.",
        zh: "用自然语言指挥音乐，DJ 通过工具调用为你推荐曲目并完成策展。",
        ja: "自然な言葉で音楽を導けば、DJ がツール呼び出しで曲を提案し、選曲を整えてくれます。",
        ko: "자연어로 음악을 이끌면, DJ가 도구 호출로 곡을 제안하고 큐레이션해 줍니다.",
      },
    },
    {
      area: "dj",
      category: "feature",
      platform: "all",
      title: {
        en: "Branching sessions",
        zh: "可分支的对话",
        ja: "枝分かれするセッション",
        ko: "갈래로 나뉘는 세션",
      },
      description: {
        en: "Fork a conversation to explore a different vibe without losing your place.",
        zh: "为对话开一条分支，去探索不同的氛围，又不会丢失当前进度。",
        ja: "会話を分岐させて別の雰囲気を試しても、いまの位置は失われません。",
        ko: "대화를 갈라 다른 분위기를 탐색해도 지금 자리를 잃지 않습니다.",
      },
    },
    {
      area: "app",
      category: "feature",
      platform: "all",
      title: {
        en: "Bring your own LLM",
        zh: "自带大模型",
        ja: "好きな LLM を持ち込む",
        ko: "원하는 LLM 연결",
      },
      description: {
        en: "Configure OpenAI or Anthropic keys, with presets and per-session model selection.",
        zh: "配置 OpenAI 或 Anthropic 密钥，支持预设和按对话选择模型。",
        ja: "OpenAI や Anthropic のキーを設定でき、プリセットやセッションごとのモデル選択にも対応します。",
        ko: "OpenAI나 Anthropic 키를 설정하고, 프리셋과 세션별 모델 선택까지 지원합니다.",
      },
    },
    {
      area: "dj",
      category: "improvement",
      platform: "all",
      title: {
        en: "Approve before generating",
        zh: "生成前先确认",
        ja: "生成の前に承認",
        ko: "생성 전 승인",
      },
      description: {
        en: "Queue prompts and approve tool actions; the queue pauses for your call.",
        zh: "排队提交提示词并审批工具操作，队列会停下来等你拍板。",
        ja: "プロンプトをためてツール操作を承認でき、キューはあなたの判断を待って一時停止します。",
        ko: "프롬프트를 줄 세우고 도구 동작을 승인하며, 큐는 당신의 결정을 기다리며 멈춥니다.",
      },
    },
  ],
};

export default release;
