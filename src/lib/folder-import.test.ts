import { describe, expect, it } from "vitest";
import {
  basename,
  type DirEntryLike,
  type FolderFs,
  isEncryptedStoreFormat,
  mimeFromExtension,
  type ScannedFile,
  scanFolderForMedia,
  selectNewFiles,
} from "./folder-import";

// --- in-memory fake filesystem for the recursion tests ------------------------

const dir = (name: string): DirEntryLike => ({
  name,
  isDirectory: true,
  isFile: false,
  isSymlink: false,
});
const file = (name: string): DirEntryLike => ({
  name,
  isDirectory: false,
  isFile: true,
  isSymlink: false,
});
const symlinkFile = (name: string): DirEntryLike => ({
  name,
  isDirectory: false,
  isFile: true,
  isSymlink: true,
});
const symlinkDir = (name: string): DirEntryLike => ({
  name,
  isDirectory: true,
  isFile: false,
  isSymlink: true,
});

function fakeFs(
  tree: Record<string, DirEntryLike[]>,
  joinAsync = false,
): Pick<FolderFs, "readDir" | "join"> {
  return {
    readDir: async (p) => {
      const entries = tree[p];
      if (!entries) throw new Error(`ENOENT ${p}`); // unreadable dir
      return entries;
    },
    join: (base, name) => {
      const joined = `${base}/${name}`;
      return joinAsync ? Promise.resolve(joined) : joined;
    },
  };
}

describe("scanFolderForMedia", () => {
  it("recurses nested directories and collects media at every depth", async () => {
    const fs = fakeFs({
      "/root": [file("a.mp3"), dir("sub"), file("readme.txt"), file("cover.jpg")],
      "/root/sub": [file("b.flac"), dir("deep")],
      "/root/sub/deep": [file("c.mp4")],
    });
    const result = await scanFolderForMedia("/root", fs);
    expect(result.media.map((m) => m.path)).toEqual([
      "/root/a.mp3",
      "/root/sub/b.flac",
      "/root/sub/deep/c.mp4",
    ]);
    expect(result.media.map((m) => m.kind)).toEqual(["audio", "audio", "video"]);
    expect(result.unsupportedCount).toBe(1); // readme.txt — cover.jpg is ignored, not counted
    expect(result.encryptedCount).toBe(0);
  });

  it("skips symlinks entirely (files and directories)", async () => {
    const fs = fakeFs({
      "/root": [symlinkDir("loopback"), symlinkFile("link.mp3"), file("real.mp3")],
      // /root/loopback is never read because the symlink is skipped first.
      "/root/loopback": [file("should-not-appear.mp3")],
    });
    const result = await scanFolderForMedia("/root", fs);
    expect(result.media.map((m) => m.path)).toEqual(["/root/real.mp3"]);
  });

  it("swallows an unreadable subdirectory and keeps scanning the rest", async () => {
    const fs = fakeFs({
      "/root": [dir("ok"), dir("denied"), file("a.mp3")],
      "/root/ok": [file("b.mp3")],
      // "/root/denied" is absent → readDir throws → skipped.
    });
    const result = await scanFolderForMedia("/root", fs);
    expect(result.media.map((m) => m.path).sort()).toEqual(["/root/a.mp3", "/root/ok/b.mp3"]);
  });

  it("stops at MAX_DEPTH instead of looping forever", async () => {
    // readDir always returns one more subdir + a file → infinite without the guard.
    const fs: Pick<FolderFs, "readDir" | "join"> = {
      readDir: async () => [dir("x"), file("f.mp3")],
      join: (base, name) => `${base}/${name}`,
    };
    const result = await scanFolderForMedia("/root", fs);
    // Depths 0..24 inclusive each contribute one f.mp3 before the guard trips.
    expect(result.media).toHaveLength(25);
  });

  it("scans .ncm as decryptable media but still skips other encrypted formats", async () => {
    const fs = fakeFs({
      "/root": [file("song.ncm"), file("x.qmcflac"), file("y.mflac"), file("z.mp3")],
    });
    const result = await scanFolderForMedia("/root", fs);
    expect(result.encryptedCount).toBe(2); // qmcflac + mflac (ncm is decrypted on import)
    expect(result.media.map((m) => m.path)).toEqual(["/root/song.ncm", "/root/z.mp3"]);
    const ncm = result.media.find((m) => m.name === "song.ncm");
    expect(ncm?.decode).toBe("ncm");
    expect(ncm?.kind).toBe("audio");
  });

  it("supports an async join", async () => {
    const fs = fakeFs({ "/root": [dir("s")], "/root/s": [file("a.mp3")] }, /* joinAsync */ true);
    const result = await scanFolderForMedia("/root", fs);
    expect(result.media.map((m) => m.path)).toEqual(["/root/s/a.mp3"]);
  });
});

describe("isEncryptedStoreFormat", () => {
  it.each([
    "track.qmc0",
    "track.qmcflac",
    "x.mflac",
    "y.mgg",
    "kugou.kgm",
    "kuwo.kwm",
  ])("flags %s as encrypted", (name) => {
    expect(isEncryptedStoreFormat(name)).toBe(true);
  });

  it.each([
    "a.mp3",
    "a.flac",
    "a.m4a",
    "a.mp4",
    "a.mkv",
    "a.xm",
    // .ncm is decrypted on import (local format conversion), not skipped.
    "song.ncm",
    "UPPER.NCM",
  ])("does not flag plaintext/decryptable %s", (name) => {
    expect(isEncryptedStoreFormat(name)).toBe(false);
  });
});

describe("mimeFromExtension", () => {
  it.each([
    ["a.mp3", "audio", "audio/mpeg"],
    ["a.flac", "audio", "audio/flac"],
    ["a.mp4", "video", "video/mp4"],
    ["a.mkv", "video", "video/x-matroska"],
    ["a.mov", "video", "video/quicktime"],
  ] as const)("maps %s → %s", (name, kind, mime) => {
    expect(mimeFromExtension(name, kind)).toBe(mime);
  });

  it("falls back to a kind default for unknown extensions", () => {
    expect(mimeFromExtension("mystery.xyz", "video")).toBe("video/mp4");
    expect(mimeFromExtension("mystery.xyz", "audio")).toBe("audio/mpeg");
  });
});

describe("selectNewFiles", () => {
  const scanned: ScannedFile[] = [
    { path: "/m/a.mp3", name: "a.mp3", kind: "audio" },
    { path: "/m/b.mp3", name: "b.mp3", kind: "audio" },
  ];

  it("returns only files whose path is not already known", () => {
    expect(selectNewFiles(scanned, new Set(["/m/a.mp3"]))).toEqual([scanned[1]]);
    expect(selectNewFiles(scanned, new Set())).toEqual(scanned);
    expect(selectNewFiles(scanned, new Set(["/m/a.mp3", "/m/b.mp3"]))).toEqual([]);
  });
});

describe("basename", () => {
  it.each([
    ["/a/b/c.mp3", "c.mp3"],
    ["C:\\Music\\y.flac", "y.flac"],
    ["/trailing/slash/", "slash"],
    ["bare", "bare"],
  ])("%s → %s", (path, expected) => {
    expect(basename(path)).toBe(expected);
  });
});
