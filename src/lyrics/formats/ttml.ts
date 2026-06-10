/**
 * TTML (Apple-Music-like Lyrics / AMLL) parser. TTML is XML: each `<p>` is a line
 * with `begin`/`end` and an optional `ttm:agent` (duet); inside, `<span begin end>`
 * are timed words/syllables, `<span ttm:role="x-translation">` a translation and
 * `<span ttm:role="x-roman">` a romanization. Parsed with the platform DOMParser
 * (Electron/Tauri/web/jsdom all provide it) and normalized into the unified
 * `LyricLine[]` model — words for karaoke fill, translation/roman as sub-lines.
 * Background vocals (`x-bg`) are skipped for now. No network — unit-tested.
 */

import type { LyricLine, WordTiming } from "../model";

/** Read an attribute by local name regardless of namespace prefix (`begin`, `ttm:role`…). */
function attr(el: Element, local: string): string | null {
  const direct = el.getAttribute(local);
  if (direct != null) return direct;
  for (const a of Array.from(el.attributes)) if (a.localName === local) return a.value;
  return null;
}

/** TTML time → ms. Handles clock time (`hh:mm:ss.fff` / `mm:ss.fff` / `ss.fff`) and
 *  offset time with a unit (`12.5s` / `200ms` / `2m` / `1h`). */
function ttmlTimeToMs(v: string | null): number | undefined {
  if (!v) return undefined;
  const s = v.trim();
  const unit = s.match(/^([\d.]+)(ms|s|m|h)$/);
  if (unit) {
    const n = Number(unit[1]);
    const mult =
      unit[2] === "ms" ? 1 : unit[2] === "s" ? 1000 : unit[2] === "m" ? 60_000 : 3_600_000;
    return Number.isFinite(n) ? Math.round(n * mult) : undefined;
  }
  const parts = s.split(":").map(Number);
  if (parts.some(Number.isNaN)) return undefined;
  let sec = 0;
  if (parts.length === 3) sec = parts[0] * 3600 + parts[1] * 60 + parts[2];
  else if (parts.length === 2) sec = parts[0] * 60 + parts[1];
  else if (parts.length === 1) sec = parts[0];
  else return undefined;
  return Math.round(sec * 1000);
}

function mapAgent(a: string | null): "v1" | "v2" | "bg" | undefined {
  if (!a) return undefined;
  if (/2|second|backing/i.test(a)) return "v2";
  return "v1";
}

export function parseTtml(raw: string): LyricLine[] {
  if (!raw || typeof DOMParser === "undefined") return [];
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(raw, "application/xml");
  } catch {
    return [];
  }
  if (doc.getElementsByTagName("parsererror").length > 0) return [];

  const lines: LyricLine[] = [];
  for (const p of Array.from(doc.getElementsByTagName("p"))) {
    const timeMs = ttmlTimeToMs(attr(p, "begin"));
    if (timeMs == null) continue;
    const endMs = ttmlTimeToMs(attr(p, "end"));
    const agent = mapAgent(attr(p, "agent"));

    const words: WordTiming[] = [];
    let translation: string | undefined;
    let roman: string | undefined;

    for (const node of Array.from(p.childNodes)) {
      if (node.nodeType === 3 /* text */) {
        // Inter-span whitespace (pretty-printed TTML): keep the gap on the last word.
        const ws = (node.textContent ?? "").replace(/\s+/g, " ");
        const last = words[words.length - 1];
        if (ws.trim() === "" && ws && last && !last.text.endsWith(" ")) last.text += " ";
        continue;
      }
      if (node.nodeType !== 1 /* element */) continue;
      const span = node as Element;
      if (span.localName !== "span") continue;
      const role = attr(span, "role");
      if (role === "x-translation") {
        translation = (span.textContent ?? "").trim() || translation;
        continue;
      }
      if (role === "x-roman" || role === "x-romaji") {
        roman = (span.textContent ?? "").trim() || roman;
        continue;
      }
      if (role?.startsWith("x-bg")) continue; // background vocals — skipped for now
      const ws = ttmlTimeToMs(attr(span, "begin"));
      const we = ttmlTimeToMs(attr(span, "end"));
      if (ws != null) {
        words.push({
          timeMs: ws,
          durMs: we != null ? Math.max(0, we - ws) : 0,
          text: span.textContent ?? "",
        });
      }
    }

    const text =
      words.length > 0
        ? words
            .map((w) => w.text)
            .join("")
            .trim()
        : (p.textContent ?? "").trim();
    const line: LyricLine = { timeMs, text };
    if (endMs != null) line.endMs = endMs;
    if (words.length > 0) line.words = words;
    if (translation) line.translation = translation;
    if (roman) line.roman = roman;
    if (agent) line.agent = agent;
    lines.push(line);
  }
  lines.sort((a, b) => a.timeMs - b.timeMs);
  return lines;
}
