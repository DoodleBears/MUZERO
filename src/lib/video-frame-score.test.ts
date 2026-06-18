import { describe, expect, it } from "vitest";
import {
  candidatePosterTimes,
  centeredSquareCrop,
  scoreImagePixels,
  selectBestScoredFrame,
} from "@/lib/video-frame-score";

function pixels(width: number, height: number, fill: [number, number, number, number]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill[0];
    data[i + 1] = fill[1];
    data[i + 2] = fill[2];
    data[i + 3] = fill[3];
  }
  return { data, height, width };
}

describe("candidatePosterTimes", () => {
  it("samples useful early times and dedupes the duration-relative candidate", () => {
    expect(candidatePosterTimes(60).map((c) => c.atTimeSeconds)).toEqual([0.1, 0.5, 1, 2, 3]);
    expect(candidatePosterTimes(10).map((c) => c.atTimeSeconds)).toEqual([0.1, 0.5, 1, 2]);
  });

  it("clamps candidates for short videos and falls back to 0 for tiny clips", () => {
    expect(candidatePosterTimes(1.2).map((c) => c.atTimeSeconds)).toEqual([
      0.06, 0.1, 0.5, 1, 1.19,
    ]);
    expect(candidatePosterTimes(0.05).map((c) => c.atTimeSeconds)).toEqual([0]);
  });

  it("keeps the default sequence when duration is unknown", () => {
    expect(candidatePosterTimes().map((c) => c.atTimeSeconds)).toEqual([0.1, 0.5, 1, 2]);
  });
});

describe("scoreImagePixels", () => {
  it("classifies flat black and near-black frames as black", () => {
    expect(scoreImagePixels(pixels(4, 4, [0, 0, 0, 255])).black).toBe(true);
    expect(scoreImagePixels(pixels(4, 4, [6, 6, 6, 255])).black).toBe(true);
  });

  it("keeps bright frames and high-variance title frames", () => {
    expect(scoreImagePixels(pixels(4, 4, [180, 180, 180, 255])).black).toBe(false);

    const data = pixels(4, 4, [0, 0, 0, 255]);
    for (let i = 0; i < data.data.length; i += 8) {
      data.data[i] = 255;
      data.data[i + 1] = 255;
      data.data[i + 2] = 255;
    }
    const score = scoreImagePixels(data);
    expect(score.black).toBe(false);
    expect(score.lumaVariance).toBeGreaterThan(0.1);
  });
});

describe("selectBestScoredFrame", () => {
  it("returns the first non-black frame", () => {
    const black = { id: "t100", score: scoreImagePixels(pixels(2, 2, [0, 0, 0, 255])) };
    const firstUseful = { id: "t500", score: scoreImagePixels(pixels(2, 2, [90, 90, 90, 255])) };
    const laterUseful = {
      id: "t1000",
      score: scoreImagePixels(pixels(2, 2, [220, 220, 220, 255])),
    };

    expect(selectBestScoredFrame([black, firstUseful, laterUseful])).toBe(firstUseful);
  });

  it("falls back to the least-bad decoded frame when all candidates are black", () => {
    const black = { id: "t100", score: scoreImagePixels(pixels(2, 2, [0, 0, 0, 255])) };
    const almost = { id: "t500", score: scoreImagePixels(pixels(2, 2, [8, 8, 8, 255])) };

    expect(selectBestScoredFrame([black, almost])).toBe(almost);
  });
});

describe("centeredSquareCrop", () => {
  it("returns a centered square crop for landscape and portrait images", () => {
    expect(centeredSquareCrop(1920, 1080)).toEqual({ height: 1080, width: 1080, x: 420, y: 0 });
    expect(centeredSquareCrop(720, 1280)).toEqual({ height: 720, width: 720, x: 0, y: 280 });
  });
});
