# ericBot landing Worker

Single-page public landing site and stable download entry points.

The Worker serves static assets from `public/` and exposes:

```text
/download/mac/arm64
/download/mac/x64
/download/checksums
```

They redirect to fixed asset names on the rolling `internal-latest` GitHub
prerelease. The `desktop-latest-sync` workflow refreshes that release from the
latest successful `desktop-internal` build every 30 minutes.

Deploy configuration lives in `wrangler.jsonc`; the public hostname is supplied
at deploy time so the public repository does not contain a private production
URL.

```sh
pnpm --filter @rakazo/landing check
cd apps/landing
pnpm exec wrangler deploy --domain "$RAKAZO_LANDING_DOMAIN"
```
