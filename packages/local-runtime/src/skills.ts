import { createHash } from "node:crypto";
import path from "node:path";
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
import type {
  Bot,
  LocalSkill,
  LocalSkillRuntime,
  LocalSkillScript,
  SkillRepository,
} from "@rakazo/local-db";
import type { LocalAgentTool } from "./agent.js";
import { runSkillScript } from "./skill-runtime.js";
import type { LocalTool, LocalToolExecutionRequest, LocalToolProvider } from "./tools.js";

const MAX_SKILL_CONTENT_CHARS = 100_000;
const MAX_SKILL_NAME_CHARS = 80;
const MAX_SKILL_DESCRIPTION_CHARS = 2_000;
const MAX_SKILL_SCRIPTS = 20;
const MAX_SKILL_SCRIPT_CHARS = 200_000;
const MAX_SKILL_SCRIPTS_TOTAL_CHARS = 1_000_000;

export interface LocalSkillScriptInput {
  path: string;
  content: string;
  runtime?: LocalSkillRuntime | null;
  timeoutSeconds?: number;
  network?: boolean;
}

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
        scripts: {
          type: "array",
          description: "Optional script files bundled with the skill.",
          items: {
            type: "object",
            properties: {
              path: { type: "string", description: "Relative path, for example scripts/main.py." },
              content: { type: "string" },
              runtime: { type: ["string", "null"], enum: ["node", "python3", "sh", null] },
              timeoutSeconds: { type: "number" },
              network: { type: "boolean" },
            },
            required: ["path", "content"],
          },
        },
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
        scripts: {
          type: "array",
          description: "Replacement script files for this skill.",
          items: {
            type: "object",
            properties: {
              path: { type: "string" },
              content: { type: "string" },
              runtime: { type: ["string", "null"], enum: ["node", "python3", "sh", null] },
              timeoutSeconds: { type: "number" },
              network: { type: "boolean" },
            },
            required: ["path", "content"],
          },
        },
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

const skillRunTool: LocalAgentTool = {
  name: "skill_run",
  requiresApproval: true,
  description:
    "Run one declared entrypoint from a skill after reading the skill. Entrypoints receive the JSON args in input.json and run in a fresh workspace skill-runs folder. Each call requires user approval.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Exact skill name from the catalog." },
      entrypoint: {
        type: "string",
        description: "Declared script path, for example scripts/main.py.",
      },
      args: {
        type: "object",
        description: "JSON object written to input.json in the run folder.",
      },
    },
    required: ["name", "entrypoint"],
  },
};

export function createLocalSkillRunTool(
  run: (request: LocalToolExecutionRequest) => Promise<unknown>,
): LocalTool {
  return {
    definition: skillRunTool,
    execute: run,
  };
}

export interface LocalSkillView {
  id: string;
  name: string;
  description: string;
  content: string;
  scripts: LocalSkillScript[];
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
    scripts: [],
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
    scripts: skill.scripts,
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

function assertScriptPath(value: string): string {
  const normalized = value.trim().replaceAll("\\", "/");
  if (!normalized || normalized.length > 200) throw new Error("Skill script path is invalid");
  if (
    path.posix.isAbsolute(normalized) ||
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error("Skill script path must stay inside the skill folder");
  }
  if (!/\.(?:js|mjs|cjs|py|sh)$/i.test(normalized)) {
    throw new Error("Skill script must use a .js, .mjs, .cjs, .py, or .sh extension");
  }
  return normalized;
}

function runtimeForPath(value: string): LocalSkillRuntime | null {
  if (/\.(?:js|mjs|cjs)$/i.test(value)) return "node";
  if (/\.py$/i.test(value)) return "python3";
  if (/\.sh$/i.test(value)) return "sh";
  return null;
}

function normalizeScripts(input: readonly LocalSkillScriptInput[] | undefined): LocalSkillScript[] {
  const scripts = input ?? [];
  if (scripts.length > MAX_SKILL_SCRIPTS) throw new Error("A skill can have at most 20 scripts");
  const paths = new Set<string>();
  let totalChars = 0;
  return scripts.map((script) => {
    const scriptPath = assertScriptPath(script.path);
    if (paths.has(scriptPath)) throw new Error(`Duplicate skill script path: ${scriptPath}`);
    paths.add(scriptPath);
    if (typeof script.content !== "string" || script.content.length > MAX_SKILL_SCRIPT_CHARS) {
      throw new Error(`Skill script ${scriptPath} is too large`);
    }
    totalChars += script.content.length;
    if (totalChars > MAX_SKILL_SCRIPTS_TOTAL_CHARS) {
      throw new Error("Skill scripts are too large");
    }
    const inferred = runtimeForPath(scriptPath);
    const runtime = script.runtime === undefined ? inferred : script.runtime;
    if (runtime !== null && runtime !== inferred) {
      throw new Error(`Skill script ${scriptPath} does not match runtime ${runtime}`);
    }
    return {
      path: scriptPath,
      content: script.content,
      runtime,
      timeoutSeconds: Math.min(120, Math.max(1, Math.trunc(script.timeoutSeconds ?? 60))),
      network: script.network === true,
      sha256: createHash("sha256").update(script.content, "utf8").digest("hex"),
    };
  });
}

function scriptSummary(scripts: readonly LocalSkillScript[]): string[] {
  return scripts
    .filter((script) => script.runtime)
    .map(
      (script) =>
        `  - ${script.path} (${script.runtime}, ${script.timeoutSeconds}s, network ${script.network ? "on" : "off"})`,
    );
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
    scripts?: LocalSkillScriptInput[];
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
    return storedView(
      this.repository.create({
        name,
        description,
        content,
        scripts: normalizeScripts(input.scripts),
      }),
    );
  }

