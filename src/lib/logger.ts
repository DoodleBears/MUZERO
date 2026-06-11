/**
 * Leveled diagnostics logger. Settings Trace is the support source of truth;
 * console output is only a sanitized dev mirror / emergency fallback.
 */
import {
  type DiagnosticContext,
  type DiagnosticLevel,
  sanitizeDiagnosticData,
} from "@/lib/diagnostics";
import { type TraceLevel, traceDiagnosticEvent, traceEvent } from "@/lib/trace";

const isDev = import.meta.env?.DEV ?? true;

type DiagnosticLogContext = DiagnosticContext & {
  message?: string;
};

function ts(): string {
  return new Date().toISOString().slice(11, 23);
}

export const log = {
  debug(scope: string, ...args: unknown[]): void {
    trace("debug", scope, args);
    writeConsole("debug", scope, args);
  },
  info(scope: string, ...args: unknown[]): void {
    trace("info", scope, args);
    writeConsole("info", scope, args);
  },
  warn(scope: string, ...args: unknown[]): void {
    trace("warn", scope, args);
    writeConsole("warn", scope, args);
  },
  error(scope: string, ...args: unknown[]): void {
    trace("error", scope, args);
    writeConsole("error", scope, args);
  },
};

export function createDiagnosticLogger(scope: string) {
  return {
    debug(event: string, context: DiagnosticLogContext = {}): void {
      structured("debug", scope, event, context);
    },
    info(event: string, context: DiagnosticLogContext = {}): void {
      structured("info", scope, event, context);
    },
    warn(event: string, context: DiagnosticLogContext = {}): void {
      structured("warn", scope, event, context);
    },
    error(event: string, context: DiagnosticLogContext = {}): void {
      structured("error", scope, event, context);
    },
  };
}

export function recordUserAction(event: string, context: DiagnosticLogContext = {}): void {
  structured("info", "ui.action", event, {
    phase: "start",
    ...context,
    category: "user-action",
  });
}

function trace(level: TraceLevel, scope: string, args: unknown[]): void {
  const [message, ...rest] = args;
  traceEvent(level, scope, typeof message === "string" ? message : "log", ...rest);
}

function structured(
  level: DiagnosticLevel,
  scope: string,
  event: string,
  { message, ...context }: DiagnosticLogContext,
): void {
  const safeMessage = message || event;
  traceDiagnosticEvent(level, scope, event, safeMessage, context);
  writeConsole(level, scope, [event, safeMessage, context]);
}

function writeConsole(level: DiagnosticLevel, scope: string, args: unknown[]): void {
  if ((level === "debug" || level === "info") && !isDev) return;
  const safeArgs = args.map((value) => sanitizeDiagnosticData(value));
  console[level](`[${ts()}] ${scope}`, ...safeArgs);
}
