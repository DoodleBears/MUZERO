import { describe, expect, it } from "vitest";
import type { TrackBrief } from "@/dj/dj-brief-schema";
import { createCloudMusicGenProvider } from "../cloud-provider";
import { resolveCloudPreset } from "./index";
import { murekaPreset } from "./mureka";

const brief: TrackBrief = {
  title: "Sakura Drift",
  caption: "city pop, warm, female vocal",
  lyrics: "[verse]\nさくら\n[chorus]\nまた",
  durationSec: 60,
  vocalLanguage: "ja",
};

describe("mureka preset shape", () => {
  it("is registered, fixed-endpoint, bearer auth, async submit→poll paths", () => {
    const p = resolveCloudPreset("mureka");
    expect(p.id).toBe("mureka");
    expect(p.fixedEndpoint).toBe(true);
    expect(p.authScheme).toBe("bearer");
    expect(p.defaults.baseUrl).toContain("mureka");
    expect(p.defaults.createPath).toBe("/v1/song/generate");
    expect(p.defaults.statusPath).toBe("/v1/song/query/{id}");
  });
});

describe("mureka mapBriefToBody", () => {
  it("maps caption→prompt, lyrics→lyrics, default model auto", () => {
    const body = murekaPreset.mappers.mapBriefToBody(brief, { baseUrl: "x" });
    expect(body).toEqual({
      lyrics: "[verse]\nさくら\n[chorus]\nまた",
      prompt: "city pop, warm, female vocal",
      model: "auto",
    });
  });

  it("honors a configured model override", () => {
    const body = murekaPreset.mappers.mapBriefToBody(brief, { baseUrl: "x", model: "mureka-v8" });
    expect(body.model).toBe("mureka-v8");
  });
});

describe("mureka parseCreate / parseStatus", () => {
  it("parseCreate returns the task id (no audio yet)", () => {
    expect(
      murekaPreset.mappers.parseCreate({ id: "task_1", status: "preparing", trace_id: "t" }),
    ).toEqual({ jobId: "task_1", audioUrl: undefined });
  });

  it("parseStatus stays pending while running", () => {
    expect(murekaPreset.mappers.parseStatus({ status: "running" }).state).toBe("pending");
    expect(murekaPreset.mappers.parseStatus({ status: "preparing" }).state).toBe("pending");
  });

  it("parseStatus extracts the first choice's audio url on success", () => {
    expect(
      murekaPreset.mappers.parseStatus({
        status: "succeeded",
        choices: [{ url: "https://cdn/a.mp3" }, { url: "https://cdn/b.mp3" }],
      }),
    ).toMatchObject({ state: "succeeded", audioUrl: "https://cdn/a.mp3" });
    expect(
      murekaPreset.mappers.parseStatus({
        status: "succeeded",
        choices: [{ mp3_url: "https://cdn/c.mp3" }],
      }),
    ).toMatchObject({ state: "succeeded", audioUrl: "https://cdn/c.mp3" });
  });

  it("parseStatus maps failure/timeout states", () => {
    expect(murekaPreset.mappers.parseStatus({ status: "failed" }).state).toBe("failed");
    expect(murekaPreset.mappers.parseStatus({ status: "timeouted" }).state).toBe("failed");
  });
});

describe("mureka end-to-end via injected fetch (async submit→poll→download)", () => {
  it("submits with Bearer auth, polls the task, downloads the rendered mp3", async () => {
    let body: unknown;
    let auth: string | undefined;
    let polls = 0;
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (init?.method === "POST") {
        body = JSON.parse(String(init.body ?? "{}"));
        auth = (init.headers as Record<string, string>).authorization;
        return json({ id: "task_1", status: "preparing", trace_id: "t" });
      }
      if (u.endsWith("/v1/song/query/task_1")) {
        polls += 1;
        return polls < 2
          ? json({ status: "running" })
          : json({ status: "succeeded", choices: [{ url: "https://cdn/song.mp3" }] });
      }
      // download
      return new Response(new Uint8Array([7, 7, 7]), {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
      });
    }) as unknown as typeof fetch;

    const provider = createCloudMusicGenProvider(
      {
        baseUrl: murekaPreset.defaults.baseUrl,
        createPath: murekaPreset.defaults.createPath,
        statusPath: murekaPreset.defaults.statusPath,
        authScheme: murekaPreset.authScheme,
        apiKey: "mk_key",
        pollIntervalMs: 1,
        fetchImpl: fakeFetch,
      },
      murekaPreset.mappers,
    );

    const res = await provider.generate({ brief });
    expect(auth).toBe("Bearer mk_key");
    expect(body).toMatchObject({ prompt: "city pop, warm, female vocal", model: "auto" });
    expect(polls).toBe(2);
    expect(res.provider).toBe("cloud");
    expect(res.mime).toBe("audio/mpeg");
  });
});

function json(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
