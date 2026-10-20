import { rm } from "node:fs/promises";
import path from "node:path";
import { safeStorage } from "electron";
import type { LocalSession, SessionVault } from "./local-auth.js";
import { readPrivateFile, writePrivateFile } from "./setup-store.js";

export function createSafeStorageVault(userDataDir: string): SessionVault {
  const localDir = path.join(userDataDir, "local");
  const file = path.join(localDir, "session-v2.bin");
  const legacyFile = path.join(localDir, "session.bin");
  return {
    async load(): Promise<LocalSession | null> {
      if (!safeStorage.isEncryptionAvailable()) return null;
      const encrypted = await readPrivateFile(file, 64 * 1024);
      if (!encrypted) return null;
      try {
        const parsed = JSON.parse(
          safeStorage.decryptString(Buffer.from(encrypted, "base64")),
        ) as Partial<LocalSession>;
        return typeof parsed.token === "string" &&
          parsed.token &&
          typeof parsed.userId === "string" &&
          parsed.userId &&
          typeof parsed.email === "string" &&
          parsed.email &&
          typeof parsed.name === "string"
          ? {
              token: parsed.token,
              userId: parsed.userId,
              email: parsed.email,
              name: parsed.name,
            }
          : null;
      } catch {
        return null;
      }
    },
    async save(session: LocalSession): Promise<void> {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("Secure storage is unavailable on this system");
      }
      await writePrivateFile(
        file,
        safeStorage.encryptString(JSON.stringify(session)).toString("base64"),
      );
      await rm(legacyFile, { force: true });
    },
    async clear(): Promise<void> {
      await Promise.all([rm(file, { force: true }), rm(legacyFile, { force: true })]);
    },
  };
}
