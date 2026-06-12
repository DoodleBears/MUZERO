import { CircleHelp } from "lucide-react";
import type { ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function VisualizerHelpLabel({
  children,
  helpLabel,
  id,
}: {
  children: ReactNode;
  helpLabel: string;
  id?: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span id={id} className="text-xs font-medium text-muted-foreground">
        {children}
      </span>
      <VisualizerHelpButton label={helpLabel} />
    </div>
  );
}

export function VisualizerHelpButton({ label }: { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            className="inline-grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <CircleHelp className="size-3.5" />
          </button>
        }
      />
      <TooltipContent className="max-w-64 whitespace-normal font-normal leading-snug">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
