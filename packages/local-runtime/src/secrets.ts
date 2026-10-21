import {
  BOT_SECRET_VALUE_MAX_LENGTH,
  type BotSecretDestination,
  BotSecretName,
  botSecretDestinationSchema,
  commandVariableName,
  decodeLoginSecret,
  encodeLoginSecret,
  SecretHttpRequest,
} from "@rakazo/contracts";

const MAX_SECRET_HTTP_RESPONSE_CHARS = 20_000;

export interface LocalSecretMetadata {
  name: string;
  origin: string;
  auth: BotSecretDestination["auth"];
  createdAt: string;
  updatedAt: string;
}

export interface LocalSecretEntry extends LocalSecretMetadata {
  botId: string;
  value: string;
}

export interface LocalSecretVault {
  list(botId: string): Promise<LocalSecretMetadata[]>;
  get(botId: string, name: string): Promise<LocalSecretEntry | null>;
  put(input: LocalSecretEntry): Promise<LocalSecretMetadata>;
  remove(botId: string, name: string): Promise<boolean>;
}

export interface LocalSecretHttpRequest {
  url: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
  body?: string;
  headers: Record<string, string>;
  signal?: AbortSignal;
}

export interface LocalSecretHttpResponse {
  status: number;
  body: string;
  contentType: string | null;
}

export type LocalSecretHttp = (request: LocalSecretHttpRequest) => Promise<LocalSecretHttpResponse>;

export interface LocalSecretPromptRequest {
  name: string;
  origin: string;
  auth: BotSecretDestination["auth"];
  reason?: string;
}

export interface LocalSecretPromptValue {
  value: string;
  username?: string;
}

export type PromptForLocalSecret = (
  request: LocalSecretPromptRequest,
  signal?: AbortSignal,
) => Promise<LocalSecretPromptValue | null>;

export interface LocalSecretsOptions {
  vault: LocalSecretVault;
  request: LocalSecretHttp;
  prompt?: PromptForLocalSecret;
  allowPrivateHttpOrigin?: boolean;
}

function secretMetadata(entry: LocalSecretEntry): LocalSecretMetadata {
  const { value: _value, botId: _botId, ...metadata } = entry;
  return metadata;
}

function normalizePut(
  botId: string,
  input: {
    name: string;
    origin?: string;
    auth: BotSecretDestination["auth"];
    value: string;
  },
  allowPrivateHttpOrigin: boolean,
) {
  const destination = botSecretDestinationSchema({ allowPrivateHttpOrigin }).parse({
    name: input.name,
    origin: input.origin ?? "",
    auth: input.auth,
  });
  if (!input.value || input.value.length > BOT_SECRET_VALUE_MAX_LENGTH) {
    throw new Error("Credential value is invalid");
  }
  if (destination.auth.type === "login" || destination.auth.type === "command") {
    if (destination.auth.type === "login") decodeLoginSecret(input.value);
  }
  return { botId, ...destination, value: input.value };
}

function redact(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === "string") {
    return secrets.reduce((next, secret) => next.replaceAll(secret, "[redacted]"), value);
  }
  if (Array.isArray(value)) return value.map((entry) => redact(entry, secrets));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [redact(key, secrets), redact(entry, secrets)]),
  );
}

function encodedForms(value: string): string[] {
  const out = [value];
  try {
    out.push(encodeURIComponent(value));
  } catch {
    // Invalid surrogate input still needs raw-value redaction.
  }
  out.push(Buffer.from(value).toString("base64"));
  return out.filter(Boolean);
}

export class LocalSecrets {
  constructor(private readonly options: LocalSecretsOptions) {}

  async list(botId: string): Promise<LocalSecretMetadata[]> {
    return (await this.options.vault.list(botId)).filter(
      (secret) => !secret.name.startsWith("mcp-internal-"),
    );
  }

