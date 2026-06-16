/**
 * Per-source login config + pure cookie helpers. Logging in opens the source's real
 * login page in a desktop auth window (see `DesktopBridge.openSourceLogin`); once the
 * session cookie appears we capture it into `AppSettings.streamSources[id].cookie`
 * (device-local, BYOK — never bundled). The cookie then rides on every request via
 * each source's `getCookie`, unlocking VIP / higher quality.
 *
 * This module is pure (no Electron / DB) so the config + assembly are unit-testable;
 * the window + cookie-store read live in the desktop layer.
 */

import type { StreamSourceConfig, StreamSourceId } from "@/db/types";

export interface StreamCookie {
  name: string;
  value: string;
}

export interface StreamLoginConfig {
  source: StreamSourceId;
  /** The login page opened in the auth window. */
  loginUrl: string;
  /** URLs whose cookie store to read after login (queried per URL by the main process). */
  cookieUrls: string[];
  /** Presence of this cookie (with a value) signals a completed login — poll until it appears. */
  authCookie: string;
}

/** Login is wired for the sources with a cookie-based session (YouTube uses OAuth — later). */
export const STREAM_LOGIN_CONFIGS: Partial<Record<StreamSourceId, StreamLoginConfig>> = {
  netease: {
    source: "netease",
    loginUrl: "https://music.163.com/#/login",
    cookieUrls: ["https://music.163.com"],
    authCookie: "MUSIC_U",
  },
  bili: {
    source: "bili",
    loginUrl: "https://passport.bilibili.com/login",
    cookieUrls: ["https://www.bilibili.com", "https://bilibili.com"],
    authCookie: "SESSDATA",
  },
  // QQ Music web — the official page hosts QQ + WeChat QR login (Q4: login-window
  // route first). On success the session sets qqmusic_key/qqmusic_uin on .qq.com,
  // which provider g_tk switches to hash33(musickey). Whether y.qq.com exposes the
  // key as a readable cookie (vs localStorage) is a Phase 3 runtime-verify item.
  qq: {
    source: "qq",
    loginUrl: "https://y.qq.com/",
    cookieUrls: ["https://y.qq.com", "https://c.y.qq.com"],
    authCookie: "qqmusic_key",
  },
};

/**
 * Build a `Cookie:` header value from captured cookies. Drops empties and dedupes by
 * name (last wins — the freshest value from the session store).
 */
export function assembleCookieHeader(cookies: StreamCookie[]): string {
  const byName = new Map<string, string>();
  for (const c of cookies) {
    if (c.name && c.value) byName.set(c.name, c.value);
  }
  return [...byName].map(([name, value]) => `${name}=${value}`).join("; ");
}

/** Whether the captured cookies include the source's auth cookie (with a value) → logged in. */
export function hasAuthCookie(cookies: StreamCookie[], authCookie: string): boolean {
  return cookies.some((c) => c.name === authCookie && c.value.length > 0);
}

/** Whether a stored cookie string already carries the source's auth cookie. */
export function cookieStringHasAuth(cookie: string | undefined, authCookie: string): boolean {
  if (!cookie) return false;
  return cookie.split(";").some((pair) => pair.trim().startsWith(`${authCookie}=`));
}

type StreamSourcesMap = Partial<Record<StreamSourceId, StreamSourceConfig>>;

/**
 * Settings patch after a successful login: store the cookie + mark the source
 * enabled, preserving any existing quality preference. Returns the new map (the
 * caller wraps it as `{ streamSources }` for saveSettings).
 */
export function streamSourcesAfterLogin(
  current: StreamSourcesMap | undefined,
  source: StreamSourceId,
  cookie: string,
  now: number,
): StreamSourcesMap {
  const map = current ?? {};
  return {
    ...map,
    [source]: { ...map[source], cookie, enabled: true, lastAuthAt: now },
  };
}

/** Settings patch after logout: drop the cookie + auth timestamp, keep quality/enabled. */
export function streamSourcesAfterLogout(
  current: StreamSourcesMap | undefined,
  source: StreamSourceId,
): StreamSourcesMap {
  const map = current ?? {};
  const existing = map[source];
  if (!existing) return map;
  const { cookie: _cookie, lastAuthAt: _lastAuthAt, ...rest } = existing;
  return { ...map, [source]: rest };
}
