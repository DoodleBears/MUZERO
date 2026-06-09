import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StepperStep {
  id: string;
  label: string;
}

/**
 * Minimal shadcn-style step indicator: numbered circles + labels + connectors.
 * Purely presentational — the parent owns the current index. The active step
 * carries `aria-current="step"` for a11y and testing.
 */
export function Stepper({
  steps,
  current,
  className,
}: {
  steps: StepperStep[];
  current: number;
  className?: string;
}) {
  return (
    <ol className={cn("flex items-center gap-2", className)}>
      {steps.map((step, index) => {
        const state = index < current ? "done" : index === current ? "active" : "upcoming";
        const isLast = index === steps.length - 1;
        return (
          <li
            key={step.id}
            className="flex min-w-0 items-center gap-2"
            aria-current={state === "active" ? "step" : undefined}
          >
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs",
                state === "active" && "border-primary bg-primary text-primary-foreground",
                state === "done" && "border-primary text-primary",
                state === "upcoming" && "border-border text-muted-foreground",
              )}
            >
              {state === "done" ? <Check className="size-3.5" /> : index + 1}
            </span>
            <span
              className={cn(
                "truncate text-sm",
                state === "active" ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              {step.label}
            </span>
            {!isLast && <span className="h-px w-5 shrink-0 bg-border" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}
