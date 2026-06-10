import { describe, expect, it, vi } from "vitest";
import { buildAmllNcmTtmlUrl, createAmllTtmlProvider } from "./amll-ttml-provider";

const TTML =
  '<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="00:01.000" end="00:02.000"><span begin="00:01.000" end="00:01.500">hi</span></p></div></body></tt>';

function fakeFetch(impl: (url: string) => { ok: boolean; status: number; body: string }) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const { ok, status, body } = impl(String(input));
    return { ok, status, text: async () => body } as Response;
  });
}

describe("buildAmllNcmTtmlUrl", () => {
  it("points at the ncm-lyrics raw path", () => {
    expect(buildAmllNcmTtmlUrl("33894312")).toBe(
      "https://raw.githubusercontent.com/amll-dev/amll-ttml-db/refs/heads/main/ncm-lyrics/33894312.ttml",
    );
  });
});

describe("createAmllTtmlProvider", () => {
  it("fetches the TTML for a NetEase song id and tags it format:ttml", async () => {
    const fetchImpl = fakeFetch(() => ({ ok: true, status: 200, body: TTML }));
    const provider = createAmllTtmlProvider({ fetchImpl });
    const hit = await provider.fetch({ trackName: "x", artistName: "y", neteaseSongId: "42" });
    expect(fetchImpl).toHaveBeenCalledWith(buildAmllNcmTtmlUrl("42"), expect.anything());
    expect(hit).toMatchObject({ source: "amll", sourceId: "42", format: "ttml", synced: TTML });
  });

  it("returns null when the DB has no entry (404)", async () => {
    const provider = createAmllTtmlProvider({
      fetchImpl: fakeFetch(() => ({ ok: false, status: 404, body: "Not Found" })),
    });
    expect(
      await provider.fetch({ trackName: "x", artistName: "y", neteaseSongId: "42" }),
    ).toBeNull();
  });

  it("returns null (no request) without a NetEase song id — the DB is id-keyed", async () => {
    const fetchImpl = fakeFetch(() => ({ ok: true, status: 200, body: TTML }));
    const provider = createAmllTtmlProvider({ fetchImpl });
    expect(await provider.fetch({ trackName: "x", artistName: "y" })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns null when the response is not TTML", async () => {
    const provider = createAmllTtmlProvider({
      fetchImpl: fakeFetch(() => ({ ok: true, status: 200, body: "garbage" })),
    });
    expect(
      await provider.fetch({ trackName: "x", artistName: "y", neteaseSongId: "42" }),
    ).toBeNull();
  });
});
