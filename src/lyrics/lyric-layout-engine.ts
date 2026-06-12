import type { LyricRenderLine } from "./lyric-render-line";

export type LyricLayoutState = "passed" | "active" | "upcoming" | "distant";

export interface LyricLayoutFrame {
  id: string;
  index: number;
  y: number;
  naturalY: number;
  translateY: number;
  height: number;
  opacity: number;
  scale: number;
  blurPx: number;
  delaySec: number;
  state: LyricLayoutState;
}

export interface LyricLayoutResult {
  activeIndex: number;
  anchorY: number;
  totalHeight: number;
  frames: LyricLayoutFrame[];
}

export interface LyricCascadeTuning {
  /** Active line anchor inside the viewport, 0–1. */
  anchorRatio?: number;
  /** Maximum blur applied to distant inactive lines. */
  maxBlurPx?: number;
  /** Per-row cascade delay multiplier. */
  staggerMs?: number;
  /** Upper bound for a far row's delay. */
  maxDelayMs?: number;
}

export interface SolveLyricLayoutInput {
  lines: LyricRenderLine[];
  activeIndex: number;
  lineHeights: number[];
  viewportHeight: number;
  alignPosition: number;
  lineGapPx: number;
  reducedMotion: boolean;
  visualStyle?: {
    activeOpacity: number;
    inactiveOpacity: number;
    inactiveScale: number;
  };
  cascadeTuning?: LyricCascadeTuning;
}

export const DEFAULT_LYRIC_CASCADE_TUNING = {
  anchorRatio: 0.42,
  maxBlurPx: 4.2,
  staggerMs: 52,
  maxDelayMs: 220,
} as const satisfies Required<LyricCascadeTuning>;

const MIN_LINE_HEIGHT = 36;
const DISTANT_DISTANCE = 3;
const STAGGER_SEC = 0.052;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function safeHeight(height: number | undefined): number {
  return Number.isFinite(height) && height !== undefined
    ? Math.max(MIN_LINE_HEIGHT, height)
    : MIN_LINE_HEIGHT;
}

function rounded(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function visualState(index: number, activeIndex: number): LyricLayoutState {
  if (index === activeIndex) return "active";
  const distance = Math.abs(index - activeIndex);
  if (distance >= DISTANT_DISTANCE) return "distant";
  return index < activeIndex ? "passed" : "upcoming";
}

function opacityFor(
  state: LyricLayoutState,
  distance: number,
  reducedMotion: boolean,
  visualStyle: SolveLyricLayoutInput["visualStyle"],
): number {
  if (visualStyle) {
    return state === "active" ? visualStyle.activeOpacity : visualStyle.inactiveOpacity;
  }
  if (state === "active") return 1;
  if (reducedMotion) return state === "distant" ? 0.42 : 0.72;
  if (state === "distant") return 0.28;
  return distance <= 1 ? 0.78 : 0.58;
}

function scaleFor(
  state: LyricLayoutState,
  distance: number,
  reducedMotion: boolean,
  visualStyle: SolveLyricLayoutInput["visualStyle"],
): number {
  if (visualStyle) {
    return state === "active" ? 1 : visualStyle.inactiveScale;
  }
  if (reducedMotion || state === "active") return 1;
  if (state === "distant") return 0.9;
  return distance <= 1 ? 0.96 : 0.93;
}

function blurFor(
  state: LyricLayoutState,
  distance: number,
  reducedMotion: boolean,
  cascadeTuning: LyricCascadeTuning | undefined,
): number {
  if (reducedMotion || state === "active") return 0;
  if (cascadeTuning?.maxBlurPx != null) {
    const maxBlurPx = clamp(cascadeTuning.maxBlurPx, 0, 16);
    if (state === "distant") return rounded(maxBlurPx);
    return rounded(Math.min(maxBlurPx, distance * (maxBlurPx / DISTANT_DISTANCE)));
  }
  if (state === "distant") return 4.2;
  return rounded(Math.min(3.2, distance * 1.2));
}

function delayFor(
  index: number,
  activeIndex: number,
  reducedMotion: boolean,
  cascadeTuning: LyricCascadeTuning | undefined,
): number {
  if (reducedMotion || index === activeIndex) return 0;
  const distance = Math.abs(index - activeIndex);
  if (cascadeTuning?.staggerMs != null) {
    const staggerSec = clamp(cascadeTuning.staggerMs, 0, 300) / 1000;
    const maxDelaySec =
      clamp(cascadeTuning.maxDelayMs ?? DEFAULT_LYRIC_CASCADE_TUNING.maxDelayMs, 0, 1000) / 1000;
    return rounded(Math.min(maxDelaySec, distance * staggerSec));
  }
  return rounded(Math.min(0.22, distance * STAGGER_SEC));
}

export function solveLyricLayout(input: SolveLyricLayoutInput): LyricLayoutResult {
  if (input.lines.length === 0) {
    return { activeIndex: -1, anchorY: 0, totalHeight: 0, frames: [] };
  }

  const activeIndex = clamp(input.activeIndex, 0, input.lines.length - 1);
  const heights = input.lines.map((_, index) => safeHeight(input.lineHeights[index]));
  const gap = Math.max(0, input.lineGapPx);
  const naturalY = heights.reduce<number[]>((acc, height, index) => {
    const previous = acc[index - 1] ?? 0;
    acc.push(index === 0 ? 0 : previous + heights[index - 1] + gap);
    void height;
    return acc;
  }, []);
  const totalHeight = heights.reduce((sum, height) => sum + height, 0) + gap * (heights.length - 1);
  const anchorY = rounded(Math.max(0, input.viewportHeight) * clamp(input.alignPosition, 0, 1));
  const activeY = anchorY - heights[activeIndex] / 2;
  const offset = activeY - naturalY[activeIndex];

  return {
    activeIndex,
    anchorY,
    totalHeight: rounded(totalHeight),
    frames: input.lines.map((line, index) => {
      const state = visualState(index, activeIndex);
      const distance = Math.abs(index - activeIndex);
      const y = naturalY[index] + offset;
      return {
        id: line.id,
        index,
        y: rounded(y),
        naturalY: rounded(naturalY[index]),
        translateY: rounded(offset),
        height: heights[index],
        opacity: opacityFor(state, distance, input.reducedMotion, input.visualStyle),
        scale: scaleFor(state, distance, input.reducedMotion, input.visualStyle),
        blurPx: blurFor(state, distance, input.reducedMotion, input.cascadeTuning),
        delaySec: delayFor(index, activeIndex, input.reducedMotion, input.cascadeTuning),
        state,
      };
    }),
  };
}
