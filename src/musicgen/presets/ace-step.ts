/**
 * ACE-Step on fal.ai — MUZERO's default cloud music provider (BYOK).
 *
 * Open-weights ACE-Step, hosted by fal.ai with an official documented API.
 * Cheapest vocals+lyrics option (~$0.012 per 60s song) and maps almost 1:1 onto
 * the TrackBrief: `caption → tags`, `lyrics → lyrics` (with [verse]/[chorus]
 * structure tags, or [inst] for instrumental), `durationSec → duration`.
 *
 * We use fal's SYNCHRONOUS endpoint (`https://fal.run/...`): the POST blocks
 * until the audio is rendered and returns `{ audio: { url } }` directly, which
 * fits the shared create→(poll)→download flow with no changes to cloud-job.ts.
 * (The async queue at `https://queue.fal.run/...` is a two-step status→result
 * dance that would need extra plumbing; ACE-Step is fast enough for sync.)
 *
 * Auth is fal-style `Authorization: Key <FAL_KEY>` (not Bearer).
 */

import type { TrackBrief } from "@/dj/dj-brief-schema";
import type { JobStatus } from "../cloud-job";
import type { CloudMappers, CloudMusicGenConfig, CreateResult } from "../cloud-provider";
import type { CloudPreset } from "./index";

const FAL_ACE_STEP_SYNC_URL = "https://fal.run/fal-ai/ace-step";

function str(obj: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!obj) return undefined;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v) return v;
  }
  return undefined;
}

/** Pull a nested `audio.url` (sync result) or top-level audio url (variants). */
function audioUrlOf(obj: Record<string, unknown>): string | undefined {
  const audio = obj.audio as Record<string, unknown> | undefined;
  const audioFile = obj.audio_file as Record<string, unknown> | undefined;
  return str(audio, ["url"]) ?? str(audioFile, ["url"]) ?? str(obj, ["audio_url", "url", "output"]);
}

function mapBriefToBody(brief: TrackBrief, _cfg: CloudMusicGenConfig): Record<string, unknown> {
  const lyrics = brief.lyrics?.trim() ? brief.lyrics : "[inst]";
  return {
    tags: brief.caption,
    lyrics,
    duration: brief.durationSec,
  };
}

function parseCreate(json: unknown): CreateResult {
  const obj = (json ?? {}) as Record<string, unknown>;
  return {
    audioUrl: audioUrlOf(obj),
    jobId: str(obj, ["request_id", "id"]),
  };
}

function parseStatus(json: unknown): JobStatus {
  const obj = (json ?? {}) as Record<string, unknown>;
  const audioUrl = audioUrlOf(obj);
  const status = (str(obj, ["status", "state"]) ?? "").toUpperCase();
  if (audioUrl || status === "COMPLETED" || status === "OK") {
    return { state: "succeeded", audioUrl };
  }
  if (["FAILED", "ERROR", "CANCELED", "CANCELLED"].includes(status)) {
    return { state: "failed", error: str(obj, ["error", "message"]) ?? status };
  }
  return { state: "pending" };
}

const mappers: CloudMappers = { mapBriefToBody, parseCreate, parseStatus };

export const aceStepPreset: CloudPreset = {
  id: "ace-step",
  label: "ACE-Step (fal.ai) · cheapest",
  authScheme: "key",
  fixedEndpoint: true,
  estCostPerSongUsd: 0.012,
  apiKeyUrl: "https://fal.ai/dashboard/keys",
  defaults: { baseUrl: FAL_ACE_STEP_SYNC_URL, createPath: "", statusPath: "" },
  mappers,
};
