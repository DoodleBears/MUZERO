import { describe, expect, it } from "vitest";
import { extractToolCalls, summarizeToolCalls } from "./dj-chat-trace";
import type { DjChatUIMessage } from "./types";

let seq = 0;
function assistantWithTools(
  tools: Array<{ name: string; state?: string; input?: unknown; output?: unknown }>,
  text?: string,
): DjChatUIMessage {
  const parts: DjChatUIMessage["parts"] = [];
  if (text) parts.push({ type: "text", text });
  for (const tcall of tools) {
    parts.push({
      type: `tool-${tcall.name}`,
      toolCallId: `call_${seq++}`,
      state: tcall.state ?? "output-available",
      input: tcall.input,
      output: tcall.output,
    } as never);
  }
  return { id: `m${seq++}`, role: "assistant", parts } as DjChatUIMessage;
}

function userMsg(text: string): DjChatUIMessage {
  return { id: `u${seq++}`, role: "user", parts: [{ type: "text", text }] } as DjChatUIMessage;
}

describe("extractToolCalls", () => {
  it("flattens tool calls in order with tool name / state / input / output", () => {
    const messages = [
      userMsg("play some jazz"),
      assistantWithTools(
        [
          { name: "library_search", input: { queries: ["jazz"] }, output: { total: 3 } },
          { name: "set_add_tracks", input: { sessionId: "#S1" }, output: { status: "ok" } },
        ],
        "On it.",
      ),
    ];
    const calls = extractToolCalls(messages);
    expect(calls).toEqual([
      {
        tool: "library_search",
        state: "output-available",
        input: { queries: ["jazz"] },
        output: { total: 3 },
      },
      {
        tool: "set_add_tracks",
        state: "output-available",
        input: { sessionId: "#S1" },
        output: { status: "ok" },
      },
    ]);
  });

  it("ignores text/user parts and returns [] when there are no tool calls", () => {
    expect(extractToolCalls([userMsg("hi"), assistantWithTools([], "hey there")])).toEqual([]);
  });

  it("preserves in-flight (input-available) calls too", () => {
    const calls = extractToolCalls([
      assistantWithTools([
        { name: "dj_generate_tracks", state: "input-available", input: { briefs: [] } },
      ]),
    ]);
    expect(calls[0]).toMatchObject({ tool: "dj_generate_tracks", state: "input-available" });
  });
});

describe("summarizeToolCalls", () => {
  it("counts calls per tool", () => {
    const calls = extractToolCalls([
      assistantWithTools([{ name: "library_search" }, { name: "library_search" }]),
      assistantWithTools([{ name: "set_add_tracks" }]),
    ]);
    expect(summarizeToolCalls(calls)).toEqual({ library_search: 2, set_add_tracks: 1 });
  });
});
