import { describe, expect, it } from "vitest";
import { activeWordIndex } from "./active-word";
import type { WordTiming } from "./model";

const words: WordTiming[] = [
  { timeMs: 1000, durMs: 300, text: "a " },
  { timeMs: 1300, durMs: 200, text: "b " },
  { timeMs: 1500, durMs: 500, text: "c" },
];

describe("activeWordIndex", () => {
  it("returns -1 before the first word", () => {
    expect(activeWordIndex(words, 0)).toBe(-1);
    expect(activeWordIndex(words, 999)).toBe(-1);
  });

  it("returns the index of the word at exactly its start", () => {
    expect(activeWordIndex(words, 1000)).toBe(0);
    expect(activeWordIndex(words, 1300)).toBe(1);
    expect(activeWordIndex(words, 1500)).toBe(2);
  });

  it("returns the most recent word between starts", () => {
    expect(activeWordIndex(words, 1200)).toBe(0);
    expect(activeWordIndex(words, 1499)).toBe(1);
  });

  it("stays on the last word after it starts", () => {
    expect(activeWordIndex(words, 9999)).toBe(2);
  });

  it("returns -1 for an empty list", () => {
    expect(activeWordIndex([], 1000)).toBe(-1);
  });
});
