export type DjChatToolAvailability = "always" | "online" | "generation";

export interface DjChatToolMetadata<Id extends string = string> {
  availability: DjChatToolAvailability;
  category: "library" | "sets" | "queue" | "player" | "memories" | "online" | "generation";
  descriptionKey: `chat.tools.${Id}.description`;
  id: Id;
  labelKey: `chat.tools.${Id}.label`;
}

const tool = <const Id extends string>(
  id: Id,
  category: DjChatToolMetadata["category"],
  availability: DjChatToolAvailability = "always",
): DjChatToolMetadata<Id> => ({
  availability,
  category,
  descriptionKey: `chat.tools.${id}.description`,
  id,
  labelKey: `chat.tools.${id}.label`,
});

export const DJ_CHAT_TOOL_METADATA = [
  tool("library_search", "library"),
  tool("library_tree", "library"),
  tool("library_list_tags", "library"),
  tool("now_playing_get", "player"),
  tool("set_list", "sets"),
  tool("set_get", "sets"),
  tool("set_create", "sets"),
  tool("set_update", "sets"),
  tool("set_add_tracks", "sets"),
  tool("set_switch", "queue"),
  tool("queue_add", "queue"),
  tool("queue_edit", "queue"),
  tool("queue_clear", "queue"),
  tool("play_set", "player"),
  tool("play_track", "player"),
  tool("memory_search", "memories"),
  tool("add_memory", "memories"),
  tool("dj_say", "player"),
  tool("online_search_tracks", "online", "online"),
  tool("online_add_tracks", "online", "online"),
  tool("dj_propose_briefs", "generation", "generation"),
  tool("dj_generate_tracks", "generation", "generation"),
] as const satisfies readonly DjChatToolMetadata[];

export type DjChatToolId = (typeof DJ_CHAT_TOOL_METADATA)[number]["id"];
