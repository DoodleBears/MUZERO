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

  it("extracts capability flags from OpenRouter (vision / audio / tools)", () => {
    const [model] = parseModelCatalog({
      data: [
        {
          id: "openai/gpt-4o",
          name: "GPT-4o",
          context_length: 128000,
          architecture: { input_modalities: ["text", "image", "audio"], modality: "text+image" },
          supported_parameters: ["tools", "tool_choice", "max_tokens"],
        },
      ],
    });
    expect(model).toMatchObject({
      supportsVision: true,
      supportsAudio: true,
      supportsTools: true,
    });
  });

  it("leaves capability flags undefined for text-only models without tool support", () => {
    const [model] = parseModelCatalog({
      data: [
        {
          id: "meta/llama-3-text",
          architecture: { input_modalities: ["text"] },
          supported_parameters: ["max_tokens"],
        },
      ],
    });
    expect(model.supportsVision).toBeUndefined();
    expect(model.supportsAudio).toBeUndefined();
    expect(model.supportsTools).toBeUndefined();
  });

  it("formats context length + price compactly", async () => {
    const { formatContextLength, formatPricePerMillion } = await import("./model-catalog");
    expect(formatContextLength(128000)).toBe("128K");
    expect(formatContextLength(1_000_000)).toBe("1M");
    expect(formatContextLength(1_500_000)).toBe("1.5M");
    expect(formatContextLength(512)).toBe("512");
    expect(formatPricePerMillion(3)).toBe("$3");
    expect(formatPricePerMillion(0.15)).toBe("$0.15");
    expect(formatPricePerMillion(2.5)).toBe("$2.50");
    expect(formatPricePerMillion(0)).toBe("$0");
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
