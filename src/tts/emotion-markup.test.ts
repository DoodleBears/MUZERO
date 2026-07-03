import { describe, expect, it } from "vitest";
import {
  buildEmotionText,
  emotionMarker,
  normalizeReplyParts,
  plainReplyText,
  type ReplyPart,
  usesParenEmotion,
} from "./emotion-markup";

describe("normalizeReplyParts", () => {
  it("keeps a multi-part say array, trimming text + emotion", () => {
    const parts = normalizeReplyParts({
      say: [
        { text: "  On it. ", emotion: " happy " },
        { text: "Switching now.", emotion: "" },
      ],
    });
    expect(parts).toEqual([
      { text: "On it.", emotion: "happy" },
      { text: "Switching now.", emotion: undefined },
    ]);
  });

  it("falls back to a legacy single text", () => {
    expect(normalizeReplyParts({ text: "  hello  " })).toEqual([
      { text: "hello", emotion: undefined },
    ]);
  });

  it("prefers say over text when both are present and drops empty parts", () => {
    const parts = normalizeReplyParts({
      say: [{ text: "kept" }, { text: "   " }],
      text: "ignored",
    });
    expect(parts).toEqual([{ text: "kept", emotion: undefined }]);
  });

  it("returns [] for an empty payload", () => {
    expect(normalizeReplyParts({})).toEqual([]);
    expect(normalizeReplyParts({ say: [] })).toEqual([]);
  });
});

describe("plainReplyText", () => {
  it("joins part texts with a space and ignores emotions", () => {
    const parts: ReplyPart[] = [
      { text: "First.", emotion: "excited" },
      { text: "Second.", emotion: "sad" },
    ];
    expect(plainReplyText(parts)).toBe("First. Second.");
  });
});

describe("usesParenEmotion", () => {
  it("is true only for s1", () => {
    expect(usesParenEmotion("s1")).toBe(true);
    expect(usesParenEmotion("s2-pro")).toBe(false);
    expect(usesParenEmotion("s2.1-pro")).toBe(false);
    expect(usesParenEmotion("s2.1-pro-free")).toBe(false);
  });
});

describe("emotionMarker", () => {
  it("uses brackets for the S2 family, parentheses for S1", () => {
    expect(emotionMarker("happy", "s2.1-pro-free")).toBe("[happy]");
    expect(emotionMarker("happy", "s1")).toBe("(happy)");
  });

  it("strips stray brackets the model may already have added (no double-wrap)", () => {
    expect(emotionMarker("[excited]", "s2-pro")).toBe("[excited]");
    expect(emotionMarker("(gentle)", "s1")).toBe("(gentle)");
  });

  it("returns '' for an empty label", () => {
    expect(emotionMarker("  ", "s1")).toBe("");
  });
});

describe("buildEmotionText", () => {
  it("prefixes each part with its emotion marker (S2 brackets)", () => {
    const parts: ReplyPart[] = [
      { text: "Great choice!", emotion: "happy" },
      { text: "Cueing it up.", emotion: "gentle" },
    ];
    expect(buildEmotionText(parts, "s2.1-pro-free")).toBe(
      "[happy] Great choice! [gentle] Cueing it up.",
    );
  });

  it("uses parentheses for S1", () => {
    const parts: ReplyPart[] = [{ text: "Here we go.", emotion: "excited" }];
    expect(buildEmotionText(parts, "s1")).toBe("(excited) Here we go.");
  });

  it("omits the marker for parts without an emotion (equals plain text)", () => {
    const parts: ReplyPart[] = [{ text: "Just this." }];
    expect(buildEmotionText(parts, "s2.1-pro")).toBe("Just this.");
    expect(buildEmotionText(parts, "s2.1-pro")).toBe(plainReplyText(parts));
  });

  it("mixes emotional and neutral parts", () => {
    const parts: ReplyPart[] = [{ text: "Okay." }, { text: "Let's dance!", emotion: "hyped" }];
    expect(buildEmotionText(parts, "s2-pro")).toBe("Okay. [hyped] Let's dance!");
  });
});
