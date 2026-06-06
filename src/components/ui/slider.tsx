import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Range slider used for the seek bar and volume. A native range input keeps this
 * dependency-free and touch-friendly; swap for `@coss/slider` if you want the
 * Base UI thumb interactions.
 */
export interface SliderProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> {
  value: number;
  onValueChange?: (value: number) => void;
}

export function Slider({
  className,
  value,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  ...props
}: SliderProps) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onValueChange?.(Number(e.target.value))}
      className={cn(
        "h-1.5 w-full cursor-pointer appearance-none rounded-full bg-secondary accent-primary",
        className,
      )}
      {...props}
    />
  );
}
