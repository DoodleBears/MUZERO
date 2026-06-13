import type { AppSettings } from "@/db/types";

/**
 * One-tap "quality" presets for the Performance pane: each bundles the cost
 * switches (background renderer, heavy layers, GPU power) into a battery →
 * balanced → full-quality gradient. We DERIVE the active preset from the current
 * settings (rather than storing a `graphicsQualityPreset` field), so tweaking any
 * switch — here or in the Background/Visualizer panes — naturally reads back as
 * "custom" with no field to keep in sync. The app defaults match "quality".
 * See the performance-settings-hub PRD (Phase 2).
 */
export type GraphicsQualityPreset = "battery" | "balanced" | "quality";
export type ActiveQualityPreset = GraphicsQualityPreset | "custom";

/** The settings fields a preset controls — also the fields matched to derive the active preset. */
type QualityBundle = Required<
  Pick<
    AppSettings,
    | "backgroundRenderer"
    | "visualizerAsBackground"
    | "flowEnabled"
    | "immersiveIdle"
    | "backgroundGpuPowerPreference"
    | "backgroundGpuBackend"
  >
>;

export const QUALITY_PRESET_BUNDLES: Record<GraphicsQualityPreset, QualityBundle> = {
  battery: {
    backgroundRenderer: "image",
    visualizerAsBackground: false,
    flowEnabled: false,
    immersiveIdle: false,
    backgroundGpuPowerPreference: "low-power",
    backgroundGpuBackend: "auto",
  },
  balanced: {
    backgroundRenderer: "blur",
    visualizerAsBackground: true,
    flowEnabled: false,
    immersiveIdle: true,
    backgroundGpuPowerPreference: "auto",
    backgroundGpuBackend: "auto",
  },
  quality: {
    backgroundRenderer: "noise",
    visualizerAsBackground: true,
    flowEnabled: true,
    immersiveIdle: true,
    backgroundGpuPowerPreference: "auto",
    backgroundGpuBackend: "auto",
  },
};

/** The effective values used both as defaults and to match settings against a bundle. */
const QUALITY_DEFAULTS: QualityBundle = QUALITY_PRESET_BUNDLES.quality;

export function resolveQualityPresetSettings(preset: GraphicsQualityPreset): QualityBundle {
  return { ...QUALITY_PRESET_BUNDLES[preset] };
}

export function matchActiveQualityPreset(settings: Partial<AppSettings>): ActiveQualityPreset {
  const effective: QualityBundle = {
    backgroundRenderer: settings.backgroundRenderer ?? QUALITY_DEFAULTS.backgroundRenderer,
    visualizerAsBackground:
      settings.visualizerAsBackground ?? QUALITY_DEFAULTS.visualizerAsBackground,
    flowEnabled: settings.flowEnabled ?? QUALITY_DEFAULTS.flowEnabled,
    immersiveIdle: settings.immersiveIdle ?? QUALITY_DEFAULTS.immersiveIdle,
    backgroundGpuPowerPreference:
      settings.backgroundGpuPowerPreference ?? QUALITY_DEFAULTS.backgroundGpuPowerPreference,
    backgroundGpuBackend: settings.backgroundGpuBackend ?? QUALITY_DEFAULTS.backgroundGpuBackend,
  };
  for (const preset of ["battery", "balanced", "quality"] as const) {
    const bundle = QUALITY_PRESET_BUNDLES[preset];
    if (
      effective.backgroundRenderer === bundle.backgroundRenderer &&
      effective.visualizerAsBackground === bundle.visualizerAsBackground &&
      effective.flowEnabled === bundle.flowEnabled &&
      effective.immersiveIdle === bundle.immersiveIdle &&
      effective.backgroundGpuPowerPreference === bundle.backgroundGpuPowerPreference &&
      effective.backgroundGpuBackend === bundle.backgroundGpuBackend
    ) {
      return preset;
    }
  }
  return "custom";
}
