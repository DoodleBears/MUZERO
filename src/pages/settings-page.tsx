import { useLiveQuery } from "dexie-react-hooks";
import {
  CheckCircle2,
  ClipboardCopy,
  Cloud,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserRound,
  XCircle,
} from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AddDriveDialog } from "@/components/settings/add-drive-dialog";
import { BackgroundSettings } from "@/components/settings/background-settings";
import { CloudDriveSets } from "@/components/settings/cloud-drive-sets";
import { ImportedFoldersSettings } from "@/components/settings/imported-folders-settings";
import { LyricsSettings } from "@/components/settings/lyrics-settings";
import { resolveActiveSettingsItem } from "@/components/settings/settings-nav";
import { SettingsSidebar } from "@/components/settings/settings-sidebar";
import { ShortcutsSettings } from "@/components/settings/shortcuts-settings";
import { StreamSourcesSettings } from "@/components/settings/stream-sources-settings";
import { VisualizerSettings } from "@/components/settings/visualizer-settings";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ColorPicker } from "@/components/ui/color-picker";
import { Combobox, type ComboboxItem } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { db } from "@/db/muzero-db";
import { saveSettings } from "@/db/repositories";
import type { AppSettings, CloudDrive, LlmProviderId } from "@/db/types";
import { useSettings } from "@/hooks/use-app-data";
import { type Locale, locales, persistLocale } from "@/i18n/config";
import { hasStreamingSources } from "@/lib/desktop/bridge";
import { useSmoothScroll } from "@/lib/smooth-scroll/use-smooth-scroll";
import { clearTrace, formatTraceEntries, useTraceEntries } from "@/lib/trace";
import { formatDuration } from "@/lib/utils";
import {
  CLOUD_PRESET_IDS,
  type CloudPresetId,
  continuousHourlyUsd,
  resolveCloudPreset,
} from "@/musicgen/presets";
import { type MusicGenProviderId, resolveMusicGenProvider } from "@/musicgen/registry";
import { useNavStore } from "@/stores/nav-store";
import { usePlayerStore } from "@/stores/player-store";
import { useSyncStore } from "@/stores/sync-store";
import { listCloudDrives } from "@/sync/cloud-drive-repo";
import {
  getLocalDevice,
  getOrCreateLocalDevice,
  updateLocalDeviceProfile,
} from "@/sync/device-repo";
import { summarizePlaybackAggregates } from "@/sync/playback-aggregate-summary";
import { summarizePlaybackSyncState } from "@/sync/playback-sync-summary";
import { buildRecommendedR2Cors } from "@/sync/r2-healthcheck";
import type { SyncPhase, SyncProgress } from "@/sync/sync-orchestrator";
import {
  type SyncProgressPhase,
  type SyncProgressSummary,
  summarizeSyncRunProgress,
} from "@/sync/sync-progress-summary";
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

const CLOUD_SETUP_KEYS = [
  "settings.cloudSetupAccount",
  "settings.cloudSetupBucket",
  "settings.cloudSetupPublicUrl",
  "settings.cloudSetupCors",
  "settings.cloudSetupCredentials",
] as const;

const CLOUD_DRIVE_KIND_LABEL_KEY = {
  owned: "settings.cloudDriveKind.owned",
  trusted: "settings.cloudDriveKind.trusted",
  shared: "settings.cloudDriveKind.shared",
  "local-only": "settings.cloudDriveKind.local-only",
} as const satisfies Record<CloudDrive["kind"], string>;

const SYNC_PROGRESS_PHASE_LABEL_KEY = {
  preparing: "settings.cloudSyncPhasePreparing",
  uploading: "settings.cloudSyncPhaseUploading",
  downloading: "settings.cloudSyncPhaseDownloading",
  completed: "settings.cloudSyncPhaseCompleted",
  failed: "settings.cloudSyncPhaseFailed",
  cancelled: "settings.cloudSyncPhaseCancelled",
} as const satisfies Record<SyncProgressPhase, string>;

