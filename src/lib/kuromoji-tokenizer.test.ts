import type { IpadicFeatures } from "@sglkc/kuromoji";
import { describe, expect, it } from "vitest";
import { KUROMOJI_DICT_PATH, toReadingTokens } from "./kuromoji-tokenizer";

const feature = (reading?: string): IpadicFeatures => ({ reading }) as IpadicFeatures;

describe("toReadingTokens", () => {
  it("projects kuromoji features down to just the reading", () => {
    expect(toReadingTokens([feature("サクラ"), feature("ノ"), feature(undefined)])).toEqual([
      { reading: "サクラ" },
      { reading: "ノ" },
      { reading: undefined },
    ]);
  });

  it("returns [] for no tokens", () => {
    expect(toReadingTokens([])).toEqual([]);
  });
});

describe("KUROMOJI_DICT_PATH", () => {
  it("matches the Vite kuromoji-dict plugin prefix", () => {
    expect(KUROMOJI_DICT_PATH).toBe("/kuromoji-dict");
  });
});
