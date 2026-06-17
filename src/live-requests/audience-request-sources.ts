import { type AudienceRequestSource, DEFAULT_AUDIENCE_REQUEST_SOURCE } from "@/db/types";
import { getPresetMapping, type RequestMapping } from "./request-mapping-presets";

/**
 * Source resolution for the multi-source intake. Pure helpers over the persisted
 * `AudienceRequestIntakeSettings.sources` list — no DB / bridge access.
 */

export const DEFAULT_SOURCE_ID = "default";

/** Configured sources, backfilling the built-in default when none are set. */
export function resolveSources(
  sources: AudienceRequestSource[] | undefined,
): AudienceRequestSource[] {
  return sources && sources.length > 0 ? sources : [DEFAULT_AUDIENCE_REQUEST_SOURCE];
}

/** The source for an incoming `sourceId` (absent/empty → the default source). */
export function findSource(
  sources: AudienceRequestSource[],
  sourceId: string | undefined,
): AudienceRequestSource | undefined {
  const id = sourceId && sourceId.length > 0 ? sourceId : DEFAULT_SOURCE_ID;
  return sources.find((source) => source.id === id);
}

/** The mapping a source applies: `auto` → null (heuristic), `custom` → its own, else the preset. */
export function resolveSourceMapping(source: AudienceRequestSource): RequestMapping | null {
  if (source.mappingPreset === "custom") return source.mapping ?? null;
  return getPresetMapping(source.mappingPreset);
}
