import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { setAllShortcutOverrides } from "@/db/repositories";
import { useSettings } from "@/hooks/use-app-data";
import { cn } from "@/lib/utils";
import { type RecorderDraft, reconcileRecorderDrafts } from "@/shortcuts/conflict";
import {
  currentPlatform,
  formatGesture,
  gestureFromEvent,
  sanitizeOverrides,
} from "@/shortcuts/engine";
import { isModifierOnlyKey, reservedWarning } from "@/shortcuts/recorder";
import {
  SHORTCUT_ACTIONS_BY_ID,
  type ShortcutGesture,
  type ShortcutScope,
} from "@/shortcuts/registry";

/**
 * Cascading "press your keys" recorder (PRD Phase 5). Recording an occupied chord
 * spawns a slot to relocate the displaced action; relocating it may cascade again
 * — a reactive chain driven by `reconcileRecorderDrafts`. Save is gated until every
 * slot is filled and nothing hits a protected holder, then the whole chain is
 * written atomically. Cancel (Esc / button) discards everything.
 */
export function ShortcutRecorderDialog({
  actionId,
  scope,
  actionLabel,
  open,
  onOpenChange,
}: {
  actionId: string;
  scope: ShortcutScope;
  actionLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const td = t as unknown as (key: string) => string;
  const overrides = useSettings().shortcutOverrides;
  const platform = useMemo(() => currentPlatform(), []);
  // Accumulated user captures (source of truth); the reconcile derives the active,
  // pruned, chain-ordered slot list that we render.
  const [drafts, setDrafts] = useState<RecorderDraft[]>([]);
  // Which slot is focused (capturing). A focused box prompts for a (re)record.
  const [focusedId, setFocusedId] = useState<string | null>(null);

  useEffect(() => {
    if (open) setDrafts([{ actionId, scope, gesture: null }]);
  }, [open, actionId, scope]);

  const base = useMemo(() => sanitizeOverrides(overrides, platform), [overrides, platform]);
  const reconcile = useMemo(
    () => reconcileRecorderDrafts(drafts, base, platform),
    [drafts, base, platform],
  );
  const firstPendingId = reconcile.drafts.find((d) => d.gesture === null)?.actionId;

  // Focus the first unfilled slot (the one to record next). The dialog content is
  // portaled to <body>, so query the document.
  useEffect(() => {
    if (!open || !firstPendingId) return;
    const slot = `${firstPendingId}:${reconcile.drafts.find((d) => d.actionId === firstPendingId)?.scope ?? "global"}`;
    const id = requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-capture-slot="${CSS.escape(slot)}"]`)?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open, firstPendingId, reconcile.drafts]);

  function record(
    slotActionId: string,
    slotScope: ShortcutScope,
    displacedChord: ShortcutGesture | undefined,
    event: React.KeyboardEvent,
  ) {
    if (event.key === "Escape") return; // let the dialog close
    if (event.metaKey && event.key.toLowerCase() === "w") return; // never trap close-window
    if (isModifierOnlyKey(event.key)) return; // wait for a real key
    event.preventDefault();
    event.stopPropagation();
    const gesture = gestureFromEvent({
      code: event.code,
      key: event.key,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
    });
    setDrafts((prev) =>
      prev.some((d) => d.actionId === slotActionId && d.scope === slotScope)
        ? prev.map((d) =>
            d.actionId === slotActionId && d.scope === slotScope ? { ...d, gesture } : d,
          )
        : [...prev, { actionId: slotActionId, scope: slotScope, gesture, displacedChord }],
    );
  }

  /** Clear a slot's recorded chord (→ pending), re-run the cascade, and re-focus it. */
  function clearSlot(slotActionId: string, slotScope: ShortcutScope) {
    setDrafts((prev) =>
      prev.map((d) =>
        d.actionId === slotActionId && d.scope === slotScope ? { ...d, gesture: null } : d,
      ),
    );
    const slot = `${slotActionId}:${slotScope}`;
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-capture-slot="${CSS.escape(slot)}"]`)?.focus();
    });
  }

  async function save() {
    if (!reconcile.canSave) return;
    await setAllShortcutOverrides(reconcile.plan.overrides);
    onOpenChange(false);
  }

  const blockedNames = reconcile.plan.blocked
    .map((b) => td(SHORTCUT_ACTIONS_BY_ID[b.actionId]?.labelKey ?? b.actionId))
    .join(", ");
  const isChain = reconcile.drafts.length > 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{t("shortcuts.recorder.title", { name: actionLabel })}</DialogTitle>
        <DialogDescription>
          {isChain ? t("shortcuts.recorder.chainHint") : t("shortcuts.recorder.hint")}
        </DialogDescription>

        <div className="flex flex-col gap-3">
          {reconcile.drafts.map((slot, index) => {
            const slotScope = slot.scope ?? scope;
            const slotKey = `${slot.actionId}:${slotScope}`;
            const reserved = slot.gesture ? reservedWarning(slot.gesture, platform) : null;
            const slotLabel =
              index === 0
                ? actionLabel
                : td(SHORTCUT_ACTIONS_BY_ID[slot.actionId]?.labelKey ?? slot.actionId);
            const focused = focusedId === slotKey;
            // A focused box is "recording" — prompt for a (re)record, hiding the
            // chip; an unfocused filled box shows its chip + a ✕ to clear.
            const showPrompt = focused || !slot.gesture;
            return (
              <div key={slot.actionId} className="flex flex-col gap-1">
                {index > 0 && slot.displacedChord && (
                  <p className="text-muted-foreground text-xs">
                    {t("shortcuts.recorder.relocate", {
                      name: slotLabel,
                      chord: formatGesture(slot.displacedChord, platform).join(""),
                    })}
                  </p>
                )}
                <div className="relative">
                  <button
                    type="button"
                    data-shortcut-capture
                    data-capture-action={slot.actionId}
                    data-capture-scope={slotScope}
                    data-capture-slot={slotKey}
                    onKeyDown={(e) => record(slot.actionId, slotScope, slot.displacedChord, e)}
                    onFocus={() => setFocusedId(slotKey)}
                    onBlur={() => setFocusedId((id) => (id === slotKey ? null : id))}
                    className={cn(
                      "grid min-h-12 w-full place-items-center rounded-lg border-2 bg-background/40 px-3 py-3 outline-none transition-colors",
                      focused ? "border-primary border-solid" : "border-input border-dashed",
                    )}
                  >
                    {!showPrompt && slot.gesture ? (
                      <KbdGroup>
                        {formatGesture(slot.gesture, platform).map((cap) => (
                          <Kbd key={cap}>{cap}</Kbd>
                        ))}
                      </KbdGroup>
                    ) : (
                      <span className="text-muted-foreground text-sm">
                        {focused && slot.gesture
                          ? t("shortcuts.recorder.replace")
                          : t("shortcuts.recorder.press")}
                      </span>
                    )}
                  </button>
                  {slot.gesture && !focused && (
                    <button
                      type="button"
                      onClick={() => clearSlot(slot.actionId, slotScope)}
                      aria-label={t("shortcuts.removeBinding")}
                      className="-translate-y-1/2 absolute top-1/2 right-2 grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <X className="size-4" />
                    </button>
                  )}
                </div>
                {reserved && (
                  <p className="text-amber-600 text-xs dark:text-amber-500">
                    {t("shortcuts.recorder.reserved")}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {blockedNames && (
          <p className="text-destructive-foreground text-xs">
            {t("shortcuts.recorder.blocked", { names: blockedNames })}
          </p>
        )}

        <div className="mt-1 flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" disabled={!reconcile.canSave} onClick={() => void save()}>
            {t("shortcuts.recorder.save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
