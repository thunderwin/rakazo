import {
  BUILTIN_AGENT_SKILLS,
  buildSkillMd,
  expandSkillReferencesInPrompt,
  findSkillByName,
  formatSkillsCatalogInstruction,
  isSkillReadOnly,
  parseSkillMd,
  type SkillRecord,
  type SkillSource,
} from "@rakazo/core";
import type { Bot, LocalSkill, SkillRepository } from "@rakazo/local-db";
import type { LocalAgentTool } from "./agent.js";
import type { LocalToolExecutionRequest, LocalToolProvider } from "./tools.js";

const MAX_SKILL_CONTENT_CHARS = 100_000;
const MAX_SKILL_NAME_CHARS = 80;
const MAX_SKILL_DESCRIPTION_CHARS = 2_000;

const skillTools: LocalAgentTool[] = [
  {
    name: "skill_read",
    readOnly: true,
    requiresApproval: false,
    description:
      "Load a Claude Agent Skill (SKILL.md recipe) by exact name. Call this when a catalog skill matches the user's request, then follow it immediately.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Exact skill name from the catalog." } },
      required: ["name"],
    },
  },
  {
    name: "skill_create",
    requiresApproval: false,
    description:
      "Create a reusable Claude Agent Skill (generic how-to SKILL.md) shared across assistants. Use when a multi-step task is worth repeating or the user asks to save a skill.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short skill name." },
        description: { type: "string", description: "When the skill should be used." },
        body: { type: "string", description: "Markdown steps and guidance." },
        content: { type: "string", description: "Optional complete SKILL.md content." },
      },
    },
  },
  {
    name: "skill_update",
    requiresApproval: false,
    description: "Update one user-created skill. Built-in and managed skills are read-only.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Current exact skill name." },
        newName: { type: "string" },
        description: { type: "string" },
        body: { type: "string" },
        content: { type: "string" },
      },
      required: ["name"],
    },
  },
  {
    name: "skill_delete",
    requiresApproval: false,
    description: "Delete one user-created skill by exact name.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
  },
];

export interface LocalSkillView {
  id: string;
  name: string;
  description: string;
  content: string;
  source: SkillSource;
  readOnly: boolean;
  createdAt: string;
  updatedAt: string;
}

function builtinViews(): LocalSkillView[] {
  const now = new Date(0).toISOString();
  return BUILTIN_AGENT_SKILLS.map((skill) => ({
    id: `builtin:${skill.name}`,
    name: skill.name,
    description: skill.description,
    content: skill.content,
    source: "builtin",
    readOnly: true,
    createdAt: now,
    updatedAt: now,
  }));
}

function storedView(skill: LocalSkill): LocalSkillView {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    content: skill.content,
    source: skill.source,
    readOnly: isSkillReadOnly(skill.source),
    createdAt: skill.createdAt,
    updatedAt: skill.updatedAt,
  };
}

function assertFields(name: string, description: string): void {
  if (!name) throw new Error("Skill name is required");
  if (!description) throw new Error("Skill description is required");
  if (name.length > MAX_SKILL_NAME_CHARS) throw new Error("Skill name is too long");
  if (description.length > MAX_SKILL_DESCRIPTION_CHARS) {
    throw new Error("Skill description is too long");
  }
}

export class LocalSkills implements LocalSkillCatalog {
  constructor(private readonly repository: SkillRepository) {}

  list(): LocalSkillView[] {
    const stored = this.repository.list().map(storedView);
    return [
      ...builtinViews().filter((builtin) => !findSkillByName(stored, builtin.name)),
      ...stored,
    ];
  }

  get(id: string): LocalSkillView | null {
    return this.list().find((skill) => skill.id === id) ?? null;
  }

  findByName(name: string): LocalSkillView | null {
    return findSkillByName(this.list(), name) ?? null;
  }

  create(input: {
    name?: string;
    description?: string;
    body?: string;
    content?: string;
  }): LocalSkillView {
    let name = input.name?.trim() ?? "";
    let description = input.description?.trim() ?? "";
    let content = "";
    if (input.content?.trim()) {
      const parsed = parseSkillMd(input.content);
      if ("error" in parsed) throw new Error(parsed.error);
      name = parsed.name;
      description = parsed.description;
      content = buildSkillMd(parsed);
    } else {
      assertFields(name, description);
      content = buildSkillMd({ name, description, body: input.body?.trim() ?? "" });
    }
    assertFields(name, description);
    if (content.length > MAX_SKILL_CONTENT_CHARS) throw new Error("Skill content is too large");
    if (this.findByName(name)) throw new Error(`A skill named "${name}" already exists`);
    return storedView(this.repository.create({ name, description, content }));
  }

