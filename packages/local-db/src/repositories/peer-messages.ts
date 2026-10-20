import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

export interface PeerMessage {
  id: string;
  fromBotId: string;
  toBotId: string;
  intent: string;
  prompt: string;
  reply: string | null;
  status: "pending" | "completed" | "failed";
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

interface PeerMessageRow {
  id: string;
  from_bot_id: string;
  to_bot_id: string;
  intent: string;
  prompt: string;
  reply: string | null;
  status: PeerMessage["status"];
  error: string | null;
  created_at: string;
  completed_at: string | null;
}

function rowToPeerMessage(row: PeerMessageRow): PeerMessage {
  return {
    id: row.id,
    fromBotId: row.from_bot_id,
    toBotId: row.to_bot_id,
    intent: row.intent,
    prompt: row.prompt,
    reply: row.reply,
    status: row.status,
    error: row.error,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export class PeerMessageRepository {
  constructor(private readonly db: Database.Database) {}

  create(input: {
    fromBotId: string;
    toBotId: string;
    intent: string;
    prompt: string;
  }): PeerMessage {
    const message: PeerMessage = {
      id: randomUUID(),
      ...input,
      reply: null,
      status: "pending",
      error: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
    };
    this.db
      .prepare(
        `INSERT INTO peer_messages (
          id, from_bot_id, to_bot_id, intent, prompt, reply, status, error, created_at, completed_at
        ) VALUES (
          @id, @fromBotId, @toBotId, @intent, @prompt, @reply, @status, @error, @createdAt, @completedAt
        )`,
      )
      .run(message);
    return message;
  }

  complete(id: string, reply: string): void {
    this.db
      .prepare(
        `UPDATE peer_messages
         SET reply = ?, status = 'completed', completed_at = ?
         WHERE id = ?`,
      )
      .run(reply, new Date().toISOString(), id);
  }

  fail(id: string, error: string): void {
    this.db
      .prepare(
        `UPDATE peer_messages
         SET error = ?, status = 'failed', completed_at = ?
         WHERE id = ?`,
      )
      .run(error, new Date().toISOString(), id);
  }

  listForBot(botId: string, limit = 100): PeerMessage[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM peer_messages
         WHERE from_bot_id = ? OR to_bot_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(botId, botId, Math.max(1, Math.min(limit, 500))) as PeerMessageRow[];
    return rows.map(rowToPeerMessage);
  }
}
