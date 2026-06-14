import { create } from "zustand";
import { createDiagnosticLogger } from "@/lib/logger";
import { type Rgb, rgba } from "@/lib/visualizer-color";

const TRANSITION_MS = 900;
const DISABLE_COVER_COLOR_CSS_FOR_BISECT = true;
const DISABLE_COVER_COLOR_RAF_FOR_BISECT = true;
const DISABLE_COVER_COLOR_PALETTE_FOR_BISECT = true;
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

let raf = 0;

export function transitionVisualizerCoverColor(
  coverBlobId: string | null,
  next: Rgb | null,
  nextPalette: Rgb[] = [],
) {
  const current = useVisualizerCoverColorStore.getState();
  if (
    current.coverBlobId === coverBlobId &&
    sameRgb(current.rgb, next) &&
    samePalette(current.palette, nextPalette)
  ) {
    return;
  }

  if (raf) {
    cancelAnimationFrame(raf);
    raf = 0;
  }

  if (DISABLE_COVER_COLOR_CSS_FOR_BISECT) {
    coverColorLog.debug("cover.palette.css", {
      message: "cover palette css output skipped for diagnostic bisect",
      category: "media",
      phase: "skip",
      reason: "diag-bisect",
      targetKey: coverBlobId ?? undefined,
      paletteCount: nextPalette.length,
      fallbackToTheme: !next,
    });
  }
  if (DISABLE_COVER_COLOR_PALETTE_FOR_BISECT) {
    coverColorLog.debug("cover.palette.palette", {
      message: "cover palette store output skipped for diagnostic bisect",
      category: "media",
      phase: "skip",
      reason: "diag-bisect",
      targetKey: coverBlobId ?? undefined,
      paletteCount: nextPalette.length,
    });
  }

  if (!coverBlobId || !next) {
    useVisualizerCoverColorStore.setState({
      coverBlobId,
      rgb: null,
      css: DISABLE_COVER_COLOR_CSS_FOR_BISECT ? current.css : null,
      palette: coverColorPaletteValue([], current.palette),
    });
    return;
  }

  const from = current.rgb ?? next;
  const fromPalette = current.palette;
  if (sameRgb(from, next) && samePalette(fromPalette, nextPalette)) {
    useVisualizerCoverColorStore.setState({
      coverBlobId,
      rgb: next,
      css: coverColorCssValue(next, current.css),
      palette: coverColorPaletteValue(nextPalette, current.palette),
    });
    return;
  }

  if (DISABLE_COVER_COLOR_RAF_FOR_BISECT) {
    coverColorLog.debug("cover.palette.transition", {
      message: "cover palette raf transition skipped for diagnostic bisect",
      category: "media",
      phase: "skip",
      reason: "diag-bisect",
      targetKey: coverBlobId,
      paletteCount: nextPalette.length,
    });
    useVisualizerCoverColorStore.setState({
      coverBlobId,
      rgb: next,
      css: coverColorCssValue(next, current.css),
      palette: coverColorPaletteValue(nextPalette, current.palette),
    });
    return;
  }

  const started = performance.now();
  const tick = (now: number) => {
    const t = Math.min(1, (now - started) / TRANSITION_MS);
    const eased = easeInOutCubic(t);
    const rgb = mixRgb(from, next, eased);
    useVisualizerCoverColorStore.setState({
      coverBlobId,
      rgb,
      css: coverColorCssValue(rgb, current.css),
      palette: coverColorPaletteValue(mixPalette(fromPalette, nextPalette, eased), current.palette),
    });
    if (t < 1) raf = requestAnimationFrame(tick);
    else raf = 0;
  };
  raf = requestAnimationFrame(tick);
}

function coverColorCssValue(rgb: Rgb, currentCss: string | null): string | null {
  return DISABLE_COVER_COLOR_CSS_FOR_BISECT ? currentCss : rgba(rgb, 1);
}

function coverColorPaletteValue(nextPalette: Rgb[], currentPalette: Rgb[]): Rgb[] {
  return DISABLE_COVER_COLOR_PALETTE_FOR_BISECT ? currentPalette : nextPalette;
}

function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  };
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

function sameRgb(a: Rgb | null, b: Rgb | null): boolean {
  return a === b || (!!a && !!b && a.r === b.r && a.g === b.g && a.b === b.b);
}

function samePalette(a: Rgb[], b: Rgb[]): boolean {
  return a.length === b.length && a.every((c, i) => sameRgb(c, b[i] ?? null));
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}
