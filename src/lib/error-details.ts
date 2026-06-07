/**
 * Framework-agnostic error introspection + a clipboard formatter.
 *
 * `extractErrorDebugInfo` normalizes anything thrown (Error, plain object,
 * string, MediaError…) into a flat, copy-friendly shape; `formatErrorClipboardText`
 * renders that plus device/route context into the one-click "copy details"
 * payload used by both the notification stack and the global error boundary.
 * Pure, no DOM, no deps — exhaustively unit-tested in `error-details.test.ts`.
 */

export interface ErrorDebugInfo {
  name?: string;
  message?: string;
  detail?: string;
  stack?: string;
  componentStack?: string;
  cause?: string;
  requestId?: string;
  traceId?: string;
  code?: string;
  status?: string;
  source?: string;
}

interface ErrorDebugContext extends Partial<ErrorDebugInfo> {
  detail?: string;
  requestId?: string;
  traceId?: string;
}

interface ErrorClipboardInput {
  message?: string;
  detail?: string;
  requestId?: string;
  traceId?: string;
  createdAt?: number;
  url?: string;
  userAgent?: string;
  context?: Array<{ label: string; value?: string }>;
  debug?: ErrorDebugInfo;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function stringifyUnknown(value: unknown): string | undefined {
  if (typeof value === "string") return cleanString(value);
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  const record = toRecord(value);
  if (!record) return undefined;

  try {
    return cleanString(JSON.stringify(record));
  } catch {
    return undefined;
  }
}

function formatCause(cause: unknown): string | undefined {
  if (cause instanceof Error) {
    return [cleanString(cause.name), cleanString(cause.message)].filter(Boolean).join(": ");
  }

  const record = toRecord(cause);
  if (record) {
    const name = cleanString(record.name);
    const message = cleanString(record.message);
    if (name || message) return [name, message].filter(Boolean).join(": ");
  }

  return stringifyUnknown(cause);
}

function compactDebugInfo(info: ErrorDebugInfo): ErrorDebugInfo | undefined {
  const compact = Object.fromEntries(
    Object.entries(info).filter(([, value]) => value !== undefined && value !== ""),
  ) as ErrorDebugInfo;

  return Object.keys(compact).length > 0 ? compact : undefined;
}

/**
 * Normalize any thrown value into a flat {@link ErrorDebugInfo}. Merges optional
 * `context` (component stack, source, ids) the catch site knows but the error
 * object doesn't. Returns `undefined` when there's nothing useful to report.
 */
export function extractErrorDebugInfo(
  error: unknown,
  context: ErrorDebugContext = {},
): ErrorDebugInfo | undefined {
  const base: ErrorDebugInfo = {
    detail: context.detail,
    componentStack: cleanString(context.componentStack),
    requestId: context.requestId,
    traceId: context.traceId,
    source: cleanString(context.source),
    code: cleanString(context.code),
    status: cleanString(context.status),
  };

  if (error instanceof Error) {
    const errorWithCause = error as Error & { cause?: unknown };
    const record = error as Error & Record<string, unknown>;
    return compactDebugInfo({
      ...base,
      name: cleanString(error.name),
      message: cleanString(error.message),
      detail: base.detail ?? cleanString(record.detail),
      stack: cleanString(error.stack),
      cause: formatCause(errorWithCause.cause),
      componentStack: base.componentStack ?? cleanString(record.componentStack),
      requestId: base.requestId ?? cleanString(record.requestId),
      traceId: base.traceId ?? cleanString(record.traceId),
      code: base.code ?? cleanString(record.code),
      status:
        base.status ??
        (typeof record.status === "number" || typeof record.status === "string"
          ? String(record.status)
          : undefined),
      source: base.source ?? cleanString(record.source),
    });
  }

  const record = toRecord(error);
  if (record) {
    return compactDebugInfo({
      ...base,
      name: cleanString(record.name),
      message: cleanString(record.message),
      detail: base.detail ?? cleanString(record.detail),
      stack: cleanString(record.stack),
      componentStack: base.componentStack ?? cleanString(record.componentStack),
      cause: formatCause(record.cause),
      requestId: base.requestId ?? cleanString(record.requestId),
      traceId: base.traceId ?? cleanString(record.traceId),
      code: base.code ?? cleanString(record.code),
      status:
        base.status ??
        (typeof record.status === "number" || typeof record.status === "string"
          ? String(record.status)
          : undefined),
      source: base.source ?? cleanString(record.source),
    });
  }

  return compactDebugInfo({
    ...base,
    message: stringifyUnknown(error),
  });
}

/**
 * Render an error + its context into the plain-text blob copied to the
 * clipboard: a summary line, metadata, device/route context, then the stacks.
 */
export function formatErrorClipboardText(input: ErrorClipboardInput): string {
  const { debug } = input;
  const requestId = input.requestId || debug?.requestId;
  const traceId = input.traceId || debug?.traceId;
  const lines = [
    `Error: ${input.message || debug?.message || "Unknown error"}`,
    debug?.name ? `Name: ${debug.name}` : null,
    input.detail || debug?.detail ? `Detail: ${input.detail || debug?.detail}` : null,
    requestId ? `ReqID: ${requestId}` : null,
    traceId && traceId !== requestId ? `Trace: ${traceId}` : null,
    debug?.code ? `Code: ${debug.code}` : null,
    debug?.status ? `Status: ${debug.status}` : null,
    debug?.source ? `Source: ${debug.source}` : null,
    input.url ? `URL: ${input.url}` : null,
    input.createdAt ? `Time: ${new Date(input.createdAt).toISOString()}` : null,
    input.userAgent ? `UA: ${input.userAgent}` : null,
    ...(input.context ?? []).map((item) => (item.value ? `${item.label}: ${item.value}` : null)),
    debug?.cause ? `\nCause:\n${debug.cause}` : null,
    debug?.componentStack ? `\nComponent Stack:\n${debug.componentStack}` : null,
    debug?.stack ? `\nStack:\n${debug.stack}` : null,
  ];

  return lines.filter(Boolean).join("\n");
}
