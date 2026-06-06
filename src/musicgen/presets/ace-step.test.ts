import { describe, expect, it } from "vitest";
import type { TrackBrief } from "@/dj/dj-brief-schema";
import { createCloudMusicGenProvider } from "../cloud-provider";
import { aceStepPreset } from "./ace-step";
import { resolveCloudPreset } from "./index";

const brief: TrackBrief = {
  title: "Neon Rain",
  caption: "lofi, hip hop, chill",
  lyrics: "[verse]\nrain on the window\n[chorus]\nstay",
  durationSec: 60,
};

describe("ace-step preset shape", () => {
  it("is registered, fixed-endpoint, and uses the fal Key auth scheme", () => {
    const p = resolveCloudPreset("ace-step");
    expect(p.id).toBe("ace-step");
    expect(p.fixedEndpoint).toBe(true);
    expect(p.authScheme).toBe("key");
    expect(p.defaults.baseUrl).toContain("fal");
  });
});

describe("ace-step mapBriefToBody", () => {
  it("maps caption→tags, lyrics→lyrics (structure preserved), duration", () => {
    const body = aceStepPreset.mappers.mapBriefToBody(brief, aceConfig());
    expect(body).toEqual({
      tags: "lofi, hip hop, chill",
      lyrics: "[verse]\nrain on the window\n[chorus]\nstay",
      duration: 60,
    });
  });

  it("turns empty lyrics into an instrumental marker", () => {
    const body = aceStepPreset.mappers.mapBriefToBody({ ...brief, lyrics: "" }, aceConfig());
    expect(body.lyrics).toBe("[inst]");
  });

  it("treats whitespace-only lyrics as instrumental", () => {
    const body = aceStepPreset.mappers.mapBriefToBody({ ...brief, lyrics: "   \n  " }, aceConfig());
    expect(body.lyrics).toBe("[inst]");
  });
});

describe("ace-step parseCreate / parseStatus", () => {
  it("parseCreate reads the synchronous audio.url", () => {
    expect(
      aceStepPreset.mappers.parseCreate({ audio: { url: "https://cdn/a.wav" } }),
    ).toMatchObject({ audioUrl: "https://cdn/a.wav" });
  });

  it("parseCreate falls back to a queue request_id", () => {
    expect(aceStepPreset.mappers.parseCreate({ request_id: "req_1" })).toMatchObject({
      jobId: "req_1",
    });
  });

  it("parseStatus maps fal queue states", () => {
    expect(aceStepPreset.mappers.parseStatus({ status: "IN_PROGRESS" }).state).toBe("pending");
    expect(aceStepPreset.mappers.parseStatus({ status: "IN_QUEUE" }).state).toBe("pending");
    expect(
      aceStepPreset.mappers.parseStatus({
        status: "COMPLETED",
        audio: { url: "https://cdn/a.wav" },
      }),
    ).toMatchObject({ state: "succeeded", audioUrl: "https://cdn/a.wav" });
    expect(aceStepPreset.mappers.parseStatus({ status: "FAILED", error: "boom" })).toMatchObject({
      state: "failed",
      error: "boom",
    });
  });
});

describe("ace-step end-to-end via injected fetch (sync endpoint)", () => {
  it("submits tags/lyrics with Key auth and downloads the rendered audio", async () => {
    let body: unknown;
    let auth: string | undefined;
    let postUrl: string | undefined;
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        postUrl = String(url);
        body = JSON.parse(String(init.body ?? "{}"));
        auth = (init.headers as Record<string, string>).authorization;
        return new Response(
          JSON.stringify({ audio: { url: "https://cdn/song.wav", content_type: "audio/wav" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { "content-type": "audio/wav" },
      });
    }) as unknown as typeof fetch;

    const provider = createCloudMusicGenProvider(
      {
        baseUrl: aceStepPreset.defaults.baseUrl,
        createPath: aceStepPreset.defaults.createPath,
        statusPath: aceStepPreset.defaults.statusPath,
        authScheme: aceStepPreset.authScheme,
        apiKey: "fal_key",
        fetchImpl: fakeFetch,
      },
      aceStepPreset.mappers,
    );

    const res = await provider.generate({ brief });
    expect(postUrl).toBe(aceStepPreset.defaults.baseUrl + aceStepPreset.defaults.createPath);
    expect(auth).toBe("Key fal_key");
    expect(body).toEqual({
      tags: "lofi, hip hop, chill",
      lyrics: "[verse]\nrain on the window\n[chorus]\nstay",
      duration: 60,
    });
    expect(res.provider).toBe("cloud");
    expect(res.mime).toBe("audio/wav");
    expect(res.durationSec).toBe(60);
    expect(await res.blob.arrayBuffer()).toHaveProperty("byteLength", 4);
  });
});

/** A minimal config matching the preset, for pure-mapper tests. */
function aceConfig() {
  return {
    baseUrl: aceStepPreset.defaults.baseUrl,
    authScheme: aceStepPreset.authScheme,
  };
}
