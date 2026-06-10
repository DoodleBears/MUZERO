"use client";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import type * as React from "react";
import { createContext, useContext } from "react";
import { cn } from "@/lib/utils";

/**
 * shadcn/COSS-style Tabs wrappers over Base UI. The active tab is tracked by a
 * single sliding `TabsIndicator` that reads Base UI's `--active-tab-*` geometry
 * vars, so switching tabs animates instead of snapping. `variant` picks the
 * indicator shape — a filled pill (`default`, segmented control) or a bottom
 * line (`underline`) — and is threaded to the parts via context.
 */
type TabsVariant = "default" | "underline";

const TabsVariantContext = createContext<TabsVariant>("default");

export function Tabs({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root> & { variant?: TabsVariant }) {
  return (
    <TabsVariantContext.Provider value={variant}>
      <TabsPrimitive.Root
        data-variant={variant}
        className={cn("flex flex-col gap-2", className)}
        {...props}
      />
    </TabsVariantContext.Provider>
  );
}

export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  const variant = useContext(TabsVariantContext);
  return (
    <TabsPrimitive.List
      className={cn(
        "relative isolate flex items-center",
        variant === "default" && "w-fit gap-1 rounded-lg border border-border bg-background/10 p-1",
        variant === "underline" && "gap-4 border-b border-border",
        className,
      )}
      {...props}
    />
  );
}

export function TabsTab({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Tab>) {
  const variant = useContext(TabsVariantContext);
  return (
    <TabsPrimitive.Tab
      className={cn(
        "relative z-10 inline-flex cursor-pointer select-none items-center justify-center gap-1.5 whitespace-nowrap text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background data-[selected]:text-foreground disabled:pointer-events-none disabled:opacity-50",
        variant === "default" && "rounded-md px-3 py-1.5",
        variant === "underline" && "-mb-px border-b-2 border-transparent px-1 pb-2.5 pt-1",
        className,
      )}
      {...props}
    />
  );
}

export function TabsIndicator({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Indicator>) {
  const variant = useContext(TabsVariantContext);
  return (
    <TabsPrimitive.Indicator
      renderBeforeHydration
      className={cn(
        // Position + size come from Base UI's active-tab geometry vars; `transition-all`
        // turns a tab switch into a slide rather than a jump.
        "pointer-events-none absolute left-0 z-0 w-[var(--active-tab-width)] translate-x-[var(--active-tab-left)] transition-all duration-200 ease-out",
        variant === "default" &&
          "top-0 h-[var(--active-tab-height)] translate-y-[var(--active-tab-top)] rounded-md bg-accent",
        variant === "underline" && "-bottom-px h-0.5 bg-primary",
        className,
      )}
      {...props}
    />
  );
}

export function TabsPanel({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Panel>) {
  return (
    <TabsPrimitive.Panel
      className={cn("outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
      {...props}
    />
  );
}
