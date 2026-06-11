import { useLiveQuery } from "dexie-react-hooks";
import { db as defaultDb, type MuzeroDB } from "@/db/muzero-db";
import type { CustomLlmModel, CustomLlmProvider } from "@/db/types";
import type { LlmProviderPreset } from "./llm-providers";

/**
 * User-defined OpenAI-compatible LLM providers (chat PRD §6.1, ClipCombo
 * parity). Rows live in Dexie `llmCustomProviders`; this module owns their id
 * namespace, normalization, preset conversion, and CRUD. API keys are NOT
 * stored here — they stay in `AppSettings.apiKeysByPresetId` like every other
 * preset (hard rule #2), and may be absent (local endpoints run keyless).
 */

export const CUSTOM_LLM_PROVIDER_ID_PREFIX = "custom:";

/** Dynamic-custom ids only — the built-in `custom` preset is NOT one of these. */
export function isCustomLlmProviderId(id: string | undefined): id is `custom:${string}` {
  return Boolean(id && id !== "custom" && id.startsWith(CUSTOM_LLM_PROVIDER_ID_PREFIX));
}

export function createCustomLlmProviderId(): `custom:${string}` {
  const uuid =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${CUSTOM_LLM_PROVIDER_ID_PREFIX}${uuid}`;
}

function normalizeModels(models: unknown): CustomLlmModel[] {
  if (!Array.isArray(models)) return [];
  const seen = new Set<string>();
  const out: CustomLlmModel[] = [];
  for (const model of models) {
    const id =
      typeof (model as CustomLlmModel)?.id === "string" ? (model as CustomLlmModel).id.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const label = (model as CustomLlmModel).label?.trim();
    out.push(label ? { id, label } : { id });
  }
  return out;
}

/**
 * Validate + clean rows from any source (DB, import, in-flight edits): only
 * `custom:` ids, trimmed label/baseUrl, ≥1 usable model, de-duped by id.
 */
export function normalizeCustomLlmProviders(rows: unknown): CustomLlmProvider[] {
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>();
  const out: CustomLlmProvider[] = [];
  for (const row of rows) {
    const candidate = row as CustomLlmProvider | null;
    if (!candidate || typeof candidate !== "object") continue;
    if (!isCustomLlmProviderId(candidate.id) || seen.has(candidate.id)) continue;
    const baseUrl = typeof candidate.baseUrl === "string" ? candidate.baseUrl.trim() : "";
    const models = normalizeModels(candidate.models);
    if (!baseUrl || models.length === 0) continue;
    seen.add(candidate.id);
    out.push({
      id: candidate.id,
      label: (typeof candidate.label === "string" && candidate.label.trim()) || candidate.id,
      baseUrl,
      models,
      createdAt: typeof candidate.createdAt === "number" ? candidate.createdAt : 0,
      updatedAt: typeof candidate.updatedAt === "number" ? candidate.updatedAt : 0,
    });
  }
  return out;
}

/** Custom providers are always OpenAI-compatible (ClipCombo parity). */
export function customLlmProviderToPreset(provider: CustomLlmProvider): LlmProviderPreset {
  return {
    id: provider.id,
    label: provider.label,
    provider: "openai-compatible",
    baseURL: provider.baseUrl,
    models: provider.models.map((m) => ({ id: m.id, label: m.label ?? m.id })),
  };
}

export async function listCustomLlmProviders(
  db: MuzeroDB = defaultDb,
): Promise<CustomLlmProvider[]> {
  const rows = await db.llmCustomProviders.orderBy("createdAt").toArray();
  return normalizeCustomLlmProviders(rows);
}

export async function putCustomLlmProvider(
  provider: CustomLlmProvider,
  db: MuzeroDB = defaultDb,
): Promise<CustomLlmProvider> {
  const [normalized] = normalizeCustomLlmProviders([provider]);
  if (!normalized) throw new Error("Invalid custom LLM provider (needs a baseUrl and ≥1 model)");
  await db.llmCustomProviders.put(normalized);
  return normalized;
}

export async function deleteCustomLlmProvider(id: string, db: MuzeroDB = defaultDb): Promise<void> {
  if (!isCustomLlmProviderId(id)) return; // built-ins are not deletable rows
  await db.llmCustomProviders.delete(id);
}

/** Reactive list for UI (Settings panel, model picker). */
export function useCustomLlmProviders(): CustomLlmProvider[] {
  return useLiveQuery(() => listCustomLlmProviders(), [], []);
}
