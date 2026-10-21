# ericBot Browser Bridge

Chrome/Edge MV3 extension that connects the local ericBot desktop client to the user's existing browser
profile. It opens Agent Windows, exposes short-lived element observations, and performs page actions on
behalf of the local Pi Agent loop.

## Development

```bash
pnpm install
pnpm --filter @rakazo/browser-extension build
pnpm --filter @rakazo/browser-extension test
pnpm --filter @rakazo/browser-extension test:e2e
```

Load the generated `dist/` directory as an unpacked extension in `chrome://extensions`. In ericBot Settings, choose
**Connect Chrome**, then enter the displayed port and six-digit code in the extension popup.

The extension uses loopback WebSocket only, shares the selected Chrome profile's website sign-ins, and
never exports cookies. See [docs/BROWSER.md](../../docs/BROWSER.md) for the protocol, permission model,
limits, and release requirements.

## Internal release

Pushes that change the extension run the `extension-internal` GitHub workflow. It type-checks, runs unit
and Chromium extension E2E tests, builds a production ZIP without source maps, and updates the rolling
`extension-latest` prerelease.

The public landing Worker exposes a stable `/download/extension` route to that ZIP. The ZIP is suitable
for Chrome/Edge developer-mode testing, not a Chrome Web Store submission by itself. Store submission
still requires developer accounts, listing assets, privacy review, and the store-generated extension ID.
