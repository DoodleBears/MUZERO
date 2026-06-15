/**
 * Tiny, dependency-free template engine for mapping an arbitrary incoming
 * request body to MUZERO's request fields. Ported from the `anysoul` webhook
 * mapping engine (`packages/server/src/services/webhooks.ts`
 * `applyTemplateString`) so the Settings preview and the live intake path share
 * one evaluator — what the user sees in the mapping dialog is exactly what runs
 * on a real request (preview parity).
 *
 * Supported syntax inside `{{ … }}`:
 *   - `payload` / `payload.a.b`  → path access (prototype keys blocked)
 *   - `a || b || 'literal'`      → first non-empty candidate
 *   - `cond ? 'x' : 'y'`         → ternary (quoted colons respected)
 *   - `expr | map '${item.x}' | join ', '` → pipes (map / join / time)
 *   - `'single'` / `"double"`    → string literals (with \n \r \t \\ escapes)
 *
 * A single whole-string `{{ expr }}` returns the raw resolved value (objects and
 * numbers preserved); anything with surrounding text or multiple blocks renders
 * to a string. This is a closed expression language — no host access, no eval.
 */

export interface TemplateContext {
  payload: Record<string, unknown>;
  item?: unknown;
}

const BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function getPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  const keys = path.split(".").filter(Boolean);
  let cur: unknown = obj;
  for (const key of keys) {
    if (!cur || typeof cur !== "object") return undefined;
    if (BLOCKED_KEYS.has(key)) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function processEscapes(str: string): string {
  return str.replace(/\\([nrt\\])/g, (_, ch) => {
    switch (ch) {
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      case "\\":
        return "\\";
      default:
        return ch;
    }
  });
}

function unquoteLiteral(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return processEscapes(trimmed.slice(1, -1));
  }
  return trimmed;
}

/** Split `cond ? a : b`, ignoring `?`/`:` inside quoted literals. */
function parseTernary(
  expr: string,
): { condition: string; trueExpr: string; falseExpr: string } | null {
  let questionIdx = -1;
  let colonIdx = -1;
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (!inSingle && !inDouble) {
      if (ch === "?" && questionIdx === -1) questionIdx = i;
      else if (ch === ":" && questionIdx !== -1 && colonIdx === -1) colonIdx = i;
    }
  }

  if (questionIdx === -1 || colonIdx === -1) return null;
  return {
    condition: expr.slice(0, questionIdx).trim(),
    trueExpr: expr.slice(questionIdx + 1, colonIdx).trim(),
    falseExpr: expr.slice(colonIdx + 1).trim(),
  };
}

interface PipeOp {
  name: string;
  arg: string;
}

/** Split `base | op arg | op2`, ignoring `|` inside quoted literals. */
function parsePipeline(candidate: string): { base: string; pipes: PipeOp[] } | null {
  const segments: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < candidate.length; i++) {
    const ch = candidate[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      current += ch;
    } else if (ch === "|" && !inSingle && !inDouble) {
      segments.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  segments.push(current.trim());

  if (segments.length <= 1) return null;

  const base = segments[0];
  const pipes: PipeOp[] = segments.slice(1).map((seg) => {
    const firstSpace = seg.indexOf(" ");
    if (firstSpace === -1) return { name: seg, arg: "" };
    return { name: seg.slice(0, firstSpace).trim(), arg: seg.slice(firstSpace + 1).trim() };
  });

  return { base, pipes };
}

/** Resolve `${expr}` placeholders inside a `map` template against `ctx.item`. */
function resolveInnerTemplate(template: string, ctx: TemplateContext): string {
  return template.replace(/\$\{([^}]+)\}/g, (_, expr: string) => {
    const value = resolveTemplateExpression(expr.trim(), ctx);
    if (value === null || value === undefined) return "";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  });
}

