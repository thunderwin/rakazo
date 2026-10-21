import { rm } from "node:fs/promises";
import { build } from "esbuild";

await rm("dist", { recursive: true, force: true });

const buildServerUrl = process.env.RAKAZO_BUILD_SERVER_URL?.trim();
const buildManifestPublicKey =
  process.env.RAKAZO_BUILD_CLIENT_MANIFEST_PUBLIC_KEY?.trim();

if (buildServerUrl) {
  const parsed = new URL(buildServerUrl);
  if (
    parsed.protocol !== "https:" &&
    parsed.hostname !== "127.0.0.1" &&
    parsed.hostname !== "localhost"
  ) {
    throw new Error(
      "RAKAZO_BUILD_SERVER_URL must use HTTPS outside local development",
    );
  }
}

const define = {};
if (buildServerUrl)
  define["process.env.RAKAZO_SERVER_URL"] = JSON.stringify(buildServerUrl);
if (buildManifestPublicKey) {
  define["process.env.RAKAZO_CLIENT_MANIFEST_PUBLIC_KEY"] = JSON.stringify(
    buildManifestPublicKey,
  );
}

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
  ...(Object.keys(define).length > 0 ? { define } : {}),
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
