import type { AppSettings } from "@/db/types";

export type BackgroundEffectSettings = Pick<
  AppSettings,
  | "backgroundBlur"
  | "backgroundAsciiColor"
  | "backgroundAsciiReplaceColor"
  | "backgroundCrtCurvature"
  | "backgroundCrtLineWidth"
  | "backgroundCrtLineContrast"
  | "backgroundCrtVerticalLine"
  | "backgroundCrtTime"
  | "backgroundCrtNoise"
  | "backgroundCrtNoiseSize"
  | "backgroundCrtSeed"
  | "backgroundCrtVignetting"
  | "backgroundCrtVignettingAlpha"
  | "backgroundCrtVignettingBlur"
  | "backgroundDotScale"
  | "backgroundDotAngle"
  | "backgroundDotGrayscale"
  | "backgroundNoiseAmount"
  | "backgroundNoiseSeed"
>;

export const BACKGROUND_EFFECT_DEFAULTS = {
  asciiColor: "#ffffff",
  asciiReplaceColor: false,
  crtCurvature: 0.54,
  crtLineWidth: 4,
  crtLineContrast: 1,
  crtVerticalLine: false,
  crtTime: 0,
  crtNoise: 0.44,
  crtNoiseSize: 1,
  crtSeed: 0.42,
  crtVignetting: 0.27,
  crtVignettingAlpha: 0.91,
  crtVignettingBlur: 0.62,
  dotAngle: 5,
  dotGrayscale: false,
  noiseAmount: 0.4,
  noiseSeed: 0.37,
} as const;

export function dotScaleDefault(pixelSize: number) {
  return Math.max(0.6, Math.max(4, Math.min(40, Math.round(pixelSize))) / 10);
}

export function resolvePixiBackgroundEffectOptions(
  settings: BackgroundEffectSettings,
  pixelSize: number,
) {
  const size = Math.max(4, Math.min(40, Math.round(pixelSize)));
  return {
    blur: {
      strength: Math.max(0, Math.min(80, Math.round(settings.backgroundBlur ?? 64))),
    },
    ascii: {
      color: settings.backgroundAsciiColor ?? BACKGROUND_EFFECT_DEFAULTS.asciiColor,
      replaceColor:
        settings.backgroundAsciiReplaceColor ?? BACKGROUND_EFFECT_DEFAULTS.asciiReplaceColor,
      size,
    },
    crt: {
      curvature: settings.backgroundCrtCurvature ?? BACKGROUND_EFFECT_DEFAULTS.crtCurvature,
      lineContrast:
        settings.backgroundCrtLineContrast ?? BACKGROUND_EFFECT_DEFAULTS.crtLineContrast,
      lineWidth: settings.backgroundCrtLineWidth ?? BACKGROUND_EFFECT_DEFAULTS.crtLineWidth,
      noise: settings.backgroundCrtNoise ?? BACKGROUND_EFFECT_DEFAULTS.crtNoise,
      noiseSize: settings.backgroundCrtNoiseSize ?? BACKGROUND_EFFECT_DEFAULTS.crtNoiseSize,
      seed: settings.backgroundCrtSeed ?? BACKGROUND_EFFECT_DEFAULTS.crtSeed,
      time: settings.backgroundCrtTime ?? BACKGROUND_EFFECT_DEFAULTS.crtTime,
      verticalLine:
        settings.backgroundCrtVerticalLine ?? BACKGROUND_EFFECT_DEFAULTS.crtVerticalLine,
      vignetting: settings.backgroundCrtVignetting ?? BACKGROUND_EFFECT_DEFAULTS.crtVignetting,
      vignettingAlpha:
        settings.backgroundCrtVignettingAlpha ?? BACKGROUND_EFFECT_DEFAULTS.crtVignettingAlpha,
      vignettingBlur:
        settings.backgroundCrtVignettingBlur ?? BACKGROUND_EFFECT_DEFAULTS.crtVignettingBlur,
    },
    dot: {
      angle: settings.backgroundDotAngle ?? BACKGROUND_EFFECT_DEFAULTS.dotAngle,
      grayscale: settings.backgroundDotGrayscale ?? BACKGROUND_EFFECT_DEFAULTS.dotGrayscale,
      scale: settings.backgroundDotScale ?? dotScaleDefault(size),
    },
    noise: {
      noise: settings.backgroundNoiseAmount ?? BACKGROUND_EFFECT_DEFAULTS.noiseAmount,
      seed: settings.backgroundNoiseSeed ?? BACKGROUND_EFFECT_DEFAULTS.noiseSeed,
    },
  };
}
