import type { AppSettings } from "@/db/types";
import { createCloudMusicGenProvider } from "./cloud-provider";
import { createMockMusicGenProvider } from "./mock-provider";
import { resolveCloudPreset } from "./presets";
import { musicGenProviderPresetKey } from "./provenance";
import type { MusicGenProvider } from "./provider";

export type MusicGenProviderId = "mock" | "cloud";

export const MUSICGEN_PROVIDER_IDS: MusicGenProviderId[] = ["mock", "cloud"];

/**
 * Resolve the active music-gen provider from on-device settings. Defaults to the
 * offline mock so the app is fully functional before the user wires up a cloud
 * API key. The cloud provider is BYOK — its endpoint/key live only in IndexedDB.
 */
export function resolveMusicGenProvider(settings: AppSettings): MusicGenProvider {
  switch (settings.musicGenProvider) {
    case "cloud": {
      // A preset bakes in the vendor endpoint/auth/mappers; "custom" lets the
      // user supply the URL. We never branch on vendor outside this resolution.
      const preset = resolveCloudPreset(settings.musicCloudPreset);
      return createCloudMusicGenProvider(
        {
          baseUrl: preset.fixedEndpoint ? preset.defaults.baseUrl : (settings.musicCloudUrl ?? ""),
          apiKey: settings.musicCloudApiKey,
          model: settings.musicCloudModel ?? preset.defaults.model,
          createPath: preset.defaults.createPath,
          statusPath: preset.defaults.statusPath,
          authScheme: preset.authScheme,
          providerPreset: musicGenProviderPresetKey({
            provider: "cloud",
            cloudPreset: preset.id,
            model: settings.musicCloudModel ?? preset.defaults.model,
          }),
        },
        preset.mappers,
      );
    }
    default:
      return createMockMusicGenProvider();
  }
}
