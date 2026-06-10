import { describe, expect, it } from "vitest";
import { parseTtml } from "./ttml";

const TTML = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata">
  <body>
    <div>
      <p begin="00:01.000" end="00:03.000" ttm:agent="v1"><span begin="00:01.000" end="00:01.500">Hello </span><span begin="00:01.500" end="00:02.000">world</span><span ttm:role="x-translation">你好世界</span><span ttm:role="x-roman">nihao shijie</span></p>
      <p begin="00:03.000" end="00:05.000" ttm:agent="v2"><span begin="00:03.000" end="00:03.800">Bye</span></p>
    </div>
  </body>
</tt>`;

describe("parseTtml", () => {
  it("parses word timings, translation, romanization and agent", () => {
    const lines = parseTtml(TTML);
    expect(lines[0]).toEqual({
      timeMs: 1000,
      endMs: 3000,
      text: "Hello world",
      words: [
        { timeMs: 1000, durMs: 500, text: "Hello " },
        { timeMs: 1500, durMs: 500, text: "world" },
      ],
      translation: "你好世界",
      roman: "nihao shijie",
      agent: "v1",
    });
  });

  it("maps a secondary singer to agent v2", () => {
    expect(parseTtml(TTML)[1]).toEqual({
      timeMs: 3000,
      endMs: 5000,
      text: "Bye",
      words: [{ timeMs: 3000, durMs: 800, text: "Bye" }],
      agent: "v2",
    });
  });

  it("parses hh:mm:ss.mmm and bare-seconds time offsets", () => {
    const ttml = `<tt xmlns="http://www.w3.org/ns/ttml"><body><div>
      <p begin="01:00:02.500" end="01:00:03.000"><span begin="01:00:02.500" end="01:00:03.000">late</span></p>
      <p begin="2.5s" end="3s"><span begin="2.5s" end="3s">secs</span></p>
    </div></body></tt>`;
    const lines = parseTtml(ttml);
    expect(lines.map((l) => l.timeMs)).toEqual([2500, 3602500]);
  });

  it("returns an empty array for non-TTML / malformed input", () => {
    expect(parseTtml("not xml at all")).toEqual([]);
    expect(parseTtml("")).toEqual([]);
  });
});
