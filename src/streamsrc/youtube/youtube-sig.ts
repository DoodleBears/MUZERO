/**
 * Pure YouTube signature descrambler. The `s` parameter of a ciphered stream is
 * unscrambled by a small function in player.js that calls a helper object's methods
 * (reverse / splice / swap) in a fixed order. Rather than run that JS, we PARSE
 * player.js to extract the operation sequence and apply it in TS — the long-standing
 * youtube-dl/yt-dlp technique. Fully unit-testable (no JS engine).
 *
 * The `n` throttling param is a different, much larger function that does need a JS
 * interpreter — that one runs in the Electron solver window (see `youtube-engine`).
 */

export type SigOp = { op: "reverse" } | { op: "splice"; arg: number } | { op: "swap"; arg: number };

/** Find the name of the signature-descramble function defined in player.js. */
export function findSignatureFunctionName(playerJs: string): string | null {
  const patterns = [
    // caller: `...=AAA(decodeURIComponent(...))` or `BBB&&(c=AAA(c))`
    /\b([a-zA-Z0-9_$]+)\s*=\s*function\(\s*([a-zA-Z0-9_$]+)\s*\)\s*\{\s*\2\s*=\s*\2\.split\(\s*""\s*\)/,
    /([a-zA-Z0-9_$]+)\s*=\s*function\(\s*a\s*\)\s*\{\s*a\s*=\s*a\.split\(\s*""\s*\)/,
    /\b([a-zA-Z0-9_$]{2,})\s*=\s*function\(\s*[a-zA-Z0-9_$]+\s*\)\s*\{[a-zA-Z0-9_$]+=[a-zA-Z0-9_$]+\.split\(""\)/,
  ];
  for (const re of patterns) {
    const m = playerJs.match(re);
    if (m) return m[1];
  }
  return null;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The body (helper calls) of the named signature function. */
function findFunctionBody(playerJs: string, name: string): string | null {
  const re = new RegExp(
    `(?:function\\s+${escapeRe(name)}|${escapeRe(name)}\\s*=\\s*function)\\s*\\([a-zA-Z0-9_$]+\\)\\s*\\{([\\s\\S]*?)\\}`,
  );
  return playerJs.match(re)?.[1] ?? null;
}

/** Classify a helper-object method body into a cipher op kind. */
function classifyHelper(body: string): SigOp["op"] | null {
  if (/\breverse\(\)/.test(body)) return "reverse";
  if (/\bsplice\(/.test(body)) return "splice";
  // swap: `var c=a[0];a[0]=a[b%a.length];a[...]=c`
  if (/var\s+\w+=\w+\[0\];/.test(body) && /\[\w+%\w+\.length\]/.test(body)) return "swap";
  return null;
}

/** Build {helperMethod → op kind} from the helper object's definition. */
function parseHelperObject(playerJs: string, objName: string): Record<string, SigOp["op"]> {
  const objRe = new RegExp(`var\\s+${escapeRe(objName)}\\s*=\\s*\\{([\\s\\S]*?)\\};`);
  const objBody = playerJs.match(objRe)?.[1];
  const map: Record<string, SigOp["op"]> = {};
  if (!objBody) return map;
  const methodRe = /([a-zA-Z0-9_$]+)\s*:\s*function\([^)]*\)\s*\{([\s\S]*?)\}/g;
  for (let m = methodRe.exec(objBody); m; m = methodRe.exec(objBody)) {
    const kind = classifyHelper(m[2]);
    if (kind) map[m[1]] = kind;
  }
  return map;
}

/** Extract the full signature operation sequence from player.js, or null if not found. */
export function extractSigOperations(playerJs: string): SigOp[] | null {
  const name = findSignatureFunctionName(playerJs);
  if (!name) return null;
  const body = findFunctionBody(playerJs, name);
  if (!body) return null;
  // Each statement is `Obj.method(a, NN)` or `Obj.method(a)`.
  const callRe = /([a-zA-Z0-9_$]+)\.([a-zA-Z0-9_$]+)\(\s*[a-zA-Z0-9_$]+\s*(?:,\s*(\d+)\s*)?\)/g;
  const calls: Array<{ method: string; arg: number; obj: string }> = [];
  for (let m = callRe.exec(body); m; m = callRe.exec(body)) {
    calls.push({ obj: m[1], method: m[2], arg: m[3] ? Number(m[3]) : 0 });
  }
  if (calls.length === 0) return null;
  const helpers = parseHelperObject(playerJs, calls[0].obj);
  const ops: SigOp[] = [];
  for (const call of calls) {
    const kind = helpers[call.method];
    if (!kind) return null; // unknown op → bail rather than corrupt the signature
    ops.push(kind === "reverse" ? { op: "reverse" } : { op: kind, arg: call.arg });
  }
  return ops;
}

/** Apply a parsed operation sequence to a scrambled signature. */
export function applySigOperations(sig: string, ops: SigOp[]): string {
  const a = sig.split("");
  for (const op of ops) {
    switch (op.op) {
      case "reverse":
        a.reverse();
        break;
      case "splice":
        a.splice(0, op.arg);
        break;
      case "swap": {
        const i = op.arg % a.length;
        const tmp = a[0];
        a[0] = a[i];
        a[i] = tmp;
        break;
      }
    }
  }
  return a.join("");
}

/** Parse player.js + descramble a signature in one call (null if extraction fails). */
export function solveSignature(playerJs: string, sig: string): string | null {
  const ops = extractSigOperations(playerJs);
  return ops ? applySigOperations(sig, ops) : null;
}

/** The `signatureTimestamp` (sts) baked into player.js — pins the `/player` request. */
export function extractSignatureTimestamp(playerJs: string): number | null {
  const m = playerJs.match(/signatureTimestamp[=:]\s*(\d+)/);
  return m ? Number(m[1]) : null;
}
