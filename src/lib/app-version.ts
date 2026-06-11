/**
 * The ONLY place app code reads the version from. Never hand-type a version
 * string elsewhere — these come from build-time defines (vite.config.ts /
 * vitest.config.ts) computed from package.json `version`, which is the single
 * source of truth kept in sync with tauri.conf.json + Cargo.toml by
 * scripts/bump-version.mjs.
 *
 * On desktop the authoritative runtime version is the Electron `app.getVersion()`
 * (exposed via the preload bridge); APP_VERSION here is the bundled-renderer
 * version and they match for a given release. See
 * docs/prd/20260611-muzero-release-pipeline-changelog-prd §2.5.
 */

/** Semver of the app/renderer bundle, from package.json. */
export const APP_VERSION: string = __APP_VERSION__;

/** Short git sha of the build commit (or "unknown" outside a git checkout). */
export const GIT_SHA: string = __GIT_SHA__;

/** ISO timestamp of when the bundle was built. */
export const BUILD_TIME: string = __BUILD_TIME__;

/** Human-readable build identity for support/diagnostics rows (orthogonal to semver). */
export const RELEASE_ID = `${APP_VERSION}+${GIT_SHA}`;
