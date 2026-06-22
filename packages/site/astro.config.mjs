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
  integrations: [
    starlight({
      title: "MUZERO",
      description:
        "MUZERO — your private, local-first music museum. Sync & play MV and music across every device.",
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
