import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { localAccountKey, prepareLocalAccountData } from "./local-account-data.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function userData() {
  const directory = await mkdtemp(path.join(tmpdir(), "rakazo-account-data-"));
  directories.push(directory);
  return directory;
}

describe("local account data", () => {
  it("gives each user stable isolated database and workspace paths", async () => {
    const root = await userData();
    const first = await prepareLocalAccountData(root, "user-1");
    const firstAgain = await prepareLocalAccountData(root, "user-1");
    const second = await prepareLocalAccountData(root, "user-2");

    expect(first).toEqual(firstAgain);
    expect(first.databasePath).not.toBe(second.databasePath);
    expect(first.workspaceDir).not.toBe(second.workspaceDir);
    expect(first.accountDir).toContain(localAccountKey("user-1"));
    expect(second.accountDir).toContain(localAccountKey("user-2"));
    if (process.platform !== "win32") {
      expect((await stat(first.accountDir)).mode & 0o777).toBe(0o700);
      expect((await stat(first.workspaceDir)).mode & 0o777).toBe(0o700);
    }
  });

  it("assigns legacy preview data to the first scoped account", async () => {
    const root = await userData();
    const local = path.join(root, "local");
    await mkdir(path.join(local, "workspace"), { recursive: true });
    await writeFile(path.join(local, "rakazo.sqlite"), "legacy-db");
    await writeFile(path.join(local, "workspace", "note.txt"), "legacy-note");

    const first = await prepareLocalAccountData(root, "user-1");
    const second = await prepareLocalAccountData(root, "user-2");

    expect(await readFile(first.databasePath, "utf8")).toBe("legacy-db");
    expect(await readFile(path.join(first.workspaceDir, "note.txt"), "utf8")).toBe("legacy-note");
    expect(existsSync(second.databasePath)).toBe(false);
    expect(existsSync(path.join(local, "rakazo.sqlite"))).toBe(false);
  });
});
