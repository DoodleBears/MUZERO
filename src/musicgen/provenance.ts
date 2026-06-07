import type { AppSettings } from "@/db/types";
import type { TrackBrief } from "@/dj/dj-brief-schema";
import { resolveCloudPreset } from "./presets";
import type { MusicGenProvider } from "./provider";

export function musicGenProviderPresetKey(input: {
  provider: string;
  cloudPreset?: AppSettings["musicCloudPreset"];
  model?: string;
}): string | undefined {
  if (input.provider === "mock") return "mock";
  if (input.provider !== "cloud") return input.provider || undefined;
  const preset = resolveCloudPreset(input.cloudPreset);
  const model = input.model?.trim() || preset.defaults.model;
  return model ? `${preset.id}:${model}` : preset.id;
}

export function musicGenProviderPresetKeyFromSettings(settings: AppSettings): string | undefined {
  return musicGenProviderPresetKey({
    provider: settings.musicGenProvider,
    cloudPreset: settings.musicCloudPreset,
    model: settings.musicCloudModel,
  });
}

export function musicGenProviderPresetKeyFromProvider(
  provider: MusicGenProvider,
): string | undefined {
  return provider.providerPreset ?? musicGenProviderPresetKey({ provider: provider.id });
}

export function generatedTrackMemoryNote(input: {
  seedPrompt?: string;
  providerPreset?: string;
  brief: TrackBrief;
}): string | undefined {
  if (!input.providerPreset || input.providerPreset === "mock") return undefined;
  const bits = [`DJ generated${input.seedPrompt?.trim() ? ` for ${input.seedPrompt.trim()}` : ""}`];
  bits.push(input.providerPreset);
  const djNote = input.brief.djNote?.trim();
  if (djNote) bits.push(djNote);
  return bits.join(" · ");
}
