export const SUPPORTED_LOCALES = ["en", "zh", "ja", "ko"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_STORAGE_KEY = "muzero-locale";

export const LOCALE_HTML_LANG: Record<Locale, string> = {
  en: "en",
  zh: "zh-CN",
  ja: "ja",
  ko: "ko",
};

export const locales: Array<{ code: Locale; shortLabel: string; label: string }> = [
  { code: "en", shortLabel: "EN", label: "English" },
  { code: "zh", shortLabel: "中", label: "简体中文" },
  { code: "ja", shortLabel: "日", label: "日本語" },
  { code: "ko", shortLabel: "한", label: "한국어" },
];

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && SUPPORTED_LOCALES.includes(value as Locale);
}

/** Resolve the startup locale: stored preference → browser language → default. */
export function readStoredLocale(): Locale {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  if (isLocale(stored)) return stored;
  const browserLang = window.navigator.language.toLowerCase();
  if (browserLang.startsWith("zh")) return "zh";
  if (browserLang.startsWith("ja")) return "ja";
  if (browserLang.startsWith("ko")) return "ko";
  return DEFAULT_LOCALE;
}

/** Persist the chosen locale and reflect it on <html lang>. */
export function persistLocale(locale: Locale): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  document.documentElement.lang = LOCALE_HTML_LANG[locale];
}
