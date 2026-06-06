import { CheckCircle2, ExternalLink, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { saveSettings } from "@/db/repositories";
import type { AppSettings, LlmProviderId } from "@/db/types";
import { useSettings } from "@/hooks/use-app-data";
import { type Locale, locales, persistLocale } from "@/i18n/config";
import {
  CLOUD_PRESET_IDS,
  type CloudPresetId,
  continuousHourlyUsd,
  resolveCloudPreset,
} from "@/musicgen/presets";
import { type MusicGenProviderId, resolveMusicGenProvider } from "@/musicgen/registry";
import { usePlayerStore } from "@/stores/player-store";
import { DEFAULT_THEME, persistTheme, type Theme, themes } from "@/theme/theme";

/** Maps a preset id to its i18n option label (ids carry hyphens; keys don't). */
const PRESET_LABEL_KEY = {
  "ace-step": "settings.presetAceStep",
  mureka: "settings.presetMureka",
  custom: "settings.presetCustom",
} as const satisfies Record<CloudPresetId, string>;

/** On-device, BYOK settings. Nothing here is ever sent anywhere but the model/API you point it at. */
export function SettingsPage() {
  const { t, i18n } = useTranslation();
  const settings = useSettings();
  const rebuildEngine = usePlayerStore((s) => s.rebuildEngine);
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [saved, setSaved] = useState(false);
  const [health, setHealth] = useState<"unknown" | "ok" | "down" | "checking">("unknown");

  // Keep the local draft in sync once the persisted settings load.
  useEffect(() => setDraft(settings), [settings]);

  function patch(p: Partial<AppSettings>) {
    setDraft((d) => ({ ...d, ...p }));
    setSaved(false);
  }

  async function changeLanguage(locale: Locale) {
    await i18n.changeLanguage(locale);
    persistLocale(locale);
    await saveSettings({ locale });
  }

  async function changeTheme(theme: Theme) {
    persistTheme(theme);
    await saveSettings({ theme });
  }

  async function save() {
    await saveSettings(draft);
    await rebuildEngine();
    setSaved(true);
  }

  async function checkCloud() {
    setHealth("checking");
    const provider = resolveMusicGenProvider({ ...draft, musicGenProvider: "cloud" });
    const ok = (await provider.health?.()) ?? false;
    setHealth(ok ? "ok" : "down");
  }

  const cloudPreset = resolveCloudPreset(draft.musicCloudPreset);
  const costText =
    cloudPreset.estCostPerSongUsd == null
      ? t("settings.costUnknown")
      : t("settings.costHint", {
          song: `$${cloudPreset.estCostPerSongUsd.toFixed(3)}`,
          hourly: `$${continuousHourlyUsd(cloudPreset.estCostPerSongUsd).toFixed(2)}`,
        });

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col gap-4 overflow-y-auto p-4 lg:p-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.appearance")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Field label={t("settings.theme")}>
            <select
              value={settings.theme ?? DEFAULT_THEME}
              onChange={(e) => void changeTheme(e.target.value as Theme)}
              className="h-10 rounded-md border border-input bg-transparent px-3 text-sm"
            >
              {themes.map(({ value, labelKey }) => (
                <option key={value} value={value}>
                  {t(labelKey)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("settings.language")}>
            <select
              value={i18n.language}
              onChange={(e) => void changeLanguage(e.target.value as Locale)}
              className="h-10 rounded-md border border-input bg-transparent px-3 text-sm"
            >
              {locales.map(({ code, label }) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.djTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Field label={t("settings.provider")}>
            <select
              value={draft.llmProvider}
              onChange={(e) => patch({ llmProvider: e.target.value as LlmProviderId })}
              className="h-10 rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
            </select>
          </Field>
          <Field label={t("settings.model")}>
            <Input
              value={draft.llmModel}
              onChange={(e) => patch({ llmModel: e.target.value })}
              placeholder="gpt-4o-mini"
            />
          </Field>
          {draft.llmProvider === "openai" ? (
            <Field label={t("settings.openaiKey")}>
              <Input
                type="password"
                value={draft.openaiApiKey ?? ""}
                onChange={(e) => patch({ openaiApiKey: e.target.value })}
                placeholder="sk-…"
              />
            </Field>
          ) : (
            <Field label={t("settings.anthropicKey")}>
              <Input
                type="password"
                value={draft.anthropicApiKey ?? ""}
                onChange={(e) => patch({ anthropicApiKey: e.target.value })}
                placeholder="sk-ant-…"
              />
            </Field>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.musicTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Field label={t("settings.provider")}>
            <select
              value={draft.musicGenProvider}
              onChange={(e) => patch({ musicGenProvider: e.target.value as MusicGenProviderId })}
              className="h-10 rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="mock">{t("settings.providerMock")}</option>
              <option value="cloud">{t("settings.providerCloud")}</option>
            </select>
          </Field>
          {draft.musicGenProvider === "cloud" && (
            <>
              <Field label={t("settings.preset")}>
                <select
                  value={draft.musicCloudPreset ?? "mureka"}
                  onChange={(e) => patch({ musicCloudPreset: e.target.value as CloudPresetId })}
                  className="h-10 rounded-md border border-input bg-transparent px-3 text-sm"
                >
                  {CLOUD_PRESET_IDS.map((id) => (
                    <option key={id} value={id}>
                      {t(PRESET_LABEL_KEY[id])}
                    </option>
                  ))}
                </select>
              </Field>
              {!cloudPreset.fixedEndpoint && (
                <Field label={t("settings.apiBaseUrl")}>
                  <Input
                    value={draft.musicCloudUrl ?? ""}
                    onChange={(e) => patch({ musicCloudUrl: e.target.value })}
                    placeholder="https://api.your-music-provider.com/v1"
                  />
                </Field>
              )}
              <Field label={t("settings.apiKey")}>
                <Input
                  type="password"
                  value={draft.musicCloudApiKey ?? ""}
                  onChange={(e) => patch({ musicCloudApiKey: e.target.value })}
                  placeholder={cloudPreset.authScheme === "key" ? "fal_…" : "sk-…"}
                />
              </Field>
              {cloudPreset.apiKeyUrl && (
                <a
                  href={cloudPreset.apiKeyUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex w-fit items-center gap-1 text-xs text-primary hover:underline"
                >
                  {t("settings.getApiKey")}
                  <ExternalLink className="size-3" />
                </a>
              )}
              <Field label={t("settings.modelOptional")}>
                <Input
                  value={draft.musicCloudModel ?? ""}
                  onChange={(e) => patch({ musicCloudModel: e.target.value })}
                  placeholder={cloudPreset.defaults.model ?? "provider-specific model id"}
                />
              </Field>
              <p className="text-xs text-muted-foreground">{costText}</p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => void checkCloud()}>
                  {t("settings.testConnection")}
                </Button>
                {health === "ok" && <CheckCircle2 className="size-4 text-primary" />}
                {health === "down" && <XCircle className="size-4 text-destructive" />}
                {health === "checking" && (
                  <span className="text-xs text-muted-foreground">{t("settings.checking")}</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{t("settings.cloudNote")}</p>
            </>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={() => void save()}>{t("settings.save")}</Button>
        {saved && <span className="text-sm text-muted-foreground">{t("settings.saved")}</span>}
      </div>
      <p className="pb-4 text-xs text-muted-foreground">{t("settings.localNote")}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    // The control is passed in via `children` and nested inside the label, which
    // Biome's static analysis can't see through.
    // biome-ignore lint/a11y/noLabelWithoutControl: control supplied via children
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
