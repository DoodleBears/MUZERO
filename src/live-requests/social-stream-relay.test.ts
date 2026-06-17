import { describe, expect, it, vi } from "vitest";
import {
  buildJoinUrl,
  connectSocialStreamRelay,
  parseRelayEvent,
  type RelaySocketHandlers,
} from "./social-stream-relay";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("buildJoinUrl", () => {
  it("targets channel 4 and tolerates a trailing slash", () => {
    expect(buildJoinUrl("wss://io.socialstream.ninja", "ABC")).toBe(
      "wss://io.socialstream.ninja/join/ABC/4",
    );
    expect(buildJoinUrl("wss://io.socialstream.ninja/", "ABC")).toBe(
      "wss://io.socialstream.ninja/join/ABC/4",
    );
  });
});

describe("parseRelayEvent", () => {
  it("returns the record for chat frames", () => {
    expect(parseRelayEvent(JSON.stringify({ chatmessage: "hi", type: "twitch" }))).toMatchObject({
      chatmessage: "hi",
      type: "twitch",
    });
    expect(parseRelayEvent(JSON.stringify({ textContent: "yo" }))).toMatchObject({
      textContent: "yo",
    });
  });

  it("drops non-chat / control / malformed frames", () => {
    expect(parseRelayEvent("not json")).toBeNull();
    expect(parseRelayEvent(JSON.stringify({}))).toBeNull();
    expect(parseRelayEvent(JSON.stringify({ chatmessage: "   " }))).toBeNull();
    expect(parseRelayEvent(JSON.stringify("timeout"))).toBeNull();
  });
});

describe("connectSocialStreamRelay", () => {
  function harness() {
    const sockets: Array<{
      url: string;
      handlers: RelaySocketHandlers;
      close: ReturnType<typeof vi.fn>;
    }> = [];
    const createSocket = (url: string, handlers: RelaySocketHandlers) => {
      const socket = { url, handlers, close: vi.fn() };
      sockets.push(socket);
      return socket;
    };
    return { sockets, createSocket };
  }

  it("connects to the channel-4 join URL and forwards only chat frames", () => {
    const { sockets, createSocket } = harness();
    const onChat = vi.fn();
    const relay = connectSocialStreamRelay({
      relayUrl: "wss://io.socialstream.ninja",
      sessionId: "S",
      onChat,
      createSocket,
      sleep: async () => {},
    });

    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toBe("wss://io.socialstream.ninja/join/S/4");

    sockets[0].handlers.onOpen();
    sockets[0].handlers.onMessage(JSON.stringify({ chatmessage: "点歌 X", type: "youtube" }));
    sockets[0].handlers.onMessage(JSON.stringify({ state: "connected" })); // control frame

    expect(onChat).toHaveBeenCalledTimes(1);
    expect(onChat.mock.calls[0][0]).toMatchObject({ chatmessage: "点歌 X" });
    relay.stop();
  });

  it("reconnects after the socket closes", async () => {
    const { sockets, createSocket } = harness();
    const relay = connectSocialStreamRelay({
      relayUrl: "wss://io.socialstream.ninja",
      sessionId: "S",
      onChat: vi.fn(),
      createSocket,
      sleep: async () => {},
    });

    sockets[0].handlers.onOpen();
    sockets[0].handlers.onClose();
    await flush();

    expect(sockets.length).toBeGreaterThanOrEqual(2);
    relay.stop();
  });

  it("stops reconnecting once stopped", async () => {
    const { sockets, createSocket } = harness();
    const relay = connectSocialStreamRelay({
      relayUrl: "wss://io.socialstream.ninja",
      sessionId: "S",
      onChat: vi.fn(),
      createSocket,
      sleep: async () => {},
    });

    relay.stop();
    sockets[0].handlers.onClose();
    await flush();

    expect(sockets).toHaveLength(1);
    expect(sockets[0].close).toHaveBeenCalled();
  });
});
