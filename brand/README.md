# Brand sources

This directory is the source of truth for the product brand. The upstream
Rakazo assets are still present so the project builds before a brand is chosen.

Expected inputs:

- `logo.svg` or `icon-source.png`
- primary and accent colors
- product name and short description
- website domain

After replacing the source assets, regenerate platform icons and web favicons
with the existing `packages/ui-tokens/scripts/export-brand.ts` flow. Do not
hand-edit generated PNG, ICO, or CSS files.

Current status: **brand assets are not provided yet**.
