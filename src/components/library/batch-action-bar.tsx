import { X } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

export interface BatchAction {
  label: string;
  onClick: () => void;
  variant?: React.ComponentProps<typeof Button>["variant"];
  icon?: ReactNode;
}

/**
 * Floating bar shown while a track list is in select mode. Sits ABOVE the
 * PlayerDock (`--spacing-chrome-bottom` clearance) so it never overlaps it.
 * Actions are supplied by the surface (set view: remove-from-set + permanent;
 * global: permanent only).
 */
export function BatchActionBar({
  count,
  allSelected,
  indeterminate,
  onToggleAll,
  onCancel,
  actions,
  disabled,
}: {
  count: number;
  allSelected: boolean;
  indeterminate: boolean;
  onToggleAll: () => void;
  onCancel: () => void;
  actions: BatchAction[];
  /** Temporarily disable the actions (e.g. while a reorder drag is in progress). */
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "-translate-x-1/2 fixed bottom-[calc(var(--spacing-chrome-bottom)+0.5rem)] left-1/2 z-40 flex w-[min(calc(100vw-2rem),38rem)] items-center gap-3 rounded-xl border border-border bg-popover/95 px-3 py-2 shadow-lg backdrop-blur",
        disabled && "pointer-events-none opacity-60",
      )}
    >
      <button
        type="button"
        onClick={onToggleAll}
        className="flex items-center gap-2 text-sm outline-none"
      >
        <Checkbox
          checked={allSelected}
          indeterminate={indeterminate}
          className="pointer-events-none"
        />
        <span className="text-muted-foreground">{t("select.selectAll")}</span>
      </button>
      <span className="font-medium text-sm">{t("select.selectedCount", { count })}</span>
      <div className="ml-auto flex items-center gap-2">
        {actions.map((action) => (
          <Button
            key={action.label}
            variant={action.variant ?? "outline"}
            size="sm"
            disabled={disabled || count === 0}
            onClick={action.onClick}
          >
            {action.icon}
            {action.label}
          </Button>
        ))}
        <Button variant="ghost" size="sm" onClick={onCancel} aria-label={t("select.done")}>
          <X />
        </Button>
      </div>
    </div>
  );
}
