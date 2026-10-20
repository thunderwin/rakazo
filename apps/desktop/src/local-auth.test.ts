import { describe, expect, it, vi } from "vitest";
import { LocalAuth, type TokenVault } from "./local-auth.js";

function memoryVault(initial: string | null = null): TokenVault & { token: string | null } {
  return {
    token: initial,
    async load() {
      return this.token;
    },
    async save(token) {
      this.token = token;
    },
    async clear() {
      this.token = null;
    },
  };
}

describe("desktop local auth", () => {
  it("signs in with email/password and persists the session token", async () => {
    const vault = memoryVault();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ token: "session-token" })));
    const auth = new LocalAuth({
      serverUrl: "https://app.example.com",
      vault,
      fetchImpl,
    });

    await auth.signIn("user@example.com", "password12");

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://app.example.com/api/auth/sign-in/email",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ origin: "https://app.example.com" }),
      }),
    );
    expect(await auth.getToken()).toBe("session-token");
    await expect(auth.status()).resolves.toEqual({
      signedIn: true,
      serverUrl: "https://app.example.com",
    });
  });

  it("does not save a token when sign-in fails", async () => {
    const vault = memoryVault();
    const auth = new LocalAuth({
      serverUrl: "https://app.example.com",
      vault,
      fetchImpl: vi.fn(async () => new Response("no", { status: 401 })),
    });
    await expect(auth.signIn("user@example.com", "password12")).rejects.toThrow("Sign-in failed");
    expect(vault.token).toBeNull();
  });

  it("clears the local token on sign-out", async () => {
    const vault = memoryVault("session-token");
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const auth = new LocalAuth({
      serverUrl: "https://app.example.com",
      vault,
      fetchImpl,
    });
    await auth.signOut();
    expect(vault.token).toBeNull();
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://app.example.com/api/auth/sign-out",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer session-token" }),
      }),
    );
  });
});
