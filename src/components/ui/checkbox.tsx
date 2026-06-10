"use client";

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { Check, Minus } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";

/** Minimal checkbox on Base UI — square, fills with `--primary` when checked.
 *  Supports the indeterminate state (used by select-all). */
export function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        "grid size-4.5 shrink-0 place-items-center rounded border border-input bg-background text-primary-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring data-[checked]:border-primary data-[checked]:bg-primary data-[indeterminate]:border-primary data-[indeterminate]:bg-primary",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        className="flex items-center justify-center text-current data-[unchecked]:hidden"
        render={(indicatorProps, state) => (
          <span {...indicatorProps}>
            {state.indeterminate ? <Minus className="size-3.5" /> : <Check className="size-3.5" />}
          </span>
        )}
      />
    </CheckboxPrimitive.Root>
  );
}
