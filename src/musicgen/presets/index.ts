/**
 * Cloud vendor presets. Every preset drives the SAME `cloud` provider and the
 * SAME submit→poll→download flow ({@link createCloudMusicGenProvider}); a preset
 * only carries the vendor-specific bits: endpoint defaults, auth scheme, and the
 * three pure mapper functions. This is how MUZERO supports multiple vendors
 * (ACE-Step, Mureka, …) without `if (vendor === …)` branches leaking into the
 * DJ / store / UI. The provider id stays the codename-stable "cloud".
 *
 * Phase 1 registers only "custom" (the generic BYOK endpoint). Later phases
 * append "ace-step" and "mureka" to {@link CLOUD_PRESETS}.
 */

import { type CloudMappers, mapBriefToBody, parseCreate, parseStatus } from "../cloud-provider";
import { aceStepPreset } from "./ace-step";
import { murekaPreset } from "./mureka";

export type CloudPresetId = "ace-step" | "mureka" | "custom";

export interface CloudPresetDefaults {
  /** Vendor base URL (used when {@link CloudPreset.fixedEndpoint} is true). */
  baseUrl: string;
  /** Path appended to baseUrl to create a job. */
  createPath: string;
  /** Path template to poll a job; "{id}" is replaced. */
  statusPath: string;
  /** Default model id the vendor expects, if any. */
  model?: string;
}

export interface CloudPreset {
  id: CloudPresetId;
  label: string;
  authScheme: "bearer" | "key";
  /**
   * Whether the endpoint is fixed by the preset (vendor URL baked in) vs.
   * supplied by the user. "custom" is the only user-supplied-endpoint preset.
   */
  fixedEndpoint: boolean;
  /** Approximate USD per generated song, for the Settings cost hint. Omit if unknown (custom). */
  estCostPerSongUsd?: number;
  defaults: CloudPresetDefaults;
  mappers: CloudMappers;
}

const customPreset: CloudPreset = {
  id: "custom",
  label: "Custom (BYOK endpoint)",
  authScheme: "bearer",
  fixedEndpoint: false,
  defaults: { baseUrl: "", createPath: "/music", statusPath: "/music/{id}" },
  mappers: { mapBriefToBody, parseCreate, parseStatus },
};

/** Registered presets. ace-step is the default; mureka is added in a later phase. */
export const CLOUD_PRESETS: Partial<Record<CloudPresetId, CloudPreset>> = {
  "ace-step": aceStepPreset,
  mureka: murekaPreset,
  custom: customPreset,
};

/** Ids in registration order, for Settings dropdowns. */
export const CLOUD_PRESET_IDS = Object.keys(CLOUD_PRESETS) as CloudPresetId[];

/** Resolve a preset, falling back to "custom" for undefined / unknown ids. */
export function resolveCloudPreset(id: CloudPresetId | undefined): CloudPreset {
  return (id && CLOUD_PRESETS[id]) || customPreset;
}

/** Rough continuous-generation cost: one new song roughly every 3 min ⇒ 20/hr. */
export function continuousHourlyUsd(perSongUsd: number, songsPerHour = 20): number {
  return perSongUsd * songsPerHour;
}
