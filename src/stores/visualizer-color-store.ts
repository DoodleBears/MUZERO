import { create } from "zustand";
import { createDiagnosticLogger } from "@/lib/logger";
import { type Rgb, rgba } from "@/lib/visualizer-color";

export const COVER_COLOR_APPLY_SETTLE_MS = 650;
const coverColorLog = createDiagnosticLogger("cover.palette");

interface VisualizerCoverColorState {
  coverBlobId: string | null;
  rgb: Rgb | null;
  css: string | null;
  /** Multi-color cover palette for the flow background (empty = no cover palette). */
  palette: Rgb[];
}

export const useVisualizerCoverColorStore = create<VisualizerCoverColorState>(() => ({
  coverBlobId: null,
  rgb: null,
  css: null,
  palette: [],
}));

export const getVisualizerCoverColorRgb = () => useVisualizerCoverColorStore.getState().rgb;
export const getVisualizerCoverPalette = () => useVisualizerCoverColorStore.getState().palette;

let settleTimer: ReturnType<typeof setTimeout> | null = null;
let settleSeq = 0;
let pendingTarget: { coverBlobId: string | null; rgb: Rgb | null; palette: Rgb[] } | null = null;

export function transitionVisualizerCoverColor(
  coverBlobId: string | null,
  next: Rgb | null,
  nextPalette: Rgb[] = [],
) {
  const current = useVisualizerCoverColorStore.getState();
  const palette = nextPalette.map((color) => ({ ...color }));
  if (
    (current.coverBlobId === coverBlobId &&
      sameRgb(current.rgb, next) &&
      samePalette(current.palette, palette)) ||
    (pendingTarget?.coverBlobId === coverBlobId &&
      sameRgb(pendingTarget.rgb, next) &&
      samePalette(pendingTarget.palette, palette))
  ) {
    return;
  }

  if (settleTimer) {
    clearTimeout(settleTimer);
    settleTimer = null;
  }

  const seq = ++settleSeq;
  pendingTarget = { coverBlobId, rgb: next ? { ...next } : null, palette };
  coverColorLog.debug("cover.palette.settle", {
    message: "cover palette color apply scheduled after switch settle",
    category: "media",
    phase: "start",
    targetKey: coverBlobId ?? undefined,
    paletteCount: palette.length,
    fallbackToTheme: !next,
    delayMs: COVER_COLOR_APPLY_SETTLE_MS,
  });
  settleTimer = setTimeout(() => {
    if (settleSeq !== seq || !pendingTarget) return;
    const target = pendingTarget;
    pendingTarget = null;
    settleTimer = null;
    applySettledCoverColor(target.coverBlobId, target.rgb, target.palette);
  }, COVER_COLOR_APPLY_SETTLE_MS);
}

/**
 * Apply a cover color IMMEDIATELY, cancelling any pending settle. Used at a
 * deliberate cover-drag COMMIT: the settled border/flow read this store, which
 * otherwise only adopts the committed track's color after `COVER_COLOR_APPLY_SETTLE_MS`
 * — so when the drag-color override releases at the hand-off it hands back to the
 * STALE (pre-drag) color for up to 650ms (the "松手后 border 闪回起点色再过渡" flash, PRD
 * 20260618-recenter-boundary). Snapping here makes the settled value already match
 * where the drag left it; the regular settle-debounced path still owns auto-advance.
 */
export function snapVisualizerCoverColor(
  coverBlobId: string | null,
  rgb: Rgb | null,
  palette: Rgb[] = [],
) {
  if (settleTimer) {
    clearTimeout(settleTimer);
    settleTimer = null;
  }
  settleSeq += 1; // invalidate any in-flight settle so it can't override this snap
  pendingTarget = null;
  applySettledCoverColor(
    coverBlobId,
    rgb,
    palette.map((color) => ({ ...color })),
  );
}

function applySettledCoverColor(coverBlobId: string | null, rgb: Rgb | null, palette: Rgb[]) {
  const current = useVisualizerCoverColorStore.getState();
  if (
    current.coverBlobId === coverBlobId &&
    sameRgb(current.rgb, rgb) &&
    samePalette(current.palette, palette)
  ) {
    return;
  }

  useVisualizerCoverColorStore.setState(
    rgb
      ? {
          coverBlobId,
          rgb,
          css: rgba(rgb, 1),
          palette,
        }
      : {
          coverBlobId,
          rgb: null,
          css: null,
          palette: [],
        },
  );
  coverColorLog.debug("cover.palette.settle", {
    message: "cover palette color applied after switch settle",
    category: "media",
    phase: "success",
    targetKey: coverBlobId ?? undefined,
    paletteCount: palette.length,
    fallbackToTheme: !rgb,
    delayMs: COVER_COLOR_APPLY_SETTLE_MS,
  });
}

/**
 * Interpolate two palettes color-by-color. The result always matches the target
 * length: when the new palette is longer, the extra colors fade in from the
 * previous palette's last color (so swatches glide in rather than pop).
 */
export function mixPalette(from: Rgb[], to: Rgb[], t: number): Rgb[] {
  if (to.length === 0) return [];
  const out: Rgb[] = [];
  for (let i = 0; i < to.length; i++) {
    const a = from[i] ?? from[from.length - 1] ?? to[i];
    out.push(mixRgb(a, to[i], t));
  }
  return out;
}

function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  };
}

function sameRgb(a: Rgb | null, b: Rgb | null): boolean {
  return a === b || (!!a && !!b && a.r === b.r && a.g === b.g && a.b === b.b);
}

function samePalette(a: Rgb[], b: Rgb[]): boolean {
  return a.length === b.length && a.every((c, i) => sameRgb(c, b[i] ?? null));
}
