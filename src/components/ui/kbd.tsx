import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Keyboard key display (shadcn `Kbd`, manual install — matches the project's
 * hand-seeded ui/* primitives). Renders a small key cap; group with `KbdGroup`.
 */
export function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 min-w-5 select-none items-center justify-center gap-1 rounded-sm bg-muted px-1 font-sans text-[11px] font-medium text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

/** Group several `Kbd` keys together (e.g. ⌘ + 1). */
export function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-0.5", className)}
      {...props}
    />
  );
}
