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
  fleet_management: number;
  created_by_bot_id: string | null;
  instructions_version: number;
  archived_at: string | null;
  section: string | null;
  pinned: number;
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
    fleetManagement: row.fleet_management === 1,
    createdByBotId: row.created_by_bot_id,
    instructionsVersion: row.instructions_version,
    archivedAt: row.archived_at,
    section: row.section,
    pinned: row.pinned === 1,
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
      fleetManagement: input.fleetManagement ?? false,
      createdByBotId: input.createdByBotId ?? null,
      instructionsVersion: 1,
      archivedAt: input.archivedAt ?? null,
      section: input.section ?? null,
      pinned: input.pinned ?? false,
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
          fleet_management, created_by_bot_id, instructions_version,
          archived_at, section, pinned,
          template_key, template_version, source, managed_key, package_version,
          created_at, updated_at
        ) VALUES (
          @id, @name, @title, @description, @instructions, @color,
          @modelProvider, @modelId, @thinkingLevel, @disabledBuiltinTools,
          @fleetManagement, @createdByBotId, @instructionsVersion,
          @archivedAt, @section, @pinned,
          @templateKey, @templateVersion, @source, @managedKey, @packageVersion,
          @createdAt, @updatedAt
        )`,
      )
      .run({
        ...bot,
        fleetManagement: bot.fleetManagement ? 1 : 0,
        pinned: bot.pinned ? 1 : 0,
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

  listActive(): Bot[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM bots WHERE archived_at IS NULL ORDER BY pinned DESC, created_at ASC, id ASC",
      )
      .all() as BotRow[];
    return rows.map(rowToBot);
  }

  listArchived(): Bot[] {
    const rows = this.db
      .prepare("SELECT * FROM bots WHERE archived_at IS NOT NULL ORDER BY archived_at DESC, id ASC")
      .all() as BotRow[];
    return rows.map(rowToBot);
  }

  archive(id: string, archivedAt = new Date().toISOString()): Bot | null {
    this.db
      .prepare("UPDATE bots SET archived_at = ?, updated_at = ? WHERE id = ?")
      .run(archivedAt, new Date().toISOString(), id);
    return this.get(id);
  }

  restore(id: string): Bot | null {
    this.db
      .prepare("UPDATE bots SET archived_at = NULL, updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
    return this.get(id);
  }

  deleteArchived(id: string): boolean {
    return (
      this.db.prepare("DELETE FROM bots WHERE id = ? AND archived_at IS NOT NULL").run(id).changes >
      0
    );
  }

  update(
    id: string,
    input: Partial<Omit<CreateBotInput, "templateKey" | "templateVersion">>,
  ): Bot | null {
    const current = this.get(id);
    if (!current) return null;
    const now = new Date().toISOString();
    const instructions = input.instructions ?? current.instructions;
    const instructionsChanged = instructions !== current.instructions;
    const next: Bot = {
      ...current,
      id,
      name: input.name ?? current.name,
      title: input.title ?? current.title,
      description: input.description ?? current.description,
      instructions,
      color: input.color ?? current.color,
      modelProvider:
        input.modelProvider === undefined ? current.modelProvider : input.modelProvider,
      modelId: input.modelId === undefined ? current.modelId : input.modelId,
      thinkingLevel:
        input.thinkingLevel === undefined ? current.thinkingLevel : input.thinkingLevel,
      disabledBuiltinTools: input.disabledBuiltinTools ?? current.disabledBuiltinTools,
      fleetManagement: input.fleetManagement ?? current.fleetManagement,
      createdByBotId:
        input.createdByBotId === undefined ? current.createdByBotId : input.createdByBotId,
      instructionsVersion: current.instructionsVersion + (instructionsChanged ? 1 : 0),
      section: input.section === undefined ? current.section : input.section,
      pinned: input.pinned ?? current.pinned,
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
          fleet_management = @fleetManagement,
          created_by_bot_id = @createdByBotId,
          instructions_version = @instructionsVersion,
          archived_at = @archivedAt,
          section = @section,
          pinned = @pinned,
          updated_at = @updatedAt
        WHERE id = @id`,
      )
      .run({
        ...next,
        fleetManagement: next.fleetManagement ? 1 : 0,
        archivedAt: next.archivedAt ?? null,
        pinned: next.pinned ? 1 : 0,
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
          fleet_management = 0, created_by_bot_id = NULL,
          archived_at = NULL,
          instructions_version = instructions_version + ?,
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
        input.instructions === existing.instructions ? 0 : 1,
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
