import { create } from "zustand";
import { type Rgb, rgba } from "@/lib/visualizer-color";

const TRANSITION_MS = 900;

interface VisualizerCoverColorState {
  coverBlobId: string | null;
  rgb: Rgb | null;
  css: string | null;
}

export const useVisualizerCoverColorStore = create<VisualizerCoverColorState>(() => ({
  coverBlobId: null,
  rgb: null,
  css: null,
}));

export const getVisualizerCoverColorRgb = () => useVisualizerCoverColorStore.getState().rgb;

let raf = 0;

export function transitionVisualizerCoverColor(coverBlobId: string | null, next: Rgb | null) {
  const current = useVisualizerCoverColorStore.getState();
  if (current.coverBlobId === coverBlobId && sameRgb(current.rgb, next)) return;

  if (raf) {
    cancelAnimationFrame(raf);
    raf = 0;
  }

  if (!coverBlobId || !next) {
    useVisualizerCoverColorStore.setState({ coverBlobId, rgb: null, css: null });
    return;
  }

  const from = current.rgb ?? next;
  if (sameRgb(from, next)) {
    useVisualizerCoverColorStore.setState({ coverBlobId, rgb: next, css: rgba(next, 1) });
    return;
  }

  const started = performance.now();
  const tick = (now: number) => {
    const t = Math.min(1, (now - started) / TRANSITION_MS);
    const eased = easeInOutCubic(t);
    const rgb = mixRgb(from, next, eased);
    useVisualizerCoverColorStore.setState({ coverBlobId, rgb, css: rgba(rgb, 1) });
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

function sameRgb(a: Rgb | null, b: Rgb | null): boolean {
  return a === b || (!!a && !!b && a.r === b.r && a.g === b.g && a.b === b.b);
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}
