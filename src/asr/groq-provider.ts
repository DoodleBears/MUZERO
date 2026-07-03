/**
 * Groq Whisper ASR provider. BYOK, called directly through {@link getAppFetch}
 * (Electron `muzfetch://` / Tauri http / web) so it bypasses CORS the same way
 * the musicgen cloud provider does — never `window.fetch` an external API
 * (CLAUDE.md rules 5/10). All vendor request/response shaping lives in the pure
 * `groq-mapping.ts`; this file is just the network + error plumbing.
 */

import { createDiagnosticLogger } from "@/lib/logger";
import { getAppFetch } from "@/lib/platform";
import {
  buildTranscribeForm,
  classifyGroqError,
  DEFAULT_GROQ_MODEL,
  GROQ_TRANSCRIBE_URL,
  type GroqWhisperModel,
  parseTranscript,
} from "./groq-mapping";
import { AsrError, type AsrProvider, type AsrTranscribeInput } from "./provider";

const diag = createDiagnosticLogger("voice.asr");

export interface GroqAsrConfig {
  apiKey: string;
  model?: GroqWhisperModel;
  /** Injected fetch for tests; defaults to the CORS-safe {@link getAppFetch}. */
  fetchImpl?: typeof globalThis.fetch;
}

export function createGroqAsrProvider(cfg: GroqAsrConfig): AsrProvider {
  const model = cfg.model ?? DEFAULT_GROQ_MODEL;
  const resolveFetch = async () => cfg.fetchImpl ?? (await getAppFetch());

  return {
    id: "groq",

    async transcribe({ blob, language, signal }: AsrTranscribeInput) {
      if (!cfg.apiKey) {
        throw new AsrError("No Groq API key configured.", "auth", "groq");
      }
      const form = buildTranscribeForm(blob, { model, language });
      const fetchFn = await resolveFetch();

      let res: Response;
      try {
        res = await fetchFn(GROQ_TRANSCRIBE_URL, {
          method: "POST",
          headers: { authorization: `Bearer ${cfg.apiKey}` },
          body: form,
          signal,
        });
      } catch (err) {
        throw new AsrError("Could not reach Groq.", "network", "groq", undefined, err);
      }

      if (!res.ok) {
        const kind = classifyGroqError(res.status);
        const detail = await res
          .json()
          .then((body) => (body as { error?: { message?: string } })?.error?.message)
          .catch(() => undefined);
        throw new AsrError(
          detail ?? `Groq transcription failed (${res.status}).`,
          kind,
          "groq",
          res.status,
        );
      }

      const result = parseTranscript(await res.json(), res.headers);
      diag.info("transcribed", {
        provider: "groq",
        // Byte count + quota only — never the transcript text itself (rule 2/8).
        bytes: blob.size,
        remainingAudioSeconds: result.remainingAudioSeconds,
      });
      return result;
    },
  };
}
