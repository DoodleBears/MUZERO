/**
 * Global UI font family.
 *
 * Mirrors the theme/primary approach (see src/theme/theme.ts /
 * src/theme/primary.ts): localStorage (`muzero-font`) is the synchronous source
 * of truth read at boot — an inline script in index.html sets the `--app-font`
 * CSS variable before first paint to avoid a font flash — and
 * `AppSettings.fontFamily` in IndexedDB is the mirrored copy.
 *
 * We store the resolved CSS font-family STACK (not an id), so the boot script
 * applies it with zero id→stack mapping and `body { font-family: var(--app-font) }`
 * in styles.css just reads it.
 *
 * No web fonts are downloaded (local-first, hard rule #1): every preset is a
 * SYSTEM font stack that resolves to whatever the OS already has installed, with
 * cross-platform fallbacks. Users can also type any installed font name (Custom).
 */

export type FontId = "system" | "serif" | "rounded" | "mono";

export interface FontOption {
  id: FontId;
  /** CSS font-family value applied to the whole UI. */
  stack: string;
  labelKey: `settings.font${Capitalize<FontId>}`;
}

/**
 * Preset system font stacks. Each leads with the CSS generic `ui-*` keyword
 * (native UI font on platforms that support it) then names concrete families as
 * fallbacks so older WebViews still get the intended style. CJK glyphs resolve
 * through `system-ui`/the OS, so these read correctly in zh/ja/ko too.
 */
export const FONTS: FontOption[] = [
  {
    id: "system",
    stack: `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`,
    labelKey: "settings.fontSystem",
  },
  {
    id: "serif",
    stack: `ui-serif, Georgia, Cambria, "Times New Roman", Times, serif`,
    labelKey: "settings.fontSerif",
  },
  {
    id: "rounded",
    stack: `ui-rounded, "SF Pro Rounded", "Hiragino Maru Gothic ProN", "Quicksand", system-ui, sans-serif`,
    labelKey: "settings.fontRounded",
  },
  {
    id: "mono",
    stack: `ui-monospace, "SF Mono", "Cascadia Code", "Roboto Mono", Menlo, Consolas, monospace`,
    labelKey: "settings.fontMono",
  },
];

/** Default = system UI sans (matches the body fallback in styles.css). */
export const DEFAULT_FONT_STACK = FONTS[0].stack;

export const FONT_STORAGE_KEY = "muzero-font";

/** A usable (non-empty) font-family string. */
export function isFontStack(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Build a CSS font-family stack from raw user input. If the user already typed a
 * full stack (contains a comma) we respect it verbatim; a single family name is
 * quoted (when it has spaces) and backed by the system fallback so a typo or a
 * missing font degrades to the UI sans rather than the browser's default serif.
 */
export function customFontStack(input: string): string {
  const name = input.trim();
  if (!name) return DEFAULT_FONT_STACK;
  if (name.includes(",")) return name;
  const quoted = /\s/.test(name) ? `"${name}"` : name;
  return `${quoted}, ${DEFAULT_FONT_STACK}`;
}

/**
 * The first concrete family in a font-family stack, unquoted — used to label the
 * current font in the picker (e.g. `"Comic Sans MS", ...` → `Comic Sans MS`).
 */
export function primaryFamily(stack: string): string {
  const first = stack.split(",")[0]?.trim() ?? "";
  return first.replace(/^["']|["']$/g, "");
}

/** Read the startup font stack: stored preference → default. */
export function readStoredFont(): string {
  if (typeof window === "undefined") return DEFAULT_FONT_STACK;
  const stored = window.localStorage.getItem(FONT_STORAGE_KEY);
  return isFontStack(stored) ? stored : DEFAULT_FONT_STACK;
}

/** Reflect a font stack on the document via the `--app-font` CSS variable. */
export function applyFont(stack: string): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--app-font", stack);
}

/** Persist the chosen font stack and apply it immediately. */
export function persistFont(stack: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(FONT_STORAGE_KEY, stack);
  applyFont(stack);
}

/** Apply the stored font on boot (called before first render). */
export function initFont(): void {
  applyFont(readStoredFont());
}
