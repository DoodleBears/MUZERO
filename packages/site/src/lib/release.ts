/**
 * Read the public release manifest (assets.mu0.app/desktop/manifest.json) that
 * drives the download UI — the same source the desktop app's Settings → Version
 * history uses. The R2 bucket serves it with permissive CORS, so the static site
 * fetches it directly in the browser. Shape mirrors the app's
 * release-manifest-schema (kept in sync; validated loosely here, no Zod dep).
 */
export const RELEASE_MANIFEST_URL = "https://assets.mu0.app/desktop/manifest.json";
export const CHANGELOG_URL = "https://github.com/DoodleBears/MUZERO/blob/main/CHANGELOG.md";

export const PLATFORMS = [
  "mac-arm64",
  "mac-x64",
  "win-x64",
  "linux-x64-appimage",
  "linux-x64-deb",
] as const;
export type Platform = (typeof PLATFORMS)[number];
export type OsFamily = "mac" | "win" | "linux" | "other";

export type ReleaseAsset = { file: string; url: string; size: number; sha256: string };
export type ReleaseEntry = {
  version: string;
  date: string;
  channel?: "stable" | "beta";
  notesRef?: string;
  platforms: Partial<Record<Platform, ReleaseAsset>>;
};
export type ReleaseManifest = {
  schema: string;
  productName: string;
  latest: string;
  latestBeta?: string;
  updatedAt: string;
  releases: ReleaseEntry[];
};

export async function fetchManifest(url: string = RELEASE_MANIFEST_URL): Promise<ReleaseManifest> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Release manifest unavailable (${res.status})`);
  const data = (await res.json()) as ReleaseManifest;
  if (!data || !Array.isArray(data.releases)) throw new Error("Malformed release manifest");
  return data;
}

/** Best-effort host OS family, to lead with the matching download. */
export function currentOsFamily(
  ua: string = typeof navigator === "undefined" ? "" : navigator.userAgent,
): OsFamily {
  const s = ua.toLowerCase();
  if (s.includes("mac")) return "mac";
  if (s.includes("win")) return "win";
  if (s.includes("linux") || s.includes("x11")) return "linux";
  return "other";
}

export function osOfPlatform(p: Platform): Exclude<OsFamily, "other"> {
  if (p.startsWith("mac")) return "mac";
  if (p.startsWith("win")) return "win";
  return "linux";
}

export const OS_LABEL: Record<OsFamily, string> = {
  mac: "macOS",
  win: "Windows",
  linux: "Linux",
  other: "Desktop",
};

/** Short label for a specific asset (arch / format). */
export const VARIANT_LABEL: Record<Platform, string> = {
  "mac-arm64": "Apple Silicon",
  "mac-x64": "Intel",
  "win-x64": "x64",
  "linux-x64-appimage": "AppImage",
  "linux-x64-deb": ".deb",
};

/** The asset to feature first for an OS (preferred arch / format). */
export const PRIMARY_PLATFORM: Record<Exclude<OsFamily, "other">, Platform> = {
  mac: "mac-arm64",
  win: "win-x64",
  linux: "linux-x64-appimage",
};

/** Assets of an OS present in a release, primary-first. */
export function osAssets(entry: ReleaseEntry, os: Exclude<OsFamily, "other">): Platform[] {
  return PLATFORMS.filter((p) => osOfPlatform(p) === os && entry.platforms[p]).sort((a, b) =>
    a === PRIMARY_PLATFORM[os] ? -1 : b === PRIMARY_PLATFORM[os] ? 1 : 0,
  );
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "";
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
}
