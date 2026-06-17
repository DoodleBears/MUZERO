import {
  connectSocialStreamRelay,
  type RelaySocketFactory,
  type SocialStreamRelay,
} from "@/live-requests/social-stream-relay";
import type {
  DesktopBridge,
  DesktopLiveRequestIntakeControls,
  LiveRequestIntakePayload,
} from "./bridge";

/**
 * Plain-browser bridge (Vite dev, vitest, or a hosted web build). No filesystem
 * or save dialog → callers fall back to `<input webkitdirectory>` / anchor
 * downloads. `fetch` is the global (subject to CORS — BYOK endpoints must allow it).
 */
export function createWebBridge(): DesktopBridge {
  return {
    kind: "web",
    fetch: globalThis.fetch.bind(globalThis),
    openExternal: async (rawUrl) => {
      const url = new URL(rawUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("Unsupported external URL protocol");
      }
      window.open(url.toString(), "_blank", "noreferrer");
    },
    liveRequestIntake: createWebLiveRequestIntake(),
  };
}

/** A browser `WebSocket` adapted to the relay's injectable socket interface. */
const webSocketFactory: RelaySocketFactory = (url, handlers) => {
  const ws = new WebSocket(url);
  ws.addEventListener("open", () => handlers.onOpen());
  ws.addEventListener("message", (event) =>
    handlers.onMessage(typeof event.data === "string" ? event.data : ""),
  );
  ws.addEventListener("close", () => handlers.onClose());
  ws.addEventListener("error", (event) => handlers.onError(event));
  return { close: () => ws.close() };
};

/**
 * Web intake transport: an outbound SSN-relay WebSocket subscription (the web
 * surface can't host an inbound HTTP server). `http-webhook` is unsupported here.
 * Multiple `onMessage` subscribers are supported (panel inbox + controller).
 */
function createWebLiveRequestIntake(): DesktopLiveRequestIntakeControls {
  const listeners = new Set<(payload: LiveRequestIntakePayload) => void>();
  let relay: SocialStreamRelay | null = null;

  function stopRelay(): void {
    relay?.stop();
    relay = null;
  }

  return {
    start: async (input) => {
      if (input.transport !== "ssn-websocket") {
        return {
          supported: true,
          listening: false,
          error: "web transport supports ssn-websocket only",
        };
      }
      stopRelay();
      relay = connectSocialStreamRelay({
        relayUrl: input.relayUrl,
        sessionId: input.sessionId,
        createSocket: webSocketFactory,
        onChat: (event) => {
          const payload: LiveRequestIntakePayload = {
            sourceId: input.sourceId,
            body: JSON.stringify(event),
            receivedAt: Date.now(),
          };
          for (const listener of listeners) listener(payload);
        },
      });
      return { supported: true, listening: true };
    },
    stop: async () => {
      stopRelay();
      return { supported: true, listening: false };
    },
    status: async () => {
      const state = relay?.status();
      return { supported: true, listening: state === "open" || state === "connecting" };
    },
    onMessage: (callback) => {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
  };
}
