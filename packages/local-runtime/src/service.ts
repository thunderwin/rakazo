import path from "node:path";
import {
  type ClientManifestEnvelope,
  TICKET_COMMENT_MAX_LENGTH,
  TICKET_DESCRIPTION_MAX_LENGTH,
  TICKET_TITLE_MAX_LENGTH,
} from "@rakazo/contracts";
import { isOneShotRoutineCron, nextCronDate } from "@rakazo/core";
import {
  type Bot,
  type CreateBotInput,
  type JsonValue,
  type LocalDatabase,
  openLocalDatabase,
} from "@rakazo/local-db";
import { RecordingToolProvider } from "./activity-tools.js";
import type {
  LocalAgentEngine,
  LocalAgentModel,
  LocalAgentRunContext,
} from "./agent.js";
import {
  type LocalArtifactInput,
  LocalAttachmentStore,
} from "./attachments.js";
import { LocalGroupRuntime } from "./group-runtime.js";
import { LocalHistoryToolProvider } from "./history-tools.js";
import { LocalKnowledge, LocalKnowledgeToolProvider } from "./knowledge.js";
import {
  type ConnectLocalMcp,
  LocalMcpService,
  LocalMcpToolProvider,
} from "./mcp.js";
import { LocalMemory, LocalMemoryToolProvider } from "./memory.js";
import type { PeerBotMessageRequest } from "./message-bot-tool.js";
import {
  type LocalRoutineInput,
  LocalRoutineRuntime,
  LocalRoutineToolProvider,
  type LocalRoutineUpdate,
} from "./routines.js";
import { LocalRuntime, type SendMessageResult } from "./runtime.js";
import {
  type LocalSecretHttp,
  LocalSecrets,
  type LocalSecretVault,
  type PromptForLocalSecret,
} from "./secrets.js";
import { type LocalUserSettings, parseLocalUserSettings } from "./settings.js";
import {
  type LocalSkillScriptInput,
  LocalSkills,
  LocalSkillToolProvider,
} from "./skills.js";
import { SqliteConversationStore } from "./store.js";
import { LocalToolPolicyProvider } from "./tool-policy.js";
import type {
  ApproveLocalTool,
  LocalToolExecutionRequest,
  LocalToolProvider,
} from "./tools.js";
import { LocalWorkToolProvider } from "./work-tools.js";

export interface LocalRuntimeServiceOptions {
  databasePath: string;
  workspaceDir?: string;
  engine: LocalAgentEngine;
  tools: LocalToolProvider;
  resolveModel: (bot: Bot) => Promise<LocalAgentModel> | LocalAgentModel;
  onRunStart?: ConstructorParameters<typeof LocalRuntime>[0]["onRunStart"];
  onEvent?: ConstructorParameters<typeof LocalRuntime>[0]["onEvent"];
  onRunEnd?: ConstructorParameters<typeof LocalRuntime>[0]["onRunEnd"];
  secretVault?: LocalSecretVault;
  secretHttp?: LocalSecretHttp;
  promptForSecret?: PromptForLocalSecret;
  allowPrivateHttpSecretOrigins?: boolean;
  promptForUserChoice?: (
    question: string,
    options: string[],
    signal?: AbortSignal,
  ) => Promise<string | null>;
  mcpConnector?: ConnectLocalMcp;
  approveTool?: ApproveLocalTool;
}

/** Owns the local DB and runtime for one desktop process. */
export class LocalRuntimeService {
  readonly db: LocalDatabase;
  readonly runtime: LocalRuntime;
  readonly memory: LocalMemory;
  readonly attachments: LocalAttachmentStore;
  readonly knowledge: LocalKnowledge;
  readonly skills: LocalSkills;
  readonly secrets?: LocalSecrets;
  readonly mcp?: LocalMcpService;
  private readonly routines: LocalRoutineRuntime;
  private readonly groups: LocalGroupRuntime;
  private readonly workspaceDir: string;
  private readonly promptForUserChoice?: LocalRuntimeServiceOptions["promptForUserChoice"];

