import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { LocalArtifact, LocalArtifactWithContent } from "../types.js";

interface ArtifactRow {
  id: string;
  bot_id: string | null;
  group_id: string | null;
  name: string;
  mime_type: string;
  size: number;
  created_at: string;
}

interface ArtifactContentRow extends ArtifactRow {
  content: Buffer;
}

function artifactRow(row: ArtifactRow): LocalArtifact {
  return {
    id: row.id,
    botId: row.bot_id,
    groupId: row.group_id,
    name: row.name,
    mimeType: row.mime_type,
    size: row.size,
    createdAt: row.created_at,
  };
}

export class ArtifactRepository {
  constructor(private readonly db: Database.Database) {}

  create(input: {
    botId?: string;
    groupId?: string;
    name: string;
    mimeType: string;
    content: Uint8Array;
  }): LocalArtifact {
    if ((input.botId ? 1 : 0) + (input.groupId ? 1 : 0) !== 1) {
      throw new Error("An artifact must belong to one bot or one group");
    }
    if (input.content.byteLength === 0) throw new Error("Artifact content is empty");
    const record: LocalArtifact = {
      id: randomUUID(),
      botId: input.botId ?? null,
      groupId: input.groupId ?? null,
      name: input.name,
      mimeType: input.mimeType,
      size: input.content.byteLength,
      createdAt: new Date().toISOString(),
    };
    this.db
      .prepare(
        `INSERT INTO artifacts
          (id, bot_id, group_id, name, mime_type, size, content, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.botId,
        record.groupId,
        record.name,
        record.mimeType,
        record.size,
        Buffer.from(input.content),
        record.createdAt,
      );
    return record;
  }

  get(id: string): LocalArtifact | null {
    const row = this.db.prepare("SELECT * FROM artifacts WHERE id = ?").get(id) as
      | ArtifactRow
      | undefined;
    return row ? artifactRow(row) : null;
  }

  read(id: string): LocalArtifactWithContent | null {
    const row = this.db.prepare("SELECT * FROM artifacts WHERE id = ?").get(id) as
      | ArtifactContentRow
      | undefined;
    return row
      ? {
          ...artifactRow(row),
          content: new Uint8Array(row.content),
        }
      : null;
  }
}
