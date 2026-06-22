/**
 * Generate placeholder album "covers" for the landing-page cascade.
 *
 * These are GENERATED vector covers (gradient + a tasteful motif), written as
 * SVG to `public/covers/cover-NN.svg`. They are copyright-safe and tiny/crisp
 * (SVG beats webp for vector gradients). The landing references them as <img>.
 *
 * To use REAL covers: replace these files (or point the `covers` array in
 * src/pages/index.astro at your own webp URLs — local `/covers/*.webp` or R2
 * `https://assets.mu0.app/site/covers/*.webp`). webp is the right format for
 * photographic cover art; keep SVG only for generated vector placeholders.
 *
 * Run: node packages/site/scripts/gen-covers.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath, URL as NodeURL } from "node:url";

const COUNT = 18;
const SIZE = 600;
const outDir = fileURLToPath(new NodeURL("../public/covers/", import.meta.url));
mkdirSync(outDir, { recursive: true });

/** A motif overlay per variant — abstract "cover art" over the gradient. */
function motif(variant) {
  switch (variant) {
    case 0: // concentric vinyl rings
      return `
    <g fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="6">
      <circle cx="300" cy="300" r="90"/>
      <circle cx="300" cy="300" r="150"/>
      <circle cx="300" cy="300" r="210"/>
      <circle cx="300" cy="300" r="270"/>
    </g>
    <circle cx="300" cy="300" r="44" fill="rgba(0,0,0,0.22)"/>`;
    case 1: // offset sun disc
      return `<circle cx="440" cy="170" r="170" fill="rgba(255,255,255,0.2)"/>`;
    case 2: // diagonal beams
      return `
    <g stroke="rgba(255,255,255,0.14)" stroke-width="46" stroke-linecap="round">
      <line x1="-40" y1="560" x2="360" y2="40"/>
      <line x1="160" y1="640" x2="560" y2="120"/>
      <line x1="360" y1="720" x2="760" y2="200"/>
    </g>`;
    case 3: { // dot grid
      let dots = "";
      for (let y = 0; y < 6; y++) {
        for (let x = 0; x < 6; x++) {
          dots += `<circle cx="${90 + x * 84}" cy="${90 + y * 84}" r="16" fill="rgba(255,255,255,0.16)"/>`;
        }
      }
      return `<g>${dots}</g>`;
    }
    default: // stacked bars (waveform-ish)
      return `
    <g fill="rgba(0,0,0,0.16)">
      <rect x="70" y="360" width="460" height="30" rx="15"/>
      <rect x="70" y="412" width="330" height="30" rx="15"/>
      <rect x="70" y="464" width="410" height="30" rx="15"/>
    </g>`;
  }
}

function cover(i) {
  const hue = Math.round((i / (COUNT - 1)) * 320);
  const hue2 = (hue + 28) % 360;
  const variant = i % 5;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue} 72% 64%)"/>
      <stop offset="1" stop-color="hsl(${hue2} 58% 42%)"/>
    </linearGradient>
    <radialGradient id="s" cx="0.26" cy="0.12" r="0.9">
      <stop offset="0" stop-color="rgba(255,255,255,0.34)"/>
      <stop offset="0.6" stop-color="rgba(255,255,255,0)"/>
    </radialGradient>
  </defs>
  <rect width="${SIZE}" height="${SIZE}" fill="url(#g)"/>${motif(variant)}
  <rect width="${SIZE}" height="${SIZE}" fill="url(#s)"/>
</svg>
`;
}

for (let i = 0; i < COUNT; i++) {
  const name = `cover-${String(i + 1).padStart(2, "0")}.svg`;
  writeFileSync(outDir + name, cover(i));
}
console.log(`Generated ${COUNT} covers in ${outDir}`);
