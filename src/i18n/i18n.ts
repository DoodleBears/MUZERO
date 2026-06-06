import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { DEFAULT_LOCALE, LOCALE_HTML_LANG, type Locale, readStoredLocale } from "./config";
import en from "./locales/en/common.json";
import ja from "./locales/ja/common.json";
import ko from "./locales/ko/common.json";
import zh from "./locales/zh/common.json";

export const defaultNS = "common";

export const resources = {
  en: { common: en },
  zh: { common: zh },
  ja: { common: ja },
  ko: { common: ko },
} as const;

const lng = readStoredLocale();

void i18n.use(initReactI18next).init({
  resources,
  lng,
  fallbackLng: DEFAULT_LOCALE,
  defaultNS,
  interpolation: { escapeValue: false },
  returnNull: false,
  saveMissing: import.meta.env.DEV,
});

if (typeof document !== "undefined") {
  document.documentElement.lang = LOCALE_HTML_LANG[lng as Locale] ?? lng;
}

export default i18n;
