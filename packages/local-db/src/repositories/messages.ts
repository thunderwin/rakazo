import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { AppendMessageInput, JsonValue, LocalMessage, MessageRole } from "../types.js";

interface MessageRow {
  id: string;
  thread_id: string;
  sequence: number;
  role: MessageRole;
  blocks: string;
  created_at: string;
  updated_at: string;
}

function rowToMessage(row: MessageRow): LocalMessage {
  return {
    id: row.id,
    threadId: row.thread_id,
    sequence: row.sequence,
    role: row.role,
    blocks: JSON.parse(row.blocks) as JsonValue[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class MessageRepository {
  constructor(private readonly db: Database.Database) {}

  append(input: AppendMessageInput): LocalMessage {
    return this.db.transaction(() => {
      const next = this.db
        .prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM messages WHERE thread_id = ?")
        .get(input.threadId) as { next: number };
      const now = new Date().toISOString();
      const message: LocalMessage = {
        id: randomUUID(),
        threadId: input.threadId,
        sequence: next.next,
        role: input.role,
        blocks: input.blocks,
        createdAt: now,
        updatedAt: now,
      };
      this.db
        .prepare(
          `INSERT INTO messages
            (id, thread_id, sequence, role, blocks, created_at, updated_at)
           VALUES
            (@id, @threadId, @sequence, @role, @blocks, @createdAt, @updatedAt)`,
        )
        .run({ ...message, blocks: JSON.stringify(message.blocks) });
      this.db.prepare("UPDATE threads SET updated_at = ? WHERE id = ?").run(now, input.threadId);
      return message;
    })();
  }

  list(threadId: string, options: { limit?: number } = {}): LocalMessage[] {
    const limit = Math.max(1, Math.min(options.limit ?? 200, 1000));
    const rows = this.db
      .prepare(
        `SELECT * FROM (
          SELECT * FROM messages WHERE thread_id = ? ORDER BY sequence DESC LIMIT ?
        ) ORDER BY sequence ASC`,
      )
      .all(threadId, limit) as MessageRow[];
    return rows.map(rowToMessage);
  }
}
