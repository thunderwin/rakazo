import { copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const icon = path.resolve(root, "../desktop/assets/icon.png");

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, "icons"), { recursive: true });
await build({
  entryPoints: [path.join(root, "src/background.ts"), path.join(root, "src/popup.ts")],
  outdir: dist,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "chrome116",
  sourcemap: true,
  entryNames: "[name]",
});
await Promise.all([
  copyFile(path.join(root, "src/manifest.json"), path.join(dist, "manifest.json")),
  copyFile(path.join(root, "src/popup.html"), path.join(dist, "popup.html")),
  copyFile(path.join(root, "src/popup.css"), path.join(dist, "popup.css")),
  copyFile(icon, path.join(dist, "icons/icon.png")),
]);
