import type { AppSettings } from "@/db/types";
import { createAceStepProvider } from "./acestep-local";
import { createMockMusicGenProvider } from "./mock-provider";
import type { MusicGenProvider } from "./provider";

export type MusicGenProviderId = "mock" | "acestep-local";

export const MUSICGEN_PROVIDER_IDS: MusicGenProviderId[] = ["mock", "acestep-local"];

/**
 * Resolve the active music-gen provider from on-device settings. Defaults to the
 * offline mock so the app is fully functional before the user wires up ACE-Step.
 */
export function resolveMusicGenProvider(settings: AppSettings): MusicGenProvider {
  switch (settings.musicGenProvider) {
    case "acestep-local":
      return createAceStepProvider({
        baseUrl: settings.aceStepUrl || "http://localhost:8085",
        synthModel: settings.aceStepSynthModel,
        lmModel: settings.aceStepLmModel,
      });
    default:
      return createMockMusicGenProvider();
  }
}
