import { describe, expect, it, vi } from "vitest";
import {
  appendYoutubeCpn,
  decipherYtjsFormatUrl,
  readableStreamToBlob,
  withYtjsPlayerPoToken,
} from "./youtube-ytjs";

function streamOf(chunks: Uint8Array[], error?: Error): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(chunks[i++]);
        return;
      }
      if (error) controller.error(error);
      else controller.close();
    },
  });
}

describe("readableStreamToBlob", () => {
  it("collects the stream into a Blob of the given mime", async () => {
    const blob = await readableStreamToBlob(
      streamOf([new Uint8Array([1, 2]), new Uint8Array([3])]),
      "audio/mp4",
    );
    expect(blob.type).toBe("audio/mp4");
    expect(blob.size).toBe(3);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("propagates a mid-stream error to the caller (PRD F-2)", async () => {
    const stream = streamOf([new Uint8Array([1])], new Error("network reset"));
    await expect(readableStreamToBlob(stream, "audio/mp4")).rejects.toThrow("network reset");
  });

  it("cancels the underlying source past the byte cap instead of buffering unbounded data", async () => {
    const big = new Uint8Array(1024);
    const cancel = vi.fn();
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(big);
      },
      cancel,
    });
    await expect(
      readableStreamToBlob(endless, "audio/mp4", { maxBytes: 4 * 1024 }),
    ).rejects.toThrow(/cap/i);
    // reader.cancel() must reach the source so the network stops producing.
    expect(cancel).toHaveBeenCalled();
  });
});

describe("decipherYtjsFormatUrl", () => {
  it("asks the selected youtubei format to decipher with the active player", async () => {
    const player = { po_token: "pot" };
    const format = {
      decipher: vi.fn(async (givenPlayer?: unknown) =>
        givenPlayer === player ? "https://rr.example.com/videoplayback?itag=140&pot=1" : "",
      ),
    };

    await expect(decipherYtjsFormatUrl(format, player)).resolves.toContain("pot=1");
    expect(format.decipher).toHaveBeenCalledWith(player);
  });
});

describe("withYtjsPlayerPoToken", () => {
  it("temporarily applies a video PoToken to the active player", async () => {
    const player = { po_token: "visitor-token" };

    const result = await withYtjsPlayerPoToken(player, "video-token", async () => {
      expect(player.po_token).toBe("video-token");
      return "ok";
    });

    expect(result).toBe("ok");
    expect(player.po_token).toBe("visitor-token");
  });

  it("restores the previous player PoToken when the operation fails", async () => {
    const player = { po_token: "visitor-token" };

    await expect(
      withYtjsPlayerPoToken(player, "video-token", async () => {
        expect(player.po_token).toBe("video-token");
        throw new Error("download failed");
      }),
    ).rejects.toThrow("download failed");

    expect(player.po_token).toBe("visitor-token");
  });

  it("leaves the player untouched when no video PoToken is available", async () => {
    const player = { po_token: "visitor-token" };

    await withYtjsPlayerPoToken(player, null, async () => {
      expect(player.po_token).toBe("visitor-token");
    });

    expect(player.po_token).toBe("visitor-token");
  });
});

describe("appendYoutubeCpn", () => {
  it("adds the YouTube content playback nonce to direct media URLs", () => {
    expect(appendYoutubeCpn("https://rr.example.com/videoplayback?itag=140", "abc123")).toBe(
      "https://rr.example.com/videoplayback?itag=140&cpn=abc123",
    );
  });

  it("does not overwrite an existing cpn", () => {
    expect(appendYoutubeCpn("https://rr.example.com/videoplayback?itag=140&cpn=old", "new")).toBe(
      "https://rr.example.com/videoplayback?itag=140&cpn=old",
    );
  });

  it("keeps the URL unchanged when cpn is unavailable", () => {
    expect(appendYoutubeCpn("https://rr.example.com/videoplayback?itag=140", undefined)).toBe(
      "https://rr.example.com/videoplayback?itag=140",
    );
  });
});