  constructor(options: LocalRuntimeServiceOptions) {
    this.workspaceDir =
      options.workspaceDir ??
      path.join(path.dirname(options.databasePath), "workspace");
    this.promptForUserChoice = options.promptForUserChoice;
    this.db = openLocalDatabase(options.databasePath);
    this.memory = new LocalMemory(this.db.memory);
    this.attachments = new LocalAttachmentStore(this.db.artifacts);
    this.knowledge = new LocalKnowledge(this.db.knowledge);
    this.skills = new LocalSkills(this.db.skills);
    this.secrets =
      options.secretVault && options.secretHttp
        ? new LocalSecrets({
            vault: options.secretVault,
            request: options.secretHttp,
            ...(options.promptForSecret
              ? { prompt: options.promptForSecret }
              : {}),
            allowPrivateHttpOrigin:
              options.allowPrivateHttpSecretOrigins === true,
          })
        : undefined;
    this.mcp =
      options.secretVault && options.mcpConnector
        ? new LocalMcpService(
            this.db.mcpServers,
            this.db,
            options.secretVault,
            options.mcpConnector,
          )
        : undefined;
    const baseProvider = new LocalKnowledgeToolProvider(
      new LocalHistoryToolProvider(
        new LocalSkillToolProvider(
          new LocalRoutineToolProvider(
            new LocalMemoryToolProvider(options.tools, this.memory),
            () => this.routines,
          ),
          this.skills,
        ),
        this.db,
      ),
      this.knowledge,
    );
    const withMcp = this.mcp
      ? new LocalMcpToolProvider(
          baseProvider,
          this.mcp,
          options.approveTool ?? (() => false),
        )
      : baseProvider;
    const provider = new LocalWorkToolProvider(
      withMcp,
      this.db,
      options.approveTool ?? (() => false),
    );
    const tools = new LocalToolPolicyProvider(
      new RecordingToolProvider(provider, this.db.runs),
      () => this.getManagedDisabledTools(),
      (botId) => this.db.bots.get(botId),
    );
    const onRunStart = async (run: {
      runId: string;
      botId: string;
      threadId: string;
      userMessageId: string;
    }) => {
      const groupThread = this.db.groupThreads.get(run.threadId);
      this.db.runs.start({
        id: run.runId,
        kind: groupThread ? "group" : "direct",
        botId: run.botId,
        threadId: run.threadId,
        ...(groupThread ? { groupId: groupThread.groupId } : {}),
      });
      try {
        await options.onRunStart?.(run);
      } catch (error) {
        this.db.runs.finish(
          run.runId,
          "failed",
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      }
    };
    const onRunEnd = async (run: {
      runId: string;
      status: "completed" | "failed" | "stopped";
      error: string | null;
    }) => {
      this.db.runs.finish(run.runId, run.status, run.error);
      await options.onRunEnd?.(run);
    };
    this.runtime = new LocalRuntime({
      store: new SqliteConversationStore(this.db),
      engine: options.engine,
      tools,
      memory: this.memory,
      skills: this.skills,
      resolveModel: options.resolveModel,
      onRunStart,
      onEvent: options.onEvent,
      onRunEnd,
    });
    this.groups = new LocalGroupRuntime({
      db: this.db,
      engine: options.engine,
      tools,
      skills: this.skills,
      resolveModel: options.resolveModel,
      onRunStart,
      onEvent: options.onEvent,
      onRunEnd,
    });
    this.routines = new LocalRoutineRuntime({
      db: this.db,
      runtime: this.runtime,
    });
  }

  listBots(): Bot[] {
    return this.db.bots.listActive();
  }

  listArchivedBots(): Bot[] {
    return this.db.bots.listArchived();
  }

  restoreBot(botId: string): Bot {
    const bot = this.db.bots.get(botId);
    if (!bot?.archivedAt) throw new Error("Archived bot not found");
    return this.db.bots.restore(botId)!;
  }

  deleteArchivedBot(botId: string): boolean {
    return this.db.bots.deleteArchived(botId);
  }

  createBot(input: CreateBotInput): Bot {
    return this.runtime.createBot(input);
  }

  listMessages(botId: string) {
    const bot = this.db.bots.get(botId);
    if (!bot) return [];
    const thread = this.db.threads.getForBot(bot.id);
    return thread ? this.db.messages.list(thread.id) : [];
  }

  listGroups() {
    return this.groups.listGroups();
  }

  createGroup(input: {
    name: string;
    description?: string;
    color?: string;
    botIds: string[];
  }) {
    return this.groups.createGroup(input);
  }

  updateGroup(
    groupId: string,
    input: {
      name?: string;
      description?: string;
      color?: string;
      botIds?: string[];
    },
  ) {
    return this.groups.updateGroup(groupId, input);
  }

  removeGroup(groupId: string) {
    return this.groups.removeGroup(groupId);
  }

  listGroupMessages(groupId: string) {
    return this.groups.listMessages(groupId);
  }

  async sendGroupMessage(
    groupId: string,
    text: string,
    options: LocalAgentRunContext = {},
    artifactIds: string[] = [],
  ) {
    return this.groups.sendMessage(
      groupId,
      text,
      options,
      this.attachments.resolveForGroup(groupId, artifactIds),
    );
  }

  cancelGroup(groupId: string) {
    return this.groups.cancel(groupId);
  }

  listActivity(limit = 30) {
    return this.db.runs.listRecent(limit);
  }

  listMemory(input: { scope?: "bot" | "user"; botId?: string } = {}) {
    return this.memory.list(input);
  }

  updateMemory(documentId: string, content: string, expectedRevision?: number) {
    return this.memory.update(documentId, content, expectedRevision);
  }

  removeMemory(documentId: string) {
    return this.memory.remove(documentId);
  }

  forgetMemoryForTool(documentId: string, botId?: string) {
    const document = this.memory.get(documentId);
    if (!document) return { error: "Memory document not found." };
    if (botId && document.scope === "bot" && document.botId !== botId) {
      return { error: "Memory document not found." };
    }
    return { removed: this.memory.remove(documentId) };
  }

  createArtifact(input: LocalArtifactInput) {
    return this.attachments.create(input);
  }

  listArtifacts(
    input: {
      botId?: string;
      groupId?: string;
      limit?: number;
      cursor?: string;
    } = {},
  ) {
    return this.db.artifacts.list(input);
  }

  readArtifact(id: string) {
    return this.attachments.read(id);
  }

  removeArtifact(id: string) {
    if (!this.db.artifacts.remove(id)) throw new Error("Artifact not found");
  }

  listScratchpad(botId: string, includeDone = false) {
    this.requireBot(botId);
    return this.db.work.listScratchpad(botId, includeDone);
  }

  createScratchpad(
    botId: string,
    input: {
      title: string;
      status?: "open" | "parked" | "done";
      notes?: string;
    },
  ) {
    this.requireBot(botId);
    const title = input.title.trim();
    if (!title || title.length > 500)
      throw new Error("Scratchpad title is invalid");
    return this.db.work.addScratchpad({ ...input, botId, title });
  }

  updateScratchpad(
    botId: string,
    itemId: string,
    input: {
      title?: string;
      status?: "open" | "parked" | "done";
      notes?: string;
    },
  ) {
    if (input.title !== undefined) {
      const title = input.title.trim();
      if (!title || title.length > 500) {
        throw new Error("Scratchpad title is invalid");
      }
      input = { ...input, title };
    }
    const item = this.db.work.updateScratchpad(itemId, botId, input);
    if (!item) throw new Error("Scratchpad item not found");
    return item;
  }

  removeScratchpad(botId: string, itemId: string) {
    if (!this.db.work.removeScratchpad(itemId, botId)) {
      throw new Error("Scratchpad item not found");
    }
  }

  listTickets(input: Parameters<LocalDatabase["work"]["listTickets"]>[0] = {}) {
    return this.db.work.listTickets(input);
  }

  listTicketComments(ticketId: string) {
    return this.db.work.getTicket(ticketId)?.comments ?? [];
  }

  createTicket(input: Parameters<LocalDatabase["work"]["createTicket"]>[0]) {
    this.requireBot(input.botId);
    if (input.ownerBotId) this.requireBot(input.ownerBotId);
    const title = input.title.trim();
    if (!title || title.length > TICKET_TITLE_MAX_LENGTH) {
      throw new Error("Ticket title is invalid");
    }
    if ((input.description?.length ?? 0) > TICKET_DESCRIPTION_MAX_LENGTH) {
      throw new Error("Ticket description is invalid");
    }
    return this.db.work.createTicket({ ...input, title });
  }

  updateTicket(
    ticketId: string,
    input: Parameters<LocalDatabase["work"]["updateTicket"]>[1],
  ) {
    if (input.ownerBotId) this.requireBot(input.ownerBotId);
    if (input.title !== undefined) {
      const title = input.title.trim();
      if (!title || title.length > TICKET_TITLE_MAX_LENGTH) {
        throw new Error("Ticket title is invalid");
      }
      input = { ...input, title };
    }
    if ((input.description?.length ?? 0) > TICKET_DESCRIPTION_MAX_LENGTH) {
      throw new Error("Ticket description is invalid");
    }
    const ticket = this.db.work.updateTicket(ticketId, input);
    if (!ticket) throw new Error("Ticket not found");
    return ticket;
  }

  commentOnTicket(ticketId: string, botId: string, body: string) {
    this.requireBot(botId);
    const normalizedBody = body.trim();
    if (!normalizedBody || normalizedBody.length > TICKET_COMMENT_MAX_LENGTH) {
      throw new Error("Ticket comment is invalid");
    }
    const comment = this.db.work.addComment(ticketId, botId, normalizedBody);
    if (!comment) throw new Error("Ticket not found");
    return comment;
  }

  listKnowledge() {
    return this.knowledge.list();
  }

  createKnowledge(input: { title: string; content: string }) {
    return this.knowledge.create(input);
  }

  updateKnowledge(id: string, input: { title?: string; content?: string }) {
    return this.knowledge.update(id, input);
  }

  removeKnowledge(id: string) {
    return this.knowledge.remove(id);
  }

  listSkills() {
    return this.skills.list();
  }

  createSkill(input: {
    name?: string;
    description?: string;
    body?: string;
    content?: string;
    scripts?: LocalSkillScriptInput[];
  }) {
    return this.skills.create(input);
  }

  updateSkill(
    name: string,
    input: {
      newName?: string;
      description?: string;
      body?: string;
      content?: string;
      scripts?: LocalSkillScriptInput[];
    },
  ) {
    return this.skills.update(name, input);
  }

  removeSkill(name: string) {
    return this.skills.remove(name);
  }

  async runSkill(input: {
    botId: string;
    name: string;
    entrypoint: string;
    args: unknown;
    signal?: AbortSignal;
  }) {
    return this.skills.run({
      ...input,
      workspaceDir: this.workspaceDir,
      environment: this.secrets
        ? await this.secrets.commandEnvironment(input.botId)
        : {},
    });
  }

  listSecrets(botId: string) {
    if (!this.secrets) throw new Error("Credential storage is unavailable");
    return this.secrets.list(botId);
  }

  putSecret(botId: string, input: Parameters<LocalSecrets["put"]>[1]) {
    if (!this.secrets) throw new Error("Credential storage is unavailable");
    return this.secrets.put(botId, input);
  }

  removeSecret(botId: string, name: string) {
    if (!this.secrets) throw new Error("Credential storage is unavailable");
    return this.secrets.remove(botId, name);
  }

  requestSecret(
    botId: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ) {
    if (!this.secrets) throw new Error("Credential storage is unavailable");
    return this.secrets.request(botId, args, signal);
  }

  requestSecretFromUser(
    botId: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ) {
    if (!this.secrets) throw new Error("Credential storage is unavailable");
    return this.secrets.requestFromUser(botId, args, signal);
  }

  askUser(question: string, options: string[], signal?: AbortSignal) {
    if (!this.promptForUserChoice)
      throw new Error("User questions are unavailable");
    return this.promptForUserChoice(question, options, signal);
  }

  postUserMessage(request: LocalToolExecutionRequest, text: string) {
    if (!request.threadId || !request.botId) {
      throw new Error("User messages need a bot and thread");
    }
    const group = this.db.groupThreads.get(request.threadId);
    if (group) {
      this.db.groupMessages.append({
        threadId: request.threadId,
        role: "bot",
        botId: request.botId,
        blocks: [{ kind: "text", text }],
      });
    } else {
      this.db.messages.append({
        threadId: request.threadId,
        role: "bot",
        blocks: [{ kind: "text", text }],
      });
    }
    return { ok: true };
  }

  proposeInstructions(input: {
    botId: string;
    instructions: string;
    reason: string;
    expectedVersion?: number;
  }) {
    const bot = this.db.bots.get(input.botId);
    if (!bot || bot.archivedAt) throw new Error("Bot not found");
    if (bot.source === "managed") {
      throw new Error(
        "Managed bot instructions must be changed in the enterprise manifest",
      );
    }
    if (
      input.expectedVersion !== undefined &&
      bot.instructionsVersion !== input.expectedVersion
    ) {
      throw new Error("Instructions changed since they were read");
    }
    const instructions = input.instructions.trim();
    const reason = input.reason.trim();
    if (!instructions || instructions.length > 40_000) {
      throw new Error("instructions is invalid");
    }
    if (!reason || reason.length > 500) throw new Error("reason is invalid");
    if (instructions === bot.instructions) return { ok: true, unchanged: true };
    const version = this.db.instructionVersions.create({
      botId: bot.id,
      before: bot.instructions,
      after: instructions,
      reason,
    });
    const updated = this.db.bots.update(bot.id, { instructions })!;
    return {
      ok: true,
      instructionsVersion: updated.instructionsVersion,
      versionId: version.id,
    };
  }

  addMcpServer(botId: string, args: Record<string, unknown>) {
    if (!this.mcp) throw new Error("MCP support is unavailable");
    return this.mcp.add(botId, args);
  }

  applyClientManifest(manifest: ClientManifestEnvelope) {
    const previous = this.getManagedManifestState();
    if (previous && previous.organizationId !== manifest.organization.id) {
      this.clearManagedResources(previous.organizationId);
    }
    const botByKey = new Map<string, string>();
    for (const template of manifest.content.botTemplates) {
      const bot = this.db.bots.upsertManaged({
        organizationId: manifest.organization.id,
        key: template.key,
        packageVersion: manifest.version,
        name: template.name,
        title: template.title,
        description: template.description,
        instructions: template.instructions,
        color: template.color,
        modelId: template.modelId,
        thinkingLevel: template.thinkingLevel,
        disabledBuiltinTools: template.disabledBuiltinTools,
      });
      this.db.threads.getOrCreateForBot(bot.id);
      botByKey.set(template.key, bot.id);
    }
    const groupKeys: string[] = [];
    for (const preset of manifest.content.groupPresets) {
      const botIds = preset.botKeys.map((key) => botByKey.get(key));
      if (botIds.some((id) => !id)) {
        throw new Error(
          `Group preset ${preset.key} references an unknown bot template`,
        );
      }
      this.db.groups.upsertManaged({
        organizationId: manifest.organization.id,
        key: preset.key,
        packageVersion: manifest.version,
        name: preset.name,
        description: preset.description,
        color: preset.color,
        botIds: botIds as string[],
      });
      groupKeys.push(preset.key);
    }
    const now = new Date();
    const routineKeys: string[] = [];
    for (const preset of manifest.content.routines) {
      const botId = botByKey.get(preset.botKey);
      if (!botId) {
        throw new Error(
          `Routine preset ${preset.key} references an unknown bot template`,
        );
      }
      if (isOneShotRoutineCron(preset.cron)) {
        throw new Error(
          `Managed routine ${preset.key} cannot use a one-time schedule`,
        );
      }
      let nextRunAt: string | null = null;
      try {
        nextRunAt = nextCronDate(
          preset.cron,
          now,
          preset.timezone,
        ).toISOString();
      } catch {
        throw new Error(
          `Routine preset ${preset.key} has an invalid cron or timezone`,
        );
      }
      this.db.routines.upsertManaged({
        organizationId: manifest.organization.id,
        packageId: `${manifest.organization.id}:${manifest.version}`,
        version: manifest.version,
        key: preset.key,
        botId,
        name: preset.name,
        prompt: preset.prompt,
        cron: preset.cron,
        timezone: preset.timezone,
        enabled: preset.enabled,
        nextRunAt: preset.enabled ? nextRunAt : null,
      });
      routineKeys.push(preset.key);
    }
    this.db.groups.deleteManagedExcept(manifest.organization.id, groupKeys);
    this.db.routines.deleteManagedExcept(manifest.organization.id, routineKeys);
    this.db.bots.deleteManagedExcept(manifest.organization.id, [
      ...botByKey.keys(),
    ]);
    const packageId = `${manifest.organization.id}:${manifest.version}`;
    this.db.knowledge.replaceManaged({
      packageId,
      version: manifest.version,
      documents: manifest.content.knowledge.map((document) => ({
        key: `${manifest.organization.id}:${document.key}`,
        title: document.title,
        content: document.content,
      })),
    });
    this.skills.replaceManaged({
      packageId,
      version: manifest.version,
      skills: manifest.content.skills.map((skill) => ({
        key: `${manifest.organization.id}:${skill.key}`,
        name: skill.name,
        description: skill.description,
        content: skill.content,
        scripts: skill.scripts,
      })),
    });
    const state = {
      organizationId: manifest.organization.id,
      organizationName: manifest.organization.name,
      version: manifest.version,
      hash: manifest.hash,
      publishedAt: manifest.publishedAt,
    };
    this.db.settings.set("managed.client-manifest", state);
    this.db.settings.set(
      "managed.disabled-tools",
      manifest.content.featurePolicy.disabledTools,
    );
    return state;
  }

  clearManagedManifest(): boolean {
    const current = this.getManagedManifestState();
    if (!current) return false;
    this.clearManagedResources(current.organizationId);
    this.db.knowledge.replaceManaged({
      packageId: current.organizationId,
      version: 0,
      documents: [],
    });
    this.skills.replaceManaged({
      packageId: current.organizationId,
      version: 0,
      skills: [],
    });
    this.db.settings.set("managed.client-manifest", null);
    this.db.settings.set("managed.disabled-tools", []);
    return true;
  }

  getManagedDisabledTools(): string[] {
    const value = this.db.settings.get("managed.disabled-tools");
    return Array.isArray(value)
      ? [
          ...new Set(
            value.filter((entry): entry is string => typeof entry === "string"),
          ),
        ]
      : [];
  }

  getManagedManifestState(): {
    organizationId: string;
    organizationName: string;
    version: number;
    hash: string;
    publishedAt: string;
  } | null {
    const value = this.db.settings.get("managed.client-manifest");
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      typeof value.organizationId !== "string" ||
      typeof value.organizationName !== "string" ||
      typeof value.version !== "number" ||
      typeof value.hash !== "string" ||
      typeof value.publishedAt !== "string"
    ) {
      return null;
    }
    return value as {
      organizationId: string;
      organizationName: string;
      version: number;
      hash: string;
      publishedAt: string;
    };
  }

