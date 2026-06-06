/**
 * Tiny leveled logger. `debug`/`info` are silenced in production builds; `warn`
 * and `error` always pass through. Mirrors the doodlekuma console-discipline
 * convention — components should import this rather than touching `console.*`.
 */
const isDev = import.meta.env?.DEV ?? true;

function ts(): string {
  return new Date().toISOString().slice(11, 23);
}

export const log = {
  debug(scope: string, ...args: unknown[]): void {
    if (isDev) console.debug(`[${ts()}] ${scope}`, ...args);
  },
  info(scope: string, ...args: unknown[]): void {
    if (isDev) console.info(`[${ts()}] ${scope}`, ...args);
  },
  warn(scope: string, ...args: unknown[]): void {
    console.warn(`[${ts()}] ${scope}`, ...args);
  },
  error(scope: string, ...args: unknown[]): void {
    console.error(`[${ts()}] ${scope}`, ...args);
  },
};
