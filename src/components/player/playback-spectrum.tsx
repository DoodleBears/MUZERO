import {
  type KeyboardEvent,
  memo,
  type PointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { useSettledValue } from "@/hooks/use-settled-value";
import { cn, formatDuration } from "@/lib/utils";
import { type Rgb, readPrimaryRgb, rgba } from "@/lib/visualizer-color";
import { progressPercent } from "@/player/transport";
import { getMediaEngine, usePlayerStore } from "@/stores/player-store";

const PEAK_COUNT = 1440;
const WAVEFORM_VIEWPORT_SCALE = 1;
const BAR_GAP = 1.25;
const BAR_WIDTH = 3;
/**
 * How long the current track id must hold steady before the spectrum resumes
 * animating. During a switch (and a rapid next/prev burst) there is no audible
 * music yet, so the waveform fades out and its rAF loop fully stops (PRD Phase
 * 28 / P1) — product chose "pause + fade" over running a throttled animation.
 */
const SPECTRUM_SWITCH_SETTLE_MS = 420;

/**
 * Whether the spectrum should run its rAF loop. An active seek drag always
 * animates (the user is scrubbing); otherwise it animates only while playing AND
 * not mid-switch. When this is false the loop is not scheduled at all (rAF = 0).
 */
export function shouldAnimateSpectrum({
  isPlaying,
  dragging,
  switching,
}: {
  isPlaying: boolean;
  dragging: boolean;
  switching: boolean;
}): boolean {
  if (dragging) return true;
  return isPlaying && !switching;
}

type DragState = {
  startX: number;
  startSec: number;
  waveformWidth: number;
};

/**
 * Full-song spectrum scrubber for the Now Playing transport zone. The center
 * playhead stays fixed (under the play button); the decoded overview waveform
 * slides beneath it as playback advances. Click/drag the waveform area to seek.
 *
 * Keep this path light in macOS WKWebView: do not read the persisted media Blob
 * or call decodeAudioData() during Now Playing mount. The seeded overview is
 * refined from the live analyser while playback runs.
 */
export const PlaybackSpectrum = memo(function PlaybackSpectrum({
  className,
}: {
  className?: string;
}) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const positionSec = usePlayerStore((s) => s.positionSec);
  const durationSec = usePlayerStore((s) => s.durationSec);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const seek = usePlayerStore((s) => s.seek);
  const current = usePlayerStore(
    useShallow((s) => {
      const track = s.currentIndex >= 0 ? s.queue[s.currentIndex] : undefined;
      return track ? { id: track.id } : null;
    }),
  );
  const seededPeaks = useMemo(
    () => fallbackPeaks(PEAK_COUNT, current?.id ?? "muzero"),
    [current?.id],
  );
  const peaksRef = useRef(seededPeaks);
  const positionRef = useRef(positionSec);
  const durationRef = useRef(durationSec);
  const renderFrameRef = useRef<(() => void) | null>(null);
  const [dragging, setDragging] = useState(false);
  // A switch (and any rapid next/prev burst) holds the spectrum idle until the
  // track id has been steady for SPECTRUM_SWITCH_SETTLE_MS — see the constant.
  const settledTrackId = useSettledValue(current?.id ?? null, SPECTRUM_SWITCH_SETTLE_MS);
  const switching = (current?.id ?? null) !== settledTrackId;
  const animating = shouldAnimateSpectrum({ isPlaying, dragging, switching });

  positionRef.current = positionSec;
  durationRef.current = durationSec;

  useEffect(() => {
    peaksRef.current = [...seededPeaks];
  }, [seededPeaks]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let raf = 0;
    let frame = 0;
    let primary = readPrimaryRgb();
    const renderFrame = () => {
      if (frame++ % 30 === 0) primary = readPrimaryRgb();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const bw = Math.round(w * dpr);
      const bh = Math.round(h * dpr);
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const engine = getMediaEngine();
      const livePosition = engine?.getCurrentTime();
      const liveDuration = engine?.getDuration();
      const renderPosition =
        typeof livePosition === "number" && Number.isFinite(livePosition)
          ? livePosition
          : positionRef.current;
      const renderDuration =
        typeof liveDuration === "number" && Number.isFinite(liveDuration) && liveDuration > 0
          ? liveDuration
          : durationRef.current;

      drawCenteredWaveform({
        ctx,
        width: w,
        height: h,
        peaks: peaksRef.current,
        progress: progressPercent(renderPosition, renderDuration) / 100,
        primary,
      });
    };
    renderFrameRef.current = renderFrame;

    const loop = () => {
      renderFrame();
      raf = requestAnimationFrame(loop);
    };

    // While switching, leave the canvas on its last (fading-out) frame and run
    // no rAF at all (PRD Phase 28): paint + loop only when actually animating.
    if (animating) {
      renderFrame();
      raf = requestAnimationFrame(loop);
    }
    return () => {
      cancelAnimationFrame(raf);
      if (renderFrameRef.current === renderFrame) renderFrameRef.current = null;
    };
  }, [animating]);

  // When idle but settled (paused at rest), paint a single static frame so the
  // waveform stays visible. Skipped while switching — the canvas is fading out.
  useEffect(() => {
    if (animating || switching) return;
    const raf = requestAnimationFrame(() => renderFrameRef.current?.());
    return () => cancelAnimationFrame(raf);
  });

  function waveformWidth(): number {
    const el = canvasRef.current;
    return (el?.clientWidth ?? 0) * WAVEFORM_VIEWPORT_SCALE;
  }

  function seekByDelta(clientX: number) {
    const drag = dragRef.current;
    if (!drag || durationRef.current <= 0) return;
    const secondsPerPx = durationRef.current / Math.max(1, drag.waveformWidth);
    // Drag the track, not the playhead: moving the waveform left advances time.
    const next = drag.startSec - (clientX - drag.startX) * secondsPerPx;
    seek(Math.min(durationRef.current, Math.max(0, next)));
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    const livePosition = getMediaEngine()?.getCurrentTime();
    dragRef.current = {
      startX: e.clientX,
      startSec:
        typeof livePosition === "number" && Number.isFinite(livePosition)
          ? livePosition
          : positionRef.current,
      waveformWidth: waveformWidth(),
    };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (e.buttons & 1) seekByDelta(e.clientX);
  }

  function onPointerUp() {
    dragRef.current = null;
    setDragging(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (durationSec <= 0) return;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      seek(Math.max(0, positionSec - 5));
    } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      seek(Math.min(durationSec, positionSec + 5));
    } else if (e.key === "Home") {
      e.preventDefault();
      seek(0);
    } else if (e.key === "End") {
      e.preventDefault();
      seek(durationSec);
    }
  }

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={t("player.seek")}
      aria-valuemin={0}
      aria-valuemax={Math.max(0, Math.round(durationSec))}
      aria-valuenow={Math.max(0, Math.round(positionSec))}
      aria-valuetext={`${formatDuration(positionSec)} / ${formatDuration(durationSec)}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      className={cn(
        "relative h-32 cursor-grab touch-none select-none overflow-hidden rounded-3xl outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-ring sm:h-40",
        className,
      )}
    >
      <canvas
        ref={canvasRef}
        className={cn(
          "absolute inset-0 z-0 h-full w-full transition-opacity duration-300 mask-[linear-gradient(90deg,transparent,black_8%,black_92%,transparent)]",
          switching ? "opacity-0" : "opacity-100",
        )}
      />
      <div className="pointer-events-none absolute inset-y-[18%] left-1/2 z-10 w-0.5 -translate-x-1/2 rounded-full bg-primary/90 shadow-[0_0_18px_color-mix(in_srgb,var(--primary)_70%,transparent)]" />
      <div className="pointer-events-none absolute inset-x-4 bottom-2 z-20 flex items-center justify-between text-[11px] font-semibold tabular-nums">
        <span className="rounded-full bg-background/85 px-2 py-1 text-foreground">
          {formatDuration(positionSec)}
        </span>
        <span className="rounded-full bg-background/85 px-2 py-1 text-foreground">
          {formatDuration(durationSec)}
        </span>
      </div>
    </div>
  );
});

function fallbackPeaks(count: number, seed: string): number[] {
  let hash = 2166136261;
  let last = 0.28;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Array.from({ length: count }, () => {
    hash ^= hash << 13;
    hash ^= hash >>> 17;
    hash ^= hash << 5;
    const noise = ((hash >>> 0) % 1000) / 1000;
    const target = 0.08 + noise * 0.72;
    last = last * 0.72 + target * 0.28;
    return Math.max(0.04, Math.min(1, last));
  });
}

function drawCenteredWaveform({
  ctx,
  width,
  height,
  peaks,
  progress,
  primary,
}: {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  peaks: number[];
  progress: number;
  primary: Rgb;
}) {
  const waveformWidth = width * WAVEFORM_VIEWPORT_SCALE;
  const centerX = width / 2;
  const gap = BAR_GAP;
  const barW = BAR_WIDTH;
  const centerY = height * 0.52;
  const maxBarH = height * 0.56;
  const step = barW + gap;
  const barCount = Math.max(24, Math.floor(width / step));
  const playedColor = rgba(primary, 0.95);
  const upcomingColor = rgba(primary, 0.34);

  for (let i = 0; i < barCount; i++) {
    const t = barCount === 1 ? 0 : i / (barCount - 1);
    const x = centerX + (t - progress) * waveformWidth - barW / 2;
    if (x + barW < 0 || x > width) continue;

    const level = Math.max(0.04, samplePeaks(peaks, t, barCount));
    const barH = Math.max(4, level * maxBarH);
    const y = centerY - barH / 2;
    const played = t <= progress;
    ctx.fillStyle = played ? playedColor : upcomingColor;
    roundRect(ctx, x, y, barW, barH, Math.min(barW / 2, 8));
    ctx.fill();
  }
}

function samplePeaks(peaks: number[], t: number, barCount: number): number {
  if (peaks.length === 0) return 0.1;
  const center = t * (peaks.length - 1);
  const radius = Math.max(1, Math.floor(peaks.length / Math.max(1, barCount * 2)));
  const start = Math.max(0, Math.floor(center - radius));
  const end = Math.min(peaks.length - 1, Math.ceil(center + radius));
  let peak = 0;
  for (let i = start; i <= end; i++) {
    peak = Math.max(peak, peaks[i] ?? 0);
  }
  return peak;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}
