/**
 * Enumerate the fonts installed on the user's machine, for the font picker.
 *
 * Two strategies, chosen by capability (local-first, no network):
 *  1. Local Font Access API (`window.queryLocalFonts`) — Chromium engines
 *     (Chrome/Edge dev, Tauri's WebView2 on Windows). Returns EVERY installed
 *     family; needs a user gesture + permission (the first combobox open is that
 *     gesture). Best coverage.
 *  2. Canvas `measureText` probing of a curated candidate list — works in every
 *     WebView (macOS WKWebView, Linux WebKitGTK) where (1) is unavailable. Can
 *     only confirm names it already knows, but covers the common system + CJK
 *     faces.
 *
 * The result is cached for the session (the probe / permission cost is paid
 * once), matching the "load once on first open" UX. See [[theming-architecture]].
 */

/**
 * Curated cross-platform candidates probed when `queryLocalFonts` is absent:
 * common UI faces + CJK families across macOS / Windows / Linux. `measureText`
 * can only confirm names it is handed, so this list is the ceiling on that path.
 */
const CANDIDATE_FONTS: readonly string[] = [
  // macOS
  "Helvetica Neue",
  "Helvetica",
  "Avenir",
  "Avenir Next",
  "Menlo",
  "Monaco",
  "Geneva",
  "Optima",
  "Futura",
  "Gill Sans",
  "Baskerville",
  "Hoefler Text",
  "Palatino",
  "American Typewriter",
  "Courier New",
  "Georgia",
  // Windows
  "Segoe UI",
  "Segoe UI Variable",
  "Calibri",
  "Cambria",
  "Consolas",
  "Tahoma",
  "Verdana",
  "Arial",
  "Arial Black",
  "Trebuchet MS",
  "Comic Sans MS",
  "Candara",
  "Constantia",
  "Corbel",
  "Franklin Gothic",
  "Lucida Console",
  "Times New Roman",
  // Cross-platform / Linux / popular installs
  "Roboto",
  "Roboto Mono",
  "Open Sans",
  "Lato",
  "Montserrat",
  "Poppins",
  "Noto Sans",
  "Noto Serif",
  "Source Sans Pro",
  "Inter",
  "Ubuntu",
  "Ubuntu Mono",
  "Cantarell",
  "DejaVu Sans",
  "DejaVu Sans Mono",
  "Liberation Sans",
  "Fira Code",
  "Fira Sans",
  "JetBrains Mono",
  "Cascadia Code",
  "Cascadia Mono",
  "Source Code Pro",
  "IBM Plex Sans",
  "IBM Plex Mono",
  // CJK — Chinese
  "PingFang SC",
  "PingFang TC",
  "Hiragino Sans GB",
  "Microsoft YaHei",
  "Microsoft JhengHei",
  "SimSun",
  "SimHei",
  "STHeiti",
  "Songti SC",
  "Heiti SC",
  "Source Han Sans SC",
  "Source Han Serif SC",
  "Noto Sans CJK SC",
  "Noto Serif CJK SC",
  "LXGW WenKai",
  // CJK — Japanese
  "Hiragino Kaku Gothic ProN",
  "Hiragino Mincho ProN",
  "Yu Gothic",
  "Yu Mincho",
  "Meiryo",
  "MS Gothic",
  "MS Mincho",
  "Noto Sans JP",
  // CJK — Korean
  "Apple SD Gothic Neo",
  "Malgun Gothic",
  "Nanum Gothic",
  "Noto Sans KR",
];

let cache: string[] | null = null;
let inflight: Promise<string[]> | null = null;

interface LocalFontData {
  family: string;
}
type QueryLocalFonts = () => Promise<LocalFontData[]>;

function getQueryLocalFonts(): QueryLocalFonts | null {
  if (typeof window === "undefined") return null;
  const q = (window as { queryLocalFonts?: QueryLocalFonts }).queryLocalFonts;
  return typeof q === "function" ? q : null;
}

/**
 * Is `family` actually installed? Render a probe string in `family` backed by a
 * generic baseline, then compare widths to the baseline alone: if `family`
 * exists the metrics differ; if it falls back to the baseline they match. Three
 * baselines guard against a family that happens to match one generic's metrics.
 */
export function isFontAvailable(family: string, ctx: CanvasRenderingContext2D): boolean {
  const PROBE = "mmmwwwiiilll0123456789MWQ中あ한";
  const SIZE = "72px";
  const baselines = ["monospace", "serif", "sans-serif"];
  for (const base of baselines) {
    ctx.font = `${SIZE} ${base}`;
    const baseWidth = ctx.measureText(PROBE).width;
    ctx.font = `${SIZE} "${family}", ${base}`;
    if (ctx.measureText(PROBE).width !== baseWidth) return true;
  }
  return false;
}

function probeCandidates(): string[] {
  if (typeof document === "undefined") return [];
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return [];
  return CANDIDATE_FONTS.filter((f) => isFontAvailable(f, ctx));
}

/** Dedupe (case-insensitive) + locale-sort family names. */
function normalizeFamilies(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    const key = name.toLowerCase();
    if (name && !seen.has(key)) {
      seen.add(key);
      out.push(name);
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

/**
 * Load installed font families, cached for the session. Tries the Local Font
 * Access API first (full list), falling back to candidate probing. Never throws
 * — a denied permission or unsupported engine resolves to the probed list.
 */
export async function loadSystemFonts(): Promise<string[]> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    const query = getQueryLocalFonts();
    if (query) {
      try {
        const families = normalizeFamilies((await query()).map((f) => f.family));
        if (families.length) return families;
      } catch {
        // Permission denied / unsupported — fall through to probing.
      }
    }
    return normalizeFamilies(probeCandidates());
  })();
  try {
    cache = await inflight;
    return cache;
  } finally {
    inflight = null;
  }
}

/** Test seam: drop the session cache so the next load re-runs. */
export function __resetSystemFontsCache(): void {
  cache = null;
  inflight = null;
}
