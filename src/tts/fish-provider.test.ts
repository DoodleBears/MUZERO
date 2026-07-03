import { describe, expect, it, vi } from "vitest";
import { createFishTtsProvider } from "./fish-provider";
import { TtsError } from "./provider";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("createFishTtsProvider", () => {
  it("lists the owner's voices with self_only + bearer auth", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain("/model?");
      expect(url).toContain("self_only=true");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer sk-fish");
      return jsonResponse({ items: [{ _id: "a", title: "A" }], total: 1 });
    });
    const provider = createFishTtsProvider({ apiKey: "sk-fish", fetchImpl: fetchImpl as never });
    const voices = await provider.listVoices({ ownedOnly: true });
    expect(voices.map((v) => v.id)).toEqual(["a"]);
  });

  it("passes a title= query when searching", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toContain("title=warm");
      return jsonResponse({ items: [] });
    });
    const provider = createFishTtsProvider({ apiKey: "k", fetchImpl: fetchImpl as never });
    await provider.listVoices({ query: "warm" });
    expect(fetchImpl).toHaveBeenCalled();
  });

  it("gets a single voice by id and returns null on 404", async () => {
    const ok = createFishTtsProvider({
      apiKey: "k",
      fetchImpl: (async () => jsonResponse({ _id: "vox", title: "Vox" })) as never,
    });
    expect((await ok.getVoice("vox"))?.id).toBe("vox");

    const missing = createFishTtsProvider({
      apiKey: "k",
      fetchImpl: (async () => new Response("", { status: 404 })) as never,
    });
    expect(await missing.getVoice("nope")).toBeNull();
  });

  it("synthesizes with the backend header and returns the audio blob", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain("/v1/tts");
      expect(init?.method).toBe("POST");
      const headers = new Headers(init?.headers);
      expect(headers.get("model")).toBe("s2-pro");
      const body = JSON.parse(init?.body as string);
      expect(body.reference_id).toBe("vox");
      return new Response(new Uint8Array(8), {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
      });
    });
    const provider = createFishTtsProvider({
      apiKey: "k",
      backend: "s2-pro",
      fetchImpl: fetchImpl as never,
    });
    const result = await provider.synthesize({ text: "hi", voiceId: "vox" });
    expect(result.mime).toBe("audio/mpeg");
    expect(result.blob.size).toBe(8);
  });

  it("defaults the backend to s2.1-pro-free (free model)", async () => {
    let modelHeader: string | null = null;
    const provider = createFishTtsProvider({
      apiKey: "k",
      fetchImpl: (async (_url: string, init?: RequestInit) => {
        modelHeader = new Headers(init?.headers).get("model");
        return new Response(new Uint8Array(4), {
          status: 200,
          headers: { "content-type": "audio/mpeg" },
        });
      }) as never,
    });
    await provider.synthesize({ text: "hi", voiceId: "v" });
    expect(modelHeader).toBe("s2.1-pro-free");
  });

  it("throws a classified TtsError on auth failure", async () => {
    const provider = createFishTtsProvider({
      apiKey: "bad",
      fetchImpl: (async () => jsonResponse({ message: "unauthorized" }, { status: 401 })) as never,
    });
    await expect(provider.synthesize({ text: "hi", voiceId: "v" })).rejects.toMatchObject({
      name: "TtsError",
      kind: "auth",
    });
  });

  it("wraps synthesis network failures", async () => {
    const provider = createFishTtsProvider({
      apiKey: "k",
      fetchImpl: (async () => {
        throw new TypeError("offline");
      }) as never,
    });
    await expect(provider.synthesize({ text: "hi", voiceId: "v" })).rejects.toMatchObject({
      kind: "network",
    });
  });

  it("refuses to synthesize without a key", async () => {
    const provider = createFishTtsProvider({ apiKey: "", fetchImpl: vi.fn() as never });
    await expect(provider.synthesize({ text: "hi", voiceId: "v" })).rejects.toBeInstanceOf(
      TtsError,
    );
  });
});
