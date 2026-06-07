import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { SliderChrome, setSliderPercent } from "@/components/ui/slider";
import { formatDuration } from "@/lib/utils";
import { progressPercent } from "@/player/transport";
import { getMediaEngine, usePlayerStore } from "@/stores/player-store";

/**
 * Row 2 of the player-dock: the full-width seek bar + elapsed/total time. Kept as
 * its own leaf subscribing only to position/duration so the ~per-tick
 * `positionSec` updates never re-render the identity row or the nav (hard rule #6).
 */
export function ProgressScrubber() {
  const { t } = useTranslation();
  const positionSec = usePlayerStore((s) => s.positionSec);
  const durationSec = usePlayerStore((s) => s.durationSec);
  const seek = usePlayerStore((s) => s.seek);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const laneRef = useRef<HTMLDivElement | null>(null);
  const positionRef = useRef(positionSec);
  const durationRef = useRef(durationSec);
  const dragPositionRef = useRef(positionSec);
  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    durationRef.current = durationSec;
    if (!draggingRef.current) positionRef.current = positionSec;
  }, [positionSec, durationSec]);

  useEffect(() => {
    paintProgress(trackRef.current, positionRef.current, durationRef.current);

    let raf = 0;
    const sync = () => {
      const engine = getMediaEngine();
      const livePosition = engine?.getCurrentTime();
      const liveDuration = engine?.getDuration();

      if (typeof liveDuration === "number" && Number.isFinite(liveDuration) && liveDuration > 0) {
        durationRef.current = liveDuration;
      }
      if (!draggingRef.current) {
        positionRef.current =
          typeof livePosition === "number" && Number.isFinite(livePosition)
            ? livePosition
            : positionRef.current;
      }

      paintProgress(
        trackRef.current,
        draggingRef.current ? dragPositionRef.current : positionRef.current,
        durationRef.current,
      );
      raf = requestAnimationFrame(sync);
    };
    raf = requestAnimationFrame(sync);
    return () => cancelAnimationFrame(raf);
  }, []);

  const pct = progressPercent(positionSec, durationSec);

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
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      next = Math.max(0, position - 5);
    } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
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
        aria-valuemax={Math.max(0, Math.round(durationSec))}
        aria-valuenow={Math.max(0, Math.round(positionSec))}
        aria-valuetext={`${formatDuration(positionSec)} / ${formatDuration(durationSec)}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        percent={pct}
        dragging={dragging}
        laneRef={laneRef}
        className="cursor-pointer"
      />
    </div>
  );
}

function paintProgress(el: HTMLElement | null, positionSec: number, durationSec: number) {
  setSliderPercent(el, progressPercent(positionSec, durationSec));
}
