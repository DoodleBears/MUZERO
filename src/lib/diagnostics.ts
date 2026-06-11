export type DiagnosticLevel = "debug" | "info" | "warn" | "error";
export type DiagnosticSource = "renderer" | "electron-main" | "tauri" | "web";
export type DiagnosticCategory =
  | "user-action"
  | "state"
  | "network"
  | "stream"
  | "media"
  | "cache"
  | "sync"
  | "db"
  | "provider"
  | "auth"
  | "performance"
  | "app";
export type DiagnosticPhase = "start" | "success" | "retry" | "fail" | "abort" | "skip" | "state";
export type DiagnosticErrorKind =
  | "http_status"
  | "network_error"
  | "timeout"
  | "media_decode"
  | "unsupported_source"
  | "auth_required"
  | "permission_denied"
  | "po_token"
  | "schema"
  | "db"
  | "unknown";
export type DiagnosticActionKind =
  | "click"
  | "submit"
  | "change"
  | "keyboard"
  | "drag"
  | "drop"
  | "paste"
  | "navigation";
export type DiagnosticInputKind = "text" | "file" | "media" | "toggle" | "select" | "slider";

export interface DiagnosticContext {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  operation?: string;
  phase?: DiagnosticPhase;
  category?: DiagnosticCategory;
  errorKind?: DiagnosticErrorKind;
  source?: DiagnosticSource;
  durationMs?: number;
  trackId?: string;
  sessionId?: string;
  sourceId?: string;
  videoId?: string;
  requestHost?: string;
  requestPathHash?: string;
  httpStatus?: number;
  contentType?: string;
  range?: string | null;
  acceptRanges?: string | null;
  bytes?: number;
  mime?: string;
  mediaReadyState?: number;
  mediaNetworkState?: number;
  retryCount?: number;
  route?: string;
  uiSurface?: string;
  controlId?: string;
  actionKind?: DiagnosticActionKind;
  inputKind?: DiagnosticInputKind;
  redactions?: string[];
  [key: string]: unknown;
}

export interface DiagnosticEntry {
  id: number;
  at: number;
  level: DiagnosticLevel;
  scope: string;
  event: string;
  message: string;
  context?: DiagnosticContext;
}

export interface DiagnosticFilter {
  levels?: DiagnosticLevel[];
  categories?: DiagnosticCategory[];
  phases?: DiagnosticPhase[];
  errorKinds?: DiagnosticErrorKind[];
  sources?: DiagnosticSource[];
  traceId?: string;
  trackId?: string;
  sessionId?: string;
  sourceId?: string;
  videoId?: string;
  entityId?: string;
  text?: string;
}

export interface SanitizedUrlSummary {
  host: string | null;
  pathHash: string;
  safeQuery: Record<string, string>;
  redactions: string[];
}

export interface DiagnosticSpan {
  traceId: string;
  spanId: string;
  operation: string;
  startedAt: number;
}

// Redaction is allowlist-minded: technical ids survive, secrets and raw user text do not.
const SECRET_KEY_RE =
  /^(authorization|cookie|set-cookie|x-api-key|api[-_]?key|access[-_]?key|secret|token|password|bearer)$/i;
const USER_INPUT_KEY_RE =
  /^(prompt|lyrics|caption|note|message|chat|text|query|searchquery|search[-_]?query|filename|file[-_]?name|clipboard|pastedtext|pasted[-_]?text|urltext|url[-_]?text)$/i;
const SIGNED_URL_PARAMS = new Set([
  "pot",
  "sig",
  "lsig",
  "signature",
  "spc",
  "bui",
  "id",
  "n",
  "cpn",
  "key",
  "token",
  "access_token",
  "auth",
  "authorization",
  "cookie",
]);
const SAFE_URL_PARAMS = new Set(["itag", "mime", "dur", "clen", "source"]);

export function sanitizeDiagnosticData(value: unknown): unknown {
  return sanitizeValue(value, undefined, new WeakSet<object>());
}

export function createTraceId(prefix: string): string {
  return `${safeIdPrefix(prefix)}_${Date.now().toString(36)}${randomIdPart()}`;
}

export function startDiagnosticSpan(
  traceId: string,
  operation: string,
  now: number = Date.now(),
): DiagnosticSpan {
  return {
    traceId,
    spanId: createTraceId("spn"),
    operation,
    startedAt: now,
  };
}

export function finishDiagnosticSpan(
  span: DiagnosticSpan,
  phase: DiagnosticPhase,
  context: DiagnosticContext = {},
  now: number = Date.now(),
): DiagnosticContext {
  return {
    ...context,
    traceId: span.traceId,
    spanId: span.spanId,
    operation: span.operation,
    phase,
    durationMs: Math.max(0, now - span.startedAt),
  };
}

