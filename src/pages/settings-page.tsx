import { CheckCircle2, ExternalLink, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BackgroundSettings } from "@/components/settings/background-settings";
import { VisualizerSettings } from "@/components/settings/visualizer-settings";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ColorPicker } from "@/components/ui/color-picker";
import { Combobox, type ComboboxItem } from "@/components/ui/combobox";
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
import {
  customFontStack,
  DEFAULT_FONT_STACK,
  FONTS,
  persistFont,
  primaryFamily,
} from "@/theme/font";
import {
  DEFAULT_PRIMARY,
  PRIMARY_PRESETS,
  type PrimaryColors,
  type PrimaryPresetId,
  persistPrimary,
} from "@/theme/primary";
import { loadSystemFonts } from "@/theme/system-fonts";
import { DEFAULT_THEME, persistTheme, type Theme, themes } from "@/theme/theme";

/** Maps a preset id to its i18n option label (ids carry hyphens; keys don't). */
const PRESET_LABEL_KEY = {
  "ace-step": "settings.presetAceStep",
  mureka: "settings.presetMureka",
  custom: "settings.presetCustom",
} as const satisfies Record<CloudPresetId, string>;

/** i18n name for each named primary-color preset. */
const PRIMARY_PRESET_NAME_KEY = {
  ocean: "settings.primaryPresetOcean",
  teal: "settings.primaryPresetTeal",
  matcha: "settings.primaryPresetMatcha",
  neon: "settings.primaryPresetNeon",
  synthwave: "settings.primaryPresetSynthwave",
  nebula: "settings.primaryPresetNebula",
  rose: "settings.primaryPresetRose",
  sunset: "settings.primaryPresetSunset",
} as const satisfies Record<PrimaryPresetId, string>;

