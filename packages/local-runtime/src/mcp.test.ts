import { openLocalDatabase } from "@rakazo/local-db";
import { describe, expect, it, vi } from "vitest";
import { LocalMcpService, LocalMcpToolProvider, parseLocalMcpConfig } from "./mcp.js";
import { LocalToolRegistry } from "./tools.js";

describe("local MCP", () => {
  it("normalizes snake-case transport and discovers callable MCP tools", async () => {
    expect(
      parseLocalMcpConfig({
        name: "Linear",
        transport: "streamable_http",
        endpoint: "https://mcp.example.com",
      }),
    ).toMatchObject({ transport: "streamable-http", args: [], env: {}, headers: {} });
  });

  it("stores server config, discovers tools, and requires approval for writes", async () => {
    const db = openLocalDatabase(":memory:");
    const bot = db.bots.create({ name: "Agent" });
    const secrets = new Map<string, string>();
    const vault = {
      async list() {
        return [];
      },
      async get(botId: string, name: string) {
        const value = secrets.get(`${botId}:${name}`);
        return value
          ? {
              botId,
              name,
              origin: "",
              auth: { type: "command" as const },
              value,
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            }
          : null;
      },
      async put(input: {
        botId: string;
        name: string;
        value: string;
        origin: string;
        auth: { type: "command" };
        createdAt: string;
        updatedAt: string;
      }) {
        secrets.set(`${input.botId}:${input.name}`, input.value);
        const { value: _value, botId: _botId, ...metadata } = input;
        return metadata;
      },
      async remove(botId: string, name: string) {
        return secrets.delete(`${botId}:${name}`);
      },
    };
    const connection = {
      listTools: vi.fn(async () => [
        {
          name: "read_issue",
          description: "Read an issue",
          inputSchema: { type: "object" },
          readOnly: true,
        },
        {
          name: "create_issue",
          description: "Create an issue",
          inputSchema: { type: "object" },
          readOnly: false,
        },
      ]),
      callTool: vi.fn(async () => ({
        content: [{ type: "text", text: "created" }],
      })),
      close: vi.fn(async () => undefined),
    };
    const service = new LocalMcpService(db.mcpServers, db, vault, async () => connection);
    await service.add(bot.id, {
      name: "Linear",
      transport: "streamable_http",
      endpoint: "https://mcp.example.com",
    });
    const approve = vi.fn(async () => true);
    const provider = new LocalMcpToolProvider(new LocalToolRegistry([]), service, approve);
    expect((await provider.definitionsFor(bot)).map((tool) => tool.name)).toEqual([
      "mcp__linear__read_issue",
      "mcp__linear__create_issue",
    ]);
    await provider.execute({
      botId: bot.id,
      name: "mcp__linear__read_issue",
      args: {},
      executionId: "read-1",
    });
    expect(approve).not.toHaveBeenCalled();
    await provider.execute({
      botId: bot.id,
      name: "mcp__linear__create_issue",
      args: { title: "Bug" },
      executionId: "write-1",
    });
    expect(approve).toHaveBeenCalledOnce();
    expect(connection.callTool).toHaveBeenLastCalledWith(
      "create_issue",
      { title: "Bug" },
      undefined,
    );
    await service.close();
    db.close();
  });
});