/** Phase labels for the live (ephemeral) per-drive run from `useSyncStore`. */
const EPHEMERAL_SYNC_PHASE_LABEL_KEY = {
  planning: "settings.cloudSyncPhasePreparing",
  uploading: "settings.cloudSyncPhaseUploading",
  downloading: "settings.cloudSyncPhaseDownloading",
  applying: "settings.cloudSyncPhaseApplying",
  completed: "settings.cloudSyncPhaseCompleted",
  failed: "settings.cloudSyncPhaseFailed",
  cancelled: "settings.cloudSyncPhaseCancelled",
  "needs-review": "settings.cloudSyncPhaseNeedsReview",
} as const satisfies Record<SyncPhase, string>;

/** Phases where a run is still in flight and can be cancelled. */
const RUNNING_SYNC_PHASES = new Set<SyncPhase>([
  "planning",
  "uploading",
  "downloading",
  "applying",
]);

/** On-device, BYOK settings. Nothing here is ever sent anywhere but the model/API you point it at. */
export function SettingsPage() {
  const { t, i18n } = useTranslation();
  const settings = useSettings();
  // Two independently scrolling columns — each opts into smooth scrolling.
  const navScrollRef = useRef<HTMLDivElement | null>(null);
  const contentScrollRef = useRef<HTMLDivElement | null>(null);
  useSmoothScroll(navScrollRef);
  useSmoothScroll(contentScrollRef);
  const cloudDrives = useLiveQuery(() => listCloudDrives(), [], []);
  const latestSyncRun = useLiveQuery(() => db.syncRuns.orderBy("startedAt").last(), [], undefined);
  const localDevice = useLiveQuery(() => getLocalDevice(), [], undefined);
  const playbackAggregateRows = useLiveQuery(
    () => db.playbackAggregates.where("scope").equals("track").toArray(),
    [],
    [],
  );
  const playbackEventRows = useLiveQuery(
    () =>
      localDevice
        ? db.playbackEvents.where("devicePublicId").equals(localDevice.publicId).toArray()
        : [],
    [localDevice?.publicId],
    [],
  );
  const statsSyncObjects = useLiveQuery(
    () => db.syncObjects.where("kind").anyOf("stats-events-segment", "stats-checkpoint").toArray(),
    [],
    [],
  );
  const rebuildEngine = usePlayerStore((s) => s.rebuildEngine);
  const setSettingsItem = useNavStore((s) => s.setSettingsItem);
  const activeItem = resolveActiveSettingsItem(useNavStore((s) => s.settingsItem));
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [saved, setSaved] = useState(false);
  const [health, setHealth] = useState<"unknown" | "ok" | "down" | "checking">("unknown");
  const [addDriveOpen, setAddDriveOpen] = useState(false);
  const [corsCopied, setCorsCopied] = useState(false);
  // Font picker: the combobox input text, plus lazily-loaded system fonts.
  const [fontInput, setFontInput] = useState("");
  const [systemFontItems, setSystemFontItems] = useState<ComboboxItem[]>([]);
  const [loadingFonts, setLoadingFonts] = useState(false);
  const fontsLoadedRef = useRef(false);
  const [deviceName, setDeviceName] = useState("");
  const [deviceAvatarSeed, setDeviceAvatarSeed] = useState("");
  const [devicePublishProfile, setDevicePublishProfile] = useState(false);
  const [deviceSaved, setDeviceSaved] = useState(false);

  // Keep the local draft in sync once the persisted settings load.
  useEffect(() => setDraft(settings), [settings]);
  useEffect(() => {
    void getOrCreateLocalDevice();
  }, []);
  useEffect(() => {
    if (!localDevice) return;
    setDeviceName(localDevice.name);
    setDeviceAvatarSeed(localDevice.avatarSeed ?? localDevice.publicId);
    setDevicePublishProfile(localDevice.publishProfile);
  }, [localDevice]);

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

  async function saveDeviceProfile() {
    const updated = await updateLocalDeviceProfile({
      name: deviceName,
      avatarSeed: deviceAvatarSeed,
      publishProfile: devicePublishProfile,
    });
    setDeviceName(updated.name);
    setDeviceAvatarSeed(updated.avatarSeed ?? updated.publicId);
    setDevicePublishProfile(updated.publishProfile);
    setDeviceSaved(true);
  }

  async function checkCloud() {
    setHealth("checking");
    const provider = resolveMusicGenProvider({ ...draft, musicGenProvider: "cloud" });
    const ok = (await provider.health?.()) ?? false;
    setHealth(ok ? "ok" : "down");
  }

  async function copyCorsJson() {
    if (!navigator.clipboard) return;
    await navigator.clipboard.writeText(corsJson);
    setCorsCopied(true);
    window.setTimeout(() => setCorsCopied(false), 1600);
  }

  async function changePresenceEnabled(enabled: boolean) {
    patch({ presenceEnabled: enabled });
    await saveSettings({ presenceEnabled: enabled });
  }

  async function changeAutoFetchLyrics(enabled: boolean) {
    await saveSettings({ autoFetchLyrics: enabled });
  }

  async function changeLyricsProvider(id: AppSettings["lyricsProviderId"]) {
    await saveSettings({ lyricsProviderId: id });
  }

  const primary: PrimaryColors = {
    light: settings.primaryLight ?? DEFAULT_PRIMARY.light,
    dark: settings.primaryDark ?? DEFAULT_PRIMARY.dark,
  };

  const corsJson = useMemo(
    () => JSON.stringify(buildRecommendedR2Cors(browserOrigin()), null, 2),
    [],
  );

  const cloudPreset = resolveCloudPreset(draft.musicCloudPreset);
  const syncProgress = latestSyncRun ? summarizeSyncRunProgress(latestSyncRun) : undefined;
  const playbackSummary = useMemo(
    () => summarizePlaybackAggregates(playbackAggregateRows ?? [], { scope: "track" }),
    [playbackAggregateRows],
  );
  const playbackSyncSummary = useMemo(
    () =>
      summarizePlaybackSyncState({
        devicePublicId: localDevice?.publicId,
        events: playbackEventRows ?? [],
        aggregates: playbackAggregateRows ?? [],
        syncObjects: statsSyncObjects ?? [],
      }),
    [localDevice?.publicId, playbackAggregateRows, playbackEventRows, statsSyncObjects],
  );
  const costText =
    cloudPreset.estCostPerSongUsd == null
      ? t("settings.costUnknown")
      : t("settings.costHint", {
          song: `$${cloudPreset.estCostPerSongUsd.toFixed(3)}`,
          hourly: `$${continuousHourlyUsd(cloudPreset.estCostPerSongUsd).toFixed(2)}`,
        });

  return (
    <div className="h-full w-full overflow-hidden">
      <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-2 px-4 md:flex-row md:gap-6 lg:px-6">
        {/* Left and right columns scroll independently (each owns its overflow). */}
        <div
          ref={navScrollRef}
          className="no-scrollbar shrink-0 overflow-y-auto pt-chrome-top md:w-52 md:pb-chrome-bottom"
        >
          <SettingsSidebar active={activeItem} onSelect={setSettingsItem} />
        </div>
        <div
          ref={contentScrollRef}
          className="no-scrollbar flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto pb-chrome-bottom md:pt-chrome-top"
        >
          {activeItem === "appearance" && (
            <Card>
              <CardHeader>
                <CardTitle>{t("settings.appearance")}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <Field label={t("settings.theme")}>
                  <Select
                    value={settings.theme ?? DEFAULT_THEME}
                    onValueChange={(value) => void changeTheme(value as Theme)}
                  >
                    <SelectTrigger>
                      <SelectValue>
                        {(value) =>
                          t(
                            themes.find((theme) => theme.value === value)?.labelKey ??
                              "settings.theme",
                          )
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {themes.map(({ value, labelKey }) => (
                        <SelectItem key={value} value={value}>
                          {t(labelKey)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label={t("settings.language")}>
                  <Select
                    value={i18n.language}
                    onValueChange={(value) => void changeLanguage(value as Locale)}
                  >
                    <SelectTrigger>
                      <SelectValue>
                        {(value) =>
                          locales.find((locale) => locale.code === value)?.label ??
                          t("settings.language")
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {locales.map(({ code, label }) => (
                        <SelectItem key={code} value={code}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    {t("settings.primaryColor")}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {PRIMARY_PRESETS.map((preset) => {
                      const active =
                        primary.light === preset.colors.light &&
                        primary.dark === preset.colors.dark;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          aria-pressed={active}
                          onClick={() => void changePrimary(preset.colors)}
                          className={`flex items-center gap-2 rounded-full border py-1 pe-3 ps-1 text-xs transition-colors ${
                            active
                              ? "border-primary bg-accent/50"
                              : "border-input hover:bg-accent/50"
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
                      <span className="text-xs text-muted-foreground">
                        {t("settings.themeLight")}
                      </span>
                      <ColorPicker
                        label={t("settings.primaryColorLight")}
                        value={primary.light}
                        onChange={(hex) => void changePrimary({ ...primary, light: hex })}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <span className="text-xs text-muted-foreground">
                        {t("settings.themeDark")}
                      </span>
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
                  <span className="text-xs font-medium text-muted-foreground">
                    {t("settings.font")}
                  </span>
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
                            active
                              ? "border-primary bg-accent/50"
                              : "border-input hover:bg-accent/50"
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
                    inputStyle={
                      fontInput.trim() ? { fontFamily: customFontStack(fontInput) } : undefined
                    }
                  />
                </div>
                <label className="flex items-start gap-3 rounded-md border border-border p-3">
                  <input
                    type="checkbox"
                    checked={settings.autoFetchLyrics ?? true}
                    onChange={(event) => void changeAutoFetchLyrics(event.currentTarget.checked)}
                    className="mt-1 size-4 accent-primary"
                  />
                  <span className="flex flex-col gap-1">
                    <span className="font-medium text-sm">{t("settings.autoFetchLyrics")}</span>
                    <span className="text-muted-foreground text-xs">
                      {t("settings.autoFetchLyricsHint")}
                    </span>
                  </span>
                </label>
                {hasStreamingSources() && (
                  <label className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
                    <span className="flex flex-col gap-1">
                      <span className="font-medium text-sm">{t("settings.lyricsSource")}</span>
                      <span className="text-muted-foreground text-xs">
                        {t("settings.lyricsSourceHint")}
                      </span>
                    </span>
                    <select
                      value={settings.lyricsProviderId ?? "lrclib"}
                      onChange={(event) =>
                        void changeLyricsProvider(
                          event.currentTarget.value as AppSettings["lyricsProviderId"],
                        )
                      }
                      className="shrink-0 rounded-md border border-border bg-transparent px-2 py-1.5 text-foreground text-sm"
                    >
                      <option value="lrclib">{t("settings.lyricsSourceLrclib")}</option>
                      <option value="netease">{t("settings.lyricsSourceNetease")}</option>
                    </select>
                  </label>
                )}
              </CardContent>
            </Card>
          )}

          {activeItem === "shortcuts" && <ShortcutsSettings />}

          {activeItem === "background" && <BackgroundSettings />}

          {activeItem === "visualizer" && <VisualizerSettings />}

          {activeItem === "lyrics" && <LyricsSettings />}
          {activeItem === "stream-sources" && <StreamSourcesSettings />}

          {activeItem === "advanced" && <TraceDiagnostics />}

          {activeItem === "device" && (
            <Card>
              <CardHeader>
                <CardTitle>{t("settings.deviceTitle")}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <div
                    className="grid size-14 shrink-0 place-items-center rounded-md text-white shadow-sm"
                    style={deviceAvatarStyle(deviceAvatarSeed || localDevice?.publicId)}
                  >
                    <UserRound className="size-7" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-sm">
                      {localDevice?.name ?? t("settings.devicePending")}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {t("settings.deviceMeta", {
                        publicId: localDevice?.publicId ?? "pending",
                        revision: localDevice?.profileRevision ?? 0,
                      })}
                    </p>
                  </div>
                </div>

                <div className="grid gap-2 rounded-md border border-border bg-muted/25 p-3 text-xs sm:grid-cols-2">
                  <div>
                    <p className="text-muted-foreground">{t("settings.deviceTotalPlays")}</p>
                    <p className="font-medium text-sm">{playbackSummary.playCount}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{t("settings.deviceListenedTime")}</p>
                    <p className="font-medium text-sm">
                      {formatDuration(playbackSummary.listenedSec)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{t("settings.devicePendingListens")}</p>
                    <p className="font-medium text-sm">
                      {playbackSyncSummary.pendingEventCount} ·{" "}
                      {formatDuration(playbackSyncSummary.pendingListenedSec)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{t("settings.deviceUploadedSegments")}</p>
                    <p className="font-medium text-sm">
                      {playbackSyncSummary.uploadedSegmentCount}
                    </p>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={t("settings.deviceName")}>
                    <Input
                      value={deviceName}
                      onChange={(event) => {
                        setDeviceName(event.target.value);
                        setDeviceSaved(false);
                      }}
                      placeholder={t("settings.deviceNamePlaceholder")}
                    />
                  </Field>
                  <Field label={t("settings.deviceAvatarSeed")}>
                    <div className="flex gap-2">
                      <Input
                        value={deviceAvatarSeed}
                        onChange={(event) => {
                          setDeviceAvatarSeed(event.target.value);
                          setDeviceSaved(false);
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label={t("settings.deviceAvatarRandomize")}
                        onClick={() => {
                          setDeviceAvatarSeed(randomAvatarSeed());
                          setDeviceSaved(false);
                        }}
                      >
                        <RefreshCw />
                      </Button>
                    </div>
                  </Field>
                </div>

                <label className="flex items-start gap-3 rounded-md border border-border p-3">
                  <input
                    type="checkbox"
                    checked={devicePublishProfile}
                    onChange={(event) => {
                      setDevicePublishProfile(event.currentTarget.checked);
                      setDeviceSaved(false);
                    }}
                    className="mt-1 size-4 accent-primary"
                  />
                  <span className="flex flex-col gap-1">
                    <span className="font-medium text-sm">
                      {t("settings.deviceProfilePublish")}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {t("settings.deviceProfilePublishHint")}
                    </span>
                  </span>
                </label>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={!localDevice || !deviceName.trim()}
                    onClick={() => void saveDeviceProfile()}
                  >
                    <UserRound />
                    {t("settings.deviceProfileSave")}
                  </Button>
                  {deviceSaved && (
                    <span className="text-muted-foreground text-xs">
                      {t("settings.deviceProfileSaved")}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {activeItem === "device" && <ImportedFoldersSettings />}

          {activeItem === "playback-dj" && (
            <Card>
              <CardHeader>
                <CardTitle>{t("settings.djTitle")}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <Field label={t("settings.provider")}>
                  <Select
                    value={draft.llmProvider}
                    onValueChange={(value) => patch({ llmProvider: value as LlmProviderId })}
                  >
                    <SelectTrigger>
                      <SelectValue>
                        {(value) =>
                          value === "anthropic" ? "Anthropic" : value === "openai" ? "OpenAI" : ""
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="openai">OpenAI</SelectItem>
                      <SelectItem value="anthropic">Anthropic</SelectItem>
                    </SelectContent>
                  </Select>
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
          )}

          {activeItem === "playback-music" && (
            <Card>
              <CardHeader>
                <CardTitle>{t("settings.musicTitle")}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <Field label={t("settings.provider")}>
                  <Select
                    value={draft.musicGenProvider}
                    onValueChange={(value) =>
                      patch({ musicGenProvider: value as MusicGenProviderId })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue>
                        {(value) =>
                          value === "cloud"
                            ? t("settings.providerCloud")
                            : value === "mock"
                              ? t("settings.providerMock")
                              : ""
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mock">{t("settings.providerMock")}</SelectItem>
                      <SelectItem value="cloud">{t("settings.providerCloud")}</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                {draft.musicGenProvider === "cloud" && (
                  <>
                    <Field label={t("settings.preset")}>
                      <Select
                        value={draft.musicCloudPreset ?? "mureka"}
                        onValueChange={(value) =>
                          patch({ musicCloudPreset: value as CloudPresetId })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue>
                            {(value) =>
                              t(
                                PRESET_LABEL_KEY[value as CloudPresetId] ??
                                  PRESET_LABEL_KEY[cloudPreset.id],
                              )
                            }
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {CLOUD_PRESET_IDS.map((id) => (
                            <SelectItem key={id} value={id}>
                              {t(PRESET_LABEL_KEY[id])}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
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
                        <span className="text-xs text-muted-foreground">
                          {t("settings.checking")}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{t("settings.cloudNote")}</p>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {activeItem.startsWith("cloud-") && (
            <Card>
              <CardHeader>
                <CardTitle>{t("settings.cloudDriveTitle")}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {activeItem === "cloud-owner" && (
                  <div className="rounded-md border border-border bg-muted/25 p-3">
                    <p className="font-medium text-sm">{t("settings.cloudSetupTitle")}</p>
                    <div className="mt-2 grid gap-2 text-muted-foreground text-xs sm:grid-cols-2">
                      {CLOUD_SETUP_KEYS.map((key) => (
                        <div key={key} className="flex items-center gap-2">
                          <CheckCircle2 className="size-3.5 text-primary" />
                          <span>{t(key)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {activeItem === "cloud-owner" && cloudDrives.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <p className="font-medium text-sm">{t("settings.cloudConnectedDrives")}</p>
                    {cloudDrives.map((drive) => (
                      <CloudDriveRow
                        key={drive.id}
                        drive={drive}
                        defaultDriveId={settings.defaultCloudDriveId}
                      />
                    ))}
                  </div>
                )}

                {activeItem === "cloud-sync" && syncProgress && (
                  <CloudSyncProgress progress={syncProgress} />
                )}

                {activeItem === "cloud-sync" && (
                  <div className="rounded-md border border-border p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-sm">{t("settings.cloudCorsTitle")}</p>
                        <p className="text-muted-foreground text-xs">
                          {t("settings.cloudCorsHint")}
                        </p>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => void copyCorsJson()}>
                        <ClipboardCopy />
                        {corsCopied ? t("settings.cloudCorsCopied") : t("settings.cloudCorsCopy")}
                      </Button>
                    </div>
                    <pre className="mt-3 max-h-44 overflow-auto rounded-md bg-muted p-3 text-[11px] leading-5 text-muted-foreground">
                      {corsJson}
                    </pre>
                  </div>
                )}

                {activeItem === "cloud-presence" && (
                  <div className="rounded-md border border-border p-3">
                    <label className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={draft.presenceEnabled ?? false}
                        onChange={(event) =>
                          void changePresenceEnabled(event.currentTarget.checked)
                        }
                        className="mt-1 size-4 accent-primary"
                      />
                      <span className="flex flex-col gap-1">
                        <span className="font-medium text-sm">
                          {t("settings.cloudPresenceTitle")}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {t("settings.cloudPresenceHint")}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {t("settings.cloudPresenceCost")}
                        </span>
                      </span>
                    </label>
                  </div>
                )}

                {activeItem === "cloud-owner" && (
                  <>
                    <div className="rounded-md border border-border p-3">
                      <div className="mb-2 flex items-center gap-2">
                        <ShieldCheck className="size-4 text-primary" />
                        <p className="font-medium text-sm">{t("settings.cloudOwnerTitle")}</p>
                      </div>
                      <p className="mb-3 text-muted-foreground text-xs">
                        {t("settings.cloudOwnerSimplifiedHint")}
                      </p>
                      <Button size="sm" onClick={() => setAddDriveOpen(true)}>
                        <Cloud />
                        {t("settings.addDrive")}
                      </Button>
                    </div>
                    <AddDriveDialog
                      open={addDriveOpen}
                      onOpenChange={setAddDriveOpen}
                      settings={settings}
                    />
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {(activeItem === "playback-dj" || activeItem === "playback-music") && (
            <div className="flex items-center gap-3">
              <Button onClick={() => void save()}>{t("settings.save")}</Button>
              {saved && (
                <span className="text-sm text-muted-foreground">{t("settings.saved")}</span>
              )}
            </div>
          )}
          <p className="pb-4 text-xs text-muted-foreground">{t("settings.localNote")}</p>
        </div>
      </div>
    </div>
  );
}

function TraceDiagnostics() {
  const { t } = useTranslation();
  const entries = useTraceEntries();
  const [copied, setCopied] = useState(false);
  const visible = entries.slice(-120);
  const visibleText = formatTraceEntries(visible);
  const allText = formatTraceEntries(entries);

  async function copyTrace() {
    if (!navigator.clipboard) return;
    await navigator.clipboard.writeText(allText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <CardTitle>{t("settings.traceTitle")}</CardTitle>
          <p className="text-muted-foreground text-sm">{t("settings.traceHint")}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={entries.length === 0}
            onClick={() => void copyTrace()}
          >
            <ClipboardCopy />
            {copied ? t("settings.traceCopied") : t("settings.traceCopy")}
          </Button>
          <Button variant="ghost" size="sm" disabled={entries.length === 0} onClick={clearTrace}>
            <Trash2 />
            {t("settings.traceClear")}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <pre className="max-h-72 overflow-auto rounded-lg bg-muted p-3 text-[11px] leading-5 text-muted-foreground">
          {visibleText || t("settings.traceEmpty")}
        </pre>
      </CardContent>
    </Card>
  );
}

function CloudDriveRow({ drive, defaultDriveId }: { drive: CloudDrive; defaultDriveId?: string }) {
  const { t } = useTranslation();
  // Minimal selector: only this drive's live progress (PRD §6 selector discipline).
  const progress = useSyncStore((state) => state.progressByDrive[drive.id]);
  const running = progress ? RUNNING_SYNC_PHASES.has(progress.phase) : false;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-background/80 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm">{drive.label}</p>
          <p className="text-muted-foreground text-xs">
            {t("settings.cloudDriveMeta", {
              kind: t(CLOUD_DRIVE_KIND_LABEL_KEY[drive.kind]),
              host: drive.manifestUrl ? sourceHost(drive.manifestUrl) : drive.provider,
            })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-muted-foreground text-xs">
          {drive.id === defaultDriveId && <span>{t("settings.cloudDefaultDrive")}</span>}
          {drive.capabilities.write ? (
            <ShieldCheck className="size-4" />
          ) : (
            <Cloud className="size-4" />
          )}
          {drive.capabilities.write &&
            (running ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => useSyncStore.getState().cancel(drive.id)}
              >
                {t("settings.cloudSyncCancel")}
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void useSyncStore.getState().publishDrive(drive.id)}
              >
                <Cloud />
                {t("settings.cloudSyncNow")}
              </Button>
            ))}
        </div>
      </div>
      {progress && <CloudDriveLiveProgress progress={progress} />}
      <CloudDriveSets drive={drive} />
    </div>
  );
}

function CloudDriveLiveProgress({ progress }: { progress: SyncProgress }) {
  const { t } = useTranslation();
  const percent =
    progress.bytesTotal > 0 ? Math.round((progress.bytesDone / progress.bytesTotal) * 100) : 0;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
      <span className="font-medium">{t(EPHEMERAL_SYNC_PHASE_LABEL_KEY[progress.phase])}</span>
      <span>
        {t("settings.cloudSyncObjects", {
          done: progress.objectsDone,
          total: progress.objectsTotal,
        })}
      </span>
      {progress.bytesTotal > 0 && <span>{percent}%</span>}
      {progress.error && <span className="text-destructive">{progress.error}</span>}
    </div>
  );
}

function CloudSyncProgress({ progress }: { progress: SyncProgressSummary }) {
  const { t } = useTranslation();
  const percent = Math.round(progress.byteRatio * 100);
  return (
    <div className="rounded-md border border-border bg-muted/25 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium text-sm">{t("settings.cloudSyncProgressTitle")}</p>
          <p className="text-muted-foreground text-xs">
            {t(SYNC_PROGRESS_PHASE_LABEL_KEY[progress.currentPhase])}
          </p>
        </div>
        <span className="font-medium text-muted-foreground text-xs">{percent}%</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-background">
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="mt-3 grid gap-2 text-muted-foreground text-xs sm:grid-cols-3">
        <span>
          {t("settings.cloudSyncObjects", {
            done: progress.objectsDone,
            total: progress.objectCount,
          })}
        </span>
        <span>
          {t("settings.cloudSyncBytes", {
            done: formatBytes(progress.bytesDone),
            total: formatBytes(progress.totalBytes),
          })}
        </span>
        <span>{t("settings.cloudSyncFailures", { count: progress.failed })}</span>
      </div>
      {progress.error && <p className="mt-2 text-destructive text-xs">{progress.error}</p>}
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

function browserOrigin(): string {
  return globalThis.location?.origin ?? "http://localhost:1420";
}

function deviceAvatarStyle(seed?: string): CSSProperties {
  const hash = hashString(seed || "muzero");
  const hue = hash % 360;
  return {
    background: `linear-gradient(135deg, hsl(${hue} 72% 48%), hsl(${(hue + 78) % 360} 74% 42%))`,
  };
}

function randomAvatarSeed(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function sourceHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  for (const unit of units) {
    if (value < 1024) return `${value.toFixed(value < 10 ? 1 : 0)} ${unit}`;
    value /= 1024;
  }
  return `${value.toFixed(0)} PB`;
}
