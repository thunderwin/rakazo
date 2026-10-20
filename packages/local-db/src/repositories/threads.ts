import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { Thread } from "../types.js";

interface ThreadRow {
  id: string;
  bot_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

function rowToThread(row: ThreadRow): Thread {
  return {
    id: row.id,
    botId: row.bot_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ThreadRepository {
  constructor(private readonly db: Database.Database) {}

  getOrCreateForBot(botId: string, title = ""): Thread {
    const existing = this.db.prepare("SELECT * FROM threads WHERE bot_id = ?").get(botId) as
      | ThreadRow
      | undefined;
    if (existing) return rowToThread(existing);

    const now = new Date().toISOString();
    const thread: Thread = {
      id: randomUUID(),
      botId,
      title,
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .prepare(
        `INSERT INTO threads (id, bot_id, title, created_at, updated_at)
         VALUES (@id, @botId, @title, @createdAt, @updatedAt)`,
      )
      .run(thread);
    return thread;
  }

  get(id: string): Thread | null {
    const row = this.db.prepare("SELECT * FROM threads WHERE id = ?").get(id) as
      | ThreadRow
      | undefined;
    return row ? rowToThread(row) : null;
  }

  getForBot(botId: string): Thread | null {
    const row = this.db.prepare("SELECT * FROM threads WHERE bot_id = ?").get(botId) as
      | ThreadRow
      | undefined;
    return row ? rowToThread(row) : null;
  }
}
