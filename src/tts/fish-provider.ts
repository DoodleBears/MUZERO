/**
 * Fish Audio TTS provider. BYOK, called directly through {@link getAppFetch}
 * (CORS-safe) — never `window.fetch` an external API (CLAUDE.md rules 5/10).
 * `self_only=true` lists the key owner's voices, `title=` searches, `GET
 * /model/{id}` resolves a pasted public id, and `POST /v1/tts` synthesizes.
 * Vendor request/response shaping lives in the pure `fish-mapping.ts`.
 */

import { createDiagnosticLogger } from "@/lib/logger";
import { getAppFetch } from "@/lib/platform";
import {
  classifyFishError,
  DEFAULT_FISH_BACKEND,
  FISH_API_BASE,
  type FishTtsBackend,
  mapReplyToTtsBody,
  parseVoiceModel,
  parseVoiceModelList,
  type TtsAudioFormat,
} from "./fish-mapping";
import {
  type ListVoicesOptions,
  TtsError,
  type TtsProvider,
  type TtsSynthesizeInput,
  type VoiceModel,
} from "./provider";

const diag = createDiagnosticLogger("voice.tts");

export interface FishTtsConfig {
  apiKey: string;
  /** Synthesis backend (sent as the `model` header). Default s2.1-pro-free. */
  backend?: FishTtsBackend;
  /** Output container. Default "mp3" (widest `<audio>`/decode support). */
  format?: TtsAudioFormat;
  /** Injected fetch for tests; defaults to the CORS-safe {@link getAppFetch}. */
  fetchImpl?: typeof globalThis.fetch;
}

export function createFishTtsProvider(cfg: FishTtsConfig): TtsProvider {
  const backend = cfg.backend ?? DEFAULT_FISH_BACKEND;
  const format = cfg.format ?? "mp3";
  const resolveFetch = async () => cfg.fetchImpl ?? (await getAppFetch());

  function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return { authorization: `Bearer ${cfg.apiKey}`, ...extra };
  }

  async function failFor(res: Response, action: string): Promise<never> {
    const kind = classifyFishError(res.status);
    const detail = await res
      .json()
      .then((body) => (body as { message?: string; detail?: string })?.message)
      .catch(() => undefined);
    throw new TtsError(
      detail ?? `Fish Audio ${action} failed (${res.status}).`,
      kind,
      "fish-audio",
      res.status,
    );
  }

  return {
    id: "fish-audio",

    async listVoices({ query, ownedOnly, signal }: ListVoicesOptions): Promise<VoiceModel[]> {
      const params = new URLSearchParams({ page_size: "50", page_number: "1" });
      if (ownedOnly) params.set("self_only", "true");
      if (query?.trim()) params.set("title", query.trim());
      const fetchFn = await resolveFetch();
      const res = await fetchFn(`${FISH_API_BASE}/model?${params.toString()}`, {
        headers: authHeaders(),
        signal,
      });
      if (!res.ok) return failFor(res, "list");
      return parseVoiceModelList(await res.json());
    },

    async getVoice(id: string, signal?: AbortSignal): Promise<VoiceModel | null> {
      const fetchFn = await resolveFetch();
      const res = await fetchFn(`${FISH_API_BASE}/model/${encodeURIComponent(id)}`, {
        headers: authHeaders(),
        signal,
      });
      if (res.status === 404) return null;
      if (!res.ok) return failFor(res, "get");
      return parseVoiceModel(await res.json());
    },

    async synthesize({ text, voiceId, speed, signal }: TtsSynthesizeInput) {
      if (!cfg.apiKey) throw new TtsError("No Fish Audio API key.", "auth", "fish-audio");
      const fetchFn = await resolveFetch();
      let res: Response;
      try {
        res = await fetchFn(`${FISH_API_BASE}/v1/tts`, {
          method: "POST",
          headers: authHeaders({ "content-type": "application/json", model: backend }),
          body: JSON.stringify(mapReplyToTtsBody({ text, voiceId, speed }, { format })),
          signal,
        });
      } catch (err) {
        throw new TtsError("Could not reach Fish Audio.", "network", "fish-audio", undefined, err);
      }
      if (!res.ok) return failFor(res, "synthesis");
      const blob = await res.blob();
      const mime = blob.type || res.headers.get("content-type") || `audio/${format}`;
      diag.info("synthesized", { provider: "fish-audio", bytes: blob.size });
      return { blob, mime };
    },
  };
}
