import { beforeAll, describe, expect, it } from "vitest";
import { matchFilterOptions, parseMention, resolveFilterScope } from "./global-search-filter";
import { ensureTransliterationLoaded } from "./search-transliterate";

// `matchFilterOptions` is transliteration-aware (pinyin / kana / romaji). The libs
// load lazily; warm them once so alias variant generation is fully synchronous here.
beforeAll(async () => {
  await ensureTransliterationLoaded();
});

describe("parseMention", () => {
  it("is inactive for empty input and plain text", () => {
    expect(parseMention("")).toEqual({ active: false, partial: "", before: "" });
    expect(parseMention("love song")).toEqual({
      active: false,
      partial: "",
      before: "love song",
    });
  });

  it("activates on a bare @", () => {
    expect(parseMention("@")).toEqual({ active: true, partial: "", before: "" });
  });

  it("captures the partial after @ at the start", () => {
    expect(parseMention("@art")).toEqual({ active: true, partial: "art", before: "" });
  });

  it("preserves free text before the mention", () => {
    expect(parseMention("love @art")).toEqual({ active: true, partial: "art", before: "love " });
  });

  it("only triggers on a leading/whitespace boundary (not mid-word)", () => {
    expect(parseMention("art@home").active).toBe(false);
  });

  it("closes once a space follows the mention", () => {
    expect(parseMention("@art ").active).toBe(false);
  });

  it("tracks the trailing mention when several @tokens are present", () => {
    expect(parseMention("a @b @c")).toEqual({ active: true, partial: "c", before: "a @b " });
  });
});

