import { describe, expect, it, vi } from "vitest";
import { LocalAuth, type LocalSession, type SessionVault } from "./local-auth.js";

function memoryVault(initial: LocalSession | null = null): SessionVault & {
  session: LocalSession | null;
} {
  return {
    session: initial,
    async load() {
      return this.session;
    },
    async save(session) {
      this.session = session;
    },
    async clear() {
      this.session = null;
    },
  };
}

describe("desktop local auth", () => {
  it("signs in with email/password and persists the session token", async () => {
    const vault = memoryVault();
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            token: "session-token",
            user: { id: "user-1", email: "user@example.com", name: "User" },
          }),
        ),
    );
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
      userId: "user-1",
      email: "user@example.com",
      name: "User",
    });
    expect(vault.session).toEqual({
      token: "session-token",
      userId: "user-1",
      email: "user@example.com",
      name: "User",
    });
  });

  it("does not save a token when sign-in fails", async () => {
    const vault = memoryVault();
    const auth = new LocalAuth({
      serverUrl: "https://app.example.com",
      vault,
      fetchImpl: vi.fn(async () => new Response("no", { status: 401 })),
    });
    await expect(auth.signIn("user@example.com", "password12")).rejects.toThrow(
      "Email or password is incorrect",
    );
    expect(vault.session).toBeNull();
  });

  it("turns network and rate-limit failures into actionable messages", async () => {
    const vault = memoryVault();
    const offline = new LocalAuth({
      serverUrl: "https://app.example.com",
      vault,
      fetchImpl: vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    });
    await expect(offline.signIn("user@example.com", "password12")).rejects.toThrow(
      "Could not reach the account server",
    );

    const limited = new LocalAuth({
      serverUrl: "https://app.example.com",
      vault,
      fetchImpl: vi.fn(async () => new Response("slow down", { status: 429 })),
    });
    await expect(limited.signIn("user@example.com", "password12")).rejects.toThrow(
      "Too many sign-in attempts",
    );
  });

  it("requires a user id from the sign-in response", async () => {
    const vault = memoryVault();
    const auth = new LocalAuth({
      serverUrl: "https://app.example.com",
      vault,
      fetchImpl: vi.fn(
        async () =>
          new Response(
            JSON.stringify({ token: "session-token", user: { email: "user@example.com" } }),
          ),
      ),
    });

    await expect(auth.signIn("user@example.com", "password12")).rejects.toThrow(
      "Sign-in did not return a user id",
    );
    expect(vault.session).toBeNull();
  });

  it("clears the local token on sign-out", async () => {
    const vault = memoryVault({
      token: "session-token",
      userId: "user-1",
      email: "user@example.com",
      name: "User",
    });
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const auth = new LocalAuth({
      serverUrl: "https://app.example.com",
      vault,
      fetchImpl,
    });
    await auth.signOut();
    expect(vault.session).toBeNull();
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://app.example.com/api/auth/sign-out",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer session-token" }),
      }),
    );
  });

  it("creates an account and persists the returned session", async () => {
    const vault = memoryVault();
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            token: "new-session",
            user: { id: "user-2", email: "new@example.com", name: "New User" },
          }),
        ),
    );
    const auth = new LocalAuth({ serverUrl: "https://app.example.com", vault, fetchImpl });

    await expect(auth.signUp("New User", "new@example.com", "password12")).resolves.toEqual({
      token: "new-session",
      userId: "user-2",
      email: "new@example.com",
      name: "New User",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://app.example.com/api/auth/sign-up/email",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
