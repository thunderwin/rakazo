# Desktop icons

The shared editable source and export notes are in
[`packages/ui-tokens/assets`](../../../packages/ui-tokens/assets/README.md).

Mac packaging requires Xcode 26 or newer. Electron builder currently compiles
the temporary upstream `Rakazo.icon` asset into `Assets.car` for Tahoe and
generates `icon.icns` for older macOS versions.
`icon-macos.png` is the matching development export with Dock margins.

`icon.png` and `icon.ico` are temporary upstream exports for Linux and Windows.
Refresh them with `pnpm --filter @rakazo/ui-tokens export:brand`.
