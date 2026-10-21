import type { ClientManifestEnvelope } from "@rakazo/contracts";
import { isOneShotRoutineCron, nextCronDate } from "@rakazo/core";
import {
  type Bot,
  type CreateBotInput,
  type JsonValue,
  type LocalDatabase,
  openLocalDatabase,
} from "@rakazo/local-db";
import { RecordingToolProvider } from "./activity-tools.js";
import type { LocalAgentEngine, LocalAgentModel, LocalAgentRunContext } from "./agent.js";
import { type LocalArtifactInput, LocalAttachmentStore } from "./attachments.js";
import { LocalGroupRuntime } from "./group-runtime.js";
import { LocalKnowledge, LocalKnowledgeToolProvider } from "./knowledge.js";
import { LocalMemory, LocalMemoryToolProvider } from "./memory.js";
import type { PeerBotMessageRequest } from "./message-bot-tool.js";
import {
  type LocalRoutineInput,
  LocalRoutineRuntime,
  LocalRoutineToolProvider,
  type LocalRoutineUpdate,
} from "./routines.js";
import { LocalRuntime, type SendMessageResult } from "./runtime.js";
import { type LocalUserSettings, parseLocalUserSettings } from "./settings.js";
import { LocalSkills, LocalSkillToolProvider } from "./skills.js";
import { SqliteConversationStore } from "./store.js";
import type { LocalToolProvider } from "./tools.js";

export interface LocalRuntimeServiceOptions {
  databasePath: string;
  engine: LocalAgentEngine;
  tools: LocalToolProvider;
  resolveModel: (bot: Bot) => Promise<LocalAgentModel> | LocalAgentModel;
  onRunStart?: ConstructorParameters<typeof LocalRuntime>[0]["onRunStart"];
  onEvent?: ConstructorParameters<typeof LocalRuntime>[0]["onEvent"];
  onRunEnd?: ConstructorParameters<typeof LocalRuntime>[0]["onRunEnd"];
}

/** Owns the local DB and runtime for one desktop process. */
export class LocalRuntimeService {
  readonly db: LocalDatabase;
  readonly runtime: LocalRuntime;
  readonly memory: LocalMemory;
  readonly attachments: LocalAttachmentStore;
  readonly knowledge: LocalKnowledge;
  readonly skills: LocalSkills;
  private readonly routines: LocalRoutineRuntime;
  private readonly groups: LocalGroupRuntime;

  constructor(options: LocalRuntimeServiceOptions) {
    this.db = openLocalDatabase(options.databasePath);
    this.memory = new LocalMemory(this.db.memory);
    this.attachments = new LocalAttachmentStore(this.db.artifacts);
    this.knowledge = new LocalKnowledge(this.db.knowledge);
    this.skills = new LocalSkills(this.db.skills);
    const tools = new RecordingToolProvider(
      new LocalKnowledgeToolProvider(
        new LocalSkillToolProvider(
          new LocalRoutineToolProvider(
            new LocalMemoryToolProvider(options.tools, this.memory),
            () => this.routines,
          ),
          this.skills,
        ),
        this.knowledge,
      ),
      this.db.runs,
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
    return this.db.bots.list();
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

  createGroup(input: { name: string; description?: string; color?: string; botIds: string[] }) {
    return this.groups.createGroup(input);
  }

  updateGroup(
    groupId: string,
    input: { name?: string; description?: string; color?: string; botIds?: string[] },
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

  createArtifact(input: LocalArtifactInput) {
    return this.attachments.create(input);
  }

  readArtifact(id: string) {
    return this.attachments.read(id);
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

  createSkill(input: { name?: string; description?: string; body?: string; content?: string }) {
    return this.skills.create(input);
  }

  updateSkill(
    name: string,
    input: { newName?: string; description?: string; body?: string; content?: string },
  ) {
    return this.skills.update(name, input);
  }

  removeSkill(name: string) {
    return this.skills.remove(name);
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
        throw new Error(`Group preset ${preset.key} references an unknown bot template`);
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
        throw new Error(`Routine preset ${preset.key} references an unknown bot template`);
      }
      if (isOneShotRoutineCron(preset.cron)) {
        throw new Error(`Managed routine ${preset.key} cannot use a one-time schedule`);
      }
      let nextRunAt: string | null = null;
      try {
        nextRunAt = nextCronDate(preset.cron, now, preset.timezone).toISOString();
      } catch {
        throw new Error(`Routine preset ${preset.key} has an invalid cron or timezone`);
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
    this.db.bots.deleteManagedExcept(manifest.organization.id, [...botByKey.keys()]);
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
    this.db.skills.replaceManaged({
      packageId,
      version: manifest.version,
      skills: manifest.content.skills.map((skill) => ({
        key: `${manifest.organization.id}:${skill.key}`,
        name: skill.name,
        description: skill.description,
        content: skill.content,
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
    this.db.skills.replaceManaged({ packageId: current.organizationId, version: 0, skills: [] });
    this.db.settings.set("managed.client-manifest", null);
    return true;
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
    if (!source) throw new Error("Source bot not found");
    const target = input.botId
      ? this.db.bots.get(input.botId)
      : input.confirmName
        ? this.db.bots
            .list()
            .filter((bot) => bot.name === input.confirmName)
            .at(0)
        : undefined;
    if (!target) throw new Error("Target bot not found");
    if (target.id === source.id) throw new Error("A bot cannot message itself");
    if (
      !input.botId &&
      this.db.bots.list().filter((bot) => bot.name === input.confirmName).length !== 1
    ) {
      throw new Error("Target bot name is ambiguous; pass bot_id");
    }
    const chain = input.peerChain?.length ? [...input.peerChain] : [source.id];
    if (chain.at(-1) !== source.id) chain.push(source.id);
    if (chain.includes(target.id)) throw new Error("Bot message cycle detected");
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
          peerChain: [...chain, target.id],
        },
      );
      const reply = result.text.trim() || "Recipient completed without a text reply.";
      this.db.peerMessages.complete(record.id, reply);
      return reply;
    } catch (error) {
      this.db.peerMessages.fail(record.id, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  close(): void {
    this.routines.stop();
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
