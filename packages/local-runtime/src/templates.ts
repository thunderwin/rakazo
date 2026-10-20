import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Bot, LocalDatabase } from "@rakazo/local-db";

export interface BotTemplate {
  key: string;
  version: number;
  name: string;
  title?: string;
  description?: string;
  instructions: string;
  color?: string;
  modelProvider?: string | null;
  modelId?: string | null;
  thinkingLevel?: string | null;
  disabledBuiltinTools?: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Bot template ${field} must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`Bot template ${field} must be a string`);
  return value;
}

function optionalNullableString(value: unknown, field: string): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== "string") throw new Error(`Bot template ${field} must be a string or null`);
  return value;
}

export function parseBotTemplate(value: unknown): BotTemplate {
  if (!isRecord(value)) throw new Error("Bot template must be an object");
  const version = value.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new Error("Bot template version must be a positive integer");
  }
  const disabledBuiltinTools = value.disabledBuiltinTools;
  if (
    disabledBuiltinTools !== undefined &&
    (!Array.isArray(disabledBuiltinTools) ||
      disabledBuiltinTools.some((tool) => typeof tool !== "string"))
  ) {
    throw new Error("Bot template disabledBuiltinTools must be an array of strings");
  }

  return {
    key: requiredString(value.key, "key"),
    version,
    name: requiredString(value.name, "name"),
    title: optionalString(value.title, "title"),
    description: optionalString(value.description, "description"),
    instructions: requiredString(value.instructions, "instructions"),
    color: optionalString(value.color, "color"),
    modelProvider: optionalNullableString(value.modelProvider, "modelProvider"),
    modelId: optionalNullableString(value.modelId, "modelId"),
    thinkingLevel: optionalNullableString(value.thinkingLevel, "thinkingLevel"),
    disabledBuiltinTools: disabledBuiltinTools as string[] | undefined,
  };
}

export async function loadBotTemplatesFromDirectory(directory: string): Promise<BotTemplate[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  });

  const templates: BotTemplate[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".json") continue;
    const file = path.join(directory, entry.name);
    const parsed = JSON.parse(await readFile(file, "utf8")) as unknown;
    try {
      templates.push(parseBotTemplate(parsed));
    } catch (error) {
      throw new Error(`${file}: ${error instanceof Error ? error.message : "invalid template"}`);
    }
  }
  return templates.sort((left, right) => left.key.localeCompare(right.key));
}

/**
 * Create bots for templates that are not present yet. Existing bots are never
 * overwritten, so a user's later edits survive an app update.
 */
export function seedBotTemplates(db: LocalDatabase, templates: BotTemplate[]): Bot[] {
  const keys = new Set<string>();
  for (const template of templates) {
    if (keys.has(template.key)) throw new Error(`Duplicate bot template key: ${template.key}`);
    keys.add(template.key);
  }

  const existing = new Set(
    db.bots
      .list()
      .map((bot) => bot.templateKey)
      .filter((key): key is string => key !== null),
  );
  const created: Bot[] = [];
  for (const template of templates) {
    if (existing.has(template.key)) continue;
    const bot = db.bots.create({
      name: template.name,
      title: template.title,
      description: template.description,
      instructions: template.instructions,
      color: template.color,
      modelProvider: template.modelProvider,
      modelId: template.modelId,
      thinkingLevel: template.thinkingLevel,
      disabledBuiltinTools: template.disabledBuiltinTools,
      templateKey: template.key,
      templateVersion: template.version,
    });
    db.threads.getOrCreateForBot(bot.id);
    created.push(bot);
  }
  return created;
}
