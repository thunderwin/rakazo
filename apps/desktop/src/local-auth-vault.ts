import { rm } from "node:fs/promises";
import path from "node:path";
import { safeStorage } from "electron";
import { readPrivateFile, writePrivateFile } from "./setup-store.js";

export function createSafeStorageVault(userDataDir: string) {
  const file = path.join(userDataDir, "local", "session.bin");
  return {
    async load(): Promise<string | null> {
      if (!safeStorage.isEncryptionAvailable()) return null;
      const encrypted = await readPrivateFile(file, 64 * 1024);
      if (!encrypted) return null;
      try {
        return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
      } catch {
        return null;
      }
    },
    async save(token: string): Promise<void> {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("Secure storage is unavailable on this system");
      }
      await writePrivateFile(file, safeStorage.encryptString(token).toString("base64"));
    },
    async clear(): Promise<void> {
      await rm(file, { force: true });
    },
  };
}
