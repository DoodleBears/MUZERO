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
  "search.png",
  "library.png",
  "dj.png",
  "settings.png",
];

for (const f of FILES) {
  const animated = f.endsWith(".gif");
  const out = outDir + f.replace(/\.(gif|png|jpe?g)$/i, ".webp");
  await sharp(srcDir + f, { animated })
    .resize({ width: 1280, withoutEnlargement: true })
    .webp({ quality: animated ? 70 : 82 })
    .toFile(out);
  console.log("wrote", f, "->", out.split(/[\\/]/).pop());
}
console.log(`Done — ${FILES.length} media optimized to ${outDir}`);
