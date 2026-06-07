import {
  type ChatTransport,
  DirectChatTransport,
  type LanguageModel,
  stepCountIs,
  ToolLoopAgent,
} from "ai";
import { resolveDjModel } from "@/ai/model";
import type { MuzeroDB } from "@/db/muzero-db";
import { getSettings } from "@/db/repositories";
import { DJ_CHAT_SYSTEM_PROMPT } from "./dj-chat-prompt";
import { createDjChatTools } from "./dj-chat-tools";
import type { DjChatUIMessage } from "./types";

export type DjChatModelResolver = (db: MuzeroDB) => Promise<LanguageModel>;

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
      const model = await resolveModel(db);
      const tools = createDjChatTools({ db });
      const agent = new ToolLoopAgent({
        model,
        tools,
        instructions: DJ_CHAT_SYSTEM_PROMPT,
        stopWhen: stepCountIs(12),
        temperature: 0.7,
        maxOutputTokens: 1200,
      });
      const transport = new DirectChatTransport({ agent });
      return transport.sendMessages(options);
    },
    async reconnectToStream() {
      return null;
    },
  };
}

async function defaultResolveModel(db: MuzeroDB): Promise<LanguageModel> {
  const settings = await getSettings(db);
  return resolveDjModel(settings);
}
