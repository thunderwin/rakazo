import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { AppendGroupMessageInput, GroupMessage, JsonValue, MessageRole } from "../types.js";

interface GroupMessageRow {
  id: string;
  thread_id: string;
  sequence: number;
  role: MessageRole;
  bot_id: string | null;
  blocks: string;
  created_at: string;
  updated_at: string;
}

function rowToMessage(row: GroupMessageRow): GroupMessage {
  return {
    id: row.id,
    threadId: row.thread_id,
    sequence: row.sequence,
    role: row.role,
    botId: row.bot_id,
    blocks: JSON.parse(row.blocks) as JsonValue[],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class GroupMessageRepository {
  constructor(private readonly db: Database.Database) {}

  append(input: AppendGroupMessageInput): GroupMessage {
    return this.db.transaction(() => {
      const next = this.db
        .prepare(
          "SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM group_messages WHERE thread_id = ?",
        )
        .get(input.threadId) as { next: number };
      const now = new Date().toISOString();
      const message: GroupMessage = {
        id: randomUUID(),
        threadId: input.threadId,
        sequence: next.next,
        role: input.role,
        botId: input.botId ?? null,
        blocks: input.blocks,
        createdAt: now,
        updatedAt: now,
      };
      this.db
        .prepare(
          `INSERT INTO group_messages
            (id, thread_id, sequence, role, bot_id, blocks, created_at, updated_at)
           VALUES
            (@id, @threadId, @sequence, @role, @botId, @blocks, @createdAt, @updatedAt)`,
        )
        .run({ ...message, blocks: JSON.stringify(message.blocks) });
      this.db
        .prepare("UPDATE group_threads SET updated_at = ? WHERE id = ?")
        .run(now, input.threadId);
      this.db
        .prepare(
          `UPDATE chat_groups SET updated_at = ?
           WHERE id = (SELECT group_id FROM group_threads WHERE id = ?)`,
        )
        .run(now, input.threadId);
      return message;
    })();
  }

  list(threadId: string, limit = 200): GroupMessage[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM (
           SELECT * FROM group_messages
           WHERE thread_id = ?
           ORDER BY sequence DESC
           LIMIT ?
         ) ORDER BY sequence ASC`,
      )
      .all(threadId, Math.max(1, Math.min(limit, 1000))) as GroupMessageRow[];
    return rows.map(rowToMessage);
  }
}
