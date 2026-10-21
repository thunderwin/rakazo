import { rm } from "node:fs/promises";
import { build } from "esbuild";

await rm("dist", { recursive: true, force: true });

await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/main.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
  external: [
    "@nut-tree-fork/nut-js",
    "electron",
    "electron-updater",
    "jsdom",
    "koffi",
    "better-sqlite3",
    "sharp",
    "ws",
  ],
});
