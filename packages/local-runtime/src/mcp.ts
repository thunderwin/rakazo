import type { Bot, LocalDatabase, McpServerRepository } from "@rakazo/local-db";
import type { LocalSecretVault } from "./secrets.js";
import type {
  ApproveLocalTool,
  LocalTool,
  LocalToolExecutionRequest,
  LocalToolProvider,
} from "./tools.js";

export interface LocalMcpConfig {
  name: string;
  transport: "streamable-http" | "sse" | "stdio";
  endpoint?: string;
  command?: string;
  args: string[];
  env: Record<string, string>;
  headers: Record<string, string>;
  secret?: string;
}

export interface LocalMcpConnection {
  listTools(signal?: AbortSignal): Promise<
    Array<{
      name: string;
      description?: string;
      inputSchema: Record<string, unknown>;
      readOnly?: boolean;
    }>
  >;
  callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<{ content: unknown[]; isError?: boolean }>;
  close(): Promise<void>;
}

export type ConnectLocalMcp = (config: LocalMcpConfig) => Promise<LocalMcpConnection>;

function text(value: unknown, key: string, max: number): string {
  const parsed = typeof value === "string" ? value.trim() : "";
  if (!parsed || parsed.length > max) throw new Error(`${key} is invalid`);
  return parsed;
}

function optionalText(value: unknown, key: string, max: number): string | undefined {
  if (value === undefined) return undefined;
  const parsed = typeof value === "string" ? value.trim() : "";
  if (!parsed || parsed.length > max) throw new Error(`${key} is invalid`);
  return parsed;
}

