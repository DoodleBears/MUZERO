/**
 * Social Stream Ninja public-relay WebSocket client. Vendor specifics are
 * isolated here (mirroring the cloud-provider mapping discipline): the join URL,
 * the channel-4 chat-event shape, and reconnect/backoff. Downstream just gets
 * chat records to feed through the same mapping/normalize pipeline as the
 * webhook transport — the `social-stream-ninja` mapping preset reads `chatmessage`
 * / `type` / `chatname` directly, so no remap is needed here.
 *
 * Read-only: we join via the URL channel and never send, so the relay can't be
 * driven from MUZERO. Deterministic for tests — the socket factory and `sleep`
 * are injected (no real timers / WebSocket in unit tests), mirroring cloud-job.
 */

export interface RelaySocketHandlers {
  onOpen: () => void;
  onMessage: (data: string) => void;
  onClose: () => void;
  onError: (error: unknown) => void;
}

export interface RelaySocket {
  close(): void;
}

export type RelaySocketFactory = (url: string, handlers: RelaySocketHandlers) => RelaySocket;

export type RelayState = "connecting" | "open" | "closed";

export interface SocialStreamRelayDeps {
  relayUrl: string;
  sessionId: string;
  onChat: (event: Record<string, unknown>) => void;
  createSocket: RelaySocketFactory;
  sleep?: (ms: number) => Promise<void>;
}

export interface SocialStreamRelay {
  stop(): void;
  status(): RelayState;
}

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 500;

/** Public SSN relay (Q1). Overridable per-source via `ssnRelayUrl` for self-hosted relays. */
export const DEFAULT_SSN_RELAY_URL = "wss://io.socialstream.ninja";

/** SSN join URL for chat messages (channel 4). */
export function buildJoinUrl(relayUrl: string, sessionId: string): string {
  return `${relayUrl.replace(/\/+$/, "")}/join/${encodeURIComponent(sessionId)}/4`;
}

/** A relay frame → the chat record to forward, or null for control/non-chat frames. */
export function parseRelayEvent(data: string): Record<string, unknown> | null {
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const message = record.chatmessage ?? record.textContent;
  if (typeof message !== "string" || !message.trim()) return null;
  return record;
}

export function connectSocialStreamRelay(deps: SocialStreamRelayDeps): SocialStreamRelay {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let stopped = false;
  let socket: RelaySocket | null = null;
  let attempt = 0;
  let state: RelayState = "connecting";

  function open(): void {
    if (stopped) return;
    state = "connecting";
    socket = deps.createSocket(buildJoinUrl(deps.relayUrl, deps.sessionId), {
      onOpen: () => {
        attempt = 0;
        state = "open";
      },
      onMessage: (data) => {
        const event = parseRelayEvent(data);
        if (event) deps.onChat(event);
      },
      onClose: () => {
        state = "closed";
        void scheduleReconnect();
      },
      onError: () => {
        // A close event follows; reconnect is driven from onClose.
      },
    });
  }

  async function scheduleReconnect(): Promise<void> {
    if (stopped) return;
    attempt += 1;
    await sleep(Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (attempt - 1)));
    if (!stopped) open();
  }

  open();

  return {
    stop() {
      stopped = true;
      socket?.close();
      socket = null;
      state = "closed";
    },
    status: () => state,
  };
}