/** On-device, BYOK settings. Nothing here is ever sent anywhere but the model/API you point it at. */
export function SettingsPage() {
  const { t, i18n } = useTranslation();
  const settings = useSettings();
  const rebuildEngine = usePlayerStore((s) => s.rebuildEngine);
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [saved, setSaved] = useState(false);
  const [health, setHealth] = useState<"unknown" | "ok" | "down" | "checking">("unknown");
  // Font picker: the combobox input text, plus lazily-loaded system fonts.
  const [fontInput, setFontInput] = useState("");
  const [systemFontItems, setSystemFontItems] = useState<ComboboxItem[]>([]);
  const [loadingFonts, setLoadingFonts] = useState(false);
  const fontsLoadedRef = useRef(false);

  // Keep the local draft in sync once the persisted settings load.
  useEffect(() => setDraft(settings), [settings]);

  // The font stack currently in effect (stored preference → system default).
  const currentFont = settings.fontFamily ?? DEFAULT_FONT_STACK;
  // Mirror the active font's display name into the combobox input (preset label,
  // else the leading family). Independent of loaded fonts so a load mid-edit
  // never clobbers what the user is typing.
  useEffect(() => {
    const preset = FONTS.find((f) => f.stack === currentFont);
    setFontInput(preset ? t(preset.labelKey) : primaryFamily(currentFont));
  }, [currentFont, t]);

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

  async function changePrimary(next: PrimaryColors) {
    persistPrimary(next);
    await saveSettings({ primaryLight: next.light, primaryDark: next.dark });
  }

  async function changeFont(stack: string) {
    persistFont(stack);
    await saveSettings({ fontFamily: stack });
  }

  // Combobox options: preset stacks first, then any loaded system fonts. Each
  // row previews itself in its own face. Preset rows recompute on locale change.
  const presetFontItems = useMemo<ComboboxItem[]>(
    () => FONTS.map((f) => ({ id: f.stack, label: t(f.labelKey), style: { fontFamily: f.stack } })),
    [t],
  );
  const fontItems = useMemo(
    () => [...presetFontItems, ...systemFontItems],
    [presetFontItems, systemFontItems],
  );
  // Highlight the active font in the list only when it's actually a row.
  const selectedFontKey = fontItems.some((i) => i.id === currentFont) ? currentFont : null;

  // Load installed fonts once, on first open (the gesture that lets the Local
  // Font Access API prompt); falls back to probing. Cached for the session.
  async function loadFontsOnce(isOpen: boolean) {
    if (!isOpen || fontsLoadedRef.current || loadingFonts) return;
    setLoadingFonts(true);
    try {
      const names = await loadSystemFonts();
      setSystemFontItems(
        names.map((n) => ({
          id: customFontStack(n),
          label: n,
          style: { fontFamily: `"${n}", sans-serif` },
        })),
      );
      fontsLoadedRef.current = true;
    } finally {
      setLoadingFonts(false);
    }
  }

  // A list pick gives the row id (a stack); a custom commit gives null, so fall
  // back to the typed text. Empty text (cleared field) changes nothing.
  function selectFont(id: string | null) {
    if (id != null) {
      void changeFont(id);
      return;
    }
    const text = fontInput.trim();
    if (text) void changeFont(customFontStack(text));
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

  const primary: PrimaryColors = {
    light: settings.primaryLight ?? DEFAULT_PRIMARY.light,
    dark: settings.primaryDark ?? DEFAULT_PRIMARY.dark,
  };

  const cloudPreset = resolveCloudPreset(draft.musicCloudPreset);
  const costText =
    cloudPreset.estCostPerSongUsd == null
      ? t("settings.costUnknown")
      : t("settings.costHint", {
          song: `$${cloudPreset.estCostPerSongUsd.toFixed(3)}`,
          hourly: `$${continuousHourlyUsd(cloudPreset.estCostPerSongUsd).toFixed(2)}`,
        });

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col gap-4 overflow-y-auto px-4 pt-chrome-top pb-chrome-bottom lg:px-6">
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
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              {t("settings.primaryColor")}
            </span>
            <div className="flex flex-wrap gap-2">
              {PRIMARY_PRESETS.map((preset) => {
                const active =
                  primary.light === preset.colors.light && primary.dark === preset.colors.dark;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => void changePrimary(preset.colors)}
                    className={`flex items-center gap-2 rounded-full border py-1 pe-3 ps-1 text-xs transition-colors ${
                      active ? "border-primary bg-accent/50" : "border-input hover:bg-accent/50"
                    }`}
                  >
                    <span className="flex size-5 overflow-hidden rounded-full border border-border">
                      <span
                        className="h-full w-1/2"
                        style={{ backgroundColor: preset.colors.light }}
                      />
                      <span
                        className="h-full w-1/2"
                        style={{ backgroundColor: preset.colors.dark }}
                      />
                    </span>
                    {t(PRIMARY_PRESET_NAME_KEY[preset.id])}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">{t("settings.themeLight")}</span>
                <ColorPicker
                  label={t("settings.primaryColorLight")}
                  value={primary.light}
                  onChange={(hex) => void changePrimary({ ...primary, light: hex })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">{t("settings.themeDark")}</span>
                <ColorPicker
                  label={t("settings.primaryColorDark")}
                  value={primary.dark}
                  onChange={(hex) => void changePrimary({ ...primary, dark: hex })}
                />
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="ms-auto"
                onClick={() => void changePrimary(DEFAULT_PRIMARY)}
              >
                {t("settings.resetColors")}
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-muted-foreground">{t("settings.font")}</span>
            <div className="flex flex-wrap gap-2">
              {FONTS.map((font) => {
                const active = currentFont === font.stack;
                return (
                  <button
                    key={font.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => void changeFont(font.stack)}
                    style={{ fontFamily: font.stack }}
                    className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                      active ? "border-primary bg-accent/50" : "border-input hover:bg-accent/50"
                    }`}
                  >
                    {t(font.labelKey)}
                  </button>
                );
              })}
            </div>
            <Combobox
              label={t("settings.fontCustom")}
              items={fontItems}
              selectedKey={selectedFontKey}
              inputValue={fontInput}
              onInputChange={setFontInput}
              onSelectionChange={selectFont}
              onOpenChange={loadFontsOnce}
              allowsCustomValue
              placeholder={t("settings.fontSearchPlaceholder")}
              loadingText={t("settings.fontLoading")}
              emptyText={t("settings.fontNoResults")}
              isLoading={loadingFonts}
              inputStyle={fontInput.trim() ? { fontFamily: customFontStack(fontInput) } : undefined}
            />
          </div>
        </CardContent>
      </Card>

      <BackgroundSettings />

      <VisualizerSettings />

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
              {cloudPreset.usesModel && (
                <Field label={t("settings.modelOptional")}>
                  <Input
                    value={draft.musicCloudModel ?? ""}
                    onChange={(e) => patch({ musicCloudModel: e.target.value })}
                    placeholder={cloudPreset.defaults.model ?? "provider-specific model id"}
                  />
                </Field>
              )}
              {cloudPreset.usesModel && (
                <p className="text-xs text-muted-foreground">{t("settings.modelHint")}</p>
              )}
              <p className="text-xs text-muted-foreground">{costText}</p>
              {cloudPreset.docsUrl && (
                <a
                  href={cloudPreset.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex w-fit items-center gap-1 text-xs text-primary hover:underline"
                >
                  {t("settings.apiDocs")}
                  <ExternalLink className="size-3" />
                </a>
              )}
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
