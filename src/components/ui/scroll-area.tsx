"use client";

import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
import type * as React from "react";
import { cn } from "@/lib/utils";

export function ScrollArea({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root>) {
  return (
    <ScrollAreaPrimitive.Root
      className={cn("relative overflow-hidden", className)}
      data-slot="scroll-area-root"
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        className="h-full w-full rounded-[inherit]"
        data-slot="scroll-area-viewport"
      >
        <ScrollAreaPrimitive.Content data-slot="scroll-area-content">
          {children}
        </ScrollAreaPrimitive.Content>
      </ScrollAreaPrimitive.Viewport>
      <ScrollAreaScrollbar>
        <ScrollAreaThumb />
      </ScrollAreaScrollbar>
      <ScrollAreaCorner />
    </ScrollAreaPrimitive.Root>
  );
}

export function ScrollAreaScrollbar({
  className,
  keepMounted = true,
  orientation = "vertical",
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Scrollbar>) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      className={cn(
        "flex touch-none select-none bg-transparent p-0.5 transition-colors",
        orientation === "vertical" ? "h-full w-2.5" : "h-2.5 w-full flex-col",
        className,
      )}
      data-slot="scroll-area-scrollbar"
      keepMounted={keepMounted}
      orientation={orientation}
      {...props}
    />
  );
}

export function ScrollAreaThumb({
  className,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Thumb>) {
  return (
    <ScrollAreaPrimitive.Thumb
      className={cn("relative flex-1 rounded-full bg-border", className)}
      data-slot="scroll-area-thumb"
      {...props}
    />
  );
}

export function ScrollAreaCorner({
  className,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Corner>) {
  return (
    <ScrollAreaPrimitive.Corner
      className={cn("bg-transparent", className)}
      data-slot="scroll-area-corner"
      {...props}
    />
  );
}
