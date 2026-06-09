import { describe, expect, it, vi } from "vitest";
import { listR2Buckets } from "./r2-list-buckets";

const LIST_XML = `<?xml version="1.0" encoding="UTF-8"?>
<ListAllMyBucketsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Owner><ID>abc</ID><DisplayName>owner</DisplayName></Owner>
  <Buckets>
    <Bucket><Name>muzero-drive</Name><CreationDate>2026-01-01T00:00:00.000Z</CreationDate></Bucket>
    <Bucket><Name>backups</Name><CreationDate>2026-02-01T00:00:00.000Z</CreationDate></Bucket>
  </Buckets>
</ListAllMyBucketsResult>`;

const now = () => new Date("2026-06-09T00:00:00.000Z");

describe("listR2Buckets", () => {
  it("signs a GET on the account root and returns bucket names", async () => {
    const calls: Array<{ url: string; method?: string; auth?: string }> = [];
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push({
        url: String(url),
        method: init?.method,
        auth: headers.get("authorization") ?? undefined,
      });
      return new Response(LIST_XML, { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    const buckets = await listR2Buckets(
      { accountId: "acct", accessKeyId: "AKID", secretAccessKey: "SECRET" },
      { fetcher, now },
    );

    expect(buckets).toEqual(["muzero-drive", "backups"]);
    expect(calls[0]?.url).toBe("https://acct.r2.cloudflarestorage.com/");
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.auth).toMatch(/^AWS4-HMAC-SHA256 /);
  });

  it("uses an explicit endpoint URL override when provided", async () => {
    let seen = "";
    const fetcher = (async (url: RequestInfo | URL) => {
      seen = String(url);
      return new Response(LIST_XML, { status: 200 });
    }) as typeof globalThis.fetch;

    await listR2Buckets(
      {
        accountId: "acct",
        accessKeyId: "AKID",
        secretAccessKey: "SECRET",
        endpointUrl: "https://custom.example.com/",
      },
      { fetcher, now },
    );

    expect(seen).toBe("https://custom.example.com/");
  });

  it("returns an empty list when there are no buckets", async () => {
    const fetcher = (async () =>
      new Response(`<ListAllMyBucketsResult><Buckets></Buckets></ListAllMyBucketsResult>`, {
        status: 200,
      })) as typeof globalThis.fetch;
    await expect(
      listR2Buckets(
        { accountId: "acct", accessKeyId: "AKID", secretAccessKey: "SECRET" },
        { fetcher, now },
      ),
    ).resolves.toEqual([]);
  });

  it("throws on a non-OK response", async () => {
    const fetcher = (async () =>
      new Response("AccessDenied", { status: 403 })) as typeof globalThis.fetch;
    await expect(
      listR2Buckets(
        { accountId: "acct", accessKeyId: "AKID", secretAccessKey: "SECRET" },
        { fetcher, now },
      ),
    ).rejects.toThrow(/403/);
  });
});
