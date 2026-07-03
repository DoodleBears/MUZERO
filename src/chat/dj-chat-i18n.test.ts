import { describe, expect, it } from "vitest";
import { djChatSystemPrompt } from "./dj-chat-prompt";
import { LOCALIZED_TOOL_IDS, toolDescription } from "./dj-chat-tool-descriptions";
import { createDjChatTools } from "./dj-chat-tools";

describe("djChatSystemPrompt", () => {
  it("returns a distinct prompt per UI language", () => {
    const en = djChatSystemPrompt("en");
    const zh = djChatSystemPrompt("zh");
    const ja = djChatSystemPrompt("ja");
    const ko = djChatSystemPrompt("ko");
    expect(new Set([en, zh, ja, ko]).size).toBe(4);
    expect(zh).toContain("AI DJ 助手");
    expect(ja).toContain("AI DJ アシスタント");
    expect(ko).toContain("AI DJ 어시스턴트");
  });

  it("falls back to English for unknown / missing locales and reads the primary subtag", () => {
    const en = djChatSystemPrompt("en");
    expect(djChatSystemPrompt(undefined)).toBe(en);
    expect(djChatSystemPrompt("fr")).toBe(en);
    expect(djChatSystemPrompt("zh-CN")).toBe(djChatSystemPrompt("zh"));
  });

  it("keeps the literal ref sigils + tool names untranslated in every locale", () => {
    for (const loc of ["en", "zh", "ja", "ko"]) {
      const p = djChatSystemPrompt(loc);
      expect(p).toContain("#T");
      expect(p).toContain("set_add_tracks");
      expect(p).toContain("dj_say");
    }
  });

  it("carries the curation-discipline guidance in every locale (Phase 9)", () => {
    // Distinctive per-locale phrase for "quality over quantity, judge by world knowledge".
    expect(djChatSystemPrompt("en")).toContain("quality over quantity");
    expect(djChatSystemPrompt("zh")).toContain("宁精勿滥");
    expect(djChatSystemPrompt("ja")).toContain("量より質");
    expect(djChatSystemPrompt("ko")).toContain("양보다 질");
    // Every locale steers toward judged set_add_tracks (the only add path now).
    for (const loc of ["en", "zh", "ja", "ko"]) {
      expect(djChatSystemPrompt(loc)).toContain("set_add_tracks");
    }
  });

  it("carries the reuse-existing-set guidance in every locale (Phase 11)", () => {
    expect(djChatSystemPrompt("en")).toContain("Reuse before creating");
    expect(djChatSystemPrompt("zh")).toContain("先复用再新建");
    expect(djChatSystemPrompt("ja")).toContain("作る前に再利用");
    expect(djChatSystemPrompt("ko")).toContain("만들기 전에 재사용");
  });

  it("nudges dj_say-once in every locale (Phase 14, trace fixes)", () => {
    // dj_say at most once per turn.
    expect(djChatSystemPrompt("en")).toContain("ONCE per turn");
    expect(djChatSystemPrompt("zh")).toContain("每回合最多调用一次");
    expect(djChatSystemPrompt("ja")).toContain("1ターンにつき最多1回");
    expect(djChatSystemPrompt("ko")).toContain("한 턴에 최대 한 번");
  });
});

describe("toolDescription", () => {
  it("returns a localized override for zh/ja/ko and '' for en/unknown", () => {
    expect(toolDescription("play_track", "zh")).toContain("切换");
    expect(toolDescription("play_track", "ja")).toContain("切り替え");
    expect(toolDescription("play_track", "ko")).toContain("바꿔");
    expect(toolDescription("play_track", "en")).toBe("");
    expect(toolDescription("play_track", "fr")).toBe("");
    expect(toolDescription("play_track", undefined)).toBe("");
  });

  it("reads the primary subtag (zh-CN → zh)", () => {
    expect(toolDescription("play_track", "zh-CN")).toBe(toolDescription("play_track", "zh"));
  });

  it("covers every registered tool id in all three locales (parity with English)", () => {
    const allTools = createDjChatTools({ includeGenerate: true, includeOnline: true });
    const toolIds = Object.keys(allTools).sort();
    expect(LOCALIZED_TOOL_IDS.slice().sort()).toEqual(toolIds);
    for (const id of toolIds) {
      for (const loc of ["zh", "ja", "ko"]) {
        expect(toolDescription(id, loc), `${id}/${loc}`).not.toBe("");
      }
    }
  });

  it("keeps literal tokens (#T/#S, tool names, params) untranslated in overrides", () => {
    expect(toolDescription("library_search", "zh")).toContain("#T");
    expect(toolDescription("library_search", "zh")).toContain("set_add_tracks");
    expect(toolDescription("library_search", "ja")).toContain("cursor");
    expect(toolDescription("dj_generate_tracks", "ko")).toContain("TrackBriefs");
  });
});

describe("createDjChatTools localization", () => {
  it("applies the localized description when a locale is given", () => {
    const zh = createDjChatTools({ includeGenerate: true, includeOnline: true, locale: "zh" });
    expect((zh.play_track as { description?: string }).description).toContain("切换");
    expect((zh.online_search_tracks as { description?: string }).description).toContain("网易云");
  });

  it("keeps the inline English by default (no locale) and for English", () => {
    const def = createDjChatTools({ includeGenerate: true, includeOnline: true });
    const en = createDjChatTools({ includeGenerate: true, includeOnline: true, locale: "en" });
    const desc = (def.play_track as { description?: string }).description;
    expect(desc).toContain("Switch the currently playing song");
    expect((en.play_track as { description?: string }).description).toBe(desc);
  });
});
