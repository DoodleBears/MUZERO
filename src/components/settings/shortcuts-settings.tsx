import { Plus, RotateCcw, Upload, X } from "lucide-react";
import {
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { ShortcutRecorderDialog } from "@/components/settings/shortcut-recorder-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DownloadIcon } from "@/components/ui/download";
import { Input } from "@/components/ui/input";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import {
  resetAllShortcuts,
  resetAllSystemShortcuts,
  resetSystemShortcut,
  setAllShortcutOverrides,
  setSystemShortcutBinding,
  setSystemShortcutsEnabled,
} from "@/db/repositories";
import { useSettings } from "@/hooks/use-app-data";
import { useTransliterationReady } from "@/hooks/use-transliteration-ready";
import { resolveDesktopBridge } from "@/lib/desktop/bridge";
import { saveTextFile } from "@/lib/save-text-file";
import { buildCheatSheet, type CheatSheetRow, cheatSheetRowMatches } from "@/shortcuts/cheatsheet";
import {
  currentPlatform,
  formatGesture,
  gestureFromEvent,
  mergeBindings,
  sanitizeOverrides,
  updateShortcutScopeOverride,
} from "@/shortcuts/engine";
import { parseKeymap, serializeKeymap } from "@/shortcuts/keymap-io";
import { SHORTCUT_PRESETS, type ShortcutPreset } from "@/shortcuts/presets";
import { isModifierOnlyKey } from "@/shortcuts/recorder";
import {
  SHORTCUT_ACTIONS_BY_ID,
  type ShortcutGesture,
  type ShortcutScope,
} from "@/shortcuts/registry";
import {
  SYSTEM_GLOBAL_SHORTCUT_ACTIONS,
  type SystemGlobalShortcutActionId,
  type SystemShortcutBinding,
  systemGestureToElectronAccelerator,
  validateSystemShortcutGesture,
} from "@/shortcuts/system-global";
import { notify } from "@/stores/notification-store";

/**
 * "View all shortcuts" + customize (PRD Phase 3 + 4 UI). Groups every registry
 * action by category (a read-only Reference section lists intrinsic widget keys +
 * gestures), searchable, with live chips. Editable rows get add (+) / remove (✕) /
 * reset (↺); the recorder drives the cascading-conflict flow. Reset-all clears
 * every override.
 */
export function ShortcutsSettings() {
  const { t } = useTranslation();
  const td = t as unknown as (key: string) => string; // dynamic registry labelKeys
  useTransliterationReady(); // load pinyin/kana so CJK search "snaps in"
  const settings = useSettings();
  const overrides = settings.shortcutOverrides;
  const [query, setQuery] = useState("");
  const [recording, setRecording] = useState<{
    actionId: string;
    scope: ShortcutScope;
    label: string;
  } | null>(null);
  const [presetToApply, setPresetToApply] = useState<ShortcutPreset | null>(null);
  const platform = useMemo(() => currentPlatform(), []);
  const cleanOverrides = useMemo(
    () => sanitizeOverrides(overrides, platform),
    [overrides, platform],
  );
  const bindings = useMemo(() => mergeBindings(cleanOverrides), [cleanOverrides]);
  const sections = useMemo(() => buildCheatSheet(bindings, platform), [bindings, platform]);
  const systemShortcutsSupported = useMemo(
    () => Boolean(resolveDesktopBridge().systemShortcuts),
    [],
  );
  const hasAnyOverride = Object.keys(cleanOverrides).length > 0;
  const importRef = useRef<HTMLInputElement>(null);

  function exportKeymap() {
    void saveTextFile("muzero-shortcuts.json", "application/json", serializeKeymap(cleanOverrides));
  }

  async function onImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const parsed = parseKeymap(await file.text(), platform);
    if (!parsed) {
      notify.error(t("shortcuts.importFailed"));
      return;
    }
    await setAllShortcutOverrides(parsed);
    notify.success(t("shortcuts.importDone"));
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>{t("settings.shortcutsTitle")}</CardTitle>
          <p className="text-muted-foreground text-sm">{t("settings.shortcutsSubtitle")}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => importRef.current?.click()}>
            <Upload className="size-4" /> {t("shortcuts.importKeymap")}
          </Button>
          {hasAnyOverride && (
            <Button variant="outline" size="sm" onClick={exportKeymap}>
              <DownloadIcon size={16} /> {t("shortcuts.exportKeymap")}
            </Button>
          )}
          {hasAnyOverride && (
            <Button variant="outline" size="sm" onClick={() => void resetAllShortcuts()}>
              {t("shortcuts.resetAll")}
            </Button>
          )}
          <input
            ref={importRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => void onImportFile(e)}
          />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("settings.shortcutsSearch")}
          data-shortcut-search
        />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-xs">{t("shortcuts.presetsLabel")}</span>
          {SHORTCUT_PRESETS.map((preset) => (
            <Button
              key={preset.id}
              variant="outline"
              size="sm"
              onClick={() => setPresetToApply(preset)}
            >
              {td(preset.labelKey)}
            </Button>
          ))}
        </div>
        {sections.map((section) => {
          const scopeLabel = t(`shortcuts.scope.${section.scope}`);
          const rows = section.rows.filter((row) =>
            cheatSheetRowMatches(row, query, td(row.labelKey), scopeLabel),
          );
          if (rows.length === 0) return null;
          return (
            <section key={section.scope} className="flex flex-col gap-0.5">
              <h3 className="px-2 pb-1 font-semibold text-muted-foreground text-xs uppercase tracking-wide">
                {scopeLabel}
              </h3>
              {rows.map((row) => (
                <ShortcutRow
                  key={`${row.actionId}:${row.scope}`}
                  row={row}
                  hasOverride={!row.isDefault}
                  onRecord={() =>
                    setRecording({
                      actionId: row.actionId,
                      scope: row.scope,
                      label: `${td(row.labelKey)} · ${t(`shortcuts.scope.${row.scope}`)}`,
                    })
                  }
                  onReplaceScope={(replacement) =>
                    void setAllShortcutOverrides(
                      updateShortcutScopeOverride(
                        cleanOverrides,
                        row.actionId,
                        row.scope,
                        replacement,
                        bindings,
                        platform,
                      ),
                    )
                  }
                />
              ))}
            </section>
          );
        })}
        <SystemGlobalShortcutsSection
          enabled={settings.systemShortcutsEnabled ?? false}
          bindings={settings.systemShortcutBindings ?? {}}
          platform={platform}
          supported={systemShortcutsSupported}
        />
      </CardContent>

      <ShortcutRecorderDialog
        actionId={recording?.actionId ?? ""}
        scope={recording?.scope ?? "global"}
        actionLabel={recording?.label ?? ""}
        open={recording !== null}
        onOpenChange={(open) => {
          if (!open) setRecording(null);
        }}
      />

      <ConfirmDialog
        open={presetToApply !== null}
        onOpenChange={(open) => {
          if (!open) setPresetToApply(null);
        }}
        title={t("shortcuts.applyPresetTitle", {
          name: presetToApply ? td(presetToApply.labelKey) : "",
        })}
        description={t("shortcuts.applyPresetBody")}
        confirm={{
          label: t("shortcuts.applyPreset"),
          variant: "default",
          onConfirm: async () => {
            if (presetToApply) await setAllShortcutOverrides(presetToApply.overrides);
          },
        }}
      />
    </Card>
  );
}

