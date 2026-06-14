import {
  type CSSProperties,
  forwardRef,
  type HTMLAttributes,
  type KeyboardEvent,
  type PointerEvent,
  type Ref,
  useEffect,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";

type SliderNumber = number | `${number}`;

export interface SliderProps extends Omit<HTMLAttributes<HTMLDivElement>, "onChange"> {
  value: number;
  onValueChange?: (value: number) => void;
  onValueCommit?: (value: number) => void;
  min?: SliderNumber;
  max?: SliderNumber;
  step?: SliderNumber;
  disabled?: boolean;
}

export interface SliderChromeProps extends HTMLAttributes<HTMLDivElement> {
  percent: number;
  dragging?: boolean;
  laneRef?: Ref<HTMLDivElement>;
}

export const SliderChrome = forwardRef<HTMLDivElement, SliderChromeProps>(function SliderChrome(
  { children, className, dragging = false, laneRef, percent, style, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      style={{ ...style, ...sliderPercentStyle(percent) }}
      className={cn(
        "group relative h-5 touch-none select-none rounded-full outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
        className,
      )}
      {...props}
    >
      <div
        ref={laneRef}
        className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-foreground/12 shadow-inner dark:bg-white/14"
      >
        <div className="absolute inset-y-0 left-0 rounded-full bg-primary/55 [width:var(--slider-pct)]" />
        <div
          data-dragging={dragging}
          className="absolute top-1/2 left-[var(--slider-pct)] h-3 w-6 rounded-full bg-primary shadow-sm ring-2 ring-card transition-[width,height,box-shadow] duration-150 ease-out [transform:translate(calc(var(--slider-ratio)*-100%),-50%)] group-hover:h-3.5 group-hover:w-8 data-[dragging=true]:h-3.5 data-[dragging=true]:w-8"
        />
      </div>
      {children}
    </div>
  );
});

export function Slider({
  className,
  disabled = false,
  max = 100,
  min = 0,
  onKeyDown,
  onPointerCancel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onValueCommit,
  onValueChange,
  step = 1,
  value,
  ...props
}: SliderProps) {
  const laneRef = useRef<HTMLDivElement | null>(null);
  const latestValueRef = useRef(value);
  const [dragging, setDragging] = useState(false);
  const minValue = toNumber(min, 0);
  const maxValue = toNumber(max, 100);
  const stepValue = toNumber(step, 1);
  const percent = valueToPercent(value, minValue, maxValue);

  function updateFromClientX(clientX: number) {
    const el = laneRef.current;
    if (!el || disabled) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width)));
    const next = snapValue(minValue + ratio * (maxValue - minValue), minValue, maxValue, stepValue);
    latestValueRef.current = next;
    onValueChange?.(next);
  }

  function handlePointerDown(e: PointerEvent<HTMLDivElement>) {
    onPointerDown?.(e);
    if (e.defaultPrevented || disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    updateFromClientX(e.clientX);
  }

  function handlePointerMove(e: PointerEvent<HTMLDivElement>) {
    onPointerMove?.(e);
    if (e.defaultPrevented || disabled) return;
    if (e.buttons & 1) updateFromClientX(e.clientX);
  }

  function handlePointerUp(e: PointerEvent<HTMLDivElement>) {
    onPointerUp?.(e);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setDragging(false);
    if (!disabled) onValueCommit?.(latestValueRef.current);
  }

  function handlePointerCancel(e: PointerEvent<HTMLDivElement>) {
    onPointerCancel?.(e);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setDragging(false);
    if (!disabled) onValueCommit?.(latestValueRef.current);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    onKeyDown?.(e);
    if (e.defaultPrevented || disabled) return;
    const delta = stepValue > 0 ? stepValue : 1;
    let next: number | null = null;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      next = value - delta;
    } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      next = value + delta;
    } else if (e.key === "Home") {
      next = minValue;
    } else if (e.key === "End") {
      next = maxValue;
    }
    if (next !== null) {
      e.preventDefault();
      const snapped = snapValue(next, minValue, maxValue, stepValue);
      latestValueRef.current = snapped;
      onValueChange?.(snapped);
      onValueCommit?.(snapped);
    }
  }

  useEffect(() => {
    latestValueRef.current = value;
  }, [value]);

  return (
    <SliderChrome
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || undefined}
      aria-valuemin={minValue}
      aria-valuemax={maxValue}
      aria-valuenow={value}
      className={cn(disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer", className)}
      dragging={dragging}
      laneRef={laneRef}
      percent={percent}
      onKeyDown={handleKeyDown}
      onPointerCancel={handlePointerCancel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      {...props}
    />
  );
}

export function sliderPercentStyle(percent: number): CSSProperties {
  const pct = Math.min(100, Math.max(0, percent));
  const ratio = pct / 100;
  return {
    "--slider-pct": `${pct}%`,
    "--slider-ratio": String(ratio),
    "--slider-thumb-center-offset": `${(0.5 - ratio) * 32}px`,
  } as CSSProperties;
}

export function setSliderPercent(el: HTMLElement | null, percent: number) {
  if (!el) return;
  const pct = Math.min(100, Math.max(0, percent));
  const ratio = pct / 100;
  el.style.setProperty("--slider-pct", `${pct}%`);
  el.style.setProperty("--slider-ratio", String(ratio));
  el.style.setProperty("--slider-thumb-center-offset", `${(0.5 - ratio) * 32}px`);
}

function valueToPercent(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  return ((Math.min(max, Math.max(min, value)) - min) / (max - min)) * 100;
}

function snapValue(value: number, min: number, max: number, step: number): number {
  const clamped = Math.min(max, Math.max(min, value));
  if (step <= 0) return clamped;
  const snapped = min + Math.round((clamped - min) / step) * step;
  const decimals = decimalPlaces(step);
  return Number(Math.min(max, Math.max(min, snapped)).toFixed(decimals));
}

function decimalPlaces(value: number): number {
  const s = String(value);
  const dot = s.indexOf(".");
  return dot === -1 ? 0 : s.length - dot - 1;
}

function toNumber(value: SliderNumber, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
