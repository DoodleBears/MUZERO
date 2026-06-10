import { describe, expect, it } from "vitest";
import type { AppSettings } from "@/db/types";
import type { StreamHttp } from "./http";
import { createStreamSource, resolveEnabledStreamSources, STREAM_SOURCE_IDS } from "./registry";

const noopHttp: StreamHttp = async () => ({
  status: 200,
  text: async () => "{}",
  json: async () => ({}),
});

const deps = {
  http: noopHttp,
  now: () => 0,
  getCookie: (id: string) => (id === "bili" ? "SESSDATA=x" : undefined),
};

describe("STREAM_SOURCE_IDS", () => {
  it("lists the three codename-stable source ids", () => {
    expect(STREAM_SOURCE_IDS).toEqual(["netease", "bili", "youtube"]);
  });
});

describe("createStreamSource", () => {
  it("builds the bili + netease providers and threads per-source cookies", () => {
    const bili = createStreamSource("bili", deps);
    const netease = createStreamSource("netease", deps);
    expect(bili?.id).toBe("bili");
    expect(bili?.isAuthed()).toBe(true); // bili cookie provided
    expect(netease?.id).toBe("netease");
    expect(netease?.isAuthed()).toBe(false); // no netease cookie
  });

  it("builds the youtube source (search works; resolve needs the desktop runtime)", () => {
    const yt = createStreamSource("youtube", deps);
    expect(yt?.id).toBe("youtube");
  });
});

describe("resolveEnabledStreamSources", () => {
  it("returns only the enabled, implemented sources", () => {
    const settings = {
      streamSources: {
        bili: { enabled: true },
        netease: { enabled: false },
        youtube: { enabled: true },
      },
    } as Pick<AppSettings, "streamSources">;
    const sources = resolveEnabledStreamSources(settings, deps);
    expect(sources.map((s) => s.id)).toEqual(["bili", "youtube"]); // netease disabled
  });

  it("returns [] when nothing is enabled", () => {
    expect(resolveEnabledStreamSources({ streamSources: {} }, deps)).toEqual([]);
    expect(resolveEnabledStreamSources({}, deps)).toEqual([]);
  });
});
