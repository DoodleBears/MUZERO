# MUZERO release to `mu0.app`

This is the operator checklist for the official hosted surface and desktop artifact distribution.

## Surfaces

| Surface | Host | Purpose | Deploy path |
| --- | --- | --- | --- |
| Web app | `https://mu0.app` | Static Vite build, web access, download center | Cloudflare Pages project `mu0-app` |
| Desktop artifacts | `https://assets.mu0.app/desktop` | Electron installers, updater feeds, release manifest | R2 bucket `muzero-releases`, uploaded by rclone |

The two surfaces are intentionally separate. Pages serves the app shell. R2 serves large immutable installers and small no-cache metadata files.

## One-time Cloudflare setup

1. Log in with the Doodlekuma Cloudflare account:

   ```bash
   pnpm exec wrangler login
   ```

2. Create the Pages project if it does not exist:

   ```bash
   make pages-project
   ```

   This creates `mu0-app` with production branch `main`. The local Wrangler config (`wrangler.toml`) is the source for the Pages build output directory: `dist/`. `make` exports `CLOUDFLARE_ACCOUNT_ID=332e72d480d7cb3e60ee671d3ca0cad0`; do not put `account_id` in `wrangler.toml` because Pages config validation rejects it.

3. Deploy once:

   ```bash
   make deploy
   ```

4. Bind the apex domain:

   Cloudflare dashboard -> Workers & Pages -> `mu0-app` -> Custom domains -> Set up `mu0.app`.

   `mu0.app` must be a zone in the same Cloudflare account. Cloudflare will create the required DNS record and issue the certificate.

5. Keep the R2 release bucket setup from the release PRD:

   ```bash
   pnpm exec wrangler r2 bucket cors set muzero-releases --file scripts/r2-release-cors.json --force
   ```

   The bucket custom domain is `assets.mu0.app`; uploads use the local or CI `r2:` rclone remote, not Wrangler.

## Deploy the web app

Production:

```bash
make deploy
```

Preview:

```bash
make pages-deploy-preview
```

The preview branch is named `preview`, so Cloudflare will serve it at the matching Pages preview URL.

## Publish Electron desktop releases

Run all platforms from the same commit and version. Each platform build uploads its own artifacts and additively merges into `desktop/manifest.json`, preserving platforms that were already published for the same version.

```bash
# macOS machine
make release-mac
make release-publish

# Windows machine
make release-win
make release-publish

# Linux or WSL2
make release-linux
make release-publish
```

Required local/CI release environment:

```bash
RELEASE_R2_BUCKET=muzero-releases
RELEASE_R2_PREFIX=desktop
RELEASE_BASE_URL=https://assets.mu0.app/desktop
RELEASE_RCLONE_REMOTE=r2:
RELEASE_CHANNEL=stable
```

R2 write credentials stay only in the build machine's rclone config or CI secrets. Do not commit them, put them in the app bundle, or log them.

`make release-mac` intentionally sets `CSC_IDENTITY_AUTO_DISCOVERY=false` so a local `Apple Development` certificate is not picked up accidentally. Without an Apple Developer Program account, macOS artifacts can still be built and uploaded, but they are unsigned/unnotarized test builds. For public Gatekeeper-friendly distribution, build with a `Developer ID Application` certificate and notarize the DMG/ZIP.

## Verify

```bash
curl -I https://mu0.app
curl -I https://assets.mu0.app/desktop/manifest.json
curl -I https://assets.mu0.app/desktop/latest.yml
curl -I https://assets.mu0.app/desktop/latest-mac.yml
curl -I https://assets.mu0.app/desktop/latest-linux.yml
```

Then check Settings -> About / version history in the app. A complete release should show one version whose manifest entry contains macOS, Windows, and Linux assets.