  update(
    name: string,
    input: {
      newName?: string;
      description?: string;
      body?: string;
      content?: string;
    },
  ): LocalSkillView {
    const existing = this.findByName(name);
    if (!existing) throw new Error("Skill not found");
    if (existing.readOnly || existing.source !== "user") {
      throw new Error("Built-in and managed skills are read-only");
    }
    const prior = parseSkillMd(existing.content);
    if ("error" in prior) throw new Error(prior.error);
    let nextName = input.newName?.trim() || existing.name;
    let nextDescription = input.description?.trim() ?? existing.description;
    let nextContent = existing.content;
    if (input.content?.trim()) {
      const parsed = parseSkillMd(input.content);
      if ("error" in parsed) throw new Error(parsed.error);
      nextName = parsed.name;
      nextDescription = parsed.description;
      nextContent = buildSkillMd(parsed);
    } else {
      nextContent = buildSkillMd({
        name: nextName,
        description: nextDescription,
        body: input.body ?? prior.body,
        frontmatter: prior.frontmatter,
      });
    }
    assertFields(nextName, nextDescription);
    if (nextContent.length > MAX_SKILL_CONTENT_CHARS) throw new Error("Skill content is too large");
    const clash = this.findByName(nextName);
    if (clash && clash.id !== existing.id) {
      throw new Error(`A skill named "${nextName}" already exists`);
    }
    const updated = this.repository.update(existing.id, {
      name: nextName,
      description: nextDescription,
      content: nextContent,
    });
    if (!updated) throw new Error("Could not update skill");
    return storedView(updated);
  }

  remove(name: string): boolean {
    const existing = this.findByName(name);
    if (!existing) return false;
    if (existing.readOnly || existing.source !== "user") {
      throw new Error("Built-in and managed skills are read-only");
    }
    return this.repository.remove(existing.id);
  }

  expandPrompt(prompt: string): string {
    return expandSkillReferencesInPrompt(
      prompt,
      this.list() as Array<SkillRecord & { id: string }>,
    );
  }

  catalogInstruction(): string | undefined {
    return formatSkillsCatalogInstruction(this.list());
  }
}

export interface LocalSkillCatalog {
  expandPrompt(prompt: string): string;
  catalogInstruction(): string | undefined;
}

export class LocalSkillToolProvider implements LocalToolProvider {
  constructor(
    private readonly tools: LocalToolProvider,
    private readonly skills: LocalSkills,
  ) {}

  definitionsFor(bot: Bot): LocalAgentTool[] {
    const disabled = new Set(bot.disabledBuiltinTools);
    return [
      ...this.tools
        .definitionsFor(bot)
        .filter((tool) => !skillTools.some((candidate) => candidate.name === tool.name)),
      ...skillTools.filter((tool) => !disabled.has(tool.name)),
    ];
  }

  async execute(request: LocalToolExecutionRequest): Promise<unknown> {
    if (request.name === "skill_read") {
      const name = typeof request.args.name === "string" ? request.args.name : "";
      const skill = this.skills.findByName(name);
      return skill
        ? {
            name: skill.name,
            description: skill.description,
            source: skill.source,
            readOnly: skill.readOnly,
            content: skill.content,
          }
        : { error: "Skill not found." };
    }
    if (request.name === "skill_create") {
      return this.skills.create({
        ...(typeof request.args.name === "string" ? { name: request.args.name } : {}),
        ...(typeof request.args.description === "string"
          ? { description: request.args.description }
          : {}),
        ...(typeof request.args.body === "string" ? { body: request.args.body } : {}),
        ...(typeof request.args.content === "string" ? { content: request.args.content } : {}),
      });
    }
    if (request.name === "skill_update") {
      const name = typeof request.args.name === "string" ? request.args.name : "";
      return this.skills.update(name, {
        ...(typeof request.args.newName === "string" ? { newName: request.args.newName } : {}),
        ...(typeof request.args.description === "string"
          ? { description: request.args.description }
          : {}),
        ...(typeof request.args.body === "string" ? { body: request.args.body } : {}),
        ...(typeof request.args.content === "string" ? { content: request.args.content } : {}),
      });
    }
    if (request.name === "skill_delete") {
      const name = typeof request.args.name === "string" ? request.args.name : "";
      return { ok: this.skills.remove(name) };
    }
    return this.tools.execute(request);
  }
}
