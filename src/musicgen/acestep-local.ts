import type { TrackBrief } from "@/dj/dj-brief-schema";
import { log } from "@/lib/logger";
import { getAppFetch } from "@/lib/platform";
import {
  MusicGenError,
  type MusicGenProvider,
  type MusicGenRequest,
  type MusicGenResult,
} from "./provider";

/**
 * Adapter for a local ACE-Step 1.5 server (acestep.cpp `ace-server`), the
 * sibling `../acestep-local` project: `make serve` → http://localhost:8085.
 * Text + lyrics in → stereo 48 kHz WAV out. Fully on-device, no cloud — the
 * core of MUZERO's "no backend, no cloud" stance.
 *
 * The exact HTTP route of `ace-server` is configurable (`generatePath`) because
 * upstream's API surface can change; default `/generate` POSTs the JSON payload
 * and accepts either a binary `audio/*` body or a JSON `{ audio_path | url }`.
 */
export interface AceStepConfig {
  baseUrl: string; // e.g. "http://localhost:8085"
  generatePath?: string; // default "/generate"
  /** GGUF model filenames the server has loaded (see acestep-local README). */
  synthModel?: string;
  lmModel?: string;
  inferenceSteps?: number;
  guidanceScale?: number;
  shift?: number;
}

/** Map MUZERO's provider-agnostic brief onto ACE-Step's request shape. */
export function toAceStepPayload(brief: TrackBrief, cfg: AceStepConfig): Record<string, unknown> {
  return {
    lm_model: cfg.lmModel ?? "acestep-5Hz-lm-4B-Q8_0.gguf",
    synth_model: cfg.synthModel ?? "acestep-v15-turbo-Q8_0.gguf",
    caption: brief.caption,
    lyrics: brief.lyrics || "[instrumental]",
    duration: brief.durationSec,
    bpm: brief.bpm,
    keyscale: brief.keyscale,
    timesignature: brief.timeSignature,
    vocal_language: brief.vocalLanguage,
    inference_steps: cfg.inferenceSteps ?? 8,
    guidance_scale: cfg.guidanceScale ?? 1.0,
    shift: cfg.shift ?? 3.0,
  };
}

export function createAceStepProvider(cfg: AceStepConfig): MusicGenProvider {
  const base = cfg.baseUrl.replace(/\/$/, "");
  const path = cfg.generatePath ?? "/generate";

  async function resolveAudio(res: Response): Promise<{ blob: Blob; mime: string }> {
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.startsWith("audio/") || contentType === "application/octet-stream") {
      const blob = await res.blob();
      return { blob, mime: contentType || "audio/wav" };
    }
    // JSON envelope referencing a file the server wrote (out/<id>.wav).
    const json = (await res.json()) as { audio_path?: string; url?: string };
    const ref = json.url ?? json.audio_path;
    if (!ref) throw new MusicGenError("ACE-Step response had no audio", "acestep-local", json);
    const audioUrl = ref.startsWith("http") ? ref : `${base}/${ref.replace(/^\//, "")}`;
    const fetchFn = await getAppFetch();
    const audioRes = await fetchFn(audioUrl);
    const blob = await audioRes.blob();
    return { blob, mime: blob.type || "audio/wav" };
  }

  return {
    id: "acestep-local",
    label: "ACE-Step (local)",
    requiresConfig: true,

    async generate({ brief, signal }: MusicGenRequest): Promise<MusicGenResult> {
      const fetchFn = await getAppFetch();
      const payload = toAceStepPayload(brief, cfg);
      log.debug("acestep", "generate", { title: brief.title, url: base + path });
      let res: Response;
      try {
        res = await fetchFn(`${base}${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          signal,
        });
      } catch (err) {
        throw new MusicGenError(
          `Could not reach ACE-Step at ${base}. Is the local server running (make serve)?`,
          "acestep-local",
          err,
        );
      }
      if (!res.ok) {
        throw new MusicGenError(
          `ACE-Step returned ${res.status}`,
          "acestep-local",
          await res.text().catch(() => ""),
        );
      }
      const { blob, mime } = await resolveAudio(res);
      const durationSec =
        readWavDuration(await blob.arrayBuffer().catch(() => null)) ?? brief.durationSec;
      return { blob, mime, durationSec, provider: "acestep-local" };
    },

    async health() {
      try {
        const fetchFn = await getAppFetch();
        const res = await fetchFn(base, { method: "GET" });
        return res.ok || res.status < 500;
      } catch {
        return false;
      }
    },
  };
}

/** Parse exact duration from a WAV header; returns null for non-WAV / malformed. */
function readWavDuration(buf: ArrayBuffer | null): number | null {
  if (!buf || buf.byteLength < 44) return null;
  const view = new DataView(buf);
  const riff = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3),
  );
  if (riff !== "RIFF") return null;
  const byteRate = view.getUint32(28, true);
  // Walk chunks to find "data".
  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const id = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3),
    );
    const size = view.getUint32(offset + 4, true);
    if (id === "data") return byteRate > 0 ? size / byteRate : null;
    offset += 8 + size + (size % 2);
  }
  return null;
}
