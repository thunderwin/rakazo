import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { writePrivateFile } from "./setup-store.js";

const LEGACY_MIGRATION_MARKER = ".legacy-account-migrated";

export interface LocalAccountDataPaths {
  accountDir: string;
  databasePath: string;
  workspaceDir: string;
}

export function localAccountKey(userId: string): string {
  if (!userId.trim()) throw new Error("Local account id is required");
  return createHash("sha256").update(userId).digest("hex").slice(0, 32);
}

async function moveIfPresent(source: string, destination: string): Promise<void> {
  if (!existsSync(source) || existsSync(destination)) return;
  await mkdir(path.dirname(destination), { recursive: true });
  await rename(source, destination);
}

/**
 * Older preview builds stored one shared database under local/. The first
 * scoped account inherits it; later accounts always get isolated directories.
 */
export async function prepareLocalAccountData(
  userDataDir: string,
  userId: string,
): Promise<LocalAccountDataPaths> {
  const localDir = path.join(userDataDir, "local");
  const accountDir = path.join(localDir, "accounts", localAccountKey(userId));
  const databasePath = path.join(accountDir, "rakazo.sqlite");
  const workspaceDir = path.join(accountDir, "workspace");
  await mkdir(accountDir, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") await chmod(accountDir, 0o700);

  const marker = path.join(localDir, LEGACY_MIGRATION_MARKER);
  if (!existsSync(marker)) {
    const legacyDatabase = path.join(localDir, "rakazo.sqlite");
    if (existsSync(legacyDatabase)) {
      await moveIfPresent(legacyDatabase, databasePath);
      await moveIfPresent(`${legacyDatabase}-wal`, `${databasePath}-wal`);
      await moveIfPresent(`${legacyDatabase}-shm`, `${databasePath}-shm`);
    }
    await moveIfPresent(path.join(localDir, "workspace"), workspaceDir);
    await writePrivateFile(marker, `${localAccountKey(userId)}\n`);
  }

  await mkdir(workspaceDir, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") await chmod(workspaceDir, 0o700);
  return { accountDir, databasePath, workspaceDir };
}
