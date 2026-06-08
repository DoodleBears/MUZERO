import { z } from "zod";
import type { AppSettings, CloudDrive } from "@/db/types";

export const r2PresenceSchema = z.object({
  schema: z.literal("muzero-r2-presence-v1"),
  devicePublicId: z.string().min(1),
  deviceName: z.string().optional(),
  trackId: z.string().optional(),
  setId: z.string().optional(),
  state: z.enum(["playing", "paused", "stopped"]),
  positionSec: z.number().nonnegative().optional(),
  updatedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative(),
});

export type R2Presence = z.infer<typeof r2PresenceSchema>;

export interface PresenceInput {
  devicePublicId: string;
  deviceName?: string;
  trackId?: string;
  setId?: string;
  state: R2Presence["state"];
  positionSec?: number;
  now: number;
  ttlMs?: number;
}

const DEFAULT_TTL_MS = 120_000;
const MIN_HEARTBEAT_MS = 60_000;

export function toR2Presence(input: PresenceInput): R2Presence {
  const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
  return {
    schema: "muzero-r2-presence-v1",
    devicePublicId: input.devicePublicId,
    deviceName: input.deviceName,
    trackId: input.trackId,
    setId: input.setId,
    state: input.state,
    positionSec:
      input.positionSec != null && input.positionSec >= 0
        ? Math.round(input.positionSec)
        : undefined,
    updatedAt: input.now,
    expiresAt: input.now + ttlMs,
  };
}

export function presenceObjectKey(devicePublicId: string): string {
  return `presence/devices/${devicePublicId}.json`;
}

export function filterActivePresence(rows: R2Presence[], now: number): R2Presence[] {
  return rows.filter((presence) => presence.expiresAt >= now);
}

export function shouldWritePresence(previous: R2Presence | null, next: PresenceInput): boolean {
  if (!previous) return true;
  if (previous.devicePublicId !== next.devicePublicId) return true;
  if (previous.trackId !== next.trackId) return true;
  if (previous.setId !== next.setId) return true;
  if (previous.state !== next.state) return true;
  return next.now - previous.updatedAt >= MIN_HEARTBEAT_MS;
}

export function canWritePresenceToDrive(settings: AppSettings, drive: CloudDrive): boolean {
  if (!settings.presenceEnabled) return false;
  if (!drive.capabilities.writePresence) return false;
  return drive.kind === "owned" || drive.kind === "trusted";
}
