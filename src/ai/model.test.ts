import { describe, expect, it, vi } from "vitest";
import { type CustomLlmProvider, DEFAULT_SETTINGS } from "@/db/types";
import { fetchWithoutAuthorization, MissingApiKeyError, resolveDjModel } from "./model";

vi.mock("@/lib/platform", () => ({
  getAppFetch: async () => globalThis.fetch,
}));

const customProvider: CustomLlmProvider = {
  id: "custom:abc",
  label: "Local vLLM",
  baseUrl: "http://localhost:8000",
  models: [{ id: "qwen-7b" }],
  createdAt: 1,
  updatedAt: 1,
};

describe("fetchWithoutAuthorization", () => {
  it("strips the Authorization header before delegating", async () => {
    const seen: Array<Headers> = [];
    const base = (async (_input: unknown, init?: RequestInit) => {
      seen.push(new Headers(init?.headers));
      return new Response("{}");
    }) as typeof globalThis.fetch;

    await fetchWithoutAuthorization(base)("http://x/v1/chat", {
      headers: {
        Authorization: "Bearer muzero-local-provider",
        "content-type": "application/json",
      },
    });
    expect(seen[0].get("authorization")).toBeNull();
    expect(seen[0].get("content-type")).toBe("application/json");
  });
});

describe("resolveDjModel", () => {
  it("throws MissingApiKeyError for keyed presets without a key", async () => {
    await expect(
      resolveDjModel({ ...DEFAULT_SETTINGS }, { presetId: "openai", model: "gpt-4o-mini" }),
    ).rejects.toBeInstanceOf(MissingApiKeyError);
  });

  it("resolves a keyless dynamic custom provider (no throw, model id kept)", async () => {
    const model = await resolveDjModel(
      { ...DEFAULT_SETTINGS },
      { presetId: "custom:abc", model: "qwen-7b" },
      [customProvider],
    );
    expect(model).toBeTruthy();
    expect((model as { modelId?: string }).modelId).toBe("qwen-7b");
  });

  it("resolves a keyed built-in preset", async () => {
    const model = await resolveDjModel(
      { ...DEFAULT_SETTINGS },
      { presetId: "groq", model: "llama-3.3-70b-versatile", apiKey: "gsk_x" },
    );
    expect((model as { modelId?: string }).modelId).toBe("llama-3.3-70b-versatile");
  });
});
