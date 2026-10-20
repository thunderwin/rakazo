# Brand sources

This directory is the source of truth for the product brand. The public product
name is **ericBot**. Upstream Rakazo icon assets remain temporarily so the
desktop app can build until an ericBot icon is supplied.

Expected inputs:

- `logo.svg` or `icon-source.png`
- primary and accent colors
- product name and short description
- website domain

After replacing the source assets, regenerate platform icons and web favicons
with the existing `packages/ui-tokens/scripts/export-brand.ts` flow. Do not
hand-edit generated PNG, ICO, or CSS files.

Current status: **name chosen; dedicated ericBot artwork is not provided yet**.
