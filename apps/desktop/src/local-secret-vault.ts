import { botSecretDestinationSchema } from "@rakazo/contracts";
import type {
  LocalSecretEntry,
  LocalSecretMetadata,
  LocalSecretVault,
} from "@rakazo/local-runtime";
import { safeStorage } from "electron";
import { readPrivateFile, writePrivateFile } from "./setup-store.js";

const MAX_VAULT_BYTES = 8 * 1024 * 1024;

type StoredEntry = LocalSecretEntry;
type VaultData = { version: 1; secrets: StoredEntry[] };

function isStoredEntry(value: unknown): value is StoredEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  if (
    typeof entry.botId !== "string" ||
    typeof entry.name !== "string" ||
    typeof entry.value !== "string" ||
    typeof entry.createdAt !== "string" ||
    typeof entry.updatedAt !== "string"
  ) {
    return false;
  }
  return botSecretDestinationSchema({ allowPrivateHttpOrigin: true }).safeParse({
    name: entry.name,
    origin: entry.origin,
    auth: entry.auth,
  }).success;
}

function metadata(entry: StoredEntry): LocalSecretMetadata {
  return {
    name: entry.name,
    origin: entry.origin,
    auth: entry.auth,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

export function createSafeStorageSecretVault(file: string): LocalSecretVault {
  let queue: Promise<unknown> = Promise.resolve();

  async function read(): Promise<VaultData> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure credential storage is unavailable on this system");
    }
    const encrypted = await readPrivateFile(file, MAX_VAULT_BYTES);
    if (!encrypted) return { version: 1, secrets: [] };
    try {
      const parsed = JSON.parse(safeStorage.decryptString(Buffer.from(encrypted, "base64"))) as {
        version?: unknown;
        secrets?: unknown;
      };
      if (parsed.version !== 1 || !Array.isArray(parsed.secrets)) {
        throw new Error("Credential vault is invalid");
      }
      return {
        version: 1,
        secrets: parsed.secrets.filter(isStoredEntry),
      };
    } catch {
      throw new Error("Credential vault could not be opened");
    }
  }

  async function write(data: VaultData): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure credential storage is unavailable on this system");
    }
    await writePrivateFile(
      file,
      safeStorage.encryptString(JSON.stringify(data)).toString("base64"),
    );
  }

  function exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const next = queue.then(operation, operation);
    queue = next.catch(() => undefined);
    return next;
  }

  return {
    async list(botId) {
      const data = await read();
      return data.secrets
        .filter((entry) => entry.botId === botId)
        .sort((left, right) => left.name.localeCompare(right.name))
        .map(metadata);
    },
    async get(botId, name) {
      const data = await read();
      return data.secrets.find((entry) => entry.botId === botId && entry.name === name) ?? null;
    },
    put(input) {
      return exclusive(async () => {
        const data = await read();
        const index = data.secrets.findIndex(
          (entry) => entry.botId === input.botId && entry.name === input.name,
        );
        if (index === -1) data.secrets.push(input);
        else data.secrets[index] = input;
        await write(data);
        return metadata(input);
      });
    },
    remove(botId, name) {
      return exclusive(async () => {
        const data = await read();
        const next = data.secrets.filter((entry) => entry.botId !== botId || entry.name !== name);
        if (next.length === data.secrets.length) return false;
        await write({ version: 1, secrets: next });
        return true;
      });
    },
  };
}