  update(
    name: string,
    input: {
      newName?: string;
      description?: string;
      body?: string;
      content?: string;
      scripts?: LocalSkillScriptInput[];
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
      scripts: input.scripts === undefined ? existing.scripts : normalizeScripts(input.scripts),
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

  replaceManaged(input: {
    packageId: string;
    version: number;
    skills: Array<{
      key: string;
      name: string;
      description: string;
      content: string;
      scripts?: LocalSkillScriptInput[];
    }>;
  }): void {
    this.repository.replaceManaged({
      ...input,
      skills: input.skills.map((skill) => ({
        ...skill,
        scripts: normalizeScripts(skill.scripts),
      })),
    });
  }

  expandPrompt(prompt: string): string {
    return expandSkillReferencesInPrompt(
      prompt,
      this.list() as Array<SkillRecord & { id: string }>,
    );
  }

  catalogInstruction(): string | undefined {
    const base = formatSkillsCatalogInstruction(this.list());
    if (!base) return undefined;
    const scripts = this.list().flatMap((skill) =>
      scriptSummary(skill.scripts).map((line) => `- ${skill.name}\n${line}`),
    );
    return scripts.length
      ? `${base}\n\nRunnable skill entrypoints (call skill_run after skill_read):\n${scripts.join("\n")}`
      : base;
  }

  run(input: {
    name: string;
    entrypoint: string;
    args: unknown;
    workspaceDir: string;
    environment?: Record<string, string>;
    signal?: AbortSignal;
  }) {
    const skill = this.findByName(input.name);
    if (!skill) throw new Error("Skill not found");
    return runSkillScript({
      skillName: skill.name,
      scripts: skill.scripts,
      entrypoint: input.entrypoint,
      args: input.args,
      workspaceDir: input.workspaceDir,
      environment: input.environment,
      signal: input.signal,
    });
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

  async definitionsFor(bot: Bot): Promise<LocalAgentTool[]> {
    const disabled = new Set(bot.disabledBuiltinTools);
    return [
      ...(await this.tools.definitionsFor(bot)).filter(
        (tool) => !skillTools.some((candidate) => candidate.name === tool.name),
      ),
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
            scripts: skill.scripts.map(({ content: _content, ...script }) => script),
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
        ...(Array.isArray(request.args.scripts)
          ? { scripts: request.args.scripts as LocalSkillScriptInput[] }
          : {}),
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
        ...(Array.isArray(request.args.scripts)
          ? { scripts: request.args.scripts as LocalSkillScriptInput[] }
          : {}),
      });
    }
    if (request.name === "skill_delete") {
      const name = typeof request.args.name === "string" ? request.args.name : "";
      return { ok: this.skills.remove(name) };
    }
    return this.tools.execute(request);
  }
}
