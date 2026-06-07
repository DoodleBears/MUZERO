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
  keys,
  side = "top",
  children,
}: {
  label: string;
  keys?: string[];
  side?: "top" | "bottom" | "left" | "right";
  children: ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side={side}>
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
      </TooltipContent>
    </Tooltip>
  );
}