function stringRecord(value: unknown, key: string): Record<string, string> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${key} must be an object`);
  }
  const entries = Object.entries(value);
  if (entries.length > 32) throw new Error(`${key} has too many entries`);
  return Object.fromEntries(
    entries.map(([name, entry]) => {
      if (
        !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name) ||
        typeof entry !== "string" ||
        entry.length > 16_384
      ) {
        throw new Error(`${key} is invalid`);
      }
      return [name, entry];
    }),
  );
}

export function parseLocalMcpConfig(args: Record<string, unknown>): LocalMcpConfig {
  const name = text(args.name, "name", 120);
  const transport =
    args.transport === "stdio" || args.transport === "sse" || args.transport === "streamable_http"
      ? args.transport === "streamable_http"
        ? ("streamable-http" as const)
        : args.transport
      : undefined;
  if (!transport) throw new Error("transport must be streamable_http, sse, or stdio");
  const endpoint = transport === "stdio" ? undefined : text(args.endpoint, "endpoint", 2_048);
  const command = transport === "stdio" ? text(args.command, "command", 2_048) : undefined;
  const rawArgs = Array.isArray(args.args)
    ? args.args
    : typeof args.args === "string"
      ? args.args.split(/\s+/)
      : [];
  const commandArgs = rawArgs
    .filter((entry): entry is string => typeof entry === "string")
    .slice(0, 64);
  const secret = optionalText(args.secret, "secret", 16_384);
  return {
    name,
    transport,
    ...(endpoint ? { endpoint } : {}),
    ...(command ? { command } : {}),
    args: commandArgs,
    env: stringRecord(args.env, "env"),
    headers: stringRecord(args.headers, "headers"),
    ...(secret ? { secret } : {}),
  };
}

function slugFor(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  if (!slug) throw new Error("MCP server name needs at least one letter or number");
  return slug;
}

export class LocalMcpService {
  private readonly connections = new Map<string, LocalMcpConnection>();

  constructor(
    private readonly repository: McpServerRepository,
    private readonly database: LocalDatabase,
    private readonly vault: LocalSecretVault,
    private readonly connect: ConnectLocalMcp,
  ) {}

  async add(botId: string, args: Record<string, unknown>) {
    if (!this.database.bots.get(botId)) throw new Error("Bot not found");
    const config = parseLocalMcpConfig(args);
    const slug = slugFor(config.name);
    const secretName = `mcp-internal-${slug}`;
    const now = new Date().toISOString();
    const existingSecret = await this.vault.get(botId, secretName);
    await this.vault.put({
      botId,
      name: secretName,
      origin: "",
      auth: { type: "command" },
      value: JSON.stringify({
        env: config.env,
        headers: config.headers,
        ...(config.secret ? { secret: config.secret } : {}),
      }),
      createdAt: existingSecret?.createdAt ?? now,
      updatedAt: now,
    });
    const existing = this.repository.find(botId, slug);
    if (existing) {
      const connection = this.connections.get(existing.id);
      this.connections.delete(existing.id);
      await connection?.close();
    }
    const server = this.repository.upsert({
      botId,
      name: config.name,
      slug,
      transport: config.transport,
      endpoint: config.endpoint ?? null,
      command: config.command ?? null,
      args: config.args,
      secretName,
    });
    return { ok: true, server: { id: server.id, name: server.name, slug: server.slug } };
  }

  async definitions(botId: string, signal?: AbortSignal) {
    const groups = await Promise.all(
      this.repository.list(botId).map(async (server) => {
        try {
          const connection = await this.connection(server);
          const tools = await connection.listTools(signal);
          return tools.map((tool) => ({
            name: `mcp__${server.slug}__${tool.name}`.slice(0, 64),
            description: tool.description ?? `${server.name}: ${tool.name}`,
            inputSchema: tool.inputSchema,
            readOnly: tool.readOnly,
            requiresApproval: !tool.readOnly,
          }));
        } catch {
          return [];
        }
      }),
    );
    return groups.flat();
  }

  async call(botId: string, toolName: string, args: Record<string, unknown>, signal?: AbortSignal) {
    const match = /^mcp__([^_]+)__(.+)$/.exec(toolName);
    if (!match) throw new Error("Unknown MCP tool");
    const server = this.repository.find(botId, match[1]!);
    if (!server) throw new Error("MCP server is unavailable");
    const connection = await this.connection(server);
    const result = await connection.callTool(match[2]!, args, signal);
    return {
      kind: "agent_tool_result",
      content: result.content,
      details: { isError: result.isError === true, server: server.slug },
    };
  }

  async close() {
    await Promise.all([...this.connections.values()].map((connection) => connection.close()));
    this.connections.clear();
  }

  private async connection(server: {
    id: string;
    botId: string;
    name: string;
    transport: "streamable-http" | "sse" | "stdio";
    endpoint: string | null;
    command: string | null;
    args: string[];
    secretName: string | null;
  }) {
    const cached = this.connections.get(server.id);
    if (cached) return cached;
    const secret = server.secretName ? await this.vault.get(server.botId, server.secretName) : null;
    const material = secret
      ? (JSON.parse(secret.value) as {
          env?: Record<string, string>;
          headers?: Record<string, string>;
          secret?: string;
        })
      : {};
    const connection = await this.connect({
      name: server.name,
      transport: server.transport,
      ...(server.endpoint ? { endpoint: server.endpoint } : {}),
      ...(server.command ? { command: server.command } : {}),
      args: server.args,
      env: material.env ?? {},
      headers: material.headers ?? {},
      ...(material.secret ? { secret: material.secret } : {}),
    });
    this.connections.set(server.id, connection);
    return connection;
  }
}

export function createLocalMcpTools(service: () => LocalMcpService): LocalTool[] {
  return [
    {
      definition: {
        name: "add_mcp_server",
        requiresApproval: true,
        description:
          "Connect an owner-provided MCP tool server. Its discovered tools become available on the next Agent turn.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", maxLength: 120 },
            transport: { type: "string", enum: ["streamable_http", "sse", "stdio"] },
            endpoint: { type: "string" },
            command: { type: "string" },
            args: {
              anyOf: [{ type: "array", items: { type: "string" } }, { type: "string" }],
            },
            env: { type: "object" },
            headers: { type: "object" },
            secret: { type: "string" },
          },
          required: ["name", "transport"],
        },
      },
      async execute({ botId, args }) {
        if (!botId) throw new Error("add_mcp_server requires a bot");
        return service().add(botId, args);
      },
    },
  ];
}

export class LocalMcpToolProvider implements LocalToolProvider {
  private readonly readOnly = new Map<string, boolean>();

  constructor(
    private readonly tools: LocalToolProvider,
    private readonly service: LocalMcpService,
    private readonly approve: ApproveLocalTool,
  ) {}

  async definitionsFor(bot: Bot) {
    const disabled = new Set(bot.disabledBuiltinTools);
    const mcp = disabled.has("mcp") ? [] : await this.service.definitions(bot.id);
    for (const tool of mcp) this.readOnly.set(tool.name, tool.readOnly === true);
    return [...(await this.tools.definitionsFor(bot)), ...mcp];
  }

  async execute(request: LocalToolExecutionRequest) {
    if (!request.name.startsWith("mcp__")) return this.tools.execute(request);
    if (!request.botId) throw new Error("MCP tools require a bot");
    if (!this.readOnly.get(request.name) && !(await this.approve(request))) {
      throw new Error(`Tool ${request.name} was not approved`);
    }
    return this.service.call(request.botId, request.name, request.args, request.signal);
  }
}
