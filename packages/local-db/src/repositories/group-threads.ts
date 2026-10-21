import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { GroupThread } from "../types.js";

interface GroupThreadRow {
  id: string;
  group_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

function rowToThread(row: GroupThreadRow): GroupThread {
  return {
    id: row.id,
    groupId: row.group_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class GroupThreadRepository {
  constructor(private readonly db: Database.Database) {}

  getOrCreate(groupId: string, title = ""): GroupThread {
    const existing = this.db
      .prepare("SELECT * FROM group_threads WHERE group_id = ?")
      .get(groupId) as GroupThreadRow | undefined;
    if (existing) return rowToThread(existing);
    const now = new Date().toISOString();
    const thread: GroupThread = {
      id: randomUUID(),
      groupId,
      title,
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .prepare(
        `INSERT INTO group_threads (id, group_id, title, created_at, updated_at)
         VALUES (@id, @groupId, @title, @createdAt, @updatedAt)`,
      )
      .run(thread);
    return thread;
  }

  get(id: string): GroupThread | null {
    const row = this.db.prepare("SELECT * FROM group_threads WHERE id = ?").get(id) as
      | GroupThreadRow
      | undefined;
    return row ? rowToThread(row) : null;
  }
}
