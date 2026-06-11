/**
 * Fetch + cache the public release manifest (assets.mu0.app/desktop/manifest.json)
 * that powers the in-app "version history" download center. Goes through
 * getAppFetch() so the desktop shell bypasses CORS via muzfetch and the web build
 * fetches it directly. See docs/prd/20260611-muzero-release-pipeline-changelog-prd §5.1.
 */
import { useQuery } from "@tanstack/react-query";
import { getAppFetch } from "@/lib/platform";
import {
  parseReleaseManifest,
  type ReleaseManifest,
  type ReleasePlatform,
} from "@/lib/release-manifest-schema";

export const RELEASE_MANIFEST_URL = "https://assets.mu0.app/desktop/manifest.json";

export async function fetchReleaseManifest(
  url: string = RELEASE_MANIFEST_URL,
): Promise<ReleaseManifest> {
  const fetch = await getAppFetch();
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Release manifest unavailable (${res.status})`);
  return parseReleaseManifest(await res.json());
}

export function useReleaseManifest() {
  return useQuery({
    queryKey: ["release-manifest"],
    queryFn: () => fetchReleaseManifest(),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

export type OsFamily = "mac" | "win" | "linux" | "other";

/** Best-effort host OS family, to highlight the matching download. */
export function currentOsFamily(
  ua: string = typeof navigator === "undefined" ? "" : navigator.userAgent,
): OsFamily {
  const s = ua.toLowerCase();
  if (s.includes("mac")) return "mac";
  if (s.includes("win")) return "win";
  if (s.includes("linux") || s.includes("x11")) return "linux";
  return "other";
}

/** Whether a manifest platform key belongs to the given OS family. */
export function platformMatchesOs(platform: ReleasePlatform, os: OsFamily): boolean {
  if (os === "mac") return platform.startsWith("mac-");
  if (os === "win") return platform.startsWith("win-");
  if (os === "linux") return platform.startsWith("linux-");
  return false;
}
