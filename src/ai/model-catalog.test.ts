import { beforeEach, describe, expect, it, vi } from "vitest";
import { customLlmProviderToPreset } from "./custom-llm-providers";
import { LLM_PROVIDER_PRESETS } from "./llm-providers";
import {
  clearModelCatalogCache,
  fetchModelCatalog,
  modelsEndpointFor,
  parseModelCatalog,
} from "./model-catalog";

describe("modelsEndpointFor", () => {
  it("builds /v1/models for OpenAI-compatible built-ins", () => {
    expect(modelsEndpointFor(LLM_PROVIDER_PRESETS.openrouter)).toBe(
      "https://openrouter.ai/api/v1/models",
    );
    expect(modelsEndpointFor(LLM_PROVIDER_PRESETS.openai)).toBe("https://api.openai.com/v1/models");
    expect(modelsEndpointFor(LLM_PROVIDER_PRESETS.groq)).toBe(
      "https://api.groq.com/openai/v1/models",
    );
  });

  it("derives the endpoint from a custom endpoint's baseURL (local LLMs included)", () => {
    const preset = customLlmProviderToPreset({
      id: "custom:abc",
      label: "Local",
      baseUrl: "http://localhost:11434",
      models: [{ id: "llama3" }],
      createdAt: 0,
      updatedAt: 0,
    });
    expect(modelsEndpointFor(preset)).toBe("http://localhost:11434/v1/models");
  });

  it("returns null for Anthropic (no open OpenAI-style model list)", () => {
    expect(modelsEndpointFor(LLM_PROVIDER_PRESETS.claude)).toBeNull();
  });
});

describe("parseModelCatalog", () => {
  it("maps the rich OpenRouter shape (name, context, pricing per million)", () => {
    const models = parseModelCatalog({
      data: [
        {
          id: "anthropic/claude-3.5-sonnet",
          name: "Anthropic: Claude 3.5 Sonnet",
          context_length: 200000,
          pricing: { prompt: "0.000003", completion: "0.000015" },
        },
      ],
    });
    expect(models).toEqual([
      {
        id: "anthropic/claude-3.5-sonnet",
        label: "Anthropic: Claude 3.5 Sonnet",
        contextLimit: 200000,
        inputCostPerMillionUsd: 3,
        outputCostPerMillionUsd: 15,
      },
    ]);
  });

  it("maps the bare OpenAI shape ({data:[{id}]}) using the id as the label", () => {
    expect(parseModelCatalog({ data: [{ id: "gpt-4o-mini" }, { id: "gpt-4.1" }] })).toEqual([
      { id: "gpt-4o-mini", label: "gpt-4o-mini" },
      { id: "gpt-4.1", label: "gpt-4.1" },
    ]);
  });

  it("dedupes by id and ignores malformed entries / shapes", () => {
    expect(
      parseModelCatalog({ data: [{ id: "a" }, { id: "a" }, { id: "" }, {}, null, 5] }),
    ).toEqual([{ id: "a", label: "a" }]);
    expect(parseModelCatalog(null)).toEqual([]);
    expect(parseModelCatalog({ nope: 1 })).toEqual([]);
  });
});

describe("fetchModelCatalog (cache + dedup)", () => {
  beforeEach(() => clearModelCatalogCache());

  function jsonFetch(models: string[]) {
    return vi.fn(async () => new Response(JSON.stringify({ data: models.map((id) => ({ id })) })));
  }

  it("returns null endpoint providers without fetching", async () => {
    const fetchImpl = jsonFetch(["x"]);
    const out = await fetchModelCatalog(LLM_PROVIDER_PRESETS.claude, undefined, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => 0,
    });
    expect(out).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fetches once, caches within the TTL, and re-fetches after it expires", async () => {
    const fetchImpl = jsonFetch(["gpt-4o-mini", "gpt-4.1"]);
    const opts = { fetchImpl: fetchImpl as unknown as typeof fetch, now: () => 1000 };
    const a = await fetchModelCatalog(LLM_PROVIDER_PRESETS.openai, "sk", opts);
    const b = await fetchModelCatalog(LLM_PROVIDER_PRESETS.openai, "sk", opts);
    expect(a?.map((m) => m.id)).toEqual(["gpt-4o-mini", "gpt-4.1"]);
    expect(b).toEqual(a);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // cached

    await fetchModelCatalog(LLM_PROVIDER_PRESETS.openai, "sk", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => 1000 + 10 * 60_000,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2); // TTL expired
  });

  it("sends the bearer key and throws on a non-OK response", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer sk-test");
      return new Response("nope", { status: 401 });
    });
    await expect(
      fetchModelCatalog(LLM_PROVIDER_PRESETS.openai, "sk-test", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        now: () => 0,
      }),
    ).rejects.toThrow();
  });
});