describe("matchFilterOptions", () => {
  it("returns every option for an empty partial", () => {
    expect(matchFilterOptions("").map((o) => o.id)).toEqual([
      "track",
      "set",
      "lyrics",
      "artist",
      "album",
      "video",
      "audio",
      "local",
      "online",
      "bili",
      "netease",
      "youtube",
      "qq",
    ]);
  });

  it("prefix-matches latin aliases", () => {
    expect(matchFilterOptions("song").map((o) => o.id)).toEqual(["track"]);
    expect(matchFilterOptions("track").map((o) => o.id)).toEqual(["track"]);
    expect(matchFilterOptions("set").map((o) => o.id)).toEqual(["set"]);
    expect(matchFilterOptions("play").map((o) => o.id)).toEqual(["set"]);
    expect(matchFilterOptions("lyr").map((o) => o.id)).toEqual(["lyrics"]);
    expect(matchFilterOptions("lrc").map((o) => o.id)).toEqual(["lyrics"]);
    expect(matchFilterOptions("art").map((o) => o.id)).toEqual(["artist"]);
    expect(matchFilterOptions("alb").map((o) => o.id)).toEqual(["album"]);
    expect(matchFilterOptions("bil").map((o) => o.id)).toEqual(["bili"]);
    expect(matchFilterOptions("net").map((o) => o.id)).toEqual(["netease"]);
    expect(matchFilterOptions("yt").map((o) => o.id)).toEqual(["youtube"]);
    expect(matchFilterOptions("油管").map((o) => o.id)).toEqual(["youtube"]);
    expect(matchFilterOptions("qq").map((o) => o.id)).toEqual(["qq"]);
    expect(matchFilterOptions("qqmusic").map((o) => o.id)).toEqual(["qq"]);
  });

  it("prefix-matches CJK aliases", () => {
    expect(matchFilterOptions("歌曲").map((o) => o.id)).toEqual(["track"]);
    expect(matchFilterOptions("曲").map((o) => o.id)).toEqual(["track"]);
    expect(matchFilterOptions("歌单").map((o) => o.id)).toEqual(["set"]);
    expect(matchFilterOptions("歌词").map((o) => o.id)).toEqual(["lyrics"]);
    expect(matchFilterOptions("歌").map((o) => o.id)).toEqual(["track", "set", "lyrics", "artist"]);
    expect(matchFilterOptions("词").map((o) => o.id)).toEqual(["lyrics"]);
    expect(matchFilterOptions("专辑").map((o) => o.id)).toEqual(["album"]);
    expect(matchFilterOptions("网易").map((o) => o.id)).toEqual(["netease"]);
    expect(matchFilterOptions("腾讯").map((o) => o.id)).toEqual(["qq"]);
    expect(matchFilterOptions("qq音乐").map((o) => o.id)).toEqual(["qq"]);
  });

  it("prefix-matches the new scope + media-kind aliases (latin)", () => {
    expect(matchFilterOptions("video").map((o) => o.id)).toEqual(["video"]);
    expect(matchFilterOptions("mv").map((o) => o.id)).toEqual(["video"]);
    expect(matchFilterOptions("audio").map((o) => o.id)).toEqual(["audio"]);
    expect(matchFilterOptions("local").map((o) => o.id)).toEqual(["local"]);
    expect(matchFilterOptions("library").map((o) => o.id)).toEqual(["local"]);
    expect(matchFilterOptions("online").map((o) => o.id)).toEqual(["online"]);
  });

  it("prefix-matches the new scope + media-kind aliases (CJK)", () => {
    expect(matchFilterOptions("视频").map((o) => o.id)).toEqual(["video"]);
    expect(matchFilterOptions("影片").map((o) => o.id)).toEqual(["video"]);
    expect(matchFilterOptions("音频").map((o) => o.id)).toEqual(["audio"]);
    expect(matchFilterOptions("本地").map((o) => o.id)).toEqual(["local"]);
    expect(matchFilterOptions("在线").map((o) => o.id)).toEqual(["online"]);
  });

  it("matches Chinese aliases by pinyin — full syllables and 首字母 initials", () => {
    // 歌曲 → gequ / gq, 歌单 → gedan / gd, etc. Full + initials both reach the option,
    // and a distinct initial stays unambiguous (gd only hits 歌单, not 歌曲's gq).
    expect(matchFilterOptions("gequ").map((o) => o.id)).toEqual(["track"]);
    expect(matchFilterOptions("gq").map((o) => o.id)).toEqual(["track"]);
    expect(matchFilterOptions("gedan").map((o) => o.id)).toEqual(["set"]);
    expect(matchFilterOptions("gd").map((o) => o.id)).toEqual(["set"]);
    expect(matchFilterOptions("geci").map((o) => o.id)).toEqual(["lyrics"]);
    expect(matchFilterOptions("geshou").map((o) => o.id)).toEqual(["artist"]);
    expect(matchFilterOptions("zhuanji").map((o) => o.id)).toEqual(["album"]);
    expect(matchFilterOptions("shipin").map((o) => o.id)).toEqual(["video"]); // 视频
    expect(matchFilterOptions("yinpin").map((o) => o.id)).toEqual(["audio"]); // 音频
    expect(matchFilterOptions("bendi").map((o) => o.id)).toEqual(["local"]);
    expect(matchFilterOptions("zaixian").map((o) => o.id)).toEqual(["online"]);
  });

  it("a bare CJK needle never leaks into a latin alias via a pinyin initial", () => {
    // 曲's pinyin initial is `q`, which prefixes `qq` — but we transliterate the
    // ALIAS, not the needle, so `曲` stays `曲` and only hits the track aliases.
    expect(matchFilterOptions("曲").map((o) => o.id)).toEqual(["track"]);
  });

  it("matches Japanese kana aliases by kana (hira/kata) and romaji", () => {
    // 曲: きょく / キョク / kyoku — plus うた / uta.
    expect(matchFilterOptions("きょく").map((o) => o.id)).toEqual(["track"]);
    expect(matchFilterOptions("キョク").map((o) => o.id)).toEqual(["track"]);
    expect(matchFilterOptions("kyoku").map((o) => o.id)).toEqual(["track"]);
    expect(matchFilterOptions("uta").map((o) => o.id)).toEqual(["track"]);
    // 歌詞: かし / kashi.
    expect(matchFilterOptions("かし").map((o) => o.id)).toEqual(["lyrics"]);
    expect(matchFilterOptions("kashi").map((o) => o.id)).toEqual(["lyrics"]);
    // アルバム / arubamu, プレイリスト → リスト / risuto.
    expect(matchFilterOptions("arubamu").map((o) => o.id)).toEqual(["album"]);
    expect(matchFilterOptions("risuto").map((o) => o.id)).toEqual(["set"]);
    // 動画/ビデオ: douga / bideo; 音声/音楽: onsei / ongaku.
    expect(matchFilterOptions("douga").map((o) => o.id)).toEqual(["video"]);
    expect(matchFilterOptions("bideo").map((o) => o.id)).toEqual(["video"]);
    expect(matchFilterOptions("onsei").map((o) => o.id)).toEqual(["audio"]);
    expect(matchFilterOptions("ongaku").map((o) => o.id)).toEqual(["audio"]);
    // ローカル / rookaru, オンライン / onrain.
    expect(matchFilterOptions("rookaru").map((o) => o.id)).toEqual(["local"]);
    expect(matchFilterOptions("onrain").map((o) => o.id)).toEqual(["online"]);
  });

  it("is case-insensitive (incl. capitalized @Video / @Audio)", () => {
    expect(matchFilterOptions("ALB").map((o) => o.id)).toEqual(["album"]);
    expect(matchFilterOptions("Video").map((o) => o.id)).toEqual(["video"]);
    expect(matchFilterOptions("Audio").map((o) => o.id)).toEqual(["audio"]);
  });

  it("respects a pre-filtered option list (e.g. no sources off-desktop)", () => {
    const local = matchFilterOptions("", [
      { id: "set", filter: { kind: "set" }, aliases: ["set"] },
      { id: "lyrics", filter: { kind: "lyrics" }, aliases: ["lyrics"] },
      { id: "artist", filter: { kind: "artist" }, aliases: ["artist"] },
      { id: "album", filter: { kind: "album" }, aliases: ["album"] },
    ]);
    expect(local.map((o) => o.id)).toEqual(["set", "lyrics", "artist", "album"]);
  });

  it("returns nothing for an unmatched partial", () => {
    expect(matchFilterOptions("zzz")).toEqual([]);
  });
});

