export interface AudienceRequestWebhookPreset {
  id: "social-stream-ninja" | "generic-json";
  method: "POST";
  bodyMode: "json";
  authModes: readonly ("query-token" | "bearer-token")[];
  examplePayload: Record<string, unknown>;
}

export const SOCIAL_STREAM_NINJA_WEBHOOK_PRESET = {
  id: "social-stream-ninja",
  method: "POST",
  bodyMode: "json",
  authModes: ["query-token", "bearer-token"],
  examplePayload: {
    app: "Social Stream Ninja",
    id: "ssn-msg-1",
    platform: "youtube",
    roomId: "room-1",
    userid: "alice-1",
    chatname: "Alice",
    chatmessage: "点歌 Plastic Love",
    role: "moderator",
  },
} as const satisfies AudienceRequestWebhookPreset;

export const GENERIC_WEBHOOK_EXAMPLE = {
  id: "generic-json",
  method: "POST",
  bodyMode: "json",
  authModes: ["bearer-token", "query-token"],
  examplePayload: {
    source: "obs-script",
    platform: "youtube",
    messageId: "evt-1",
    username: "viewer",
    message: "!song lofi rain",
    role: "viewer",
  },
} as const satisfies AudienceRequestWebhookPreset;

export function authorizationHeader(token: string | undefined): string {
  return `Authorization: Bearer ${token?.trim() || "<token>"}`;
}

export function examplePayloadJson(payload: Record<string, unknown>): string {
  return JSON.stringify(payload, null, 2);
}
