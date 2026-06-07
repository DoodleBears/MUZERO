import { layout, type PreparedText, prepare } from "@chenglou/pretext";

export const MEMORY_MASONRY_LEADING_ID = "__memory-create";

const DEFAULT_FONT_FAMILY =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

const preparedCache = new Map<string, PreparedText>();
let pretextAvailable = true;
let canUsePretextMeasurementCache: boolean | undefined;

export interface MemoryMasonryCardInput {
  fixedHeight?: number;
  hasPhoto?: boolean;
  id: string;
  note?: string;
  photoHeightRatio?: number;
}

export interface MemoryMasonryOptions {
  cardPaddingX: number;
  cardPaddingY: number;
  containerWidth: number;
  footerHeight: number;
  gap: number;
  maxColumnCount: number;
  minColumnWidth: number;
  noteFont: string;
  noteLineHeight: number;
  photoGap: number;
  photoHeightRatio: number;
}

export interface PositionedMemoryMasonryItem {
  column: number;
  height: number;
  id: string;
  width: number;
  x: number;
  y: number;
}

export interface MemoryMasonryLayout {
  columnCount: number;
  columnWidth: number;
  containerHeight: number;
  items: PositionedMemoryMasonryItem[];
}

export type MeasureMemoryTextHeight = (
  text: string,
  width: number,
  font: string,
  lineHeight: number,
) => number;

export const memoryMasonryDefaults = {
  cardPaddingX: 12,
  cardPaddingY: 12,
  footerHeight: 40,
  gap: 12,
  leadingCreateHeight: 128,
  leadingComposerHeight: 184,
  maxColumnCount: 3,
  minColumnWidth: 280,
  noteFont: `14px ${DEFAULT_FONT_FAMILY}`,
  noteLineHeight: 24,
  photoGap: 12,
  photoHeightRatio: 3 / 4,
} as const;

export function layoutMemoryMasonry(
  cards: readonly MemoryMasonryCardInput[],
  options: MemoryMasonryOptions,
  measureTextHeight: MeasureMemoryTextHeight = measureMemoryTextHeight,
): MemoryMasonryLayout {
  const gap = options.gap;
  const columnCount = resolveMemoryMasonryColumnCount(
    options.containerWidth,
    options.minColumnWidth,
    options.maxColumnCount,
    gap,
  );
  const columnWidth = Math.max(1, (options.containerWidth - gap * (columnCount - 1)) / columnCount);
  const columnHeights = new Array<number>(columnCount).fill(0);
  const items: PositionedMemoryMasonryItem[] = [];

  for (const card of cards) {
    const column = shortestColumn(columnHeights);
    const height =
      card.fixedHeight ??
      estimateMemoryCardHeight(
        card.note ?? "",
        Boolean(card.hasPhoto),
        columnWidth,
        {
          ...options,
          photoHeightRatio: card.photoHeightRatio ?? options.photoHeightRatio,
        },
        measureTextHeight,
      );
    const y = columnHeights[column] ?? 0;
    items.push({
      column,
      height,
      id: card.id,
      width: columnWidth,
      x: column * (columnWidth + gap),
      y,
    });
    columnHeights[column] = y + height + gap;
  }

  const tallest = Math.max(0, ...columnHeights);
  return {
    columnCount,
    columnWidth,
    containerHeight: tallest > 0 ? tallest - gap : 0,
    items,
  };
}

export function estimateMemoryCardHeight(
  note: string,
  hasPhoto: boolean,
  columnWidth: number,
  options: Pick<
    MemoryMasonryOptions,
    | "cardPaddingX"
    | "cardPaddingY"
    | "footerHeight"
    | "noteFont"
    | "noteLineHeight"
    | "photoGap"
    | "photoHeightRatio"
  >,
  measureTextHeight: MeasureMemoryTextHeight = measureMemoryTextHeight,
): number {
  const textWidth = Math.max(1, columnWidth - options.cardPaddingX * 2);
  const noteHeight = measureTextHeight(note, textWidth, options.noteFont, options.noteLineHeight);
  const photoHeight = hasPhoto ? textWidth * options.photoHeightRatio + options.photoGap : 0;
  return Math.ceil(options.cardPaddingY * 2 + photoHeight + noteHeight + options.footerHeight);
}

export function measureMemoryTextHeight(
  text: string,
  width: number,
  font: string,
  lineHeight: number,
): number {
  if (!pretextAvailable || !canUsePretextMeasurement()) {
    return fallbackTextHeight(text, width, lineHeight);
  }

  try {
    const cacheKey = `${font}\u0000${text}`;
    let prepared = preparedCache.get(cacheKey);
    if (!prepared) {
      prepared = prepare(text, font, { whiteSpace: "pre-wrap" });
      preparedCache.set(cacheKey, prepared);
    }
    return layout(prepared, width, lineHeight).height;
  } catch {
    pretextAvailable = false;
    return fallbackTextHeight(text, width, lineHeight);
  }
}

function canUsePretextMeasurement(): boolean {
  if (canUsePretextMeasurementCache !== undefined) return canUsePretextMeasurementCache;
  if (typeof OffscreenCanvas !== "undefined") {
    canUsePretextMeasurementCache = true;
    return canUsePretextMeasurementCache;
  }
  if (typeof window !== "undefined" && /jsdom/i.test(window.navigator.userAgent)) {
    canUsePretextMeasurementCache = false;
    return canUsePretextMeasurementCache;
  }

  canUsePretextMeasurementCache = typeof document !== "undefined";
  return canUsePretextMeasurementCache;
}

export function resolveMemoryMasonryColumnCount(
  containerWidth: number,
  minColumnWidth: number,
  maxColumnCount: number,
  gap: number,
): number {
  if (containerWidth <= 0) return 1;
  return Math.max(
    1,
    Math.min(maxColumnCount, Math.floor((containerWidth + gap) / (minColumnWidth + gap))),
  );
}

function shortestColumn(columnHeights: readonly number[]): number {
  let shortest = 0;
  for (let i = 1; i < columnHeights.length; i += 1) {
    if ((columnHeights[i] ?? 0) < (columnHeights[shortest] ?? 0)) shortest = i;
  }
  return shortest;
}

function fallbackTextHeight(text: string, width: number, lineHeight: number): number {
  const averageGlyphWidth = 7;
  const charsPerLine = Math.max(1, Math.floor(width / averageGlyphWidth));
  const lineCount = text
    .split("\n")
    .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
  return Math.max(lineHeight, lineCount * lineHeight);
}
