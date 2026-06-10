import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { useSettings } from "@/hooks/use-app-data";
import { buildCheatSheet, type CheatSheetRow, cheatSheetRowMatches } from "@/shortcuts/cheatsheet";
import { currentPlatform, mergeBindings, sanitizeOverrides } from "@/shortcuts/engine";

/**
 * "View all shortcuts" — the read-only cheat-sheet (PRD Phase 3). Groups every
 * registry action by category (a Reference section lists the intrinsic widget keys
 * + gestures, never rebindable), with live chips and a fuzzy search. Per-row
 * rebinding (the recorder) lands in Phase 4.
 */
export function ShortcutsSettings() {
  const { t } = useTranslation();
  const td = t as unknown as (key: string) => string; // dynamic registry labelKeys
  const overrides = useSettings().shortcutOverrides;
  const [query, setQuery] = useState("");
  const platform = useMemo(() => currentPlatform(), []);
  const bindings = useMemo(
    () => mergeBindings(sanitizeOverrides(overrides, platform)),
    [overrides, platform],
  );
  const sections = useMemo(() => buildCheatSheet(bindings, platform), [bindings, platform]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.shortcutsTitle")}</CardTitle>
        <p className="text-sm text-muted-foreground">{t("settings.shortcutsSubtitle")}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("settings.shortcutsSearch")}
          data-shortcut-search
        />
        {sections.map((section) => {
          const rows = section.rows.filter((row) =>
            cheatSheetRowMatches(row, query, td(row.labelKey)),
          );
          if (rows.length === 0) return null;
          return (
            <section key={section.category} className="flex flex-col gap-0.5">
              <h3 className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t(`shortcuts.category.${section.category}`)}
              </h3>
              {rows.map((row) => (
                <ShortcutRow key={row.actionId} row={row} />
              ))}
            </section>
          );
        })}
      </CardContent>
    </Card>
  );
}

function ShortcutRow({ row }: { row: CheatSheetRow }) {
  const { t } = useTranslation();
  // Registry labelKeys are dynamic strings (codename layer); the typed `t` only
  // accepts known literals, so route those through a thin cast.
  const td = t as unknown as (key: string) => string;
  const empty = row.chips.length === 0 && row.gestureLabelKeys.length === 0;
  return (
    <div
      data-shortcut-row={row.actionId}
      className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/40"
    >
      <span className="min-w-0 truncate text-sm">{td(row.labelKey)}</span>
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {row.chips.map((chip) => (
          <KbdGroup key={`${row.actionId}-${chip.join("+")}`}>
            {chip.map((cap) => (
              <Kbd key={`${chip.join("+")}-${cap}`}>{cap}</Kbd>
            ))}
          </KbdGroup>
        ))}
        {row.gestureLabelKeys.map((labelKey) => (
          <span key={labelKey} className="text-muted-foreground text-xs">
            {td(labelKey)}
          </span>
        ))}
        {empty && (
          <span className="text-muted-foreground text-xs">{t("shortcuts.unassigned")}</span>
        )}
      </div>
    </div>
  );
}
