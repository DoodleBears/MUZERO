import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { clearFailedEnrichments, saveSettings } from "@/db/repositories";
import {
  type EnrichSweepStatus,
  getEnrichmentSweepStatus,
  runEnrichmentSweep,
  stopEnrichmentSweep,
} from "@/enrich/enrich-sweep";
import { useSettings } from "@/hooks/use-app-data";

/** A BYOK key/token field: local draft, saved on blur, never re-echoed in plaintext. */
function KeyField(props: {
  label: string;
  hint: string;
  value: string;
  onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? props.value;
  return (
    <div className="flex flex-col gap-1">
      <span className="font-medium text-sm">{props.label}</span>
      <span className="text-muted-foreground text-xs">{props.hint}</span>
      <input
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={shown}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onBlur={() => {
          if (draft != null && draft !== props.value) props.onSave(draft.trim());
          setDraft(null);
        }}
        className="mt-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
      />
    </div>
  );
}

/**
 * "Genre tags" settings (genre-enrichment PRD): auto-fill genre/style for imported tracks so
 * the DJ + search can filter by style. Toggle + BYOK keys (Last.fm/Discogs) + the background
 * sweep's progress and manual controls (enrich now / stop / retry the misses).
 */
export function GenreEnrichmentSettings() {
  const { t } = useTranslation();
  const settings = useSettings();

  // Poll the module-scope sweep status while this panel is open (it's not store state, so it
  // can't drive per-frame re-renders elsewhere — rule 6).
  const [sweep, setSweep] = useState<EnrichSweepStatus>(getEnrichmentSweepStatus);
  useEffect(() => {
    const id = window.setInterval(() => setSweep(getEnrichmentSweepStatus()), 800);
    return () => window.clearInterval(id);
  }, []);

  async function retryFailed() {
    await clearFailedEnrichments();
    void runEnrichmentSweep();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("enrichSettings.title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 rounded-md border border-border p-3">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={settings.autoEnrich ?? true}
              onChange={(e) => void saveSettings({ autoEnrich: e.currentTarget.checked })}
              className="mt-1 size-4 accent-primary"
            />
            <span className="flex flex-col gap-1">
              <span className="font-medium text-sm">{t("enrichSettings.autoEnrich")}</span>
              <span className="text-muted-foreground text-xs">
                {t("enrichSettings.autoEnrichHint")}
              </span>
            </span>
          </label>
        </div>

        <div className="flex flex-col gap-3 rounded-md border border-border p-3">
          <KeyField
            label={t("enrichSettings.lastfmKey")}
            hint={t("enrichSettings.lastfmKeyHint")}
            value={settings.lastfmApiKey ?? ""}
            onSave={(v) => void saveSettings({ lastfmApiKey: v || undefined })}
          />
          <KeyField
            label={t("enrichSettings.discogsToken")}
            hint={t("enrichSettings.discogsTokenHint")}
            value={settings.discogsToken ?? ""}
            onSave={(v) => void saveSettings({ discogsToken: v || undefined })}
          />
          <span className="text-muted-foreground text-[11px]">
            {t("enrichSettings.desktopOnly")}
          </span>
        </div>

        <div className="flex flex-col gap-3 rounded-md border border-border p-3">
          <span className="font-medium text-sm">{t("enrichSettings.libraryBackfill")}</span>
          <span className="text-muted-foreground text-xs">
            {sweep.running
              ? t("enrichSettings.sweepProgress", { done: sweep.done, total: sweep.total })
              : t("enrichSettings.sweepIdle")}
          </span>
          <div className="flex flex-wrap gap-2">
            {sweep.running ? (
              <Button variant="secondary" size="sm" onClick={() => stopEnrichmentSweep()}>
                {t("enrichSettings.stop")}
              </Button>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => void runEnrichmentSweep()}>
                {t("enrichSettings.enrichNow")}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              disabled={sweep.running}
              onClick={() => void retryFailed()}
            >
              {t("enrichSettings.retryFailed")}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
