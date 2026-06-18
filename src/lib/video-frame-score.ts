import type { CropRect } from "@/db/types";

const DEFAULT_CANDIDATE_SECONDS = [0.1, 0.5, 1, 2] as const;
const MIN_DURATION_FOR_OFFSET_SEC = 0.11;
const END_EPSILON_SEC = 0.01;
const BLACK_LUMA_MEAN = 0.035;
const BLACK_LUMA_VARIANCE = 0.004;
const BLACK_NON_BLACK_RATIO = 0.02;
const NON_BLACK_LUMA = 0.06;

export type VideoFrameCandidate = {
  id: string;
  atTimeSeconds: number;
};

export type PixelSource = {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
};

export type VideoFrameScore = {
  lumaMean: number;
  lumaVariance: number;
  nonBlackRatio: number;
  black: boolean;
  rank: number;
};

export type ScoredFrame = {
  score: VideoFrameScore;
};

export function candidatePosterTimes(durationSec?: number): VideoFrameCandidate[] {
  const hasDuration =
    typeof durationSec === "number" && Number.isFinite(durationSec) && durationSec > 0;
  if (hasDuration && durationSec < MIN_DURATION_FOR_OFFSET_SEC) {
    return [{ id: "t0", atTimeSeconds: 0 }];
  }

  const raw: number[] = [...DEFAULT_CANDIDATE_SECONDS];
  if (hasDuration) raw.push(Math.min(durationSec * 0.05, 3));

  const maxTime = hasDuration
    ? Math.max(0, durationSec - END_EPSILON_SEC)
    : Number.POSITIVE_INFINITY;
  const seen = new Set<number>();
  const times: number[] = [];
  for (const value of raw) {
    const clamped = roundSeconds(Math.max(0, Math.min(value, maxTime)));
    if (seen.has(clamped)) continue;
    seen.add(clamped);
    times.push(clamped);
  }
  times.sort((a, b) => a - b);
  return times.map((atTimeSeconds) => ({
    id: timeCandidateId(atTimeSeconds),
    atTimeSeconds,
  }));
}

export function scoreImagePixels(source: PixelSource): VideoFrameScore {
  const pixelCount = Math.max(0, Math.floor(source.data.length / 4));
  if (pixelCount === 0) {
    return { black: true, lumaMean: 0, lumaVariance: 0, nonBlackRatio: 0, rank: 0 };
  }

  let lumaSum = 0;
  let lumaSquaredSum = 0;
  let nonBlack = 0;

  for (let i = 0; i < source.data.length; i += 4) {
    const alpha = source.data[i + 3] / 255;
    const luma =
      ((0.2126 * source.data[i] + 0.7152 * source.data[i + 1] + 0.0722 * source.data[i + 2]) /
        255) *
      alpha;
    lumaSum += luma;
    lumaSquaredSum += luma * luma;
    if (luma >= NON_BLACK_LUMA) nonBlack += 1;
  }

  const lumaMean = lumaSum / pixelCount;
  const lumaVariance = Math.max(0, lumaSquaredSum / pixelCount - lumaMean * lumaMean);
  const nonBlackRatio = nonBlack / pixelCount;
  const black =
    lumaMean < BLACK_LUMA_MEAN &&
    lumaVariance < BLACK_LUMA_VARIANCE &&
    nonBlackRatio < BLACK_NON_BLACK_RATIO;
  const rank = lumaMean + Math.sqrt(lumaVariance) * 0.5 + nonBlackRatio * 0.25;

  return { black, lumaMean, lumaVariance, nonBlackRatio, rank };
}

export function selectBestScoredFrame<T extends ScoredFrame>(frames: readonly T[]): T | null {
  const firstUseful = frames.find((frame) => !frame.score.black);
  if (firstUseful) return firstUseful;
  return frames.reduce<T | null>(
    (best, frame) => (!best || frame.score.rank > best.score.rank ? frame : best),
    null,
  );
}

export function centeredSquareCrop(width: number, height: number): CropRect | undefined {
  const safeWidth = Math.max(0, Math.round(width));
  const safeHeight = Math.max(0, Math.round(height));
  const side = Math.min(safeWidth, safeHeight);
  if (side <= 0) return undefined;
  return {
    x: Math.round((safeWidth - side) / 2),
    y: Math.round((safeHeight - side) / 2),
    width: side,
    height: side,
  };
}

function roundSeconds(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function timeCandidateId(value: number): string {
  return `t${Math.round(value * 1000)}`;
}
