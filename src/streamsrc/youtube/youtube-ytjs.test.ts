import { describe, expect, it, vi } from "vitest";
import { appendYoutubeCpn, decipherYtjsFormatUrl, withYtjsPlayerPoToken } from "./youtube-ytjs";

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
