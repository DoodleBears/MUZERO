/**
 * YouTube runtime — ties the pure player.js parsers into the {@link CipherSolvers}
 * the resolver needs. It fetches player.js (once, cached), extracts the signature
 * recipe (applied in pure TS) + the `n` function source (run via an injected
 * sandboxed eval — the Electron main `vm`, never the renderer's own realm) + the
 * signatureTimestamp, and fetches `visitorData` for the guest session.
 *
 * Injectable (http + evalN) so the whole flow is unit-testable with a canned
 * player.js; in prod the bridge supplies `evalN` and `http` is the muzfetch proxy.
 */

import type { StreamHttp } from "../http";
import type { CipherSolvers } from "./youtube-cipher";
import { extractNFunctionSource } from "./youtube-nsig";
import type { YoutubeBootstrap } from "./youtube-resolve";
import {
  applySigOperations,
  extractSignatureTimestamp,
  extractSigOperations,
  type SigOp,
} from "./youtube-sig";

const IFRAME_API_URL = "https://www.youtube.com/iframe_api";
const HOME_URL = "https://www.youtube.com/?hl=en";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** Build the base.js URL from the iframe_api JS (it embeds the current player hash). */
export function parsePlayerJsUrl(iframeApi: string): string | null {
  const m = iframeApi.match(/\/s\/player\/([0-9a-zA-Z_-]+)\//);
  return m ? `https://www.youtube.com/s/player/${m[1]}/player_ias.vflset/en_US/base.js` : null;
}

/** Pull the guest `visitorData` out of a YouTube HTML / config blob. */
export function parseVisitorData(html: string): string | undefined {
  return html.match(/"visitorData":\s*"([^"]+)"/)?.[1];
}

export interface YoutubeRuntimeDeps {
  http: StreamHttp;
  /** Sandboxed eval of the extracted n-function on a value (bridge → Electron main vm). */
  evalN: (functionSource: string, n: string) => Promise<string>;
}

export interface YoutubeRuntimeHandle {
  getBootstrap: () => Promise<YoutubeBootstrap>;
  solvers: CipherSolvers;
}

interface PlayerCache {
  sigOps: SigOp[] | null;
  nSource: string | null;
  sts: number | null;
}

async function getText(http: StreamHttp, url: string): Promise<string> {
  const res = await http({ url, method: "GET", headers: { "User-Agent": USER_AGENT } });
  return res.text();
}

/** Create the YouTube playback runtime (player.js solvers + bootstrap), with caching. */
export function createYoutubeRuntime(deps: YoutubeRuntimeDeps): YoutubeRuntimeHandle {
  let player: PlayerCache | null = null;
  let visitorData: string | undefined;
  let visitorFetched = false;

  async function ensurePlayer(): Promise<PlayerCache> {
    if (player) return player;
    const iframe = await getText(deps.http, IFRAME_API_URL);
    const playerUrl = parsePlayerJsUrl(iframe);
    if (!playerUrl) throw new Error("youtube: could not locate player.js");
    const js = await getText(deps.http, playerUrl);
    player = {
      sigOps: extractSigOperations(js),
      nSource: extractNFunctionSource(js),
      sts: extractSignatureTimestamp(js),
    };
    return player;
  }

  return {
    async getBootstrap(): Promise<YoutubeBootstrap> {
      const p = await ensurePlayer();
      if (!visitorFetched) {
        visitorFetched = true;
        try {
          visitorData = parseVisitorData(await getText(deps.http, HOME_URL));
        } catch {
          visitorData = undefined;
        }
      }
      return { signatureTimestamp: p.sts ?? undefined, visitorData };
    },
    solvers: {
      async solveSig(s: string): Promise<string> {
        const p = await ensurePlayer();
        return p.sigOps ? applySigOperations(s, p.sigOps) : s;
      },
      async solveN(n: string): Promise<string> {
        const p = await ensurePlayer();
        return p.nSource ? deps.evalN(p.nSource, n) : n;
      },
    },
  };
}
