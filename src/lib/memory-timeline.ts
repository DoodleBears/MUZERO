export const MEMORY_TIMELINE_IDLE_DELAY_MS = 4000;
export const MEMORY_TIMELINE_CAROUSEL_INTERVAL_MS = 5000;
export const MEMORY_TIMELINE_CAROUSEL_MAX_INTERVAL_MS = 14000;
export const MEMORY_TIMELINE_ITEM_HEIGHT = 112;

const MEMORY_TIMELINE_CAROUSEL_EXTRA_START_CHAR_COUNT = 48;
const MEMORY_TIMELINE_CAROUSEL_MS_PER_CHARACTER = 80;

interface MemoryTimelineCarouselIntervalOptions {
  baseMs?: number;
  extraStartCharCount?: number;
  maxMs?: number;
  msPerCharacter?: number;
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
