import type { ReactElement } from "react";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Wraps a single transport control in a Base UI tooltip showing its label and
 * (optionally) its keyboard shortcut as `Kbd` caps — the same affordance the nav
 * uses. `children` must be a single element that forwards props/ref (e.g. the
 * project `Button`, which composes via `useRender`); the tooltip attaches to it
 * through the `render` prop without an extra wrapper node.
 *
 * Mount inside a `TooltipProvider` so a row of controls shares the open delay.
 */
export function ControlTooltip({
  label,
  hint,
  keys,
  shortcutRows,
  side = "top",
  children,
}: {
  label: string;
  hint?: string;
  keys?: string[];
  shortcutRows?: Array<{ label: string; keys: string[] }>;
  side?: "top" | "bottom" | "left" | "right";
  children: ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent
        side={side}
        className={shortcutRows && shortcutRows.length > 0 ? "px-3 py-2" : undefined}
      >
        <span className="flex flex-col gap-1.5">
          <span className="flex items-center gap-2">
            <span>{label}</span>
            {keys && keys.length > 0 && (
              <KbdGroup>
                {keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </KbdGroup>
            )}
          </span>
          {shortcutRows?.map((row) => (
            <span
              key={row.label}
              className="grid grid-cols-[minmax(5.5rem,1fr)_auto] items-center gap-3 text-muted-foreground"
            >
              <span>{row.label}</span>
              <KbdGroup>
                {row.keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </KbdGroup>
            </span>
          ))}
          {hint ? <span className="text-muted-foreground text-xs">{hint}</span> : null}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}
