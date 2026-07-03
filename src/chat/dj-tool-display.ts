/**
 * Pure display helpers for surfacing DJ tool calls in the UI (the dock activity
 * popover): a per-tool lucide icon name + a one-line summary of the key input
 * (the search query, the new set's name, the generated title…). Reads only from
 * the tool part already in the runtime snapshot — no bus, no instrumentation, so
 * it adds ZERO overhead to tool-call execution (perf note).
 */

/** Per-tool lucide icon name (resolved to a component in the activity popover). */
const TOOL_ICON: Record<string, string> = {
  library_search: "search",
  library_tree: "folder-tree",
  library_list_tags: "tags",
  now_playing_get: "disc-3",
  set_list: "list-music",
  set_get: "list-music",
  set_create: "list-plus",
  set_update: "pencil",
  set_add_tracks: "list-plus",
  set_switch: "list-music",
  queue_add: "list-ordered",
  queue_edit: "repeat",
  queue_clear: "list-x",
  play_set: "play",
  play_track: "play",
  memory_search: "search",
  add_memory: "sticky-note",
  dj_say: "sparkles",
  online_search_tracks: "globe",
  online_add_tracks: "download",
  dj_propose_briefs: "wand-2",
  dj_generate_tracks: "wand-2",
};

export function toolIconName(toolName: string): string {
  return TOOL_ICON[toolName] ?? "sparkles";
}

const MAX_DETAIL = 80;

function clip(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > MAX_DETAIL ? `${trimmed.slice(0, MAX_DETAIL - 1)}…` : trimmed;
}

/** Extract the human-useful "core parameter" of a tool call, when there is one. */
export function summarizeToolInput(toolName: string, input: unknown): string | undefined {
  const obj = (input ?? {}) as Record<string, unknown>;
  const asStr = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const queries = () => {
    const single = asStr(obj.query);
    const many = Array.isArray(obj.queries)
      ? obj.queries.filter((q): q is string => typeof q === "string" && q.trim().length > 0)
      : [];
    const all = [single, ...many].filter(Boolean) as string[];
    return all.length ? clip(all.join("、")) : undefined;
  };

  switch (toolName) {
    case "library_search":
    case "online_search_tracks":
      return queries();
    case "set_create":
    case "set_update": {
      const name = asStr(obj.name);
      return name ? clip(name) : undefined;
    }
    case "add_memory": {
      const note = asStr(obj.note);
      return note ? clip(note) : undefined;
    }
    case "dj_propose_briefs":
    case "dj_generate_tracks": {
      const briefs = Array.isArray(obj.briefs) ? obj.briefs : [];
      const titles = briefs
        .map((b) => {
          const brief = (b ?? {}) as Record<string, unknown>;
          return asStr(brief.title) ?? asStr(brief.caption);
        })
        .filter(Boolean) as string[];
      return titles.length ? clip(titles.join("、")) : undefined;
    }
    default:
      return undefined;
  }
}
