export interface LocalSession {
  token: string;
  userId: string;
  email: string;
  name: string;
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
  email: string | null;
  name: string | null;
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

async function authFetch(
  fetchImpl: typeof fetch,
  input: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetchImpl(input, init);
  } catch {
    throw new Error("Could not reach the account server. Check your connection and try again.");
  }
}

function signInFailure(response: Response): Error {
  if (response.status === 401 || response.status === 403) {
    return new Error("Email or password is incorrect.");
  }
  if (response.status === 429) {
    return new Error("Too many sign-in attempts. Wait a moment and try again.");
  }
  if (response.status >= 500) {
    return new Error("The account server is unavailable. Try again shortly.");
  }
  return new Error("Sign-in failed. Check your email and password.");
}

function signUpFailure(response: Response): Error {
  if (response.status === 409) {
    return new Error("An account with this email already exists. Try signing in.");
  }
  if (response.status === 429) {
    return new Error("Too many account attempts. Wait a moment and try again.");
  }
  if (response.status >= 500) {
    return new Error("The account server is unavailable. Try again shortly.");
  }
  return new Error("Could not create the account. Check the details and try again.");
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
      email: session?.email ?? null,
      name: session?.name ?? null,
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
    const response = await authFetch(this.fetchImpl, `${this.serverUrl}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: this.serverUrl,
      },
      body: JSON.stringify({ email: normalizedEmail, password }),
    });
    if (!response.ok) throw signInFailure(response);
    const body = (await response.json().catch(() => null)) as {
      token?: unknown;
      user?: { id?: unknown; email?: unknown; name?: unknown };
    } | null;
    if (typeof body?.token !== "string" || !body.token) {
      throw new Error("Sign-in did not return a session token");
    }
    if (typeof body.user?.id !== "string" || !body.user.id) {
      throw new Error("Sign-in did not return a user id");
    }
    if (typeof body.user.email !== "string" || !body.user.email) {
      throw new Error("Sign-in did not return an email");
    }
    const session = {
      token: body.token,
      userId: body.user.id,
      email: body.user.email,
      name: typeof body.user.name === "string" ? body.user.name : body.user.email,
    };
    await this.vault.save(session);
    return session;
  }

  async signUp(name: string, email: string, password: string): Promise<LocalSession> {
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedName = name.trim() || normalizedEmail.split("@")[0] || "User";
    if (!normalizedEmail || password.length < 8) {
      throw new Error("Enter a valid email and password");
    }
    const response = await authFetch(this.fetchImpl, `${this.serverUrl}/api/auth/sign-up/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: this.serverUrl,
      },
      body: JSON.stringify({ email: normalizedEmail, password, name: normalizedName }),
    });
    if (!response.ok) throw signUpFailure(response);
    const body = (await response.json().catch(() => null)) as {
      token?: unknown;
      user?: { id?: unknown; email?: unknown; name?: unknown };
    } | null;
    if (
      typeof body?.token !== "string" ||
      !body.token ||
      typeof body.user?.id !== "string" ||
      !body.user.id
    ) {
      throw new Error("Sign-up did not return a session");
    }
    const session = {
      token: body.token,
      userId: body.user.id,
      email: typeof body.user.email === "string" ? body.user.email : normalizedEmail,
      name: typeof body.user.name === "string" ? body.user.name : normalizedName,
    };
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
