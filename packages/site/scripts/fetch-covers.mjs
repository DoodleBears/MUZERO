/**
 * Fetch real, commercially-licensed photos for the landing cover cascade and
 * write them as optimized webp to `public/covers/photo-NN.webp`.
 *
 * Source: Pexels (https://www.pexels.com) — Pexels License: free for commercial
 * and personal use, no attribution required. Curated music / abstract photo IDs
 * below. These are decorative "cover" tiles, not real album art (album covers
 * are copyrighted and cannot be republished).
 *
 * Re-run after editing the ID list: node packages/site/scripts/fetch-covers.mjs
 */
import { mkdirSync } from "node:fs";
import { fileURLToPath, URL as NodeURL } from "node:url";
import sharp from "sharp";

const WANT = 18;
const SIZE = 600;

// Curated Pexels photo IDs (music + abstract). A few spares cover any misses.
const CANDIDATES = [
  697672, 6648551, 2300710, 2080960, 7270006, 7095510, 7970135, 4231581,
  6942429, 2480397, 2223848, 248510, 250695, 210804, 191240, 9166089, 7799011,
  6560355, 30608991, 32813705, 30612394, 167092,
];

const outDir = fileURLToPath(new NodeURL("../public/covers/", import.meta.url));
mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const urlFor = (id) =>
  `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=${SIZE}&h=${SIZE}&fit=crop`;

async function fetchBuf(url, tries = 4) {
  let lastErr;
  for (let t = 1; t <= tries; t++) {
    try {
      const res = await fetch(url, { redirect: "follow" });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      lastErr = new Error(`${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    if (t < tries) await sleep(500 * t);
  }
  throw lastErr;
}

let ok = 0;
for (const id of CANDIDATES) {
  if (ok >= WANT) break;
  try {
    const buf = await fetchBuf(urlFor(id));
    ok += 1;
    const name = `photo-${String(ok).padStart(2, "0")}.webp`;
    await sharp(buf)
      .resize(SIZE, SIZE, { fit: "cover" })
      .webp({ quality: 82 })
      .toFile(outDir + name);
    console.log("wrote", name, "<- pexels", id);
  } catch (e) {
    console.error("skip", id, String(e?.message || e));
  }
}
console.log(`Done — ${ok}/${WANT} covers written to ${outDir}`);
if (ok < WANT) process.exitCode = 1;