  async put(
    botId: string,
    input: {
      name: string;
      origin?: string;
      auth: BotSecretDestination["auth"];
      value: string;
    },
  ): Promise<LocalSecretMetadata> {
    const normalized = normalizePut(botId, input, this.options.allowPrivateHttpOrigin === true);
    const existing = await this.options.vault.get(botId, normalized.name);
    const now = new Date().toISOString();
    return this.options.vault.put({
      ...normalized,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  async remove(botId: string, name: string): Promise<boolean> {
    const parsed = BotSecretName.safeParse(name);
    if (!parsed.success) throw new Error("A valid credential name is required");
    return this.options.vault.remove(botId, parsed.data);
  }

  async revealLogin(
    botId: string,
    name: string,
    field: "username" | "password",
    expectedOrigin: string,
  ): Promise<{ value: string; origin: string }> {
    const entry = await this.options.vault.get(botId, name);
    if (entry?.auth.type !== "login") throw new Error("Website login is unavailable");
    if (new URL(entry.origin).origin !== new URL(expectedOrigin).origin) {
      throw new Error("Website login belongs to a different origin");
    }
    return { value: decodeLoginSecret(entry.value)[field], origin: entry.origin };
  }

  async commandEnvironment(botId: string): Promise<Record<string, string>> {
    const entries = await this.options.vault.list(botId);
    const environment: Record<string, string> = {};
    for (const metadata of entries) {
      if (metadata.auth.type !== "command" || metadata.name.startsWith("mcp-internal-")) continue;
      const entry = await this.options.vault.get(botId, metadata.name);
      if (entry) environment[commandVariableName(entry.name)] = entry.value;
    }
    return environment;
  }

  async request(
    botId: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const request = SecretHttpRequest.parse(args);
    const entry = await this.options.vault.get(botId, request.name);
    if (!entry) {
      return { error: "Credential is unavailable. Save it in Chat settings first." };
    }
    if (entry.auth.type === "login") {
      return { error: "Website logins can only be used for browser sign-in." };
    }
    if (entry.auth.type === "command") {
      return { error: "Command variables are only available to approved shell commands." };
    }
    const url = new URL(request.url);
    if (url.origin !== entry.origin || url.username || url.password || url.hash) {
      return { error: "This credential cannot be sent to that destination." };
    }
    const headerName = entry.auth.type === "header" ? entry.auth.name : "Authorization";
    const headerValue =
      entry.auth.type === "bearer"
        ? `Bearer ${entry.value}`
        : entry.auth.type === "basic"
          ? `Basic ${Buffer.from(`${entry.auth.username}:${entry.value}`).toString("base64")}`
          : entry.value;
    try {
      const response = await this.options.request({
        url: url.href,
        method: request.method,
        ...(request.body === undefined ? {} : { body: request.body }),
        headers: {
          accept: "application/json",
          "content-type": request.contentType,
          [headerName]: headerValue,
        },
        signal,
      });
      let body: unknown = response.body;
      try {
        body = JSON.parse(response.body);
      } catch {
        // Plain text responses are supported.
      }
      const redactions = [
        ...new Set([
          ...encodedForms(entry.value),
          ...encodedForms(headerValue),
          headerValue.replace(/^Basic /, ""),
        ]),
      ].filter(Boolean);
      const safe = JSON.stringify(redact(body, redactions));
      return {
        status: response.status,
        body:
          safe.length > MAX_SECRET_HTTP_RESPONSE_CHARS
            ? safe.slice(0, MAX_SECRET_HTTP_RESPONSE_CHARS)
            : JSON.parse(safe),
        truncated: safe.length > MAX_SECRET_HTTP_RESPONSE_CHARS,
      };
    } catch {
      signal?.throwIfAborted();
      return { error: "Authenticated request failed. Check the destination and credential." };
    }
  }

  async requestFromUser(
    botId: string,
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (!this.options.prompt) return { error: "Credential input is unavailable." };
    const destination = botSecretDestinationSchema({
      allowPrivateHttpOrigin: this.options.allowPrivateHttpOrigin === true,
    }).parse({
      name: input.name,
      origin: input.origin ?? "",
      auth: input.auth,
    });
    const existing = await this.options.vault.get(botId, destination.name);
    if (existing && input.replace !== true) {
      return { saved: true, ...secretMetadata(existing) };
    }
    const answer = await this.options.prompt(
      {
        ...destination,
        ...(typeof input.reason === "string" && input.reason.trim()
          ? { reason: input.reason.trim().slice(0, 500) }
          : {}),
      },
      signal,
    );
    if (!answer) return { cancelled: true };
    const value =
      destination.auth.type === "login"
        ? encodeLoginSecret({
            username: answer.username?.trim() ?? "",
            password: answer.value,
          })
        : answer.value;
    return { saved: true, ...(await this.put(botId, { ...destination, value })) };
  }
}
