import { type MeasureMemoryTextHeight, measureMemoryTextHeight } from "./memory-masonry";

export const MEMORY_TIMELINE_IDLE_DELAY_MS = 4000;
export const MEMORY_TIMELINE_CAROUSEL_INTERVAL_MS = 5000;
export const MEMORY_TIMELINE_CAROUSEL_MAX_INTERVAL_MS = 14000;
export const MEMORY_TIMELINE_ITEM_HEIGHT = 112;

const DEFAULT_FONT_FAMILY =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

const MEMORY_TIMELINE_CAROUSEL_EXTRA_START_CHAR_COUNT = 48;
const MEMORY_TIMELINE_CAROUSEL_MS_PER_CHARACTER = 80;

interface MemoryTimelineCarouselIntervalOptions {
  baseMs?: number;
  extraStartCharCount?: number;
  maxMs?: number;
  msPerCharacter?: number;
}

export interface MemoryTimelineLayoutInput {
  hasPhoto?: boolean;
  id: string;
  note: string;
}

export interface MemoryTimelineLayoutOptions {
  baseItemHeight?: number;
  cardPaddingX?: number;
  cardPaddingY?: number;
  footerHeight?: number;
  gap?: number;
  noteFont?: string;
  noteLineHeight?: number;
  photoGap?: number;
  photoHeight?: number;
  width: number;
}

export interface MemoryTimelineLayoutItem {
  height: number;
  id: string;
  y: number;
}

export interface MemoryTimelineLayout {
  containerHeight: number;
  items: MemoryTimelineLayoutItem[];
}

export function sortMemoryTimelineItems<T extends { createdAt: number }>(items: readonly T[]): T[] {
  return items
    .map((item, index) => ({ index, item }))
    .sort((a, b) => a.item.createdAt - b.item.createdAt || a.index - b.index)
    .map(({ item }) => item);
}

export function memoryTimelineIndexFromOffset(
  offsetPx: number,
  itemWidth: number,
  itemCount: number,
): number {
  if (itemCount <= 0 || itemWidth <= 0) return 0;
  const index = Math.round(Math.max(0, offsetPx) / itemWidth);
  return Math.min(itemCount - 1, index);
}

export function memoryTimelineOffsetForIndex(
  index: number,
  itemWidth: number,
  itemCount: number,
): number {
  if (itemCount <= 0 || itemWidth <= 0) return 0;
  return Math.min(itemCount - 1, Math.max(0, index)) * itemWidth;
}

export function nextIdleMemoryIndex(currentIndex: number, itemCount: number): number {
  if (itemCount <= 0) return 0;
  if (currentIndex < 0 || currentIndex >= itemCount - 1) return 0;
  return currentIndex + 1;
}

export function memoryTimelineCarouselIntervalMs(
  note: string,
  {
    baseMs = MEMORY_TIMELINE_CAROUSEL_INTERVAL_MS,
    extraStartCharCount = MEMORY_TIMELINE_CAROUSEL_EXTRA_START_CHAR_COUNT,
    maxMs = MEMORY_TIMELINE_CAROUSEL_MAX_INTERVAL_MS,
    msPerCharacter = MEMORY_TIMELINE_CAROUSEL_MS_PER_CHARACTER,
  }: MemoryTimelineCarouselIntervalOptions = {},
): number {
  const readableLength = Array.from(note.replace(/\s+/g, "")).length;
  const extraCharacters = Math.max(0, readableLength - extraStartCharCount);
  return Math.min(maxMs, Math.max(baseMs, Math.round(baseMs + extraCharacters * msPerCharacter)));
}

// --- Unified display-duration scheme (immersive-memory-moments PRD §4.3) -------
// The carousel rail and the immersive overlay share ONE time curve so a memory
// dwells consistently across surfaces. `memoryTimelineCarouselIntervalMs` is the
// base curve (length → ms); the overlay adds a photo bonus on top.

/** Minimum on-screen time before an anchored cue may preempt a floating one (ms). */
export const MEMORY_DISPLAY_MIN_SHOW_MS = 2000;
/** Extra dwell for a memory that carries a photo (ms). */
export const MEMORY_DISPLAY_PHOTO_BONUS_MS = 2000;
/** Drop an anchored cue that would surface more than this late vs its `atSec` (sec). */
export const MEMORY_ANCHOR_STALE_SEC = 6;

/**
 * How long to keep one memory on screen, derived from the shared length curve
 * ({@link memoryTimelineCarouselIntervalMs}) plus a bonus when it has a photo.
 */
export function memoryDisplayDurationMs(
  memory: { note: string; hasPhoto?: boolean },
  options: MemoryTimelineCarouselIntervalOptions & { photoBonusMs?: number } = {},
): number {
  const photoBonus = memory.hasPhoto ? (options.photoBonusMs ?? MEMORY_DISPLAY_PHOTO_BONUS_MS) : 0;
  return memoryTimelineCarouselIntervalMs(memory.note, options) + photoBonus;
}

export function layoutMemoryTimelineItems(
  items: readonly MemoryTimelineLayoutInput[],
  {
    baseItemHeight = MEMORY_TIMELINE_ITEM_HEIGHT,
    cardPaddingX = 12,
    cardPaddingY = 12,
    footerHeight = 24,
    gap = 16,
    noteFont = `14px ${DEFAULT_FONT_FAMILY}`,
    noteLineHeight = 22,
    photoGap = 8,
    photoHeight = 128,
    width,
  }: MemoryTimelineLayoutOptions,
  measureTextHeight: MeasureMemoryTextHeight = measureMemoryTextHeight,
): MemoryTimelineLayout {
  const textWidth = Math.max(1, width - cardPaddingX * 2);
  let y = 0;
  const layoutItems = items.map((item) => {
    const noteHeight = measureTextHeight(item.note, textWidth, noteFont, noteLineHeight);
    const imageHeight = item.hasPhoto ? photoHeight + photoGap : 0;
    const height = Math.max(
      baseItemHeight,
      Math.ceil(cardPaddingY * 2 + imageHeight + noteHeight + footerHeight),
    );
    const layoutItem = { height, id: item.id, y };
    y += height + gap;
    return layoutItem;
  });

  return {
    containerHeight:
      layoutItems.length > 0
        ? layoutItems[layoutItems.length - 1].y + layoutItems[layoutItems.length - 1].height
        : 0,
    items: layoutItems,
  };
}

export function memoryTimelineIndexFromLayoutOffset(
  offsetPx: number,
  items: readonly MemoryTimelineLayoutItem[],
): number {
  if (items.length === 0) return 0;
  const offset = Math.max(0, offsetPx);
  let closestIndex = 0;
  let closestDistance = Math.abs(offset - items[0].y);
  for (let index = 1; index < items.length; index += 1) {
    const distance = Math.abs(offset - items[index].y);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  }
  return closestIndex;
}

export function memoryTimelineOffsetForLayoutIndex(
  index: number,
  items: readonly MemoryTimelineLayoutItem[],
): number {
  if (items.length === 0) return 0;
  return items[Math.min(items.length - 1, Math.max(0, index))].y;
}
