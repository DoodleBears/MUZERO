"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

type ConfirmVariant = React.ComponentProps<typeof Button>["variant"];

export interface ConfirmAction {
  label: string;
  onConfirm: () => void | Promise<void>;
  variant?: ConfirmVariant;
}

/**
 * A confirmation dialog over the base `Dialog`. The primary `confirm` is the
 * main (usually destructive) action; an optional `secondary` adds a second
 * destructive choice — e.g. "delete set only" vs "delete set + its songs".
 * Each action runs then closes the dialog; Cancel / backdrop / Esc just close.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirm,
  secondary,
  cancelLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirm: ConfirmAction;
  secondary?: ConfirmAction;
  cancelLabel?: string;
}) {
  const { t } = useTranslation();
  const run = (action: ConfirmAction) => async () => {
    await action.onConfirm();
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        {description ? <DialogDescription>{description}</DialogDescription> : null}
        <div className="mt-1 flex flex-wrap items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {cancelLabel ?? t("common.cancel")}
          </Button>
          {secondary ? (
            <Button
              variant={secondary.variant ?? "destructive-outline"}
              size="sm"
              onClick={run(secondary)}
            >
              {secondary.label}
            </Button>
          ) : null}
          <Button variant={confirm.variant ?? "destructive"} size="sm" onClick={run(confirm)}>
            {confirm.label}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
