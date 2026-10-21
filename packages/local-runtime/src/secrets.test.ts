import { describe, expect, it, vi } from "vitest";
import type { LocalSecretEntry, LocalSecretMetadata, LocalSecretVault } from "./secrets.js";
import { LocalSecrets } from "./secrets.js";

class MemoryVault implements LocalSecretVault {
  readonly entries = new Map<string, LocalSecretEntry>();

  async list(botId: string): Promise<LocalSecretMetadata[]> {
    return [...this.entries.values()]
      .filter((entry) => entry.botId === botId)
      .map(({ value: _value, botId: _botId, ...metadata }) => metadata);
  }

  async get(botId: string, name: string): Promise<LocalSecretEntry | null> {
    return this.entries.get(`${botId}:${name}`) ?? null;
  }

  async put(input: LocalSecretEntry): Promise<LocalSecretMetadata> {
    this.entries.set(`${input.botId}:${input.name}`, input);
    const { value: _value, botId: _botId, ...metadata } = input;
    return metadata;
  }

  async remove(botId: string, name: string): Promise<boolean> {
    return this.entries.delete(`${botId}:${name}`);
  }
}

describe("local credentials", () => {
  it("adds authentication only for the saved origin and redacts the value", async () => {
    const vault = new MemoryVault();
    const request = vi.fn(async (_input: { headers: Record<string, string> }) => ({
      status: 200,
      body: JSON.stringify({ token: "secret-value", ok: true }),
      contentType: "application/json",
    }));
    const secrets = new LocalSecrets({ vault, request });
    await secrets.put("bot-1", {
      name: "example",
      origin: "https://api.example.com",
      auth: { type: "bearer" },
      value: "secret-value",
    });

    await expect(
      secrets.request("bot-1", {
        name: "example",
        url: "https://api.example.com/v1/items",
      }),
    ).resolves.toEqual({
      status: 200,
      body: { token: "[redacted]", ok: true },
      truncated: false,
    });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer secret-value" }),
      }),
    );
    await expect(
      secrets.request("bot-1", {
        name: "example",
        url: "https://other.example.com/v1/items",
      }),
    ).resolves.toEqual({ error: "This credential cannot be sent to that destination." });
  });

  it("asks the user without returning the secret to the caller", async () => {
    const vault = new MemoryVault();
    const prompt = vi.fn(async () => ({ value: "secret-value" }));
    const secrets = new LocalSecrets({
      vault,
      request: vi.fn(),
      prompt,
    });
    const result = await secrets.requestFromUser("bot-1", {
      name: "example",
      origin: "https://api.example.com",
      auth: { type: "bearer" },
      reason: "Read the account",
    });
    expect(result).toMatchObject({ saved: true, name: "example" });
    expect(JSON.stringify(result)).not.toContain("secret-value");
    expect(prompt).toHaveBeenCalledWith(
      expect.objectContaining({ name: "example", reason: "Read the account" }),
      undefined,
    );
  });

  it("resolves origin-bound website logins and exports command variables", async () => {
    const vault = new MemoryVault();
    const secrets = new LocalSecrets({ vault, request: vi.fn() });
    await secrets.put("bot-1", {
      name: "site_login",
      origin: "https://example.test",
      auth: { type: "login" },
      value: JSON.stringify({ username: "alice", password: "password" }),
    });
    await secrets.put("bot-1", {
      name: "example-key",
      auth: { type: "command" },
      value: "secret-value",
    });
    await expect(
      secrets.revealLogin("bot-1", "site_login", "password", "https://example.test/account"),
    ).resolves.toEqual({ value: "password", origin: "https://example.test" });
    await expect(
      secrets.revealLogin("bot-1", "site_login", "password", "https://other.test/account"),
    ).rejects.toThrow("different origin");
    await expect(secrets.commandEnvironment("bot-1")).resolves.toEqual({
      EXAMPLE_KEY: "secret-value",
    });
  });
});
