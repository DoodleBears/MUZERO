import { ArrowDown, ArrowUp } from "lucide-react";
import type { ReactNode } from "react";
import type { SortDir } from "@/lib/set-gallery";
import { cn } from "@/lib/utils";

const chipClass =
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors";
const activeClass = "border-primary bg-accent/60 text-foreground";
const idleClass = "border-border text-muted-foreground hover:bg-accent/50";

/**
 * A single-select sort chip. When active it shows a direction caret (↑ asc / ↓
 * desc); clicking the active chip again flips it (the caller owns that toggle).
 * Shared by the gallery walls (sets / tracks / albums / artists) and entity
 * detail pages so every sort row reads identically.
 */
export function SortChip({
  active,
  dir,
  onClick,
  children,
}: {
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(chipClass, active ? activeClass : idleClass)}
    >
      {children}
      {active &&
        (dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
    </button>
  );
}

/** A toggle pill (e.g. the 红心 liked-only filter) sharing the sort-chip styling. */
export function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(chipClass, active ? activeClass : idleClass)}
    >
      {children}
    </button>
  );
}