export function sanitizeUrlForTrace(rawUrl: string): SanitizedUrlSummary {
  try {
    const parsed = new URL(rawUrl);
    const safeQuery: Record<string, string> = {};
    const redactions: string[] = [];
    const sortedParams = [...parsed.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));

    for (const [key, value] of sortedParams) {
      const lower = key.toLowerCase();
      if (SAFE_URL_PARAMS.has(lower)) {
        safeQuery[key] = value;
        continue;
      }
      if (SIGNED_URL_PARAMS.has(lower)) redactions.push(`url.query.${key}`);
    }

    return {
      host: parsed.host,
      pathHash: stableHash(parsed.pathname),
      safeQuery,
      redactions,
    };
  } catch {
    return {
      host: null,
      pathHash: stableHash(rawUrl),
      safeQuery: {},
      redactions: ["url.invalid"],
    };
  }
}

export function matchesDiagnosticFilter(entry: DiagnosticEntry, filter: DiagnosticFilter): boolean {
  if (filter.levels?.length && !filter.levels.includes(entry.level)) return false;
  if (filter.categories?.length && !matchesMaybe(filter.categories, entry.context?.category))
    return false;
  if (filter.phases?.length && !matchesMaybe(filter.phases, entry.context?.phase)) return false;
  if (filter.errorKinds?.length && !matchesMaybe(filter.errorKinds, entry.context?.errorKind)) {
    return false;
  }
  if (filter.sources?.length && !matchesMaybe(filter.sources, entry.context?.source)) return false;
  if (filter.traceId && entry.context?.traceId !== filter.traceId) return false;
  if (filter.trackId && entry.context?.trackId !== filter.trackId) return false;
  if (filter.sessionId && entry.context?.sessionId !== filter.sessionId) return false;
  if (filter.sourceId && entry.context?.sourceId !== filter.sourceId) return false;
  if (filter.videoId && entry.context?.videoId !== filter.videoId) return false;
  if (filter.entityId && !entryContainsEntity(entry, filter.entityId)) return false;
  if (filter.text && !entrySearchText(entry).includes(filter.text.toLowerCase())) return false;
  return true;
}

function sanitizeValue(value: unknown, key: string | undefined, seen: WeakSet<object>): unknown {
  if (key && SECRET_KEY_RE.test(key)) return secretRedactionForKey(key);
  if (key && USER_INPUT_KEY_RE.test(key)) return "[redacted:user-input]";
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  if (typeof Event !== "undefined" && value instanceof Event) return { type: value.type };
  if (typeof Element !== "undefined" && value instanceof Element) {
    return {
      tagName: value.tagName,
      id: value.id || undefined,
      className: typeof value.className === "string" ? value.className || undefined : undefined,
    };
  }
  if (typeof value === "string") {
    if (key && key.toLowerCase() === "url") return sanitizeUrlForTrace(value);
    return value;
  }
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[redacted:circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, undefined, seen));

  const out: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    out[childKey] = sanitizeValue(childValue, childKey, seen);
  }
  return out;
}

function secretRedactionForKey(key: string): string {
  const lower = key.toLowerCase();
  if (lower === "authorization") return "[redacted:authorization]";
  if (lower === "cookie" || lower === "set-cookie") return "[redacted:cookie]";
  return "[redacted:secret]";
}

function matchesMaybe<T>(allowed: T[], value: T | undefined): boolean {
  return value !== undefined && allowed.includes(value);
}

function entryContainsEntity(entry: DiagnosticEntry, entityId: string): boolean {
  const ctx = entry.context;
  if (!ctx) return false;
  return (
    ctx.traceId === entityId ||
    ctx.trackId === entityId ||
    ctx.sessionId === entityId ||
    ctx.sourceId === entityId ||
    ctx.videoId === entityId
  );
}

function entrySearchText(entry: DiagnosticEntry): string {
  const ctx = entry.context;
  return [
    entry.level,
    entry.scope,
    entry.event,
    entry.message,
    ctx?.traceId,
    ctx?.trackId,
    ctx?.sessionId,
    ctx?.sourceId,
    ctx?.videoId,
    ctx?.route,
    ctx?.uiSurface,
    ctx?.controlId,
    ctx?.category,
    ctx?.phase,
    ctx?.errorKind,
    ctx?.source,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function stableHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function safeIdPrefix(prefix: string): string {
  const safe = prefix
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return safe || "trc";
}

function randomIdPart(): string {
  return Math.random().toString(36).slice(2, 8);
}
