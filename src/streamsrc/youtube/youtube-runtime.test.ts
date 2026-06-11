import { describe, expect, it, vi } from "vitest";
import type { StreamHttp, StreamHttpResponse } from "../http";
import { createYoutubeRuntime, parsePlayerJsUrl, parseVisitorData } from "./youtube-runtime";

const PLAYER_JS = `
var Mn={rT:function(a){a.reverse()},rN:function(a,b){a.splice(0,b)},rE:function(a,b){var c=a[0];a[0]=a[b%a.length];a[b%a.length]=c}};
var Dz=function(a){a=a.split("");Mn.rT(a);Mn.rN(a,1);return a.join("")};
x.get("n"))&&(b=nF(a);
var nF=function(a){return a+"_N"};
var z={signatureTimestamp:19999};
`;

function text(body: string): StreamHttpResponse {
  return { status: 200, text: async () => body, json: async () => ({}) };
}

function stubHttp(): { http: StreamHttp; calls: string[] } {
  const calls: string[] = [];
  const http: StreamHttp = async (req) => {
    calls.push(req.url);
    if (req.url.includes("iframe_api"))
      // Real iframe_api escapes its slashes + only names www-widgetapi (not base.js).
      return text(
        "scriptUrl='https:\\/\\/www.youtube.com\\/s\\/player\\/abcd1234\\/www-widgetapi.vflset\\/www-widgetapi.js';",
      );
    if (req.url.includes("base.js")) return text(PLAYER_JS);
    return text('window.ytcfg={"visitorData":"VISITOR_XYZ"};'); // home
  };
  return { http, calls };
}

describe("parsePlayerJsUrl / parseVisitorData", () => {
  it("builds base.js url from the iframe_api hash (incl. escaped slashes)", () => {
    expect(parsePlayerJsUrl('"/s/player/deadbeef/player_ias.vflset/en_US/base.js"')).toBe(
      "https://www.youtube.com/s/player/deadbeef/player_ias.vflset/en_US/base.js",
    );
    // The real iframe_api response escapes its slashes — must still resolve.
    expect(
      parsePlayerJsUrl(
        "u='https:\\/\\/www.youtube.com\\/s\\/player\\/c0ffee01\\/www-widgetapi.vflset\\/www-widgetapi.js'",
      ),
    ).toBe("https://www.youtube.com/s/player/c0ffee01/player_ias.vflset/en_US/base.js");
    expect(parsePlayerJsUrl("no player here")).toBeNull();
  });

  it("extracts visitorData", () => {
    expect(parseVisitorData('x={"visitorData":"Cg123"}')).toBe("Cg123");
    expect(parseVisitorData("none")).toBeUndefined();
  });
});

describe("createYoutubeRuntime", () => {
  it("getBootstrap returns the sts + visitorData from player.js + home", async () => {
    const { http } = stubHttp();
    const rt = createYoutubeRuntime({ http, evalN: async (_src, n) => n });
    expect(await rt.getBootstrap()).toEqual({
      signatureTimestamp: 19999,
      visitorData: "VISITOR_XYZ",
    });
  });

  it("solveSig applies the parsed signature recipe", async () => {
    const { http } = stubHttp();
    const rt = createYoutubeRuntime({ http, evalN: async (_src, n) => n });
    // Dz recipe: reverse then splice(0,1). "abcd" → "dcba" → "cba".
    expect(await rt.solvers.solveSig("abcd")).toBe("cba");
  });

  it("solveN runs the extracted n-function source through the injected sandbox eval", async () => {
    const { http } = stubHttp();
    const evalN = vi.fn(
      async (src: string, n: string) => `${src.includes("_N") ? "ran:" : ""}${n}`,
    );
    const rt = createYoutubeRuntime({ http, evalN });
    expect(await rt.solvers.solveN("xyz")).toBe("ran:xyz");
    expect(evalN).toHaveBeenCalledWith(expect.stringContaining("_N"), "xyz");
  });

  it("fetches + parses player.js only once across calls (cached)", async () => {
    const { http, calls } = stubHttp();
    const rt = createYoutubeRuntime({ http, evalN: async (_s, n) => n });
    await rt.solvers.solveSig("a");
    await rt.solvers.solveN("b");
    await rt.getBootstrap();
    expect(calls.filter((u) => u.includes("base.js"))).toHaveLength(1);
    expect(calls.filter((u) => u.includes("iframe_api"))).toHaveLength(1);
  });
});
