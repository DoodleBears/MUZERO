/**
 * Mureka — MUZERO's quality / multilingual tier (BYOK, opt-in).
 *
 * Official async API (`https://api.mureka.ai`): `POST /v1/song/generate` returns
 * a task, then `GET /v1/song/query/{id}` is polled until the audio is ready —
 * a clean fit for the shared submit→poll→download flow. Ranks #2 on the
 * Artificial Analysis vocal arena (V8) and improves zh/ja/ko pronunciation in V9.
 *
 * Pricing is a prepaid balance ($30 entry, 12-month validity) billed per call —
 * V8/V9 ~$0.045/song — so this is an opt-in tier, not the default (ACE-Step is
 * cheaper at ~$0.012 with no prepay). Bearer auth.
 *
 * v1 scope: vocal songs via `/v1/song/generate` only. Instrumental on Mureka
 * (the separate BGM endpoint) is deferred — use ACE-Step `[inst]` for that, since
 * the shared flow uses one static create path. Mureka also returns up to 2-3
 * variants per call; we take the first. Variant-count (`n`) and the exact model
 * string are pending live-API verification (see PRD Open Questions).
 */

import type { TrackBrief } from "@/dj/dj-brief-schema";
import type { JobStatus } from "../cloud-job";
import type { CloudMappers, CloudMusicGenConfig, CreateResult } from "../cloud-provider";
import type { CloudPreset } from "./index";

const MUREKA_BASE_URL = "https://api.mureka.ai";
const SUCCESS = ["succeeded", "success", "completed", "complete", "finished", "done"];
const FAILURE = ["failed", "error", "timeouted", "timeout", "cancelled", "canceled"];

function str(obj: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!obj) return undefined;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v) return v;
  }
  return undefined;
}

/** Find the first rendered audio url across Mureka's result shapes. */
function firstAudioUrl(obj: Record<string, unknown>): string | undefined {
  const top = str(obj, ["mp3_url", "audio_url", "url", "flac_url"]);
  if (top) return top;
  for (const key of ["choices", "songs", "data"]) {
    const arr = obj[key];
    if (Array.isArray(arr)) {
      for (const item of arr) {
        const url = str(item as Record<string, unknown>, [
          "url",
          "mp3_url",
          "flac_url",
          "audio_url",
        ]);
        if (url) return url;
      }
    }
  }
  return undefined;
}

function mapBriefToBody(brief: TrackBrief, cfg: CloudMusicGenConfig): Record<string, unknown> {
  return {
    lyrics: brief.lyrics ?? "",
    prompt: brief.caption,
    model: cfg.model ?? "auto",
  };
}

function parseCreate(json: unknown): CreateResult {
  const obj = (json ?? {}) as Record<string, unknown>;
  return {
    audioUrl: firstAudioUrl(obj),
    jobId: str(obj, ["id", "task_id", "job_id"]),
  };
}

function parseStatus(json: unknown): JobStatus {
  const obj = (json ?? {}) as Record<string, unknown>;
  const status = (str(obj, ["status", "state"]) ?? "").toLowerCase();
  const audioUrl = firstAudioUrl(obj);
  if (SUCCESS.includes(status) || (!status && audioUrl)) {
    return { state: "succeeded", audioUrl };
  }
  if (FAILURE.includes(status)) {
    return { state: "failed", error: str(obj, ["error", "message", "failed_reason"]) ?? status };
  }
  return { state: "pending", audioUrl };
}

const mappers: CloudMappers = { mapBriefToBody, parseCreate, parseStatus };

export const murekaPreset: CloudPreset = {
  id: "mureka",
  label: "Mureka · high-quality · multilingual",
  authScheme: "bearer",
  fixedEndpoint: true,
  defaults: {
    baseUrl: MUREKA_BASE_URL,
    createPath: "/v1/song/generate",
    statusPath: "/v1/song/query/{id}",
    model: "auto",
  },
  mappers,
};
