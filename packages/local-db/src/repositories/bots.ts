import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { Bot, CreateBotInput } from "../types.js";

interface BotRow {
  id: string;
  name: string;
  title: string;
  description: string;
  instructions: string;
  color: string;
  model_provider: string | null;
  model_id: string | null;
  thinking_level: string | null;
  disabled_builtin_tools: string;
  template_key: string | null;
  template_version: number | null;
  source: "local" | "managed";
  managed_key: string | null;
  package_version: number | null;
  created_at: string;
  updated_at: string;
}

function rowToBot(row: BotRow): Bot {
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    description: row.description,
    instructions: row.instructions,
    color: row.color,
    modelProvider: row.model_provider,
    modelId: row.model_id,
    thinkingLevel: row.thinking_level,
    disabledBuiltinTools: JSON.parse(row.disabled_builtin_tools) as string[],
    templateKey: row.template_key,
    templateVersion: row.template_version,
    source: row.source,
    managedKey: row.managed_key,
    packageVersion: row.package_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class BotRepository {
  constructor(private readonly db: Database.Database) {}

  create(input: CreateBotInput): Bot {
    const now = new Date().toISOString();
    const bot: Bot = {
      id: randomUUID(),
      name: input.name,
      title: input.title ?? "",
      description: input.description ?? "",
      instructions: input.instructions ?? "",
      color: input.color ?? "blue",
      modelProvider: input.modelProvider ?? null,
      modelId: input.modelId ?? null,
      thinkingLevel: input.thinkingLevel ?? null,
      disabledBuiltinTools: input.disabledBuiltinTools ?? [],
      templateKey: input.templateKey ?? null,
      templateVersion: input.templateVersion ?? null,
      source: input.source ?? "local",
      managedKey: input.managedKey ?? null,
      packageVersion: input.packageVersion ?? null,
      createdAt: now,
      updatedAt: now,
    };

    this.db
      .prepare(
        `INSERT INTO bots (
          id, name, title, description, instructions, color,
          model_provider, model_id, thinking_level, disabled_builtin_tools,
          template_key, template_version, source, managed_key, package_version,
          created_at, updated_at
        ) VALUES (
          @id, @name, @title, @description, @instructions, @color,
          @modelProvider, @modelId, @thinkingLevel, @disabledBuiltinTools,
          @templateKey, @templateVersion, @source, @managedKey, @packageVersion,
          @createdAt, @updatedAt
        )`,
      )
      .run({
        ...bot,
        disabledBuiltinTools: JSON.stringify(bot.disabledBuiltinTools),
      });

    return bot;
  }

  get(id: string): Bot | null {
    const row = this.db.prepare("SELECT * FROM bots WHERE id = ?").get(id) as BotRow | undefined;
    return row ? rowToBot(row) : null;
  }

  list(): Bot[] {
    const rows = this.db
      .prepare("SELECT * FROM bots ORDER BY created_at ASC, id ASC")
      .all() as BotRow[];
    return rows.map(rowToBot);
  }

  update(
    id: string,
    input: Partial<Omit<CreateBotInput, "templateKey" | "templateVersion">>,
  ): Bot | null {
    const current = this.get(id);
    if (!current) return null;
    const now = new Date().toISOString();
    const next: Bot = {
      ...current,
      id,
      name: input.name ?? current.name,
      title: input.title ?? current.title,
      description: input.description ?? current.description,
      instructions: input.instructions ?? current.instructions,
      color: input.color ?? current.color,
      modelProvider:
        input.modelProvider === undefined ? current.modelProvider : input.modelProvider,
      modelId: input.modelId === undefined ? current.modelId : input.modelId,
      thinkingLevel:
        input.thinkingLevel === undefined ? current.thinkingLevel : input.thinkingLevel,
      disabledBuiltinTools: input.disabledBuiltinTools ?? current.disabledBuiltinTools,
      updatedAt: now,
    };
    this.db
      .prepare(
        `UPDATE bots SET
          name = @name,
          title = @title,
          description = @description,
          instructions = @instructions,
          color = @color,
          model_provider = @modelProvider,
          model_id = @modelId,
          thinking_level = @thinkingLevel,
          disabled_builtin_tools = @disabledBuiltinTools,
          updated_at = @updatedAt
        WHERE id = @id`,
      )
      .run({
        ...next,
        disabledBuiltinTools: JSON.stringify(next.disabledBuiltinTools),
      });
    return next;
  }

  upsertManaged(input: {
    organizationId: string;
    key: string;
    packageVersion: number;
    name: string;
    title: string;
    description: string;
    instructions: string;
    color: string;
    modelId: string | null;
    thinkingLevel: string | null;
    disabledBuiltinTools: string[];
  }): Bot {
    const managedKey = `${input.organizationId}:${input.key}`;
    const existing = this.db.prepare("SELECT * FROM bots WHERE managed_key = ?").get(managedKey) as
      | BotRow
      | undefined;
    const now = new Date().toISOString();
    if (!existing) {
      return this.create({
        name: input.name,
        title: input.title,
        description: input.description,
        instructions: input.instructions,
        color: input.color,
        modelId: input.modelId,
        thinkingLevel: input.thinkingLevel,
        disabledBuiltinTools: input.disabledBuiltinTools,
        source: "managed",
        managedKey,
        packageVersion: input.packageVersion,
      });
    }
    this.db
      .prepare(
        `UPDATE bots SET
          name = ?, title = ?, description = ?, instructions = ?, color = ?,
          model_id = ?, thinking_level = ?, disabled_builtin_tools = ?,
          package_version = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        input.name,
        input.title,
        input.description,
        input.instructions,
        input.color,
        input.modelId,
        input.thinkingLevel,
        JSON.stringify(input.disabledBuiltinTools),
        input.packageVersion,
        now,
        existing.id,
      );
    return this.get(existing.id)!;
  }

  deleteManagedExcept(organizationId: string, keepKeys: readonly string[]): number {
    const prefix = `${organizationId}:`;
    const keep = new Set(keepKeys.map((key) => `${prefix}${key}`));
    const rows = this.db
      .prepare("SELECT id, managed_key FROM bots WHERE source = 'managed' AND managed_key LIKE ?")
      .all(`${prefix}%`) as Array<{ id: string; managed_key: string }>;
    const remove = this.db.prepare("DELETE FROM bots WHERE id = ?");
    let count = 0;
    for (const row of rows) {
      if (keep.has(row.managed_key)) continue;
      count += remove.run(row.id).changes;
    }
    return count;
  }
}
