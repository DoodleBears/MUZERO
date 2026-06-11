/**
 * YouTube runtime backed by youtubei.js. The earlier self-built regex solver can't
 * keep up with YouTube's obfuscated player.js, so we delegate the one genuinely hard
 * part — deciphering the signature + `n` — to youtubei.js, whose browser build ships
 * a JS evaluator that runs player.js's own functions. Everything else stays ours: the
 * InnerTube `/player` request + format selection (`youtube-resolve`) are unchanged.
 *
 * youtubei.js fetches (player.js, its own session) go through the muzfetch proxy via
 * `getAppFetch`, so this only works where that proxy exists (Electron) — same as the
 * rest of the YouTube source. WEB_REMIX returns ciphered formats with no PoToken, so
 * none is needed here.
 */

import { Innertube } from "youtubei.js";
import { log } from "@/lib/logger";
import { getAppFetch } from "@/lib/platform";
import type { YoutubeFormat } from "./youtube-formats";
import type { YoutubeBootstrap } from "./youtube-resolve";

let innertubePromise: Promise<Innertube> | null = null;

/** Lazily create + cache one Innertube (fetches player.js once; supplies the decipher engine). */
async function getInnertube(): Promise<Innertube> {
  if (!innertubePromise) {
    innertubePromise = (async () => {
      const fetch = await getAppFetch();
      const yt = await Innertube.create({ fetch, retrieve_player: true });
      log.info("youtube", "youtubei ready", {
        visitorData: Boolean(yt.session.context.client.visitorData),
        sts: yt.session.player?.signature_timestamp,
      });
      return yt;
    })().catch((err) => {
      innertubePromise = null; // let the next play retry a failed bootstrap
      log.warn("youtube", "youtubei init failed", { err: String(err) });
      throw err;
    });
  }
  return innertubePromise;
}

export interface YtjsRuntime {
  getBootstrap: () => Promise<YoutubeBootstrap>;
  /** Decipher a format to a final playable URL (sig + n) using player.js's own code. */
  decipherFormat: (format: YoutubeFormat) => Promise<string>;
}

export function createYtjsRuntime(): YtjsRuntime {
  return {
    async getBootstrap(): Promise<YoutubeBootstrap> {
      const yt = await getInnertube();
      return {
        visitorData: yt.session.context.client.visitorData ?? undefined,
        signatureTimestamp: yt.session.player?.signature_timestamp,
      };
    },
    async decipherFormat(format: YoutubeFormat): Promise<string> {
      const yt = await getInnertube();
      if (!yt.session.player) throw new Error("youtube: player not loaded");
      return yt.session.player.decipher(format.url, format.signatureCipher, format.cipher);
    },
  };
}
