import starlight from "@astrojs/starlight";
import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";

// MUZERO public site (mu0.app).
// - The landing page is a plain Astro page (src/pages/index.astro) that owns "/".
// - Starlight owns the /docs/* subtree; its content lives in
//   src/content/docs/docs/** so no doc maps to "/" and collides with the landing.
// - Full i18n (en/zh/ja/ko) + content migration land in Phase 2.
export default defineConfig({
  site: "https://mu0.app",
  // i18n is owned by Starlight (see `locales` below) — Starlight forbids a
  // top-level Astro `i18n` config alongside it. The custom pages (landing,
  // download) are routed per-locale manually: src/pages/index.astro (en) +
  // src/pages/[lang]/index.astro (zh/ja/ko) both render the shared <Landing> /
  // <DownloadPage> component with a `locale` prop.
  integrations: [
    starlight({
      title: "MUZERO",
      description:
        "MUZERO — your private, local-first music museum. Sync & play MV and music across every device.",
      // Docs i18n (Starlight owns site-wide i18n). en is the "root" locale (no
      // prefix → /docs); zh/ja/ko are at /zh/docs etc. Untranslated pages fall
      // back to English. The custom pages carry the same locales via their own
      // per-locale routes (src/pages/[lang]/...).
      defaultLocale: "root",
      locales: {
        root: { label: "English", lang: "en" },
        zh: { label: "简体中文", lang: "zh-CN" },
        ja: { label: "日本語", lang: "ja" },
        ko: { label: "한국어", lang: "ko" },
      },
      logo: {
        src: "./src/assets/muzero-logo-dark.png",
        alt: "MUZERO",
      },
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/DoodleBears/MUZERO" },
      ],
      // Custom landing owns "/", so disable Starlight's own homepage handling
      // by keeping all docs under the /docs/ prefix (content/docs/docs/**).
      sidebar: [
        {
          label: "Guides",
          items: [{ autogenerate: { directory: "docs" } }],
        },
      ],
      customCss: ["./src/styles/brand.css"],
    }),
    sitemap(),
  ],
});