  private clearManagedResources(organizationId: string) {
    this.db.routines.deleteManagedExcept(organizationId, []);
    this.db.groups.deleteManagedExcept(organizationId, []);
    this.db.bots.deleteManagedExcept(organizationId, []);
  }

  private requireBot(botId: string): Bot {
    const bot = this.db.bots.get(botId);
    if (!bot || bot.archivedAt) throw new Error("Bot not found");
    return bot;
  }

  startRoutineScheduler() {
    this.routines.start();
  }

  listRoutines(botId: string) {
    return this.routines.list(botId);
  }

  createRoutine(botId: string, input: LocalRoutineInput) {
    return this.routines.create(botId, input);
  }

  updateRoutine(routineId: string, input: LocalRoutineUpdate) {
    return this.routines.update(routineId, input);
  }

  removeRoutine(routineId: string) {
    return this.routines.remove(routineId);
  }

  runRoutineNow(routineId: string) {
    return this.routines.runNow(routineId);
  }

  listRoutineRuns(routineId: string, limit?: number) {
    return this.routines.history(routineId, limit);
  }

  async sendMessage(
    botId: string,
    text: string,
    options: LocalAgentRunContext = {},
    artifactIds: string[] = [],
  ): Promise<SendMessageResult> {
    return this.runtime.sendMessage(
      botId,
      text,
      options,
      this.attachments.resolveForBot(botId, artifactIds),
    );
  }

