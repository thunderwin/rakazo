export interface LocalSession {
  token: string;
  userId: string;
}

export interface SessionVault {
  load: () => Promise<LocalSession | null>;
  save: (session: LocalSession) => Promise<void>;
  clear: () => Promise<void>;
}

export interface LocalAuthOptions {
  serverUrl: string;
  vault: SessionVault;
  fetchImpl?: typeof fetch;
}

export interface LocalAuthStatus {
  signedIn: boolean;
  serverUrl: string;
  userId: string | null;
}

function normalizeServerUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Server URL is invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Server URL must use HTTP or HTTPS");
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Server URL must be an origin");
  }
  return url.origin;
}

export class LocalAuth {
  private readonly serverUrl: string;
  private readonly vault: SessionVault;
  private readonly fetchImpl: typeof fetch;

  constructor(options: LocalAuthOptions) {
    this.serverUrl = normalizeServerUrl(options.serverUrl);
    this.vault = options.vault;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async status(): Promise<LocalAuthStatus> {
    const session = await this.vault.load();
    return {
      signedIn: session !== null,
      serverUrl: this.serverUrl,
      userId: session?.userId ?? null,
    };
  }

  async getToken(): Promise<string> {
    const session = await this.vault.load();
    if (!session) throw new Error("Sign in to connect the model gateway.");
    return session.token;
  }

  async signIn(email: string, password: string): Promise<LocalSession> {
    const normalizedEmail = email.trim();
    if (!normalizedEmail || password.length < 8) {
      throw new Error("Enter a valid email and password");
    }
    const response = await this.fetchImpl(`${this.serverUrl}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: this.serverUrl,
      },
      body: JSON.stringify({ email: normalizedEmail, password }),
    });
    if (!response.ok) {
      throw new Error("Sign-in failed. Check your email and password.");
    }
    const body = (await response.json()) as {
      token?: unknown;
      user?: { id?: unknown };
    };
    if (typeof body.token !== "string" || !body.token) {
      throw new Error("Sign-in did not return a session token");
    }
    if (typeof body.user?.id !== "string" || !body.user.id) {
      throw new Error("Sign-in did not return a user id");
    }
    const session = { token: body.token, userId: body.user.id };
    await this.vault.save(session);
    return session;
  }

  async signOut(): Promise<void> {
    const token = (await this.vault.load())?.token;
    await this.vault.clear();
    if (!token) return;
    await this.fetchImpl(`${this.serverUrl}/api/auth/sign-out`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        origin: this.serverUrl,
      },
    }).catch(() => undefined);
  }
}
