import "i18next";
import type { defaultNS, resources } from "./i18n";

// Gives `t()` full key autocompletion + type-safety against the en catalog.
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: typeof defaultNS;
    resources: (typeof resources)["en"];
  }
}
