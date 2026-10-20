import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") {
  throw new Error("The macOS preview package can only be built on macOS");
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "assets/icon-macos.png");
const temporary = await mkdtemp(path.join(tmpdir(), "ericbot-icns-"));
const iconset = path.join(temporary, "ericBot.iconset");
const output = path.join(temporary, "ericBot.icns");

const frames = [
  [16, "icon_16x16.png"],
  [32, "icon_16x16@2x.png"],
  [32, "icon_32x32.png"],
  [64, "icon_32x32@2x.png"],
  [128, "icon_128x128.png"],
  [256, "icon_128x128@2x.png"],
  [256, "icon_256x256.png"],
  [512, "icon_256x256@2x.png"],
  [512, "icon_512x512.png"],
];

try {
  await mkdir(iconset, { recursive: true });
  for (const [size, name] of frames) {
    execFileSync(
      "sips",
      ["-z", String(size), String(size), source, "--out", path.join(iconset, name)],
      {
        stdio: "ignore",
      },
    );
  }
  await copyFile(source, path.join(iconset, "icon_512x512@2x.png"));
  execFileSync("iconutil", ["-c", "icns", iconset, "-o", output], { stdio: "inherit" });
  execFileSync(
    "pnpm",
    [
      "exec",
      "electron-builder",
      "--mac",
      "--dir",
      "--publish",
      "never",
      `--config.mac.icon=${output}`,
    ],
    { cwd: root, stdio: "inherit" },
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
