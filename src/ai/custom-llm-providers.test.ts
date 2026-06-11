import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import { type AppSettings, type CustomLlmProvider, DEFAULT_SETTINGS } from "@/db/types";
import {
  createCustomLlmProviderId,
  customLlmProviderToPreset,
  deleteCustomLlmProvider,
  isCustomLlmProviderId,
  listCustomLlmProviders,
  normalizeCustomLlmProviders,
  putCustomLlmProvider,
} from "./custom-llm-providers";
import {
  allLlmProviderPresets,
  enabledLlmPresetIds,
  llmProviderAllowsMissingApiKey,
  resolveLlmProviderPreset,
} from "./llm-providers";

function customProvider(overrides: Partial<CustomLlmProvider> = {}): CustomLlmProvider {
  return {
    id: "custom:abc",
    label: "My vLLM",
    baseUrl: "http://localhost:8000/v1",
    models: [{ id: "qwen-7b" }],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("custom provider ids", () => {
  it("creates prefixed unique ids and detects them", () => {
    const id = createCustomLlmProviderId();
    expect(id.startsWith("custom:")).toBe(true);
    expect(isCustomLlmProviderId(id)).toBe(true);
    expect(isCustomLlmProviderId("openai")).toBe(false);
    expect(isCustomLlmProviderId("custom")).toBe(false); // the built-in, not dynamic
  });
});

describe("normalizeCustomLlmProviders", () => {
  it("keeps valid rows and trims fields", () => {
    const rows = normalizeCustomLlmProviders([
      customProvider({ label: "  My vLLM  ", baseUrl: " http://x/v1 " }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe("My vLLM");
    expect(rows[0].baseUrl).toBe("http://x/v1");
  });

  it("drops rows with a bad id, empty baseUrl, or no usable model; dedupes by id", () => {
    const rows = normalizeCustomLlmProviders([
      customProvider(),
      customProvider(), // duplicate id
      customProvider({ id: "openai" as never }),
      customProvider({ id: "custom:b", baseUrl: "  " }),
      customProvider({ id: "custom:c", models: [{ id: "  " }] }),
      null,
      "junk",
    ]);
    expect(rows.map((r) => r.id)).toEqual(["custom:abc"]);
  });
});

describe("customLlmProviderToPreset + registry merge", () => {
  it("converts to an openai-compatible preset", () => {
    const preset = customLlmProviderToPreset(customProvider());
    expect(preset).toMatchObject({
      id: "custom:abc",
      label: "My vLLM",
      provider: "openai-compatible",
      baseURL: "http://localhost:8000/v1",
    });
    expect(preset.models[0]).toMatchObject({ id: "qwen-7b" });
  });

  it("merges customs after the built-ins and resolves them by id", () => {
    const customs = [customProvider()];
    const all = allLlmProviderPresets(customs);
    expect(all.some((p) => p.id === "openai")).toBe(true);
    expect(all.at(-1)?.id).toBe("custom:abc");
    expect(resolveLlmProviderPreset("custom:abc", customs).label).toBe("My vLLM");
    // unknown custom id falls back to openai (same as before)
    expect(resolveLlmProviderPreset("custom:nope", customs).id).toBe("openai");
  });

  it("custom providers may run keyless and count as enabled without a key", () => {
    expect(llmProviderAllowsMissingApiKey("custom:abc")).toBe(true);
    expect(llmProviderAllowsMissingApiKey("openai")).toBe(false);
    const settings: AppSettings = { ...DEFAULT_SETTINGS };
    expect(enabledLlmPresetIds(settings, [customProvider()])).toContain("custom:abc");
  });
});

describe("custom provider repo (Dexie v21)", () => {
  let db: MuzeroDB;
  beforeEach(() => {
    db = new MuzeroDB(`muzero-test-customllm-${Math.random()}`);
  });

  it("put/list/delete round-trip, normalized and ordered by createdAt", async () => {
    await putCustomLlmProvider(customProvider({ id: "custom:b", createdAt: 2 }), db);
    await putCustomLlmProvider(customProvider({ id: "custom:a", label: " A ", createdAt: 1 }), db);
    const listed = await listCustomLlmProviders(db);
    expect(listed.map((r) => r.id)).toEqual(["custom:a", "custom:b"]);
    expect(listed[0].label).toBe("A");

    await deleteCustomLlmProvider("custom:a", db);
    expect((await listCustomLlmProviders(db)).map((r) => r.id)).toEqual(["custom:b"]);
  });

  it("put rejects rows that normalize away", async () => {
    await expect(putCustomLlmProvider(customProvider({ baseUrl: " " }), db)).rejects.toThrow();
  });
});
