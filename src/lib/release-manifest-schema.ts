/**
 * Release-distribution manifest — the FULL version-history index published to the
 * official R2 bucket (assets.mu0.app/desktop/manifest.json). Drives the in-app
 * "version history" download center. Distinct from electron-updater's latest*.yml
 * (which only describes the newest version per channel) and from the user-library
 * `muzero-r2-manifest-v1` (that's user data — different domain entirely).
 *
 * Written by scripts/publish-release.mjs (additive per-platform merge), read +
 * validated here by the Settings UI. See
 * docs/prd/20260611-muzero-release-pipeline-changelog-prd §3.5.
 */
import { z } from "zod";

export const RELEASE_PLATFORMS = [
  "mac-arm64",
  "mac-x64",
  "win-x64",
  "linux-x64-appimage",
  "linux-x64-deb",
] as const;

export const releasePlatformSchema = z.enum(RELEASE_PLATFORMS);
export type ReleasePlatform = z.infer<typeof releasePlatformSchema>;

export const releaseAssetSchema = z.object({
  /** R2 key relative to the desktop/ prefix, e.g. "0.7.0/MUZERO-0.7.0-arm64.dmg". */
  file: z.string(),
  /** Absolute download URL. */
  url: z.string().url(),
  size: z.number().int().nonnegative(),
  sha256: z.string(),
});
export type ReleaseAsset = z.infer<typeof releaseAssetSchema>;

export const releaseEntrySchema = z.object({
  version: z.string(),
  date: z.string(),
  channel: z.enum(["stable", "beta"]).default("stable"),
  /** Key into the bundled changelog (releases/<version>.ts). */
  notesRef: z.string(),
  // partialRecord: a subset of platform keys (a release may not ship every
  // platform at once), but unknown keys are still rejected.
  platforms: z.partialRecord(releasePlatformSchema, releaseAssetSchema),
});
export type ReleaseEntry = z.infer<typeof releaseEntrySchema>;

export const releaseManifestSchema = z.object({
  schema: z.literal("muzero-release-manifest-v1"),
  productName: z.literal("MUZERO"),
  /** Newest stable version. */
  latest: z.string(),
  /** Newest beta version, if any. */
  latestBeta: z.string().optional(),
  updatedAt: z.string(),
  /** Newest-first. */
  releases: z.array(releaseEntrySchema),
});
export type ReleaseManifest = z.infer<typeof releaseManifestSchema>;

export function parseReleaseManifest(input: unknown): ReleaseManifest {
  return releaseManifestSchema.parse(input);
}
