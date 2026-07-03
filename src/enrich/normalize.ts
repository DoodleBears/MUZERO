/**
 * Pure genre/tag normalization — collapse the messy folksonomy (Last.fm), sparse
 * structured genres (MusicBrainz), and native vendor labels (QQ) into a stable,
 * de-duplicated canonical vocabulary the DJ / search can filter on. No IO.
 *
 * Two jobs:
 *  1. Drop NOISE — decade tags ("2010s"), personal/listening tags ("favorites",
 *     "seen live"), bare vocal/origin descriptors ("female vocalists", "chinese").
 *  2. Canonicalize SYNONYMS — "hip-hop"/"rap" → "hip hop", "rnb" → "r&b",
 *     "alt rock" → "alternative rock", "cpop" → "c-pop", "zhongguo feng" → "中国风".
 *
 * Exhaustively unit-tested (`normalize.test.ts`) — this is the contract three consumers
 * (DJ context, chat library_search, track search) depend on, so drift is caught early.
 */

/** Alias → canonical genre. Keys are already lowercased/trimmed before lookup. */
const SYNONYMS: Record<string, string> = {
  "hip-hop": "hip hop",
  hiphop: "hip hop",
  rap: "hip hop",
  "trip-hop": "trip hop",
  rnb: "r&b",
  "r'n'b": "r&b",
  "r&b/soul": "r&b",
  "rhythm and blues": "r&b",
  "alt rock": "alternative rock",
  "alt-rock": "alternative rock",
  alternative: "alternative rock",
  "indie-rock": "indie rock",
  "indie-pop": "indie pop",
  synthpop: "synth-pop",
  "synth pop": "synth-pop",
  electro: "electronic",
  electronica: "electronic",
  edm: "electronic",
  "electro pop": "electropop",
  "electro-pop": "electropop",
  "drum and bass": "drum & bass",
  "drum n bass": "drum & bass",
  dnb: "drum & bass",
  "singer songwriter": "singer-songwriter",
  "post rock": "post-rock",
  "post punk": "post-punk",
  "lo fi": "lo-fi",
  lofi: "lo-fi",
  "j pop": "j-pop",
  jpop: "j-pop",
  "j rock": "j-rock",
  jrock: "j-rock",
  "k pop": "k-pop",
  kpop: "k-pop",
  "c pop": "c-pop",
  cpop: "c-pop",
  mandarin: "mandopop",
  "mandarin pop": "mandopop",
  "canto pop": "cantopop",
  "zhongguo feng": "中国风",
  "chinese style": "中国风",
  guofeng: "中国风",
  国风: "中国风",
  古风: "中国风",
  ost: "soundtrack",
  "video game music": "soundtrack",
  "video game": "soundtrack",
  vgm: "soundtrack",
  classical: "classical",
};

/** Exact tags to drop wholesale (lowercased). Personal/listening/origin/vocal noise. */
const NOISE = new Set([
  "favorites",
  "favourites",
  "favorite",
  "favourite",
  "seen live",
  "spotify",
  "beautiful",
  "love",
  "love at first listen",
  "awesome",
  "amazing",
  "good",
  "best",
  "masterpiece",
  "female vocalists",
  "female vocalist",
  "male vocalists",
  "male vocalist",
  "female vocals",
  "male vocals",
  "vocal",
  "vocals",
  "instrumental",
  "albums i own",
  "under 2000 listeners",
  "my music",
  "songs",
  "song",
  "music",
  "cover",
  "covers",
  // Non-genre folksonomy leakage seen from real MusicBrainz artist tags (label/franchise/
  // role/provenance, not a musical style).
  "composer",
  "hoyoverse",
  "mihoyo",
  "gacha",
  "gacha game",
  "ai-generated",
  "ai generated",
  // Bare origin/language descriptors — real as facets, but noise as a *genre*.
  "chinese",
  "english",
  "japanese",
  "korean",
  "british",
  "american",
  "usa",
  "uk",
]);

/** Decade / bare-year tags: "80s", "1990s", "2010s", "2000". */
const DECADE_RE = /^(19|20)?\d0s$|^(19|20)\d{2}$/;

/** Normalize one raw tag → canonical form, or null to drop it. Pure. */
export function normalizeGenre(raw: string): string | null {
  const t = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!t || t.length > 40) return null;
  if (NOISE.has(t)) return null;
  if (DECADE_RE.test(t)) return null;
  return SYNONYMS[t] ?? t;
}

/**
 * Normalize + de-dupe a raw tag list into canonical genres, order-preserving, capped.
 * Preserves the FIRST occurrence's order (providers list strongest tags first).
 */
export function normalizeGenres(raw: readonly string[], cap = 8): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tag of raw) {
    const g = normalizeGenre(tag);
    if (!g || seen.has(g)) continue;
    seen.add(g);
    out.push(g);
    if (out.length >= cap) break;
  }
  return out;
}

/** First-billed artist — drop features/collabs; external DBs match one clean name best. */
export function primaryArtist(joined: string): string {
  const first = joined.split(/\s*(?:,|\/|、|;|&|feat\.?|ft\.?|×)\s*/i)[0]?.trim();
  return first || joined.trim();
}
