import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

export interface LocalInstructionVersion {
  id: string;
  botId: string;
  before: string;
  after: string;
  reason: string;
  createdAt: string;
}

interface InstructionVersionRow {
  id: string;
  bot_id: string;
  before: string;
  after: string;
  reason: string;
  created_at: string;
}

function rowToVersion(row: InstructionVersionRow): LocalInstructionVersion {
  return {
    id: row.id,
    botId: row.bot_id,
    before: row.before,
    after: row.after,
    reason: row.reason,
    createdAt: row.created_at,
  };
}

export class InstructionVersionRepository {
  constructor(private readonly db: Database.Database) {}

  create(input: Omit<LocalInstructionVersion, "id" | "createdAt">): LocalInstructionVersion {
    const version: LocalInstructionVersion = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.db
      .prepare(
        `INSERT INTO bot_instruction_versions
          (id, bot_id, before, after, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        version.id,
        version.botId,
        version.before,
        version.after,
        version.reason,
        version.createdAt,
      );
    return version;
  }

  list(botId: string, limit = 50): LocalInstructionVersion[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM bot_instruction_versions
           WHERE bot_id = ? ORDER BY created_at DESC LIMIT ?`,
        )
        .all(botId, Math.max(1, Math.min(limit, 200))) as InstructionVersionRow[]
    ).map(rowToVersion);
  }
}
