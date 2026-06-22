# mu0.app cutover — marketing/docs site takes the apex, app → my.mu0.app

Operator runbook for **Phase 3** of the web PRD
([docs/prd/web/20260622-…](../prd/web/20260622-muzero-marketing-docs-site-prd/20260622-muzero-marketing-docs-site-prd.md)).
Everything here is an **outward-facing** action on the Cloudflare account — run it
yourself; the repo only ships the config + this checklist.

## Surfaces after cutover

| Surface | Host | Cloudflare project |
| --- | --- | --- |
| Marketing + docs (landing, `/docs`, `/download`, changelog) | `https://mu0.app` | Pages **`mu0-site`** (`packages/site` → `packages/site/dist`) |
| The app (React SPA) | `https://my.mu0.app` | Pages **`mu0-app`** (root `wrangler.toml` → `dist/`) |
| Desktop artifacts | `https://assets.mu0.app/desktop` | R2 `muzero-releases` — **unchanged** |

The app keeps the same `mu0-app` Pages project and build; only its **custom
domain** moves from `mu0.app` to `my.mu0.app`.

## 0. Prereqs

```bash
pnpm exec wrangler login          # Doodlekuma Cloudflare account
make site-build                   # confirm the site builds clean
make site-preview                 # eyeball / + /zh/ + /docs/ + /download/ locally
```

`mu0.app` must be a zone in the same Cloudflare account (it already is — see the
release-pipeline PRD). `make` exports `CLOUDFLARE_ACCOUNT_ID`.

## 1. Create + deploy the `mu0-site` Pages project

```bash
make site-pages-project           # one-time: creates "mu0-site", production branch main
make site-deploy                  # build + deploy → mu0-site.pages.dev
```

`make site-deploy` runs `wrangler pages deploy` from `packages/site` (reads
`packages/site/wrangler.toml`: name `mu0-site`, output `./dist`). Verify the
`*.pages.dev` URL renders the landing, `/docs/`, `/zh/docs/`, `/download/`.

## 2. Make the app reachable at `my.mu0.app` FIRST (no downtime)

Add `my.mu0.app` as an **additional** custom domain on the existing `mu0-app`
project, **before** moving anything off the apex:

- Cloudflare dashboard → Workers & Pages → `mu0-app` → Custom domains → add
  `my.mu0.app`. Cloudflare creates the DNS record + cert.

Confirm `https://my.mu0.app` serves the app while it is still live on `mu0.app`.

## 3. Point the app's canonical/OG at its new home

In the **app** `index.html` (repo root [`index.html`](../../index.html)), change
the apex URLs to `my.mu0.app` and commit + redeploy the app:

```diff
- <link rel="canonical" href="https://mu0.app/" />
+ <link rel="canonical" href="https://my.mu0.app/" />
- <meta property="og:url" content="https://mu0.app/" />
+ <meta property="og:url" content="https://my.mu0.app/" />
- <meta property="og:image" content="https://mu0.app/muzero-logo-dark.png" />
+ <meta property="og:image" content="https://my.mu0.app/muzero-logo-dark.png" />
- <meta name="twitter:image" content="https://mu0.app/muzero-logo-dark.png" />
+ <meta name="twitter:image" content="https://my.mu0.app/muzero-logo-dark.png" />
```

Then redeploy the app (`make deploy`, the existing `mu0-app` path). Do this
**before** flipping the apex so the app never advertises `mu0.app` as canonical
once the site owns it. (Leave any in-app `assets.mu0.app` references — R2 is
unchanged.)

## 4. Flip the apex `mu0.app` to the site

- Cloudflare dashboard → `mu0-app` → Custom domains → **remove** `mu0.app`
  (the app stays reachable at `my.mu0.app`).
- Cloudflare dashboard → `mu0-site` → Custom domains → **add** `mu0.app`.

Now `mu0.app` = the marketing/docs site; `my.mu0.app` = the app.

The site ships [`public/_redirects`](../../packages/site/public/_redirects) so
`mu0.app/app` → `https://my.mu0.app/` (returning-user muscle memory). The landing
owns `mu0.app/` with an "Open MUZERO" CTA → `my.mu0.app`.

## 5. Verify

```bash
curl -I https://mu0.app                       # → mu0-site (landing)
curl -I https://mu0.app/docs/                 # → Starlight docs
curl -sI https://mu0.app/zh/                  # → zh landing
curl -I https://mu0.app/download/             # → downloads + changelog
curl -I https://mu0.app/app                   # → 302 to https://my.mu0.app/
curl -I https://my.mu0.app                    # → the app (SPA)
curl -I https://assets.mu0.app/desktop/manifest.json   # → R2, unchanged
```

- Re-scrape OG for `mu0.app` (landing) and `my.mu0.app` (app) in the social
  debuggers so cards refresh.
- The shortened READMEs link to `mu0.app/docs/*` — those go live now (they were
  intentionally pointing ahead of the deploy).
- Submit `https://mu0.app/sitemap-index.xml` to Search Console / Bing.

## 6. Heads-up

- **Web-app local data is origin-scoped.** Existing hosted-web users had their
  `muzero-db` under the `mu0.app` origin; at `my.mu0.app` they start empty
  (accepted, PRD Q1). Recovery: cloud re-pull / export-import. Add the one-time
  in-app notice if not already shipped.
- **Rollback** = re-add `mu0.app` to `mu0-app` and remove it from `mu0-site`
  (and revert the app `index.html` diff). DNS/custom-domain changes are
  reversible; no data moves.

## Related

- App release + R2 distribution: [`mu0-app-release.md`](./mu0-app-release.md)
- Web PRD §6 Phase 3: [20260622-…-prd.md](../prd/web/20260622-muzero-marketing-docs-site-prd/20260622-muzero-marketing-docs-site-prd.md)
