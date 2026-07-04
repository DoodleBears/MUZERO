/**
 * Optimize the README showcase media for the landing page: convert the source
 * GIF/PNG in docs/media to webp (animated webp for GIFs) and write them to
 * public/media. Caps width at 1280px and cuts page weight by ~70-80%.
 *
 * Run: node packages/site/scripts/optimize-media.mjs
 */
import { mkdirSync } from "node:fs";
import { fileURLToPath, URL as NodeURL } from "node:url";
import sharp from "sharp";

const srcDir = fileURLToPath(new NodeURL("../../../docs/media/", import.meta.url));
const outDir = fileURLToPath(new NodeURL("../public/media/", import.meta.url));
mkdirSync(outDir, { recursive: true });

const FILES = [
  "now-playing.gif",
  "visualizer.gif",
  "switch-song.gif",
  "library.gif",
  "search.png",
  "dj.png",
  "settings.png",
];

// Encode settings (named, not magic literals). Animated q70 was too aggressive for
// motion graphics (spectrum bars, transitions) — banding/softness; static panes want
// crisp UI text. A gentle unsharp mask restores perceived crispness WebP eats on fine
// detail without haloing gradients/flow background.
const MAX_WIDTH = 1600; // larger for a crisper landing (source stills are 3840px)
const WEBP_QUALITY_ANIMATED = 90; // was 70 — clarity over weight (PM: bigger + sharper)
const WEBP_QUALITY_STATIC = 96; // near-lossless UI text
const WEBP_EFFORT = 4; // balance size vs. encode time (animated webp at 6 is very slow)
const SHARPEN_SIGMA = 0.6; // light; higher haloes

for (const f of FILES) {
  const animated = f.endsWith(".gif");
  const out = outDir + f.replace(/\.(gif|png|jpe?g)$/i, ".webp");
  await sharp(srcDir + f, { animated })
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .sharpen({ sigma: SHARPEN_SIGMA })
    .webp({
      quality: animated ? WEBP_QUALITY_ANIMATED : WEBP_QUALITY_STATIC,
      effort: WEBP_EFFORT,
    })
    .toFile(out);
  console.log("wrote", f, "->", out.split(/[\\/]/).pop());
}
console.log(`Done — ${FILES.length} media optimized to ${outDir}`);
