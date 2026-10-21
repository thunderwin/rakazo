import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { CommitMemoryInput, LocalMemoryDocument, LocalMemoryScope } from "../types.js";

interface MemoryRow {
  id: string;
  scope: LocalMemoryScope;
  bot_id: string | null;
  path: string;
  content: string;
  revision: number;
  created_at: string;
  updated_at: string;
}

export class MemoryRevisionConflictError extends Error {
  constructor() {
    super("Memory changed since it was read. Read the latest version and save again.");
    this.name = "MemoryRevisionConflictError";
  }
}

function memoryRow(row: MemoryRow): LocalMemoryDocument {
  return {
    id: row.id,
    scope: row.scope,
    botId: row.bot_id,
    path: row.path,
    content: row.content,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class MemoryRepository {
  constructor(private readonly db: Database.Database) {}

  list(input: { scope?: LocalMemoryScope; botId?: string } = {}): LocalMemoryDocument[] {
    const clauses: string[] = [];
    const params: string[] = [];
    if (input.scope) {
      clauses.push("scope = ?");
      params.push(input.scope);
    }
    if (input.botId) {
      clauses.push("bot_id = ?");
      params.push(input.botId);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return (
      this.db
        .prepare(`SELECT * FROM memory_documents ${where} ORDER BY updated_at DESC, path ASC`)
        .all(...params) as MemoryRow[]
    ).map(memoryRow);
  }

  get(id: string): LocalMemoryDocument | null {
    const row = this.db.prepare("SELECT * FROM memory_documents WHERE id = ?").get(id) as
      | MemoryRow
      | undefined;
    return row ? memoryRow(row) : null;
  }

  read(
    scope: LocalMemoryScope,
    path: string,
    input: { botId?: string } = {},
  ): LocalMemoryDocument | null {
    const row = this.db
      .prepare(
        `SELECT * FROM memory_documents
         WHERE scope = ? AND COALESCE(bot_id, '') = ? AND path = ?`,
      )
      .get(scope, input.botId ?? "", path) as MemoryRow | undefined;
    return row ? memoryRow(row) : null;
  }

  commit(input: CommitMemoryInput): LocalMemoryDocument {
    if (input.scope === "bot" && !input.botId) {
      throw new Error("Bot memory requires a bot id");
    }
    if (input.scope === "user" && input.botId) {
      throw new Error("Shared memory cannot belong to one bot");
    }

    return this.db.transaction(() => {
      const existing = this.read(input.scope, input.path, {
        ...(input.scope === "bot" ? { botId: input.botId } : {}),
      });
      if (
        input.expectedRevision !== undefined &&
        (existing?.revision ?? 0) !== input.expectedRevision
      ) {
        throw new MemoryRevisionConflictError();
      }

      const now = new Date().toISOString();
      const revision = (existing?.revision ?? 0) + 1;
      const id = existing?.id ?? randomUUID();
      if (existing) {
        this.db
          .prepare(
            `UPDATE memory_documents
             SET content = ?, revision = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(input.content, revision, now, id);
      } else {
        this.db
          .prepare(
            `INSERT INTO memory_documents
              (id, scope, bot_id, path, content, revision, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            id,
            input.scope,
            input.scope === "bot" ? input.botId : null,
            input.path,
            input.content,
            revision,
            now,
            now,
          );
      }
      this.db
        .prepare(
          `INSERT INTO memory_revisions
            (id, document_id, revision, content, source_run_id, source_thread_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          `${id}:${revision}`,
          id,
          revision,
          input.content,
          input.sourceRunId ?? null,
          input.sourceThreadId ?? null,
          now,
        );
      return {
        id,
        scope: input.scope,
        botId: input.scope === "bot" ? (input.botId ?? null) : null,
        path: input.path,
        content: input.content,
        revision,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
    })();
  }

  remove(id: string): boolean {
    return this.db.prepare("DELETE FROM memory_documents WHERE id = ?").run(id).changes > 0;
  }
}
