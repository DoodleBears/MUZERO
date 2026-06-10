/**
 * Pure extraction of YouTube's `n` (throttling) transform from player.js. Unlike the
 * signature — a short reverse/splice/swap recipe we can replay in TS — the `n`
 * function is a large self-contained routine, so we extract its SOURCE here (pure +
 * testable) and the Electron solver window evaluates it on the `n` value. Without
 * this transform the CDN serves at a throttled rate (~50KB/s), stuttering audio.
 *
 * Mirrors yt-dlp's approach: find the function name (possibly via an array index),
 * then slice out the brace-balanced function body.
 */

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Find the `n`-transform function name, resolving `NAME[idx]` array references. */
export function findNFunctionName(playerJs: string): string | null {
  // `.get("n"))&&(b=NAME[idx](a)` or `…&&(b=NAME(a)`
  const m = playerJs.match(
    /\.get\(\s*"n"\s*\)\)\s*&&\s*\(\s*[a-zA-Z0-9_$]+\s*=\s*([a-zA-Z0-9_$]+)(?:\[(\d+)\])?\s*\(/,
  );
  if (!m) return null;
  const ref = m[1];
  if (m[2] === undefined) return ref;
  // Indexed: resolve `var ref=[a,b,c,…]` and read element `idx`.
  const arr = playerJs.match(new RegExp(`var\\s+${escapeRe(ref)}\\s*=\\s*\\[([^\\]]*)\\]`));
  if (!arr) return null;
  const members = arr[1].split(",").map((x) => x.trim());
  return members[Number(m[2])] ?? null;
}

/**
 * Slice out a complete `name=function(...){…}` (or `function name(...){…}`) source by
 * brace-balancing from the function's first `{`. Returns the runnable source, or null.
 */
export function extractFunctionSource(playerJs: string, name: string): string | null {
  const decl = new RegExp(
    `(?:(?:var|let|const)\\s+)?${escapeRe(name)}\\s*=\\s*function\\s*\\(|function\\s+${escapeRe(name)}\\s*\\(`,
  );
  const start = playerJs.search(decl);
  if (start < 0) return null;
  const open = playerJs.indexOf("{", start);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < playerJs.length; i += 1) {
    const ch = playerJs[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        // Normalize to an anonymous expression so the window can `(<src>)(n)`.
        const body = playerJs.slice(open, i + 1);
        const args = playerJs.slice(playerJs.indexOf("(", start) + 1, playerJs.indexOf(")", start));
        return `function(${args.trim()})${body}`;
      }
    }
  }
  return null;
}

/** Extract the runnable `n`-transform function source from player.js, or null. */
export function extractNFunctionSource(playerJs: string): string | null {
  const name = findNFunctionName(playerJs);
  return name ? extractFunctionSource(playerJs, name) : null;
}
