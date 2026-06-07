export const MEMORY_TIMELINE_IDLE_DELAY_MS = 4000;
export const MEMORY_TIMELINE_CAROUSEL_INTERVAL_MS = 5000;
export const MEMORY_TIMELINE_ITEM_HEIGHT = 112;

export function sortMemoryTimelineItems<T extends { createdAt: number }>(items: readonly T[]): T[] {
  return items
    .map((item, index) => ({ index, item }))
    .sort((a, b) => a.item.createdAt - b.item.createdAt || a.index - b.index)
    .map(({ item }) => item);
}

export function memoryTimelineIndexFromScroll(
  scrollTop: number,
  itemHeight: number,
  itemCount: number,
): number {
  if (itemCount <= 0 || itemHeight <= 0) return 0;
  const index = Math.round(Math.max(0, scrollTop) / itemHeight);
  return Math.min(itemCount - 1, index);
}

export function nextIdleMemoryIndex(currentIndex: number, itemCount: number): number {
  if (itemCount <= 0) return 0;
  if (currentIndex < 0 || currentIndex >= itemCount - 1) return 0;
  return currentIndex + 1;
}
