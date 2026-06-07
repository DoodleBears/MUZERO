"use client";

import {
  ColorPicker as AriaColorPicker,
  Button,
  ColorArea,
  ColorField,
  ColorSlider,
  ColorSwatch,
  ColorSwatchPicker,
  ColorSwatchPickerItem,
  ColorThumb,
  Dialog,
  DialogTrigger,
  Input,
  Popover,
  SliderTrack,
} from "react-aria-components";
import { cn } from "@/lib/utils";

// Shared thumb: a white-ringed dot whose fill react-aria sets to the live color.
const THUMB =
  "box-border size-4 rounded-full border-2 border-white shadow-[0_0_0_1.5px_rgba(0,0,0,0.45)] forced-color-adjust-none";

// A compact, on-brand palette for quick picks (vivid hues that read on both modes).
const DEFAULT_SWATCHES = [
  "#bf83fe",
  "#8b5cf6",
  "#6366f1",
  "#3b82f6",
  "#06b6d4",
  "#10b981",
  "#eab308",
  "#f97316",
  "#ef4444",
  "#ec4899",
];

export interface ColorPickerProps {
  /** Current color as a `#rrggbb` hex. */
  value: string;
  /** Called with a lowercased `#rrggbb` hex whenever the color changes. */
  onChange: (hex: string) => void;
  /** Accessible name for the trigger and popover controls. */
  label: string;
  swatches?: string[];
}

/**
 * A small color picker: a swatch+hex trigger that opens a popover with a
 * saturation/brightness area, a hue slider, a hex field, and preset swatches.
 * Built on react-aria-components (same primitives ClipCombo uses) for full
 * keyboard + a11y support; styled with the app's Tailwind tokens.
 */
export function ColorPicker({
  value,
  onChange,
  label,
  swatches = DEFAULT_SWATCHES,
}: ColorPickerProps) {
  return (
    <AriaColorPicker value={value} onChange={(c) => onChange(c.toString("hex").toLowerCase())}>
      <DialogTrigger>
        <Button
          aria-label={label}
          className={cn(
            "flex h-10 items-center gap-2 rounded-md border border-input bg-transparent px-2.5 text-sm outline-none",
            "hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring data-[pressed]:bg-accent/50",
          )}
        >
          <ColorSwatch className="size-5 rounded border border-border" />
          <span className="font-mono text-xs uppercase text-muted-foreground">{value}</span>
        </Button>
        <Popover
          placement="bottom start"
          className="z-50 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg outline-none"
        >
          <Dialog aria-label={label} className="grid w-56 gap-3 outline-none">
            <ColorArea
              colorSpace="hsb"
              xChannel="saturation"
              yChannel="brightness"
              className="relative h-36 w-full touch-none select-none overflow-hidden rounded-md border border-border"
            >
              <ColorThumb className={THUMB} />
            </ColorArea>
            <ColorSlider colorSpace="hsb" channel="hue" className="grid gap-1">
              <SliderTrack className="relative h-3 touch-none select-none rounded-full border border-border">
                <ColorThumb className={THUMB} />
              </SliderTrack>
            </ColorSlider>
            <ColorField aria-label={label} className="grid gap-1">
              <Input className="h-9 rounded-md border border-input bg-transparent px-2.5 font-mono text-sm uppercase outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </ColorField>
            <ColorSwatchPicker className="grid grid-cols-10 gap-1">
              {swatches.map((c) => (
                <ColorSwatchPickerItem
                  key={c}
                  color={c}
                  className="size-4 rounded outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-ring data-[selected]:ring-2 data-[selected]:ring-ring"
                >
                  <ColorSwatch className="size-full rounded border border-border" />
                </ColorSwatchPickerItem>
              ))}
            </ColorSwatchPicker>
          </Dialog>
        </Popover>
      </DialogTrigger>
    </AriaColorPicker>
  );
}
