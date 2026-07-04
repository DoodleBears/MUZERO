import { describe, expect, it } from "vitest";
import { collectToolActivityNotices } from "./dj-tool-activity";
import type { DjChatUIMessage } from "./types";

let seq = 0;
function assistantWithTools(
  tools: Array<{ name: string; state?: string; input?: unknown; id?: string }>,
  text?: string,
): DjChatUIMessage {
  const parts: DjChatUIMessage["parts"] = [];
  if (text) parts.push({ type: "text", text });
  for (const tcall of tools) {
    parts.push({
      type: `tool-${tcall.name}`,
      toolCallId: tcall.id ?? `call_${seq++}`,
      state: tcall.state ?? "output-available",
      input: tcall.input,
    } as never);
  }
  return { id: `m${seq++}`, role: "assistant", parts } as DjChatUIMessage;
}

function userMsg(text: string): DjChatUIMessage {
  return { id: `u${seq++}`, role: "user", parts: [{ type: "text", text }] } as DjChatUIMessage;
}

describe("collectToolActivityNotices", () => {
  it("emits one notice per tool call with icon key + key-input detail", () => {
    const seen = new Set<string>();
    const messages = [
      userMsg("play some jazz"),
      assistantWithTools(
        [
          { name: "library_search", id: "a", input: { queries: ["jazz"] } },
          { name: "set_create", id: "b", input: { name: "Jazz Nights" } },
        ],
        "On it.",
      ),
    ];
    const notices = collectToolActivityNotices(messages, seen);
    expect(notices).toEqual([
      { key: "a", toolName: "library_search", iconKey: "search", detail: "jazz" },
      { key: "b", toolName: "set_create", iconKey: "list-plus", detail: "Jazz Nights" },
    ]);
    expect(seen).toEqual(new Set(["a", "b"]));
  });

  it("never re-emits a call already in `seen` (idempotent across snapshots)", () => {
    const seen = new Set<string>();
    const messages = [
      assistantWithTools([{ name: "play_set", id: "x", input: { sessionId: "#S1" } }]),
    ];
    expect(collectToolActivityNotices(messages, seen)).toHaveLength(1);
    // Same snapshot re-processed → nothing new.
    expect(collectToolActivityNotices(messages, seen)).toEqual([]);
  });

  it("excludes dj_say (it has its own reply surface)", () => {
    const seen = new Set<string>();
    const messages = [
      assistantWithTools([
        { name: "dj_say", id: "s", input: { say: [{ text: "hi" }] } },
        { name: "play_track", id: "p", input: { trackId: "#T1" } },
      ]),
    ];
    const notices = collectToolActivityNotices(messages, seen);
    expect(notices.map((n) => n.toolName)).toEqual(["play_track"]);
    expect(seen.has("s")).toBe(false);
  });

  it("skips a call whose input hasn't landed yet (input-streaming)", () => {
    const seen = new Set<string>();
    const streaming = [
      assistantWithTools([{ name: "library_search", id: "q", state: "input-streaming" }]),
    ];
    // input is undefined → no notice yet, and not marked seen.
    expect(collectToolActivityNotices(streaming, seen)).toEqual([]);
    expect(seen.has("q")).toBe(false);
    // Once input lands, it fires.
    const ready = [
      assistantWithTools([
        { name: "library_search", id: "q", state: "input-available", input: { queries: ["lofi"] } },
      ]),
    ];
    expect(collectToolActivityNotices(ready, seen).map((n) => n.key)).toEqual(["q"]);
  });

  it("ignores user-message parts", () => {
    const seen = new Set<string>();
    expect(collectToolActivityNotices([userMsg("hello")], seen)).toEqual([]);
  });

  it("omits detail when the tool has no summarizable key param", () => {
    const seen = new Set<string>();
    const notices = collectToolActivityNotices(
      [assistantWithTools([{ name: "queue_clear", id: "c", input: {} }])],
      seen,
    );
    expect(notices).toEqual([
      { key: "c", toolName: "queue_clear", iconKey: "list-x", detail: undefined },
    ]);
  });
});
