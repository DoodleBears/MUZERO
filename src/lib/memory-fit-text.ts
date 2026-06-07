import { type MeasureMemoryTextHeight, measureMemoryTextHeight } from "./memory-masonry";

const DEFAULT_FONT_FAMILY =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export interface MemoryFitTextOptions {
  fontFamily?: string;
  height: number;
  lineHeightRatio?: number;
  maxFontSize?: number;
  measureTextHeight?: MeasureMemoryTextHeight;
  minFontSize?: number;
  width: number;
}

export interface MemoryFitTextResult {
  fontSize: number;
  lineHeight: number;
}

export function resolveMemoryFitText(
  text: string,
  {
    fontFamily = DEFAULT_FONT_FAMILY,
    height,
    lineHeightRatio = 1.125,
    maxFontSize = 64,
    measureTextHeight = measureMemoryTextHeight,
    minFontSize = 14,
    width,
  }: MemoryFitTextOptions,
): MemoryFitTextResult {
  const floor = Math.max(1, Math.floor(minFontSize));
  const ceiling = Math.max(floor, Math.floor(maxFontSize));
  if (width <= 0 || height <= 0 || !text.trim()) {
    return toFitTextResult(ceiling, lineHeightRatio);
  }

  let low = floor;
  let high = ceiling;
  let best = floor;
  while (low <= high) {
    const size = Math.floor((low + high) / 2);
    const lineHeight = lineHeightForFont(size, lineHeightRatio);
    const measuredHeight = measureTextHeight(text, width, `${size}px ${fontFamily}`, lineHeight);
    if (measuredHeight <= height) {
      best = size;
      low = size + 1;
    } else {
      high = size - 1;
    }
  }

  return toFitTextResult(best, lineHeightRatio);
}

function toFitTextResult(fontSize: number, lineHeightRatio: number): MemoryFitTextResult {
  return {
    fontSize,
    lineHeight: lineHeightForFont(fontSize, lineHeightRatio),
  };
}

function lineHeightForFont(fontSize: number, lineHeightRatio: number): number {
  return Math.ceil(fontSize * lineHeightRatio);
}
