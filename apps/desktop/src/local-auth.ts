export interface TokenVault {
  load: () => Promise<string | null>;
  save: (token: string) => Promise<void>;
  clear: () => Promise<void>;
}

export interface LocalAuthOptions {
  serverUrl: string;
  vault: TokenVault;
  fetchImpl?: typeof fetch;
}

export interface LocalAuthStatus {
  signedIn: boolean;
  serverUrl: string;
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
  private readonly vault: TokenVault;
  private readonly fetchImpl: typeof fetch;

  constructor(options: LocalAuthOptions) {
    this.serverUrl = normalizeServerUrl(options.serverUrl);
    this.vault = options.vault;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async status(): Promise<LocalAuthStatus> {
    return {
      signedIn: (await this.vault.load()) !== null,
      serverUrl: this.serverUrl,
    };
  }

  async getToken(): Promise<string> {
    const token = await this.vault.load();
    if (!token) throw new Error("Sign in to connect the model gateway.");
    return token;
  }

  async signIn(email: string, password: string): Promise<void> {
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
    const body = (await response.json()) as { token?: unknown };
    if (typeof body.token !== "string" || !body.token) {
      throw new Error("Sign-in did not return a session token");
    }
    await this.vault.save(body.token);
  }

  async signOut(): Promise<void> {
    const token = await this.vault.load();
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
