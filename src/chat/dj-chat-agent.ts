import {
  type ChatTransport,
  DirectChatTransport,
  type LanguageModel,
  stepCountIs,
  ToolLoopAgent,
} from "ai";
import { listCustomLlmProviders } from "@/ai/custom-llm-providers";
import { llmSelectionForChatSession } from "@/ai/llm-providers";
import { resolveDjModel } from "@/ai/model";
import type { MuzeroDB } from "@/db/muzero-db";
import { getSettings } from "@/db/repositories";
import i18n from "@/i18n/i18n";
import { canGenerateMusic, hasEnabledStreamSources } from "./dj-chat-availability";
import { buildNowPlayingContext, buildSetsContext } from "./dj-chat-context";
import { DEFAULT_CHAT_CONTEXT_BUDGET, selectContextWindow } from "./dj-chat-context-budget";
import { djChatSystemPrompt } from "./dj-chat-prompt";
import {
  getChatSession,
  loadChatLocalIdRegistry,
  saveChatLocalIdRegistry,
} from "./dj-chat-sessions";
import { createDjChatTools } from "./dj-chat-tools";
import type { DjChatUIMessage } from "./types";

export type DjChatModelResolver = (input: {
  db: MuzeroDB;
  sessionId: string;
}) => Promise<LanguageModel>;

export interface CreateDjChatTransportOptions {
  db: MuzeroDB;
  resolveModel?: DjChatModelResolver;
}

export function createDjChatTransport({
  db,
  resolveModel = defaultResolveModel,
}: CreateDjChatTransportOptions): ChatTransport<DjChatUIMessage> {
  return {
    async sendMessages(options) {
      const model = await resolveModel({ db, sessionId: options.chatId });
      // Gate the tool set per the user's config: only offer the paid generate
      // tools when generation is enabled + configured; only offer the online
      // search/ingest tools when a streaming source is enabled (PRD §4.2).
      const settings = await getSettings(db);
      const localIds = await loadChatLocalIdRegistry(options.chatId, db);
      const persistLocalIds = () =>
        saveChatLocalIdRegistry(options.chatId, localIds.snapshot(), db);
      // Localize the LLM-facing prompt + tool descriptions to the UI language
      // (voice-DJ PRD §12 Phase 8); English is the fallback.
      const locale = uiLocale();
      const tools = createDjChatTools({
        db,
        includeGenerate: canGenerateMusic(settings),
        includeOnline: hasEnabledStreamSources(settings),
        localIds,
        persistLocalIds,
        locale,
      });
      // Refresh the now-playing snapshot + existing-sets list every turn so the DJ
      // always knows the active set/track AND what sets already exist (to reuse
      // instead of creating duplicates) without spending tool calls. Sequential so
      // the two don't race on the shared local-id registry.
      const nowPlaying = await buildNowPlayingContext(db, localIds);
      const setsContext = await buildSetsContext(db);
      await persistLocalIds();
      const contextBlocks = [nowPlaying, setsContext].filter(Boolean).join("\n\n");
      const agent = new ToolLoopAgent({
        model,
        tools,
        instructions: `${djChatSystemPrompt(locale)}\n\n${listenerLanguageDirective(locale)}\n\n${contextBlocks}`,
        stopWhen: stepCountIs(12),
        temperature: 0.7,
        // User-tunable (Settings); default generous so multi-step tool runs and
        // longer replies aren't cut off mid-thought.
        maxOutputTokens: settings.chatMaxOutputTokens ?? 32_000,
      });
      const transport = new DirectChatTransport({ agent });
      // Dynamic sliding context window (voice-DJ PRD §3.4): trim to the most
      // recent messages that fit the budget so hands-free voice chats never grow
      // until they block. `contextStartIndex` (manual compaction) is the floor.
      const session = await getChatSession(options.chatId, db);
      const windowTokens =
        settings.chatContextWindowTokens ??
        Math.floor((settings.chatMaxContextTokens ?? DEFAULT_CHAT_CONTEXT_BUDGET.maxTokens) * 0.5);
      const messages = selectContextWindow(options.messages, {
        maxTokens: windowTokens,
        minStartIndex: session?.contextStartIndex ?? 0,
      });
      return transport.sendMessages({ ...options, messages });
    },
    async reconnectToStream() {
      return null;
    },
  };
}

/** Language name per UI locale, so the DJ answers in the app's language. */
const LOCALE_LANGUAGE: Record<string, string> = {
  en: "English",
  zh: "Simplified Chinese (简体中文)",
  ja: "Japanese (日本語)",
  ko: "Korean (한국어)",
};

/** The effective UI language (what i18next actually shows), NOT the possibly-stale
 *  `settings.locale` mirror — that only syncs on an explicit Settings change. */
function uiLocale(): string {
  return (i18n.language || "en").slice(0, 2);
}

/** Tell the DJ to write listener-facing text (dj_say + chat replies) in the app's UI language. */
function listenerLanguageDirective(locale: string | undefined): string {
  const language = LOCALE_LANGUAGE[locale ?? "en"] ?? "English";
  return `Always write your listener-facing replies — dj_say lines and chat messages — in ${language}, regardless of the language the request came in.`;
}

async function defaultResolveModel({
  db,
  sessionId,
}: {
  db: MuzeroDB;
  sessionId: string;
}): Promise<LanguageModel> {
  const settings = await getSettings(db);
  const session = await getChatSession(sessionId, db);
  const custom = await listCustomLlmProviders(db);
  return resolveDjModel(settings, llmSelectionForChatSession(settings, session, custom), custom);
}
