"use client";

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import type * as React from "react";
import { cn } from "@/lib/utils";

/** shadcn-style Tooltip wrappers over Base UI (COSS UI's primitive layer). */
export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({
  className,
  sideOffset = 10,
  side = "top",
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Popup> & {
  sideOffset?: number;
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <TooltipPrimitive.Portal>
      {/*
        z-index lives on the Positioner, not just the Popup: the Positioner is the
        element that competes in the body stacking context against positioned app
        chrome (e.g. the player dock is `relative z-20`). A z-index only on the
        Popup is scoped inside the Positioner's own context and can't lift it out,
        so the dock would paint over the tooltip.
      */}
      <TooltipPrimitive.Positioner className="z-50" sideOffset={sideOffset} side={side}>
        <TooltipPrimitive.Popup
          className={cn(
            "rounded-md border border-border bg-popover px-2.5 py-1 text-xs font-medium text-popover-foreground shadow-md",
            className,
          )}
          {...props}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}
