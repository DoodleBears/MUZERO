/**
 * Tiny leveled logger. `debug`/`info` are silenced in production builds; `warn`
 * and `error` always pass through. Mirrors the doodlekuma console-discipline
 * convention — components should import this rather than touching `console.*`.
 */
import { type TraceLevel, traceEvent } from "@/lib/trace";

const isDev = import.meta.env?.DEV ?? true;

function ts(): string {
  return new Date().toISOString().slice(11, 23);
}

export const log = {
  debug(scope: string, ...args: unknown[]): void {
    trace("debug", scope, args);
    if (isDev) console.debug(`[${ts()}] ${scope}`, ...args);
  },
  info(scope: string, ...args: unknown[]): void {
    trace("info", scope, args);
    if (isDev) console.info(`[${ts()}] ${scope}`, ...args);
  },
  warn(scope: string, ...args: unknown[]): void {
    trace("warn", scope, args);
    console.warn(`[${ts()}] ${scope}`, ...args);
  },
  error(scope: string, ...args: unknown[]): void {
    trace("error", scope, args);
    console.error(`[${ts()}] ${scope}`, ...args);
  },
};

function trace(level: TraceLevel, scope: string, args: unknown[]): void {
  const [message, ...rest] = args;
  traceEvent(level, scope, typeof message === "string" ? message : "log", ...rest);
}
