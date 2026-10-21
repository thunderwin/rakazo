import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { LocalKnowledgeDocument, ManagedContentSource } from "../types.js";

interface KnowledgeRow {
  id: string;
  title: string;
  content: string;
  source: ManagedContentSource;
  package_id: string | null;
  version: number | null;
  created_at: string;
  updated_at: string;
}

function knowledgeRow(row: KnowledgeRow): LocalKnowledgeDocument {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    source: row.source,
    packageId: row.package_id,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class KnowledgeRepository {
  constructor(private readonly db: Database.Database) {}

  list(): LocalKnowledgeDocument[] {
    return (
      this.db
        .prepare("SELECT * FROM knowledge_documents ORDER BY updated_at DESC, title ASC")
        .all() as KnowledgeRow[]
    ).map(knowledgeRow);
  }

  get(id: string): LocalKnowledgeDocument | null {
    const row = this.db.prepare("SELECT * FROM knowledge_documents WHERE id = ?").get(id) as
      | KnowledgeRow
      | undefined;
    return row ? knowledgeRow(row) : null;
  }

  create(input: {
    title: string;
    content: string;
    source?: ManagedContentSource;
    packageId?: string | null;
    version?: number | null;
  }): LocalKnowledgeDocument {
    const now = new Date().toISOString();
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO knowledge_documents
          (id, title, content, source, package_id, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.title,
        input.content,
        input.source ?? "local",
        input.packageId ?? null,
        input.version ?? null,
        now,
        now,
      );
    return this.get(id)!;
  }

  update(id: string, input: { title?: string; content?: string }): LocalKnowledgeDocument | null {
    const existing = this.get(id);
    if (existing?.source !== "local") return null;
    this.db
      .prepare(
        `UPDATE knowledge_documents
         SET title = ?, content = ?, updated_at = ?
         WHERE id = ? AND source = 'local'`,
      )
      .run(
        input.title ?? existing.title,
        input.content ?? existing.content,
        new Date().toISOString(),
        id,
      );
    return this.get(id);
  }

  remove(id: string): boolean {
    return (
      this.db.prepare("DELETE FROM knowledge_documents WHERE id = ? AND source = 'local'").run(id)
        .changes > 0
    );
  }
}
