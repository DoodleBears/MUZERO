/**
 * YouTube runtime backed by youtubei.js. Our hand-rolled InnerTube `/player` request
 * proved brittle (YouTube rejects stale client versions with "no longer supported"),
 * so the whole resolve goes through youtubei's YouTube **Music** client
 * (`yt.music.getInfo`) — it returns a ciphered audio format with no PoToken, keeps
 * client versions current, and deciphers (sig + n) with player.js's own functions via
 * its browser-build JS evaluator (the renderer has it; the node platform doesn't).
 *
 * All youtubei fetches go through the muzfetch proxy (`getAppFetch`), so this only
 * works where that proxy exists (Electron) — same as the rest of the YouTube source.
 */

import { Innertube } from "youtubei.js";
import { log } from "@/lib/logger";
import { getAppFetch } from "@/lib/platform";
import type { AudioCodec } from "./youtube-formats";
import type { YoutubeRuntime } from "./youtube-source";

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

function codecOf(mime: string | undefined): AudioCodec {
  const m = (mime ?? "").toLowerCase();
  if (m.includes("mp4a")) return "aac";
  if (m.includes("opus")) return "opus";
  if (m.includes("vorbis")) return "vorbis";
  return "other";
}

export function createYtjsRuntime(): YoutubeRuntime {
  return {
    async resolveAudio(videoId: string) {
      let yt: Innertube;
      try {
        yt = await getInnertube();
      } catch (err) {
        return { kind: "unavailable", reason: `youtubei init failed: ${String(err)}` };
      }
      try {
        const info = await yt.music.getInfo(videoId);
        const status = info.playability_status?.status;
        if (status !== "OK") {
          if (status === "LOGIN_REQUIRED" || status === "AGE_VERIFICATION_REQUIRED") {
            return { kind: "login-required" };
          }
          return {
            kind: "unavailable",
            reason: info.playability_status?.reason ?? status ?? "unplayable",
          };
        }
        const format = info.chooseFormat({ type: "audio", quality: "best" });
        if (!yt.session.player) return { kind: "unavailable", reason: "player not loaded" };
        const url = await format.decipher(yt.session.player);
        const expires = info.streaming_data?.expires;
        const expiresInSeconds =
          expires instanceof Date
            ? Math.max(0, Math.round((expires.getTime() - Date.now()) / 1000))
            : undefined;
        log.info("youtube", "resolved", { videoId, itag: format.itag, mime: format.mime_type });
        return {
          kind: "ok",
          url,
          mime: (format.mime_type ?? "audio/mp4").split(";")[0].trim(),
          codec: codecOf(format.mime_type),
          expiresInSeconds,
          details: {
            videoId,
            title: info.basic_info?.title ?? undefined,
            author: info.basic_info?.author ?? undefined,
            lengthSeconds: info.basic_info?.duration ?? undefined,
          },
        };
      } catch (err) {
        log.warn("youtube", "resolveAudio failed", { videoId, err: String(err) });
        return { kind: "unavailable", reason: String(err) };
      }
    },
  };
}
