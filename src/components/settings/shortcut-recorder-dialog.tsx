import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { setAllShortcutOverrides } from "@/db/repositories";
import { useSettings } from "@/hooks/use-app-data";
import { planReassignment } from "@/shortcuts/conflict";
import {
  currentPlatform,
  formatGesture,
  gestureFromEvent,
  sanitizeOverrides,
} from "@/shortcuts/engine";
import { isModifierOnlyKey, reservedWarning } from "@/shortcuts/recorder";
import { SHORTCUT_ACTIONS_BY_ID, type ShortcutGesture } from "@/shortcuts/registry";

/**
 * "Press your keys" recorder (PRD Phase 4). Captures one chord, previews the
 * cascading-displacement plan (`planReassignment`): what it will unbind, what's
 * blocked by a protected shortcut (Save disabled), and an OS-reserved warning.
 * On Save it writes the whole resolved override map atomically.
 */
export function ShortcutRecorderDialog({
  actionId,
  actionLabel,
  open,
  onOpenChange,
}: {
  actionId: string;
  actionLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const td = t as unknown as (key: string) => string;
  const overrides = useSettings().shortcutOverrides;
  const platform = useMemo(() => currentPlatform(), []);
  const [captured, setCaptured] = useState<ShortcutGesture | null>(null);
  const captureRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setCaptured(null);
    const id = requestAnimationFrame(() => captureRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  const plan = useMemo(
    () =>
      captured
        ? planReassignment(
            [{ actionId, gesture: captured }],
            sanitizeOverrides(overrides, platform),
            platform,
          )
        : null,
    [captured, actionId, overrides, platform],
  );
  const reserved = captured ? reservedWarning(captured, platform) : null;
  const blocked = (plan?.blocked.length ?? 0) > 0;
  const canSave = !!captured && !blocked;

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") return; // let the dialog close
    if (e.metaKey && e.key.toLowerCase() === "w") return; // never trap close-window
    if (isModifierOnlyKey(e.key)) return; // wait for a real key
    e.preventDefault();
    e.stopPropagation();
    setCaptured(
      gestureFromEvent({
        code: e.code,
        key: e.key,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
      }),
    );
  }

  async function save() {
    if (!plan || blocked) return;
    await setAllShortcutOverrides(plan.overrides);
    onOpenChange(false);
  }

  const label = (id: string) => td(SHORTCUT_ACTIONS_BY_ID[id]?.labelKey ?? id);
  const displacedNames = plan?.displaced.map((d) => label(d.actionId)) ?? [];
  const blockedNames = plan?.blocked.map((b) => label(b.actionId)) ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{t("shortcuts.recorder.title", { name: actionLabel })}</DialogTitle>
        <DialogDescription>{t("shortcuts.recorder.hint")}</DialogDescription>
        <button
          ref={captureRef}
          type="button"
          onKeyDown={onKeyDown}
          data-shortcut-capture
          className="mt-1 grid min-h-16 w-full place-items-center rounded-lg border-2 border-input border-dashed bg-background/40 px-3 py-4 outline-none focus-visible:border-primary"
        >
          {captured ? (
            <KbdGroup>
              {formatGesture(captured, platform).map((cap) => (
                <Kbd key={cap}>{cap}</Kbd>
              ))}
            </KbdGroup>
          ) : (
            <span className="text-muted-foreground text-sm">{t("shortcuts.recorder.press")}</span>
          )}
        </button>
        {reserved && (
          <p className="text-amber-600 text-xs dark:text-amber-500">
            {t("shortcuts.recorder.reserved")}
          </p>
        )}
        {displacedNames.length > 0 && !blocked && (
          <p className="text-muted-foreground text-xs">
            {t("shortcuts.recorder.willUnbind", { names: displacedNames.join(", ") })}
          </p>
        )}
        {blockedNames.length > 0 && (
          <p className="text-destructive-foreground text-xs">
            {t("shortcuts.recorder.blocked", { names: blockedNames.join(", ") })}
          </p>
        )}
        <div className="mt-1 flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" disabled={!canSave} onClick={() => void save()}>
            {t("shortcuts.recorder.save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
