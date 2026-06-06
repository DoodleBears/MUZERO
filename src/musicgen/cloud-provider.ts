import type { TrackBrief } from "@/dj/dj-brief-schema";
import { log } from "@/lib/logger";
import { getAppFetch } from "@/lib/platform";
import { type JobStatus, pollUntilComplete } from "./cloud-job";
import {
  MusicGenError,
  type MusicGenProvider,
  type MusicGenRequest,
  type MusicGenResult,
} from "./provider";

/**
 * Generic cloud music-generation provider (BYOK). MUZERO stays local-first for
 * storage — tracks/audio/settings never leave the device — but music rendering
 * calls a cloud API the user configures (endpoint + API key), the same BYOK
 * model as the LLM DJ.
 *
 * Because the concrete vendor isn't picked yet, the request/response mapping is
 * isolated in the three pure functions below (`mapBriefToBody`, `parseCreate`,
 * `parseStatus`). When you choose a provider (Replicate / ElevenLabs Music /
 * Suno-style / …), adjust ONLY those three — the submit→poll→download flow,
 * abort handling, and DB wiring stay the same.
 */
export interface CloudMusicGenConfig {
  /** Base URL of the cloud API, e.g. "https://api.example.com/v1". */
  baseUrl: string;
  apiKey?: string;
  /** Optional model id the vendor expects. */
  model?: string;
  /** Path appended to baseUrl to create a generation job. Default "/music". */
  createPath?: string;
  /** Path template to poll a job; "{id}" is replaced. Default "/music/{id}". */
  statusPath?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
  /**
   * Auth header scheme. Most vendors (ElevenLabs / Mureka) use "bearer"
   * (`Authorization: Bearer …`); fal.ai uses "key" (`Authorization: Key …`).
   * Defaults to "bearer".
   */
  authScheme?: "bearer" | "key";
  /** Injected fetch for tests; defaults to the CORS-safe {@link getAppFetch}. */
  fetchImpl?: typeof globalThis.fetch;
}

/** Vendor-specific: TrackBrief → request body. Edit when you pick a provider. */
export function mapBriefToBody(
  brief: TrackBrief,
  cfg: CloudMusicGenConfig,
): Record<string, unknown> {
  return {
    model: cfg.model,
    prompt: brief.caption,
    lyrics: brief.lyrics || undefined,
    duration_seconds: brief.durationSec,
    bpm: brief.bpm,
    key: brief.keyscale,
    time_signature: brief.timeSignature,
    language: brief.vocalLanguage,
    title: brief.title,
  };
}

export interface CreateResult {
  jobId?: string;
  audioUrl?: string;
}

/**
 * The three vendor-specific pure functions a preset injects. Keeping them as an
 * injectable bundle (rather than `if (preset === …)` branches) is how MUZERO
 * supports multiple cloud vendors over one shared submit→poll→download flow.
 */
export interface CloudMappers {
  mapBriefToBody: (brief: TrackBrief, cfg: CloudMusicGenConfig) => Record<string, unknown>;
  parseCreate: (json: unknown) => CreateResult;
  parseStatus: (json: unknown) => JobStatus;
}

/** Vendor-specific: parse the create response → finished audio URL or a job id. */
export function parseCreate(json: unknown): CreateResult {
  const obj = (json ?? {}) as Record<string, unknown>;
  const audioUrl =
    pickString(obj, ["audio_url", "url", "output"]) ??
    pickString(obj.output as Record<string, unknown>, ["audio", "url"]);
  const jobId = pickString(obj, ["id", "job_id", "request_id", "task_id"]);
  return { audioUrl, jobId };
}

/** Vendor-specific: parse a status poll response → {@link JobStatus}. */
export function parseStatus(json: unknown): JobStatus {
  const obj = (json ?? {}) as Record<string, unknown>;
  const raw = (pickString(obj, ["status", "state"]) ?? "").toLowerCase();
  const audioUrl =
    pickString(obj, ["audio_url", "url", "output"]) ??
    pickString(obj.output as Record<string, unknown>, ["audio", "url"]);
  const progress = typeof obj.progress === "number" ? obj.progress : undefined;
  if (
    ["succeeded", "success", "completed", "complete", "done"].includes(raw) ||
    (!raw && audioUrl)
  ) {
    return { state: "succeeded", audioUrl, progress };
  }
  if (["failed", "error", "canceled", "cancelled"].includes(raw)) {
    return { state: "failed", error: pickString(obj, ["error", "message"]) ?? raw, progress };
  }
  return { state: "pending", audioUrl, progress };
}

