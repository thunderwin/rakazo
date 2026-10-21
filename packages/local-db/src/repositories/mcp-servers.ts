import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { LocalMcpServer } from "../types.js";

interface McpServerRow {
  id: string;
  bot_id: string;
  name: string;
  slug: string;
  transport: LocalMcpServer["transport"];
  endpoint: string | null;
  command: string | null;
  args: string;
  secret_name: string | null;
  created_at: string;
  updated_at: string;
}

function rowToServer(row: McpServerRow): LocalMcpServer {
  return {
    id: row.id,
    botId: row.bot_id,
    name: row.name,
    slug: row.slug,
    transport: row.transport,
    endpoint: row.endpoint,
    command: row.command,
    args: JSON.parse(row.args) as string[],
    secretName: row.secret_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class McpServerRepository {
  constructor(private readonly db: Database.Database) {}

  list(botId: string): LocalMcpServer[] {
    return (
      this.db
        .prepare("SELECT * FROM mcp_servers WHERE bot_id = ? ORDER BY name ASC, id ASC")
        .all(botId) as McpServerRow[]
    ).map(rowToServer);
  }

  find(botId: string, slug: string): LocalMcpServer | null {
    const row = this.db
      .prepare("SELECT * FROM mcp_servers WHERE bot_id = ? AND slug = ?")
      .get(botId, slug) as McpServerRow | undefined;
    return row ? rowToServer(row) : null;
  }

  upsert(input: {
    botId: string;
    name: string;
    slug: string;
    transport: LocalMcpServer["transport"];
    endpoint?: string | null;
    command?: string | null;
    args: string[];
    secretName?: string | null;
  }): LocalMcpServer {
    const now = new Date().toISOString();
    const existing = this.find(input.botId, input.slug);
    if (!existing) {
      const id = randomUUID();
      this.db
        .prepare(
          `INSERT INTO mcp_servers
            (id, bot_id, name, slug, transport, endpoint, command, args, secret_name,
             created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.botId,
          input.name,
          input.slug,
          input.transport,
          input.endpoint ?? null,
          input.command ?? null,
          JSON.stringify(input.args),
          input.secretName ?? null,
          now,
          now,
        );
      return this.find(input.botId, input.slug)!;
    }
    this.db
      .prepare(
        `UPDATE mcp_servers
         SET name = ?, transport = ?, endpoint = ?, command = ?, args = ?,
             secret_name = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        input.name,
        input.transport,
        input.endpoint ?? null,
        input.command ?? null,
        JSON.stringify(input.args),
        input.secretName ?? null,
        now,
        existing.id,
      );
    return this.find(input.botId, input.slug)!;
  }
}
