import { z } from "zod";

export type AudienceRequestRouteMode = "ai-dj" | "library-search" | "hybrid";
export type AudienceRequestPlaybackAction =
  | "manual-review"
  | "play-next"
  | "append-queue"
  | "play-now";

export type AudienceRequestSourceKind = "social-stream-ninja" | "http" | "manual-test";
export type AudienceRequesterRole = "viewer" | "moderator" | "broadcaster" | "unknown";

export interface NormalizedAudienceRequest {
  externalId?: string;
  sourceKind: AudienceRequestSourceKind;
  platform?: string;
  roomId?: string;
  requesterDisplayName?: string;
  requesterKey?: string;
  requesterRole: AudienceRequesterRole;
  rawMessage: string;
  normalizedQuery: string;
  receivedAt: number;
}

export interface NormalizeAudienceRequestOptions {
  commandPrefixes?: readonly string[];
  now?: number;
}

const looseRecord = z.record(z.string(), z.unknown());

function readString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function readObject(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeRole(value: string | undefined): AudienceRequesterRole {
  const role = value?.trim().toLowerCase();
  if (role === "moderator" || role === "mod") return "moderator";
  if (role === "broadcaster" || role === "host" || role === "owner") return "broadcaster";
  if (role === "viewer" || role === "audience") return "viewer";
  return "unknown";
}

function sourceKindFor(value: string | undefined): AudienceRequestSourceKind {
  const source = value
    ?.trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  return source === "socialstreamninja" ? "social-stream-ninja" : "http";
}

export function stripAudienceRequestPrefix(
  message: string,
  commandPrefixes: readonly string[] = [],
): string {
  const trimmed = message.trim();
  const lower = trimmed.toLowerCase();
  for (const rawPrefix of commandPrefixes) {
    const prefix = rawPrefix.trim();
    if (!prefix) continue;
    const lowerPrefix = prefix.toLowerCase();
    if (!lower.startsWith(lowerPrefix)) continue;
    return trimmed.slice(prefix.length).trim();
  }
  return trimmed;
}

export function normalizeAudienceRequest(
  raw: unknown,
  options: NormalizeAudienceRequestOptions = {},
): NormalizedAudienceRequest {
  const record = looseRecord.parse(raw);
  const user = readObject(record, "user");
  const source = readString(record, ["source", "type", "app"]);
  const platform =
    readString(record, ["platform", "service", "site", "sourcePlatform"]) ??
    readString(user, ["platform"]);
  const requesterId = readString(user, ["id", "userId", "uid"]) ?? readString(record, ["userid"]);
  const requesterDisplayName =
    readString(user, ["name", "displayName", "username"]) ??
    readString(record, ["chatname", "username", "userName", "name"]);
  const rawMessage = readString(record, [
    "message",
    "text",
    "chatmessage",
    "comment",
    "body",
    "content",
  ]);

  if (!rawMessage) {
    throw new Error("Audience request payload did not include a message field.");
  }

  const normalizedQuery = stripAudienceRequestPrefix(rawMessage, options.commandPrefixes);
  const requesterKey =
    requesterId && platform
      ? `${platform.toLowerCase()}:${requesterId}`
      : requesterDisplayName && platform
        ? `${platform.toLowerCase()}:${requesterDisplayName.toLowerCase()}`
        : undefined;

  return {
    externalId: readString(record, ["id", "eventId", "messageId", "uuid"]),
    sourceKind: sourceKindFor(source),
    platform,
    roomId: readString(record, ["roomId", "room", "channelId", "channel"]),
    requesterDisplayName,
    requesterKey,
    requesterRole: normalizeRole(readString(user, ["role"]) ?? readString(record, ["role"])),
    rawMessage: rawMessage.trim(),
    normalizedQuery,
    receivedAt: options.now ?? Date.now(),
  };
}
