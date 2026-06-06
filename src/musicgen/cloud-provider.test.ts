import { describe, expect, it } from "vitest";
import type { TrackBrief } from "@/dj/dj-brief-schema";
import { buildAuthHeaders, createCloudMusicGenProvider } from "./cloud-provider";

const brief: TrackBrief = {
  title: "Neon Rain",
  caption: "lofi hip hop",
  lyrics: "[verse]\nrain",
  durationSec: 45,
};

describe("buildAuthHeaders", () => {
  it("defaults to a Bearer scheme", () => {
    expect(buildAuthHeaders(undefined, "k_test")).toEqual({
      "content-type": "application/json",
      authorization: "Bearer k_test",
    });
  });

  it("uses the fal-style Key scheme when requested", () => {
    expect(buildAuthHeaders("key", "k_test").authorization).toBe("Key k_test");
  });

  it("omits the authorization header when there is no key", () => {
    const headers = buildAuthHeaders("bearer", undefined);
    expect(headers.authorization).toBeUndefined();
    expect(headers["content-type"]).toBe("application/json");
  });
});

describe("createCloudMusicGenProvider — auth + fetch injection", () => {
  it("sends the configured auth scheme and returns synchronous audio bytes", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      calls.push({
        url: String(url),
        headers: (init?.headers ?? {}) as Record<string, string>,
      });
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
      });
    }) as unknown as typeof fetch;

    const provider = createCloudMusicGenProvider({
      baseUrl: "https://fal.example/ace",
      apiKey: "k_test",
      authScheme: "key",
      createPath: "",
      fetchImpl: fakeFetch,
    });

    const res = await provider.generate({ brief });
    expect(res.provider).toBe("cloud");
    expect(res.mime).toBe("audio/mpeg");
    expect(res.durationSec).toBe(45);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://fal.example/ace");
    expect(calls[0].headers.authorization).toBe("Key k_test");
  });

  it("uses injected mappers to shape the request body", async () => {
    let sentBody: unknown;
    const fakeFetch = (async (_url: string, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(new Uint8Array([9]), {
        status: 200,
        headers: { "content-type": "audio/wav" },
      });
    }) as unknown as typeof fetch;

    const provider = createCloudMusicGenProvider(
      { baseUrl: "https://x", apiKey: "k", createPath: "", fetchImpl: fakeFetch },
      {
        mapBriefToBody: (b) => ({ custom_prompt: b.caption, n: 1 }),
        parseCreate: () => ({}),
        parseStatus: () => ({ state: "pending" }),
      },
    );

    await provider.generate({ brief });
    expect(sentBody).toEqual({ custom_prompt: "lofi hip hop", n: 1 });
  });
});
