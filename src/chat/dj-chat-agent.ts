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
import { canGenerateMusic, hasEnabledStreamSources } from "./dj-chat-availability";
import { buildNowPlayingContext } from "./dj-chat-context";
import { DEFAULT_CHAT_CONTEXT_BUDGET, selectContextWindow } from "./dj-chat-context-budget";
import { DJ_CHAT_SYSTEM_PROMPT } from "./dj-chat-prompt";
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
      const tools = createDjChatTools({
        db,
        includeGenerate: canGenerateMusic(settings),
        includeOnline: hasEnabledStreamSources(settings),
        localIds,
        persistLocalIds,
      });
      // Refresh the now-playing snapshot every turn so the DJ always knows the
      // active set + track (with ids) without spending a now_playing_get call.
      const nowPlaying = await buildNowPlayingContext(db, localIds);
      await persistLocalIds();
      const agent = new ToolLoopAgent({
        model,
        tools,
        instructions: `${DJ_CHAT_SYSTEM_PROMPT}\n\n${nowPlaying}`,
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