  abort(runId: string): Promise<void> {
    return this.runtime.abort(runId);
  }

  async sendPeerMessage(input: PeerBotMessageRequest): Promise<string> {
    const source = this.db.bots.get(input.fromBotId);
    if (!source || source.archivedAt) throw new Error("Source bot not found");
    const target = input.botId
      ? this.db.bots.get(input.botId)
      : input.confirmName
        ? this.db.bots
            .listActive()
            .filter((bot) => bot.name === input.confirmName)
            .at(0)
        : undefined;
    if (!target || target.archivedAt) throw new Error("Target bot not found");
    if (target.id === source.id) throw new Error("A bot cannot message itself");
    if (
      !input.botId &&
      this.db.bots.listActive().filter((bot) => bot.name === input.confirmName)
        .length !== 1
    ) {
      throw new Error("Target bot name is ambiguous; pass bot_id");
    }
    const chain = input.peerChain?.length ? [...input.peerChain] : [source.id];
    if (chain.at(-1) !== source.id) chain.push(source.id);
    if (chain.includes(target.id))
      throw new Error("Bot message cycle detected");
    if (chain.length >= 6) throw new Error("Bot message chain limit reached");

    const record = this.db.peerMessages.create({
      fromBotId: source.id,
      toBotId: target.id,
      intent: input.intent,
      prompt: input.message,
    });
    try {
      const result = await this.runtime.sendMessage(
        target.id,
        `Peer message from ${source.name} (${source.id}) [${input.intent}]:\n\n${input.message}\n\nReply directly in your final response. Do not call message_bot for this reply; the runtime returns your final answer to the caller automatically.`,
        {
          signal: input.signal,
          fleetManagementAllowed: false,
          peerChain: [...chain, target.id],
        },
      );
      const reply =
        result.text.trim() || "Recipient completed without a text reply.";
      this.db.peerMessages.complete(record.id, reply);
      return reply;
    } catch (error) {
      this.db.peerMessages.fail(
        record.id,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  close(): void {
    this.routines.stop();
    void this.mcp?.close();
    this.db.close();
  }

  getUserSettings(): LocalUserSettings {
    return parseLocalUserSettings(this.db.settings.get("local.user-settings"));
  }

  updateUserSettings(input: Partial<LocalUserSettings>): LocalUserSettings {
    const next = parseLocalUserSettings({
      ...this.getUserSettings(),
      ...input,
    });
    this.db.settings.set("local.user-settings", next as unknown as JsonValue);
    return next;
  }
}
