/**
 * Pure geometry helpers for the virtualized card galleries (sets / albums /
 * artists). The wall renders a responsive grid (`grid-cols-2 sm:grid-cols-3
 * lg:grid-cols-4`) or a single-column list; virtualization needs to know the
 * column count to chunk items into rows and to estimate a row's height before
 * it's measured. Kept side-effect-free so it can be exhaustively unit-tested.
 */
export type GalleryGridView = "grid" | "list";

/** Tailwind breakpoints the wall grid responds to (viewport width, px). */
const SM = 640;
const LG = 1024;

/**
 * Cards per row for a given viewport width — mirrors the Tailwind classes
 * `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4`. List view is always one column.
 */
export function galleryColumns(width: number, view: GalleryGridView): number {
  if (view === "list") return 1;
  if (width >= LG) return 4;
  if (width >= SM) return 3;
  return 2;
}

/** Number of virtual rows needed to hold `count` items at `columns` per row. */
export function galleryRowCount(count: number, columns: number): number {
  if (count <= 0 || columns <= 0) return 0;
  return Math.ceil(count / columns);
}

/**
 * Estimated row height (px) used before a row is measured, so the scrollbar and
 * overscan are roughly right on first paint. Grid rows are a square cover plus a
 * two-line caption; list rows are a fixed compact height.
 */
export function galleryRowEstimate(
  view: GalleryGridView,
  opts: {
    contentWidth: number;
    columns: number;
    gap: number;
    captionHeight: number;
    listRowHeight: number;
  },
): number {
  if (view === "list") return opts.listRowHeight;
  const { contentWidth, columns, gap, captionHeight } = opts;
  if (contentWidth <= 0 || columns <= 0) return opts.listRowHeight;
  const cardWidth = (contentWidth - gap * (columns - 1)) / columns;
  // Cover is aspect-square (height ≈ width) + caption + the cell's vertical gap.
  return Math.round(cardWidth + captionHeight + gap);
}
