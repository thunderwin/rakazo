import { createHash, randomBytes } from "node:crypto";
import type { AdapterContext, SecretStore } from "@rakazo/adapter-kit";
import type { PrismaClient } from "@rakazo/db";

export interface NewApiConfig {
  baseUrl: string;
  adminToken: string;
  adminUserId: number;
}

export interface NewApiIdentityRecord {
  userId: string;
  newApiUserId: number | null;
  tokenCiphertext: string | null;
  createdAt: Date;
}

export interface NewApiIdentityStore {
  get(userId: string): Promise<NewApiIdentityRecord | null>;
  claim(userId: string): Promise<{ record: NewApiIdentityRecord; claimed: boolean }>;
  complete(userId: string, newApiUserId: number, tokenCiphertext: string): Promise<void>;
  release(userId: string): Promise<void>;
}

export interface NewApiAdminTokenInput {
  name: string;
  unlimitedQuota: boolean;
  remainQuota: number;
  expiredTime: number;
  modelLimitsEnabled: boolean;
  modelLimits: string;
  allowIps: string;
  group: string;
  crossGroupRetry: boolean;
}

export interface NewApiUserSummary {
  id: number;
  username: string;
  role: number;
  status: number;
}

export class NewApiAdminError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "NewApiAdminError";
  }
}

function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("New API base URL is invalid");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("New API base URL must use HTTP or HTTPS");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("New API base URL must not contain credentials or query");
  }
  return url.toString().replace(/\/+$/, "");
}

function readPositiveInteger(value: string | number, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error(`${label} must be a positive integer`);
  return parsed;
}

