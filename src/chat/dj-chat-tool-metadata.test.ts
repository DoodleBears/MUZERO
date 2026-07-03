import { describe, expect, it } from "vitest";
import { DJ_CHAT_TOOL_METADATA } from "./dj-chat-tool-metadata";
import { createDjChatTools } from "./dj-chat-tools";

describe("DJ chat tool metadata", () => {
  it("covers every supported tool call id", () => {
    const allTools = createDjChatTools({ includeGenerate: true, includeOnline: true });
    const toolIds = Object.keys(allTools).sort();
    const metadataIds = DJ_CHAT_TOOL_METADATA.map((tool) => tool.id).sort();

    expect(metadataIds).toEqual(toolIds);
  });

  it("declares i18n keys for every tool chip", () => {
    for (const tool of DJ_CHAT_TOOL_METADATA) {
      expect(tool.labelKey).toBe(`chat.tools.${tool.id}.label`);
      expect(tool.descriptionKey).toBe(`chat.tools.${tool.id}.description`);
    }
  });
});
