# Desktop releases

The `release-desktop` workflow builds, signs, notarizes, attests, and publishes
the Electron app from a `vMAJOR.MINOR.PATCH` tag on `main`. Publishing the
Docker images triggers from the same tag.

This fork ships the bundle as `ericBot.app` and pins every updater feed to
`provider: github`, `owner: thunderwin`, `repo: rakazo`. Those values are checked
in CI so a branded build cannot silently download updates from upstream.

For an unsigned macOS Alpha smoke package on a machine without Xcode 26, use:

```sh
pnpm --filter @rakazo/desktop pack:mac:preview
```

That command generates a temporary legacy `.icns` from the current macOS PNG and
creates `apps/desktop/out/mac-*/ericBot.app`. It is for local QA only; signed
releases continue to use the Icon Composer source and the CI signing workflow.

Packaged builds must bake the public server and Client Manifest verification
key into the Electron main process; Finder-launched apps do not inherit the
development shell's environment:

```sh
RAKAZO_BUILD_SERVER_URL=https://api.example.com \
RAKAZO_BUILD_CLIENT_MANIFEST_PUBLIC_KEY=<base64 SPKI public key> \
pnpm --filter @rakazo/desktop build
```

The same values are read from repository variables
`RAKAZO_SERVER_URL` and `RAKAZO_CLIENT_MANIFEST_PUBLIC_KEY` during the signed
release workflow. A package without them starts without a server connection and
cannot pull managed configuration.

## Repository secrets

macOS (required):

| Secret                         | Value                                                                      |
| ------------------------------ | -------------------------------------------------------------------------- |
| `DESKTOP_MAC_CSC_LINK`         | Base64 of the `Developer ID Application` certificate exported as `.p12`    |
| `DESKTOP_MAC_CSC_KEY_PASSWORD` | Password used when exporting the `.p12`                                    |
| `APPLE_API_KEY_ID`             | App Store Connect API key ID (the `XXXXXXXXXX` in `AuthKey_XXXXXXXXXX.p8`) |
| `APPLE_API_ISSUER`             | Issuer ID shown on App Store Connect > Users and Access > Integrations     |
| `APPLE_API_KEY_P8`             | Contents of the `AuthKey_*.p8` file                                        |

The API key needs the Developer role. The workflow writes it to a mode 600 file
in the runner's temp directory for the packaging step and deletes it afterwards.

`patches/app-builder-lib@26.15.3.patch` carries electron-builder PR #10101:
without it `CSC_LINK` signing fails while creating the temporary keychain. Drop
the patch once an electron-builder release includes that fix.

Windows (optional):

| Secret                         | Value                                                   |
| ------------------------------ | ------------------------------------------------------- |
| `DESKTOP_WIN_CSC_LINK`         | Base64 of the Authenticode certificate as `.p12`/`.pfx` |
| `DESKTOP_WIN_CSC_KEY_PASSWORD` | Its password                                            |

When `DESKTOP_WIN_CSC_LINK` is unset the Windows build and its release assets
are skipped. macOS and Linux always build, and the release is only published
when every platform that was built produced its installer and update feed.

Set a secret from a file without echoing it:

```sh
base64 -i devid.p12 | gh secret set DESKTOP_MAC_CSC_LINK
gh secret set APPLE_API_KEY_P8 < AuthKey_XXXXXXXXXX.p8
```

## Cut a release

1. Bump `version` in `apps/desktop/package.json` on `main`.
2. Tag that commit `v<version>` and push the tag:

```sh
git tag v0.1.1
git push origin v0.1.1
```

The workflow refuses tags that do not match the desktop version, are not on
`main`, or are not newer than the latest published release.
