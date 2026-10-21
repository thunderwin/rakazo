import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { LocalSkill } from "../types.js";

interface SkillRow {
  id: string;
  name: string;
  description: string;
  content: string;
  source: "user" | "managed";
  package_id: string | null;
  version: number | null;
  created_at: string;
  updated_at: string;
}

function skillRow(row: SkillRow): LocalSkill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    content: row.content,
    source: row.source,
    packageId: row.package_id,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SkillRepository {
  constructor(private readonly db: Database.Database) {}

  list(): LocalSkill[] {
    return (
      this.db.prepare("SELECT * FROM agent_skills ORDER BY name ASC, id ASC").all() as SkillRow[]
    ).map(skillRow);
  }

  get(id: string): LocalSkill | null {
    const row = this.db.prepare("SELECT * FROM agent_skills WHERE id = ?").get(id) as
      | SkillRow
      | undefined;
    return row ? skillRow(row) : null;
  }

  findByName(name: string): LocalSkill | null {
    const row = this.db
      .prepare("SELECT * FROM agent_skills WHERE lower(name) = lower(?)")
      .get(name) as SkillRow | undefined;
    return row ? skillRow(row) : null;
  }

  create(input: {
    name: string;
    description: string;
    content: string;
    source?: "user" | "managed";
    packageId?: string | null;
    version?: number | null;
  }): LocalSkill {
    const now = new Date().toISOString();
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO agent_skills
          (id, name, description, content, source, package_id, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.description,
        input.content,
        input.source ?? "user",
        input.packageId ?? null,
        input.version ?? null,
        now,
        now,
      );
    return this.get(id)!;
  }

  update(
    id: string,
    input: { name?: string; description?: string; content?: string },
  ): LocalSkill | null {
    const existing = this.get(id);
    if (existing?.source !== "user") return null;
    this.db
      .prepare(
        `UPDATE agent_skills
         SET name = ?, description = ?, content = ?, updated_at = ?
         WHERE id = ? AND source = 'user'`,
      )
      .run(
        input.name ?? existing.name,
        input.description ?? existing.description,
        input.content ?? existing.content,
        new Date().toISOString(),
        id,
      );
    return this.get(id);
  }

  remove(id: string): boolean {
    return (
      this.db.prepare("DELETE FROM agent_skills WHERE id = ? AND source = 'user'").run(id).changes >
      0
    );
  }

  replaceManaged(input: {
    packageId: string;
    version: number;
    skills: Array<{ key: string; name: string; description: string; content: string }>;
  }): void {
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM agent_skills WHERE source = 'managed'").run();
      const insert = this.db.prepare(
        `INSERT INTO agent_skills
          (id, name, description, content, source, package_id, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'managed', ?, ?, ?, ?)`,
      );
      for (const skill of input.skills) {
        insert.run(
          `managed:${skill.key}`,
          skill.name,
          skill.description,
          skill.content,
          input.packageId,
          input.version,
          now,
          now,
        );
      }
    })();
  }
}
