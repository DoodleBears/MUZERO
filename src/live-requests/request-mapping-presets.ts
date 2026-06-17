import { applyTemplateString } from "./request-template";

/**
 * Field-mapping presets for the multi-source intake. A mapping is a set of
 * template strings (see {@link applyTemplateString}) that turn an arbitrary
 * incoming JSON body into MUZERO's request fields. `auto` keeps the legacy
 * candidate-key heuristic in `normalizeAudienceRequest` (zero-config, backward
 * compatible); `custom` carries the user's own templates on the source.
 *
 * The output of {@link applyMapping} is keyed to match the candidate keys that
 * `normalizeAudienceRequest` already probes (`message` / `username` / `platform`
 * / `role` / `id`), so the rest of the pipeline (prefix stripping, requester
 * key, dedupe) is unchanged.
 */

export type MappingPresetId = "auto" | "social-stream-ninja" | "generic-json" | "custom";
type BuiltinPresetId = "social-stream-ninja" | "generic-json";

export interface RequestMapping {
  /** Required — resolves to the song/request query (before command-prefix strip). */
  query: string;
  requester?: string;
  platform?: string;
  role?: string;
  externalId?: string;
}

export const REQUEST_TARGET_FIELDS = [
  { key: "query", required: true },
  { key: "requester", required: false },
  { key: "platform", required: false },
  { key: "role", required: false },
  { key: "externalId", required: false },
] as const satisfies ReadonlyArray<{ key: keyof RequestMapping; required: boolean }>;

export const REQUEST_MAPPING_PRESETS: Record<BuiltinPresetId, RequestMapping> = {
  // Reads the same fields whether the body is an SSN "Call Webhook" payload or a
  // public WS channel-4 event (both carry chatmessage/chatname/type) — so the
  // websocket path needs no remap, just this preset.
  "social-stream-ninja": {
    query: "{{ payload.chatmessage || payload.textContent }}",
    requester: "{{ payload.chatname || payload.userid || 'viewer' }}",
    platform: "{{ payload.type || payload.platform || 'stream' }}",
    externalId: "{{ payload.id }}",
  },
  "generic-json": {
    query: "{{ payload.message || payload.text }}",
    requester: "{{ payload.username }}",
    platform: "{{ payload.platform }}",
    externalId: "{{ payload.messageId || payload.id }}",
  },
};

export function getPresetMapping(id: MappingPresetId): RequestMapping | null {
  if (id === "auto" || id === "custom") return null;
  return REQUEST_MAPPING_PRESETS[id];
}

function toField(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return text.length > 0 ? text : undefined;
}

/**
 * Evaluate a mapping against a payload, producing an object keyed for
 * `normalizeAudienceRequest`. `query` is always present (possibly empty — an
 * empty query is later ignored); other fields are omitted when they resolve to
 * empty so the normalizer's own fallbacks still apply.
 */
export function applyMapping(
  payload: Record<string, unknown>,
  mapping: RequestMapping,
): Record<string, unknown> {
  const ctx = { payload };
  const out: Record<string, unknown> = {
    message: toField(applyTemplateString(mapping.query, ctx)) ?? "",
  };
  const username = mapping.requester && toField(applyTemplateString(mapping.requester, ctx));
  if (username) out.username = username;
  const platform = mapping.platform && toField(applyTemplateString(mapping.platform, ctx));
  if (platform) out.platform = platform;
  const role = mapping.role && toField(applyTemplateString(mapping.role, ctx));
  if (role) out.role = role;
  const externalId = mapping.externalId && toField(applyTemplateString(mapping.externalId, ctx));
  if (externalId) out.id = externalId;
  return out;
}

export type RequestMappingFieldValues = Record<keyof RequestMapping, string>;

/** Mapping → a full string-keyed record for the visual editor (missing → ""). */
export function mappingToFieldValues(mapping: RequestMapping | null): RequestMappingFieldValues {
  return {
    query: mapping?.query ?? "",
    requester: mapping?.requester ?? "",
    platform: mapping?.platform ?? "",
    role: mapping?.role ?? "",
    externalId: mapping?.externalId ?? "",
  };
}

/** Visual-editor values → a mapping, dropping empty optional fields (query kept). */
export function fieldValuesToMapping(values: RequestMappingFieldValues): RequestMapping {
  const mapping: RequestMapping = { query: values.query.trim() };
  if (values.requester.trim()) mapping.requester = values.requester.trim();
  if (values.platform.trim()) mapping.platform = values.platform.trim();
  if (values.role.trim()) mapping.role = values.role.trim();
  if (values.externalId.trim()) mapping.externalId = values.externalId.trim();
  return mapping;
}

/** Which built-in preset a mapping matches exactly, else `"custom"`. */
export function detectPresetId(mapping: RequestMapping): MappingPresetId {
  for (const id of Object.keys(REQUEST_MAPPING_PRESETS) as BuiltinPresetId[]) {
    const preset = REQUEST_MAPPING_PRESETS[id];
    if (REQUEST_TARGET_FIELDS.every(({ key }) => (mapping[key] ?? "") === (preset[key] ?? ""))) {
      return id;
    }
  }
  return "custom";
}
