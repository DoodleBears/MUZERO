/**
 * Route-based i18n helpers. en lives at /, /docs/...; zh/ja/ko are prefixed
 * (/zh/, /zh/docs/...). Pure functions — used both in .astro frontmatter (build)
 * and in the client LangSwitch (to jump to the same page in another locale).
 */
import { DEFAULT_LOCALE, LOCALES, type Locale, ui } from "./ui";

export {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_HTML_LANG,
  LOCALE_LABEL,
  LOCALE_SHORT,
  ui,
} from "./ui";
export type { Locale } from "./ui";

const KNOWN = new Set<string>(LOCALES);

/** The locale encoded in a pathname's first segment (default if none). */
export function localeFromPath(pathname: string): Locale {
  const seg = pathname.replace(/^\/+/, "").split("/")[0] ?? "";
  return (KNOWN.has(seg) ? (seg as Locale) : DEFAULT_LOCALE);
}

/** Drop a leading locale prefix → the path as if it were the default locale. */
export function stripLocale(pathname: string): string {
  const segs = pathname.replace(/^\/+/, "").split("/");
  if (segs[0] && KNOWN.has(segs[0]) && segs[0] !== DEFAULT_LOCALE) {
    const rest = segs.slice(1).join("/");
    return `/${rest}`;
  }
  return pathname.startsWith("/") ? pathname : `/${pathname}`;
}

/** Prefix a (default-locale) path with the locale; the default keeps no prefix. */
export function localizedPath(pathname: string, locale: Locale): string {
  const base = stripLocale(pathname);
  if (locale === DEFAULT_LOCALE) return base;
  if (base === "/") return `/${locale}/`;
  return `/${locale}${base}`;
}

/** Translations for a locale, with en fallback. */
export function useTranslations(locale: Locale) {
  return ui[locale] ?? ui[DEFAULT_LOCALE];
}

/** hreflang alternates for a path (every locale + x-default → default). */
export function alternates(pathname: string): { hreflang: string; href: string }[] {
  const list = LOCALES.map((l) => ({ hreflang: l, href: localizedPath(pathname, l) }));
  list.push({ hreflang: "x-default", href: localizedPath(pathname, DEFAULT_LOCALE) });
  return list;
}