function pickString(obj: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!obj) return undefined;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v) return v;
  }
  return undefined;
}

/** Build the auth + content-type headers for the configured scheme. */
export function buildAuthHeaders(
  authScheme: "bearer" | "key" | undefined,
  apiKey?: string,
): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (apiKey) {
    const prefix = authScheme === "key" ? "Key" : "Bearer";
    headers.authorization = `${prefix} ${apiKey}`;
  }
  return headers;
}

/** The generic, vendor-agnostic mappers — also the "custom" preset's defaults. */
const GENERIC_MAPPERS: CloudMappers = { mapBriefToBody, parseCreate, parseStatus };

export function createCloudMusicGenProvider(
  cfg: CloudMusicGenConfig,
  mappers: CloudMappers = GENERIC_MAPPERS,
): MusicGenProvider {
  const base = cfg.baseUrl.replace(/\/$/, "");
  const createPath = cfg.createPath ?? "/music";
  const statusPath = cfg.statusPath ?? "/music/{id}";
  const pollIntervalMs = cfg.pollIntervalMs ?? 2500;
  const timeoutMs = cfg.timeoutMs ?? 5 * 60_000;

  const resolveFetch = async () => cfg.fetchImpl ?? (await getAppFetch());

  function authHeaders(): Record<string, string> {
    return buildAuthHeaders(cfg.authScheme, cfg.apiKey);
  }

  async function download(
    url: string,
    signal?: AbortSignal,
  ): Promise<{ blob: Blob; mime: string }> {
    const fetchFn = await resolveFetch();
    const fullUrl = url.startsWith("http") ? url : `${base}/${url.replace(/^\//, "")}`;
    const res = await fetchFn(fullUrl, { signal });
    if (!res.ok) throw new MusicGenError(`Audio download failed (${res.status})`, "cloud");
    const blob = await res.blob();
    return { blob, mime: blob.type || "audio/mpeg" };
  }

  return {
    id: "cloud",
    label: "Cloud API (BYOK)",
    requiresConfig: true,

    async generate({ brief, signal, onProgress }: MusicGenRequest): Promise<MusicGenResult> {
      if (!base)
        throw new MusicGenError("No cloud API URL configured. Add one in Settings.", "cloud");
      const fetchFn = await resolveFetch();

      // 1) Create the generation job.
      let createRes: Response;
      try {
        createRes = await fetchFn(`${base}${createPath}`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify(mappers.mapBriefToBody(brief, cfg)),
          signal,
        });
      } catch (err) {
        throw new MusicGenError(`Could not reach the cloud music API at ${base}.`, "cloud", err);
      }
      if (!createRes.ok) {
        throw new MusicGenError(
          `Cloud API returned ${createRes.status}`,
          "cloud",
          await createRes.text().catch(() => ""),
        );
      }

      // Some vendors return audio bytes directly from the create call.
      const createType = createRes.headers.get("content-type") ?? "";
      if (createType.startsWith("audio/")) {
        const blob = await createRes.blob();
        return { blob, mime: createType, durationSec: brief.durationSec, provider: "cloud" };
      }

      const created = mappers.parseCreate(await createRes.json());
      let audioUrl = created.audioUrl;

      // 2) Poll until the job finishes (if it wasn't synchronous).
      const jobId = created.jobId;
      if (!audioUrl && jobId) {
        const final = await pollUntilComplete(
          async () => {
            const statusRes = await fetchFn(`${base}${statusPath.replace("{id}", jobId)}`, {
              headers: authHeaders(),
              signal,
            });
            if (!statusRes.ok) {
              return { state: "failed", error: `status ${statusRes.status}` } satisfies JobStatus;
            }
            return mappers.parseStatus(await statusRes.json());
          },
          { intervalMs: pollIntervalMs, timeoutMs, signal, onProgress },
        );
        audioUrl = final.audioUrl;
        if (final.blob) {
          return {
            blob: final.blob,
            mime: final.blob.type || "audio/mpeg",
            durationSec: brief.durationSec,
            provider: "cloud",
          };
        }
      }

      if (!audioUrl) throw new MusicGenError("Cloud API did not return audio.", "cloud", created);

      // 3) Download the rendered audio.
      log.debug("cloud", "downloading audio", { title: brief.title });
      const { blob, mime } = await download(audioUrl, signal);
      return { blob, mime, durationSec: brief.durationSec, provider: "cloud" };
    },

    async health() {
      if (!base) return false;
      try {
        const fetchFn = await resolveFetch();
        const res = await fetchFn(base, { method: "GET" });
        return res.status < 500;
      } catch {
        return false;
      }
    },
  };
}
