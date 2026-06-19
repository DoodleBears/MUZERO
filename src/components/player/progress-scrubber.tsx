import { type KeyboardEvent, memo, type PointerEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { SliderChrome, setSliderPercent } from "@/components/ui/slider";
import { formatDuration } from "@/lib/utils";
import { progressPercent } from "@/player/transport";
import { getMediaEngine, usePlayerStore } from "@/stores/player-store";

/**
 * Row 2 of the player-dock: the full-width seek bar + elapsed/total time. Kept as
 * its own leaf subscribing only to position/duration so the ~per-tick
 * `positionSec` updates never re-render the identity row or the nav (hard rule #6).
 */
export const ProgressScrubber = memo(function ProgressScrubber() {
  const { t } = useTranslation();
  const playback = usePlayerStore(
    useShallow((s) => ({
      durationSec: s.durationSec,
      isPlaying: s.isPlaying,
      trackId: s.currentIndex >= 0 ? s.queue[s.currentIndex]?.id : undefined,
    })),
  );
  const seek = usePlayerStore((s) => s.seek);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const laneRef = useRef<HTMLDivElement | null>(null);
  const dragTimeRef = useRef<HTMLSpanElement | null>(null);
  const durationTimeRef = useRef<HTMLSpanElement | null>(null);
  const renderSnapshot = usePlayerStore.getState();
  const renderPositionSec = renderSnapshot.positionSec;
  const renderDurationSec = playback.durationSec || renderSnapshot.durationSec;
  const positionRef = useRef(renderPositionSec);
  const durationRef = useRef(renderDurationSec);
  const isPlayingRef = useRef(playback.isPlaying);
  const dragPositionRef = useRef(renderPositionSec);
  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [hovering, setHovering] = useState(false);
  const showChips = dragging || hovering;

  // biome-ignore lint/correctness/useExhaustiveDependencies: track/duration changes should repaint from the latest store snapshot without subscribing React to position ticks.
  useEffect(() => {
    const state = usePlayerStore.getState();
    durationRef.current = state.durationSec;
    if (!draggingRef.current) positionRef.current = state.positionSec;
    paintScrubber(
      trackRef.current,
      dragTimeRef.current,
      durationTimeRef.current,
      positionRef.current,
      durationRef.current,
    );
  }, [playback.durationSec, playback.trackId]);

  useEffect(() => {
    isPlayingRef.current = playback.isPlaying;
  }, [playback.isPlaying]);

  useEffect(() => {
    let prevPosition = usePlayerStore.getState().positionSec;
    let prevDuration = usePlayerStore.getState().durationSec;

    return usePlayerStore.subscribe((state) => {
      if (state.positionSec === prevPosition && state.durationSec === prevDuration) return;
      prevPosition = state.positionSec;
      prevDuration = state.durationSec;
      durationRef.current = state.durationSec;
      if (!draggingRef.current) positionRef.current = state.positionSec;
      if (!isPlayingRef.current || draggingRef.current) {
        const renderPosition = draggingRef.current ? dragPositionRef.current : positionRef.current;
        paintScrubber(
          trackRef.current,
          dragTimeRef.current,
          durationTimeRef.current,
          renderPosition,
          durationRef.current,
        );
      }
    });
  }, []);

  useEffect(() => {
    let raf = 0;
    const sync = () => {
      const engine = getMediaEngine();
      const livePosition = engine?.getCurrentTime();
      const liveDuration = engine?.getDuration();

      if (typeof liveDuration === "number" && Number.isFinite(liveDuration) && liveDuration > 0) {
        durationRef.current = liveDuration;
      }
      if (!draggingRef.current && isPlayingRef.current) {
        positionRef.current =
          typeof livePosition === "number" && Number.isFinite(livePosition)
            ? livePosition
            : positionRef.current;
      }

      const renderPosition = draggingRef.current ? dragPositionRef.current : positionRef.current;
      paintProgress(trackRef.current, renderPosition, durationRef.current);
      paintTimeChips(
        dragTimeRef.current,
        durationTimeRef.current,
        renderPosition,
        durationRef.current,
      );
      raf = requestAnimationFrame(sync);
    };

    const renderPosition = draggingRef.current ? dragPositionRef.current : positionRef.current;
    paintProgress(trackRef.current, renderPosition, durationRef.current);
    paintTimeChips(
      dragTimeRef.current,
      durationTimeRef.current,
      renderPosition,
      durationRef.current,
    );

    if (playback.isPlaying || dragging) raf = requestAnimationFrame(sync);
    return () => cancelAnimationFrame(raf);
  }, [playback.isPlaying, dragging]);

  const pct = progressPercent(renderPositionSec, renderDurationSec);

  function seekFromClientX(clientX: number) {
    const el = laneRef.current;
    const duration = durationRef.current;
    if (!el || duration <= 0) return;
    const rect = el.getBoundingClientRect();
    const nextPct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const next = nextPct * duration;
    dragPositionRef.current = next;
    positionRef.current = next;
    paintProgress(trackRef.current, next, duration);
    paintTimeChips(dragTimeRef.current, durationTimeRef.current, next, duration);
    seek(next);
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    setDragging(true);
    seekFromClientX(e.clientX);
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (e.buttons & 1) seekFromClientX(e.clientX);
  }

  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    draggingRef.current = false;
    setDragging(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const duration = durationRef.current;
    const position = positionRef.current;
    if (duration <= 0) return;
    let next: number | null = null;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      next = Math.max(0, position - 5);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      next = Math.min(duration, position + 5);
    } else if (e.key === "Home") {
      e.preventDefault();
      next = 0;
    } else if (e.key === "End") {
      e.preventDefault();
      next = duration;
    }
    if (next !== null) {
      positionRef.current = next;
      paintProgress(trackRef.current, next, duration);
      paintTimeChips(dragTimeRef.current, durationTimeRef.current, next, duration);
      seek(next);
    }
  }

  return (
    <div className="px-1 py-1">
      <SliderChrome
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label={t("player.seek")}
        aria-valuemin={0}
        aria-valuemax={Math.max(0, Math.round(renderDurationSec))}
        aria-valuenow={Math.max(0, Math.round(renderPositionSec))}
        aria-valuetext={`${formatDuration(renderPositionSec)} / ${formatDuration(renderDurationSec)}`}
        onPointerDown={onPointerDown}
        onPointerEnter={() => setHovering(true)}
        onPointerLeave={() => setHovering(false)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        percent={pct}
        dragging={dragging}
        laneRef={laneRef}
        className="cursor-pointer"
      >
        <span
          ref={dragTimeRef}
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-[calc(var(--slider-pct)+var(--slider-thumb-center-offset))] z-10 rounded-full bg-foreground px-2 py-0.5 text-[11px] font-medium tabular-nums text-background opacity-0 shadow-md transition-opacity duration-150 data-[visible=true]:opacity-100"
          data-dragging={dragging}
          data-visible={showChips}
          style={{
            transform: "translate(-50%, calc(-100% - 0.65rem))",
          }}
        >
          {formatDuration(renderPositionSec)}
        </span>
        <span
          ref={durationTimeRef}
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-0 z-10 rounded-full bg-card/95 px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground opacity-0 shadow-sm ring-1 ring-border/70 backdrop-blur transition-opacity duration-150 data-[visible=true]:opacity-100"
          data-dragging={dragging}
          data-visible={showChips}
          style={{ transform: "translateY(calc(-100% - 0.65rem))" }}
        >
          {formatDuration(renderDurationSec)}
        </span>
      </SliderChrome>
    </div>
  );
});

function paintScrubber(
  trackEl: HTMLElement | null,
  dragEl: HTMLElement | null,
  durationEl: HTMLElement | null,
  positionSec: number,
  durationSec: number,
) {
  paintProgress(trackEl, positionSec, durationSec);
  paintTimeChips(dragEl, durationEl, positionSec, durationSec);
  paintSliderAccessibility(trackEl, positionSec, durationSec);
}

function paintProgress(el: HTMLElement | null, positionSec: number, durationSec: number) {
  setSliderPercent(el, progressPercent(positionSec, durationSec));
}

function paintTimeChips(
  dragEl: HTMLElement | null,
  durationEl: HTMLElement | null,
  positionSec: number,
  durationSec: number,
) {
  if (dragEl) dragEl.textContent = formatDuration(positionSec);
  if (durationEl) durationEl.textContent = formatDuration(durationSec);
}

function paintSliderAccessibility(
  el: HTMLElement | null,
  positionSec: number,
  durationSec: number,
) {
  if (!el) return;
  el.setAttribute("aria-valuemax", String(Math.max(0, Math.round(durationSec))));
  el.setAttribute("aria-valuenow", String(Math.max(0, Math.round(positionSec))));
  el.setAttribute(
    "aria-valuetext",
    `${formatDuration(positionSec)} / ${formatDuration(durationSec)}`,
  );
}