describe("resolveFilterScope", () => {
  it("shows every section (local + online) with no filter", () => {
    const scope = resolveFilterScope(null, true);
    expect(scope).toMatchObject({
      showSets: true,
      showTracks: true,
      showAlbums: true,
      showArtists: true,
      showOnline: true,
      runsLocalWorker: true,
    });
    expect(scope.mediaKind).toBeUndefined();
  });

  it("drops online when streaming is unsupported, even with no filter", () => {
    expect(resolveFilterScope(null, false).showOnline).toBe(false);
  });

  it("@online: online only, skips the local worker", () => {
    const scope = resolveFilterScope({ kind: "online" }, true);
    expect(scope).toMatchObject({
      showSets: false,
      showTracks: false,
      showAlbums: false,
      showArtists: false,
      showOnline: true,
      runsLocalWorker: false,
    });
  });

  it("@local: all local sections, cuts online network", () => {
    const scope = resolveFilterScope({ kind: "local" }, true);
    expect(scope).toMatchObject({
      showSets: true,
      showTracks: true,
      showAlbums: true,
      showArtists: true,
      showOnline: false,
      runsLocalWorker: true,
    });
    expect(scope.mediaKind).toBeUndefined();
  });

  it("@video / @audio: local songs only, kind predicate, no online", () => {
    const video = resolveFilterScope({ kind: "video" }, true);
    expect(video).toMatchObject({
      showSets: false,
      showTracks: true,
      showAlbums: false,
      showArtists: false,
      showOnline: false,
      runsLocalWorker: true,
      mediaKind: "video",
    });
    expect(resolveFilterScope({ kind: "audio" }, true).mediaKind).toBe("audio");
  });

  it("@source (e.g. @bili): one online source, skips the local worker", () => {
    const scope = resolveFilterScope({ kind: "source", source: "bili" }, true);
    expect(scope.showOnline).toBe(true);
    expect(scope.runsLocalWorker).toBe(false);
    expect(scope.showTracks).toBe(false);
  });

  it("preserves existing facet behavior (@track shows only the songs section, no online)", () => {
    // Mirrors the original gating: online showed only for `null` / `source`, so a
    // local facet like @track suppresses the online section.
    const scope = resolveFilterScope({ kind: "track" }, true);
    expect(scope).toMatchObject({
      showSets: false,
      showTracks: true,
      showAlbums: false,
      showArtists: false,
      showOnline: false,
      runsLocalWorker: true,
    });
  });
});