function SystemGlobalShortcutsSection({
  enabled,
  bindings,
  platform,
  supported,
}: {
  enabled: boolean;
  bindings: Partial<Record<SystemGlobalShortcutActionId, SystemShortcutBinding>>;
  platform: ReturnType<typeof currentPlatform>;
  supported: boolean;
}) {
  const { t } = useTranslation();
  const td = t as unknown as (key: string) => string;
  const [recording, setRecording] = useState<SystemGlobalShortcutActionId | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const captureRef = useRef<HTMLButtonElement | null>(null);
  const hasBindings = Object.keys(bindings).length > 0;

  useEffect(() => {
    if (!recording) return;
    const id = requestAnimationFrame(() => captureRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [recording]);

  async function record(actionId: SystemGlobalShortcutActionId, event: ReactKeyboardEvent) {
    if (event.key === "Escape") {
      setRecording(null);
      setErrorKey(null);
      return;
    }
    if (isModifierOnlyKey(event.key)) return;
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
    const validation = validateSystemShortcutGesture(gesture);
    if (!validation.ok) {
      setErrorKey(systemValidationErrorKey(validation.reason));
      return;
    }
    const duplicate = findDuplicateSystemShortcut(actionId, gesture, bindings);
    if (duplicate) {
      setErrorKey(
        t("shortcuts.system.error.duplicate", {
          name: td(SHORTCUT_ACTIONS_BY_ID[duplicate]?.labelKey ?? duplicate),
        }),
      );
      return;
    }
    await setSystemShortcutBinding(actionId, { enabled: true, gesture });
    setRecording(null);
    setErrorKey(null);
  }

  return (
    <section
      data-system-shortcuts-section
      className="mt-3 flex flex-col gap-2 border-border border-t pt-4"
    >
      <div className="flex items-start justify-between gap-3 px-2">
        <div>
          <h3 className="font-semibold text-muted-foreground text-xs uppercase tracking-wide">
            {t("shortcuts.system.title")}
          </h3>
          <p className="text-muted-foreground text-xs">{t("shortcuts.system.subtitle")}</p>
          {!supported && (
            <p className="text-muted-foreground text-xs">{t("shortcuts.system.unavailable")}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {hasBindings && (
            <Button variant="outline" size="sm" onClick={() => void resetAllSystemShortcuts()}>
              {t("shortcuts.system.resetAll")}
            </Button>
          )}
          <label
            htmlFor="system-shortcuts-enabled"
            className="flex cursor-pointer items-center gap-2 text-sm"
          >
            <Checkbox
              id="system-shortcuts-enabled"
              checked={enabled}
              disabled={!supported}
              onCheckedChange={(checked) => void setSystemShortcutsEnabled(checked === true)}
            />
            <span>{t("shortcuts.system.enable")}</span>
          </label>
        </div>
      </div>

      {SYSTEM_GLOBAL_SHORTCUT_ACTIONS.map((actionId) => {
        const action = SHORTCUT_ACTIONS_BY_ID[actionId];
        const binding = bindings[actionId];
        const gesture = binding?.enabled ? binding.gesture : undefined;
        const chips = gesture ? formatGesture(gesture, platform) : [];
        const isRecording = recording === actionId;
        return (
          <div
            key={actionId}
            data-system-shortcut-row={actionId}
            className="group flex items-center justify-between gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/40"
          >
            <span className="min-w-0 truncate text-sm">{td(action?.labelKey ?? actionId)}</span>
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              {chips.length > 0 ? (
                <KbdGroup>
                  {chips.map((cap) => (
                    <Kbd key={cap}>{cap}</Kbd>
                  ))}
                </KbdGroup>
              ) : (
                <span className="text-muted-foreground text-xs">{t("shortcuts.unassigned")}</span>
              )}
              {gesture && (
                <button
                  type="button"
                  onClick={() => void resetSystemShortcut(actionId)}
                  aria-label={t("shortcuts.system.clear")}
                  className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              )}
              <button
                type="button"
                disabled={!enabled || !supported}
                onClick={() => {
                  setRecording(actionId);
                  setErrorKey(null);
                }}
                aria-label={t("shortcuts.system.set")}
                className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
              >
                <Plus className="size-3.5" />
              </button>
              {isRecording && (
                <button
                  type="button"
                  data-system-shortcut-capture
                  ref={captureRef}
                  onKeyDown={(event) => void record(actionId, event)}
                  className="min-h-8 rounded-md border border-dashed px-3 text-muted-foreground text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t("shortcuts.system.record")}
                </button>
              )}
            </div>
          </div>
        );
      })}
      {errorKey && <p className="px-2 text-destructive-foreground text-xs">{errorKey}</p>}
    </section>
  );
}

function systemValidationErrorKey(reason: string): string {
  if (reason === "unsafe-bare-key") return "shortcuts.system.error.unsafeBareKey";
  if (reason === "pointer-gesture") return "shortcuts.system.error.pointer";
  return "shortcuts.system.error.unsupported";
}

function findDuplicateSystemShortcut(
  actionId: SystemGlobalShortcutActionId,
  gesture: ShortcutGesture,
  bindings: Partial<Record<SystemGlobalShortcutActionId, SystemShortcutBinding>>,
): SystemGlobalShortcutActionId | null {
  const accelerator = systemGestureToElectronAccelerator(gesture);
  if (!accelerator) return null;
  for (const otherActionId of SYSTEM_GLOBAL_SHORTCUT_ACTIONS) {
    if (otherActionId === actionId) continue;
    const binding = bindings[otherActionId];
    if (!binding?.enabled || !binding.gesture) continue;
    if (systemGestureToElectronAccelerator(binding.gesture) === accelerator) return otherActionId;
  }
  return null;
}

function ShortcutRow({
  row,
  hasOverride,
  onRecord,
  onReplaceScope,
}: {
  row: CheatSheetRow;
  hasOverride: boolean;
  onRecord: () => void;
  onReplaceScope: (replacement: CheatSheetRow["keyBindings"]) => void;
}) {
  const { t } = useTranslation();
  const td = t as unknown as (key: string) => string;
  const empty = row.chips.length === 0 && row.gestureLabelKeys.length === 0;

  function removeBinding(index: number) {
    onReplaceScope(row.keyBindings.filter((_, i) => i !== index));
  }

  return (
    <div
      data-shortcut-row={row.actionId}
      data-shortcut-scope={row.scope}
      className="group flex items-center justify-between gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/40"
    >
      <span className="min-w-0 truncate text-sm">{td(row.labelKey)}</span>
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {row.chips.map((chip, index) => (
          <span
            key={`${row.actionId}-${chip.join("+")}`}
            className="inline-flex items-center gap-0.5"
          >
            <KbdGroup>
              {chip.map((cap) => (
                <Kbd key={`${chip.join("+")}-${cap}`}>{cap}</Kbd>
              ))}
            </KbdGroup>
            {row.editable && (
              <button
                type="button"
                onClick={() => removeBinding(index)}
                aria-label={t("shortcuts.removeBinding")}
                className="grid size-4 place-items-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
              >
                <X className="size-3" />
              </button>
            )}
          </span>
        ))}
        {row.gestureLabelKeys.map((labelKey) => (
          <span key={labelKey} className="text-muted-foreground text-xs">
            {td(labelKey)}
          </span>
        ))}
        {empty && (
          <span className="text-muted-foreground text-xs">{t("shortcuts.unassigned")}</span>
        )}
        {row.editable && (
          <>
            <button
              type="button"
              onClick={onRecord}
              aria-label={t("shortcuts.addBinding")}
              className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Plus className="size-3.5" />
            </button>
            {hasOverride && (
              <button
                type="button"
                onClick={() => onReplaceScope(row.defaultKeyBindings)}
                aria-label={t("shortcuts.resetAction")}
                className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <RotateCcw className="size-3.5" />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
