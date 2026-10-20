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
      createdAt: now,
      updatedAt: now,
    };

    this.db
      .prepare(
        `INSERT INTO bots (
          id, name, title, description, instructions, color,
          model_provider, model_id, thinking_level, disabled_builtin_tools,
          template_key, template_version, created_at, updated_at
        ) VALUES (
          @id, @name, @title, @description, @instructions, @color,
          @modelProvider, @modelId, @thinkingLevel, @disabledBuiltinTools,
          @templateKey, @templateVersion, @createdAt, @updatedAt
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
      ...input,
      id,
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
}
