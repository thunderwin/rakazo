import type { AdapterContext } from "@rakazo/adapter-kit";
import { EncryptedSecretStore } from "@rakazo/adapters";
import { describe, expect, it, vi } from "vitest";
import {
  getOrCreateNewApiIdentity,
  NewApiAdminClient,
  type NewApiAdminTokenInput,
  type NewApiIdentityRecord,
  type NewApiIdentityStore,
  type NewApiUserSummary,
} from "./new-api.js";

class MemoryIdentityStore implements NewApiIdentityStore {
  private readonly records = new Map<string, NewApiIdentityRecord>();

  async get(userId: string) {
    return this.records.get(userId) ?? null;
  }

  async claim(userId: string) {
    const existing = this.records.get(userId);
    if (existing) return { record: existing, claimed: false };
    const record = {
      userId,
      newApiUserId: null,
      tokenCiphertext: null,
      createdAt: new Date(),
    };
    this.records.set(userId, record);
    return { record, claimed: true };
  }

  async complete(userId: string, newApiUserId: number, tokenCiphertext: string) {
    const record = this.records.get(userId);
    if (!record) throw new Error("missing record");
    this.records.set(userId, { ...record, newApiUserId, tokenCiphertext });
  }

  async release(userId: string) {
    this.records.delete(userId);
  }
}

function context(userId: string): AdapterContext {
  return {
    operationId: "test",
    traceId: "test",
    spaceId: "space-1",
    userId,
    signal: new AbortController().signal,
  };
}

function fakeClient(options: { delayUser?: Promise<void>; failUserOnce?: boolean } = {}) {
  let createdUsers = 0;
  let createdTokens = 0;
  let failUserOnce = options.failUserOnce === true;
  const users = new Map<string, NewApiUserSummary>();
  return {
    get createdUsers() {
      return createdUsers;
    },
    get createdTokens() {
      return createdTokens;
    },
    async createUser(input: { username: string }) {
      if (failUserOnce) {
        failUserOnce = false;
        throw new Error("temporary New API failure");
      }
      createdUsers += 1;
      await options.delayUser;
      users.set(input.username, { id: 42, username: input.username, role: 1, status: 1 });
    },
    async findUserByUsername(username: string) {
      return users.get(username) ?? null;
    },
    async createTokenForUser(_userId: number, input: NewApiAdminTokenInput) {
      createdTokens += 1;
      return { id: 7, key: `sk-${input.name}` };
    },
  };
}

describe("new api admin client", () => {
  it("uses admin headers and creates a user", async () => {
    const fetchImpl = vi.fn(async () => new Response('{"success":true}'));
    const client = new NewApiAdminClient(
      {
        baseUrl: "https://newapi.example.com",
        adminToken: "admin-access-token",
        adminUserId: 9,
      },
      fetchImpl,
    );

    await client.createUser({
      username: "rakazo_abc",
      password: "password12",
      displayName: "Rakazo User",
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://newapi.example.com/api/user/",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer admin-access-token",
          "new-api-user": "9",
        }),
      }),
    );
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toEqual({
      username: "rakazo_abc",
      password: "password12",
      display_name: "Rakazo User",
      role: 1,
    });
  });

  it("creates a token for a target user with unlimited token quota", async () => {
    const fetchImpl = vi.fn(
      async () => new Response('{"success":true,"data":{"id":7,"key":"sk-user"}}'),
    );
    const client = new NewApiAdminClient(
      {
        baseUrl: "https://newapi.example.com",
        adminToken: "admin-access-token",
        adminUserId: 9,
      },
      fetchImpl,
    );
    const token = await client.createTokenForUser(42, {
      name: "rakazo-user",
      unlimitedQuota: true,
      remainQuota: 0,
      expiredTime: -1,
      modelLimitsEnabled: false,
      modelLimits: "",
      allowIps: "",
      group: "",
      crossGroupRetry: false,
    });
    expect(token).toEqual({ id: 7, key: "sk-user" });
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toMatchObject({
      name: "rakazo-user",
      unlimited_quota: true,
      remain_quota: 0,
      expired_time: -1,
    });
  });

  it("finds the exact user by username after creation", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            data: {
              items: [
                { id: 41, username: "rakazo_other", role: 1, status: 1 },
                { id: 42, username: "rakazo_exact", role: 1, status: 1 },
              ],
            },
          }),
        ),
    );
    const client = new NewApiAdminClient(
      {
        baseUrl: "https://newapi.example.com",
        adminToken: "admin-access-token",
        adminUserId: 9,
      },
      fetchImpl,
    );
    await expect(client.findUserByUsername("rakazo_exact")).resolves.toMatchObject({
      id: 42,
      username: "rakazo_exact",
    });
  });
});

describe("new api identity provisioning", () => {
  it("creates once and reuses the encrypted token", async () => {
    const store = new MemoryIdentityStore();
    const client = fakeClient();
    const secretStore = new EncryptedSecretStore("test-only-encryption-key");
    await secretStore.start();

    const first = await getOrCreateNewApiIdentity(
      { userId: "user-1", context: context("user-1") },
      { store, client, secretStore, pollIntervalMs: 1 },
    );
    const second = await getOrCreateNewApiIdentity(
      { userId: "user-1", context: context("user-1") },
      { store, client, secretStore, pollIntervalMs: 1 },
    );

    expect(first.newApiUserId).toBe(42);
    expect(first.token).toMatch(/^sk-rakazo-[a-f0-9]{12}$/);
    expect(second).toEqual(first);
    expect(client.createdUsers).toBe(1);
    expect(client.createdTokens).toBe(1);
    expect((await store.get("user-1"))?.tokenCiphertext).not.toBe(first.token);
    await secretStore.close();
  });

  it("allows only one concurrent provisioner", async () => {
    const store = new MemoryIdentityStore();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const client = fakeClient({ delayUser: gate });
    const secretStore = new EncryptedSecretStore("test-only-encryption-key");
    await secretStore.start();

    const first = getOrCreateNewApiIdentity(
      { userId: "user-2", context: context("user-2") },
      { store, client, secretStore, pollIntervalMs: 2, maxWaitMs: 2_000 },
    );
    const second = getOrCreateNewApiIdentity(
      { userId: "user-2", context: context("user-2") },
      { store, client, secretStore, pollIntervalMs: 2, maxWaitMs: 2_000 },
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    release();
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(client.createdUsers).toBe(1);
    expect(client.createdTokens).toBe(1);
    await secretStore.close();
  });

  it("releases a failed claim so a later call can retry", async () => {
    const store = new MemoryIdentityStore();
    const client = fakeClient({ failUserOnce: true });
    const secretStore = new EncryptedSecretStore("test-only-encryption-key");
    await secretStore.start();

    await expect(
      getOrCreateNewApiIdentity(
        { userId: "user-3", context: context("user-3") },
        { store, client, secretStore, pollIntervalMs: 1 },
      ),
    ).rejects.toThrow("temporary New API failure");
    await expect(store.get("user-3")).resolves.toBeNull();
    await expect(
      getOrCreateNewApiIdentity(
        { userId: "user-3", context: context("user-3") },
        { store, client, secretStore, pollIntervalMs: 1 },
      ),
    ).resolves.toMatchObject({ newApiUserId: 42 });
    await secretStore.close();
  });
});
