import { create } from "zustand";
import { type Rgb, rgba } from "@/lib/visualizer-color";

const TRANSITION_MS = 900;

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

  if (!coverBlobId || !next) {
    useVisualizerCoverColorStore.setState({ coverBlobId, rgb: null, css: null, palette: [] });
    return;
  }

  const from = current.rgb ?? next;
  const fromPalette = current.palette;
  if (sameRgb(from, next) && samePalette(fromPalette, nextPalette)) {
    useVisualizerCoverColorStore.setState({
      coverBlobId,
      rgb: next,
      css: rgba(next, 1),
      palette: nextPalette,
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
      css: rgba(rgb, 1),
      palette: mixPalette(fromPalette, nextPalette, eased),
    });
    if (t < 1) raf = requestAnimationFrame(tick);
    else raf = 0;
  };
  raf = requestAnimationFrame(tick);
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