function applyPipe(value: unknown, pipe: PipeOp, ctx: TemplateContext): unknown {
  switch (pipe.name) {
    case "map": {
      if (!Array.isArray(value)) return value;
      const template = unquoteLiteral(pipe.arg);
      return value.map((element) => resolveInnerTemplate(template, { ...ctx, item: element }));
    }
    case "join": {
      if (!Array.isArray(value)) return value;
      const sep = pipe.arg ? unquoteLiteral(pipe.arg) : "\n";
      return value.map((v) => (v == null ? "" : String(v))).join(sep);
    }
    case "time": {
      const num = typeof value === "number" ? value : Number(value);
      if (Number.isNaN(num)) return value;
      const total = Math.floor(num);
      const h = Math.floor(total / 3600);
      const m = Math.floor((total % 3600) / 60);
      const s = total % 60;
      const mm = String(m).padStart(2, "0");
      const ss = String(s).padStart(2, "0");
      return h > 0 ? `${String(h).padStart(2, "0")}:${mm}:${ss}` : `${mm}:${ss}`;
    }
    default:
      return value;
  }
}

function resolveTemplateExpression(expr: string, ctx: TemplateContext): unknown {
  const ternary = parseTernary(expr);
  if (ternary) {
    const condValue = resolveTemplateExpression(ternary.condition, ctx);
    const isTruthy =
      condValue !== undefined && condValue !== null && condValue !== "" && condValue !== false;
    return resolveTemplateExpression(isTruthy ? ternary.trueExpr : ternary.falseExpr, ctx);
  }

  const candidates = expr.split("||").map((part) => part.trim());
  for (const candidate of candidates) {
    if (!candidate) continue;

    const pipeline = parsePipeline(candidate);
    if (pipeline) {
      let result = resolveTemplateExpression(pipeline.base, ctx);
      for (const pipe of pipeline.pipes) {
        result = applyPipe(result, pipe, ctx);
      }
      if (result !== undefined && result !== null && result !== "") return result;
      continue;
    }

    if (
      (candidate.startsWith("'") && candidate.endsWith("'")) ||
      (candidate.startsWith('"') && candidate.endsWith('"'))
    ) {
      const literal = unquoteLiteral(candidate);
      if (literal) return literal;
      continue;
    }

    if (candidate === "payload") return ctx.payload;
    if (candidate.startsWith("payload.")) {
      const value = getPath(ctx.payload, candidate.slice("payload.".length));
      if (value !== undefined && value !== null && value !== "") return value;
      continue;
    }

    if (candidate === "item") return ctx.item;
    if (candidate.startsWith("item.")) {
      const value = getPath(ctx.item, candidate.slice("item.".length));
      if (value !== undefined && value !== null && value !== "") return value;
      continue;
    }

    if (candidate === "null") return null;
    if (candidate === "true") return true;
    if (candidate === "false") return false;

    if (candidate) return candidate;
  }

  return undefined;
}

/**
 * Evaluate a mapping template against a payload. A whole-string `{{ expr }}`
 * returns the raw resolved value; otherwise renders to an interpolated string
 * with missing values rendered as empty.
 */
export function applyTemplateString(input: string, ctx: TemplateContext): unknown {
  // Single-expression fast path: `{{ expr }}` with no other blocks. The lazy
  // (.+?) could span multiple `{{ }}` pairs, so guard against nested `{{`.
  const wholeMatch = input.match(/^\s*\{\{\s*(.+?)\s*\}\}\s*$/);
  if (wholeMatch && !wholeMatch[1].includes("{{")) {
    return resolveTemplateExpression(wholeMatch[1], ctx);
  }

  return input.replace(/\{\{\s*(.+?)\s*\}\}/g, (_match, expr) => {
    const resolved = resolveTemplateExpression(expr, ctx);
    if (resolved === null || resolved === undefined) return "";
    if (typeof resolved === "object") return JSON.stringify(resolved);
    return String(resolved);
  });
}
