/// <reference types="vite/client" />

// Build-time constants injected via the `define` block in vite.config.ts and
// vitest.config.ts (computed from package.json + git at config-eval time). These
// are the ONLY source of the app version at runtime — never hand-type a version
// string elsewhere. See src/lib/app-version.ts and
// docs/prd/20260611-muzero-release-pipeline-changelog-prd.
declare const __APP_VERSION__: string;
declare const __GIT_SHA__: string;
declare const __BUILD_TIME__: string;