export class NewApiAdminClient {
  private readonly baseUrl: string;
  private readonly adminToken: string;
  private readonly adminUserId: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: NewApiConfig, fetchImpl: typeof fetch = fetch) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl);
    this.adminToken = config.adminToken.trim();
    this.adminUserId = readPositiveInteger(config.adminUserId, "New API admin user id");
    if (!this.adminToken) throw new Error("New API admin token is required");
    this.fetchImpl = fetchImpl;
  }

  private async request(pathname: string, init: RequestInit): Promise<unknown> {
    const response = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.adminToken}`,
        "new-api-user": String(this.adminUserId),
        "content-type": "application/json",
        ...init.headers,
      },
    });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? (JSON.parse(text) as unknown) : null;
    } catch {
      if (!response.ok) throw new NewApiAdminError("New API admin request failed", response.status);
    }
    if (!response.ok) throw new NewApiAdminError("New API admin request failed", response.status);
    return body;
  }

  async createUser(input: {
    username: string;
    password: string;
    displayName: string;
  }): Promise<void> {
    const body = await this.request("/api/user/", {
      method: "POST",
      body: JSON.stringify({
        username: input.username,
        password: input.password,
        display_name: input.displayName,
        role: 1,
      }),
    });
    if (!body || typeof body !== "object" || !("success" in body) || body.success !== true) {
      throw new NewApiAdminError("New API rejected user creation");
    }
  }

  async findUserByUsername(username: string): Promise<NewApiUserSummary | null> {
    const body = await this.request(`/api/user/search?keyword=${encodeURIComponent(username)}`, {
      method: "GET",
    });
    const items =
      body &&
      typeof body === "object" &&
      "data" in body &&
      body.data &&
      typeof body.data === "object" &&
      "items" in body.data &&
      Array.isArray(body.data.items)
        ? body.data.items
        : [];
    const found = items.find(
      (item): item is NewApiUserSummary =>
        typeof item === "object" &&
        item !== null &&
        "id" in item &&
        typeof item.id === "number" &&
        "username" in item &&
        item.username === username,
    );
    return found ?? null;
  }

  async createTokenForUser(
    newApiUserId: number,
    input: NewApiAdminTokenInput,
  ): Promise<{ id: number; key: string }> {
    const body = await this.request(
      `/api/user/${readPositiveInteger(newApiUserId, "New API user id")}/token`,
      {
        method: "POST",
        body: JSON.stringify({
          name: input.name,
          unlimited_quota: input.unlimitedQuota,
          remain_quota: input.remainQuota,
          expired_time: input.expiredTime,
          model_limits_enabled: input.modelLimitsEnabled,
          model_limits: input.modelLimits,
          allow_ips: input.allowIps,
          group: input.group,
          cross_group_retry: input.crossGroupRetry,
        }),
      },
    );
    const data =
      body &&
      typeof body === "object" &&
      "data" in body &&
      body.data &&
      typeof body.data === "object"
        ? body.data
        : null;
    if (
      !data ||
      !("id" in data) ||
      typeof data.id !== "number" ||
      !("key" in data) ||
      typeof data.key !== "string" ||
      !data.key
    ) {
      throw new NewApiAdminError("New API did not return a token key");
    }
    return { id: data.id, key: data.key };
  }
}

export class PrismaNewApiIdentityStore implements NewApiIdentityStore {
  constructor(private readonly prisma: PrismaClient) {}

  async get(userId: string): Promise<NewApiIdentityRecord | null> {
    return this.prisma.newApiIdentity.findUnique({
      where: { userId },
      select: {
        userId: true,
        newApiUserId: true,
        tokenCiphertext: true,
        createdAt: true,
      },
    });
  }

  async claim(userId: string): Promise<{ record: NewApiIdentityRecord; claimed: boolean }> {
    try {
      const record = await this.prisma.newApiIdentity.create({
        data: { userId },
        select: {
          userId: true,
          newApiUserId: true,
          tokenCiphertext: true,
          createdAt: true,
        },
      });
      return { record, claimed: true };
    } catch (error) {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "P2002") {
        throw error;
      }
      const record = await this.get(userId);
      if (!record) throw new Error("New API identity claim disappeared");
      return { record, claimed: false };
    }
  }

  async complete(userId: string, newApiUserId: number, tokenCiphertext: string): Promise<void> {
    await this.prisma.newApiIdentity.update({
      where: { userId },
      data: { newApiUserId, tokenCiphertext },
    });
  }

  async release(userId: string): Promise<void> {
    await this.prisma.newApiIdentity.deleteMany({
      where: { userId, newApiUserId: null, tokenCiphertext: null },
    });
  }
}

function stableUsername(userId: string): string {
  return `rakazo_${createHash("sha256").update(userId).digest("hex").slice(0, 12)}`;
}

function generatedPassword(): string {
  return randomBytes(8).toString("base64url");
}

export interface NewApiIdentityServiceOptions {
  store: NewApiIdentityStore;
  client: Pick<NewApiAdminClient, "createUser" | "findUserByUsername" | "createTokenForUser">;
  secretStore: SecretStore;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  pollIntervalMs?: number;
  maxWaitMs?: number;
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

export async function getOrCreateNewApiIdentity(
  input: {
    userId: string;
    context: AdapterContext;
  },
  options: NewApiIdentityServiceOptions,
): Promise<{ newApiUserId: number; token: string }> {
  const username = stableUsername(input.userId);
  const startedAt = Date.now();
  const pollIntervalMs = options.pollIntervalMs ?? 100;
  const maxWaitMs = options.maxWaitMs ?? 30_000;
  const sleep = options.sleep ?? defaultSleep;

  while (Date.now() - startedAt < maxWaitMs) {
    input.context.signal.throwIfAborted();
    let record = await options.store.get(input.userId);
    let claimed = false;
    if (!record) {
      const claim = await options.store.claim(input.userId);
      record = claim.record;
      claimed = claim.claimed;
    }
    if (record.newApiUserId !== null && record.tokenCiphertext !== null) {
      const token = await options.secretStore.load(record.tokenCiphertext, {
        recordId: `new-api-${input.userId}`,
        signal: input.context.signal,
      });
      return { newApiUserId: record.newApiUserId, token };
    }
    if (claimed) {
      try {
        const existing = await options.client.findUserByUsername(username);
        if (!existing) {
          await options.client.createUser({
            username,
            password: generatedPassword(),
            displayName: "Rakazo user",
          });
        }
        const user = existing ?? (await options.client.findUserByUsername(username));
        if (user?.status !== 1) {
          throw new NewApiAdminError("New API user is unavailable");
        }
        const token = await options.client.createTokenForUser(user.id, {
          name: `rakazo-${username.slice(-12)}`,
          unlimitedQuota: true,
          remainQuota: 0,
          expiredTime: -1,
          modelLimitsEnabled: false,
          modelLimits: "",
          allowIps: "",
          group: "",
          crossGroupRetry: false,
        });
        if (!token.key) throw new NewApiAdminError("New API returned an empty token");
        const sealed = await options.secretStore.put(token.key, input.context, {
          recordId: `new-api-${input.userId}`,
        });
        await options.store.complete(input.userId, user.id, sealed.ciphertext);
        return { newApiUserId: user.id, token: token.key };
      } catch (error) {
        await options.store.release(input.userId);
        throw error;
      }
    }
    await sleep(pollIntervalMs, input.context.signal);
  }
  throw new NewApiAdminError("New API identity provisioning timed out");
}
