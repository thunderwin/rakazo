import { randomUUID } from "node:crypto";
import {
  botMessageHopExhausted,
  messageBlockForArtifact,
  nextBotMessageHop,
  promptTextForAttachments,
  renderGroupMembersContext,
  resolveGroupTargetBotIds,
} from "@rakazo/core";
import type {
  Bot,
  GroupMessage,
  GroupThread,
  JsonValue,
  LocalArtifact,
  LocalDatabase,
  LocalGroupWithMembers,
} from "@rakazo/local-db";
import type {
  LocalAgentEngine,
  LocalAgentEvent,
  LocalAgentMessage,
  LocalAgentModel,
  LocalAgentRunContext,
  LocalAgentTool,
} from "./agent.js";
import type { LocalAttachment } from "./attachments.js";
import { LOCAL_FLEET_TOOL_NAMES } from "./fleet-tools.js";
import { PRIVATE_MEMORY_TOOL_NAMES } from "./memory.js";
import { ROUTINE_TOOL_NAMES } from "./routines.js";
import type { LocalToolProvider } from "./tools.js";

export interface GroupRunResult {
  runId: string;
  botId: string;
  text: string;
  message: GroupMessage | null;
  failed: boolean;
}

export interface GroupSendResult {
  thread: GroupThread;
  userMessage: GroupMessage;
  runs: GroupRunResult[];
}

interface GroupRuntimeOptions {
  db: LocalDatabase;
  engine: LocalAgentEngine;
  tools: LocalToolProvider;
  skills?: {
    expandPrompt(prompt: string): string;
    catalogInstruction(): string | undefined;
  };
  resolveModel: (bot: Bot) => Promise<LocalAgentModel> | LocalAgentModel;
  onRunStart?: (run: {
    runId: string;
    botId: string;
    threadId: string;
    userMessageId: string;
  }) => void | Promise<void>;
  onEvent?: (event: LocalAgentEvent, runId: string) => void | Promise<void>;
  onRunEnd?: (run: {
    runId: string;
    status: "completed" | "failed" | "stopped";
    error: string | null;
  }) => void | Promise<void>;
}

interface GroupWorkItem {
  botId: string;
  prompt: string;
  sourceMessageId: string;
  hop: number;
  chain: string[];
  fromBotId?: string;
}

interface QueuedHandoff {
  botId: string;
  message: string;
  messageId: string;
  hop: number;
  chain: string[];
}

type GroupBlock =
  | { kind: "text"; text: string }
  | { kind: "error"; message: string }
  | { kind: "image"; artifactId: string; mimeType: string; name: string }
  | {
      kind: "file";
      artifactId: string;
      mimeType: string;
      name: string;
      size: number;
    }
  | {
      kind: "handoff";
      fromBotId: string;
      toBotId: string;
      text: string;
      hop: number;
    }
  | {
      kind: "tool_call";
      executionId: string;
      name: string;
      arguments: JsonValue;
    };

const handoffTool: LocalAgentTool = {
  name: "handoff_to_bot",
  requiresApproval: false,
  description:
    "In a group chat only: transfer a genuinely distinct next stage to another current member. The target bot runs after the current member completes. Do not hand work back simply to report a result.",
  inputSchema: {
    type: "object",
    properties: {
      bot_id: { type: "string" },
      confirm_name: { type: "string" },
      message: { type: "string" },
    },
    required: ["message"],
  },
};

function isRecord(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textOfBlocks(blocks: JsonValue[]): string {
  return blocks
    .map((block) => {
      if (!isRecord(block)) return "";
      if (block.kind === "text" && typeof block.text === "string") return block.text;
      if (block.kind === "image" && typeof block.name === "string") return `[image: ${block.name}]`;
      if (block.kind === "file" && typeof block.name === "string") {
        return `[file: ${block.name} (${String(block.mimeType)}, ${String(block.size)} bytes)]`;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function toJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

export class LocalGroupRuntime {
  private readonly active = new Map<string, { controller: AbortController; runIds: Set<string> }>();

  constructor(private readonly options: GroupRuntimeOptions) {}

  listGroups(): LocalGroupWithMembers[] {
    return this.options.db.groups.list();
  }

  createGroup(input: {
    name: string;
    description?: string;
    color?: string;
    botIds: string[];
  }): LocalGroupWithMembers {
    if (input.botIds.length < 2 || input.botIds.length > 10) {
      throw new Error("A group needs 2 to 10 bots");
    }
    return this.options.db.groups.create(input);
  }

  updateGroup(
    groupId: string,
    input: { name?: string; description?: string; color?: string; botIds?: string[] },
  ): LocalGroupWithMembers | null {
    if (this.options.db.groups.get(groupId)?.source === "managed") {
      throw new Error("This group is managed by your organization");
    }
    if (input.botIds && (input.botIds.length < 2 || input.botIds.length > 10)) {
      throw new Error("A group needs 2 to 10 bots");
    }
    return this.options.db.groups.update(groupId, input);
  }

  removeGroup(groupId: string): boolean {
    if (this.options.db.groups.get(groupId)?.source === "managed") {
      throw new Error("This group is managed by your organization");
    }
    if (this.active.has(groupId)) throw new Error("Stop the group before deleting it");
    return this.options.db.groups.remove(groupId);
  }

  listMessages(groupId: string): GroupMessage[] {
    const thread = this.options.db.groupThreads.getOrCreate(groupId);
    return this.options.db.groupMessages.list(thread.id);
  }

  async cancel(groupId: string): Promise<void> {
    const active = this.active.get(groupId);
    if (!active) return;
    active.controller.abort();
    await Promise.allSettled([...active.runIds].map((runId) => this.options.engine.abort(runId)));
  }

  async sendMessage(
    groupId: string,
    rawText: string,
    options: LocalAgentRunContext = {},
    attachments: readonly LocalAttachment[] = [],
  ): Promise<GroupSendResult> {
    const text = rawText.trim();
    if (!text && attachments.length === 0) throw new Error("Message cannot be empty");
    const group = this.options.db.groups.get(groupId);
    if (!group) throw new Error("Group not found");
    if (group.members.length < 2) throw new Error("This group no longer has enough members");
    if (this.active.has(groupId)) throw new Error("This group is already running");

    const thread = this.options.db.groupThreads.getOrCreate(groupId, group.name);
    const userMessage = this.options.db.groupMessages.append({
      threadId: thread.id,
      role: "user",
      blocks: [
        ...(text ? [{ kind: "text" as const, text }] : []),
        ...attachments.map((attachment) => messageBlockForArtifact(attachment)),
      ],
    });
    const targetIds = resolveGroupTargetBotIds({
      text,
      members: group.members.map((bot) => ({ id: bot.id, name: bot.name })),
      explicitMentions: [],
    });
    const controller = new AbortController();
    const signal = options.signal
      ? AbortSignal.any([options.signal, controller.signal])
      : controller.signal;
    this.active.set(groupId, { controller, runIds: new Set() });

    const queue: GroupWorkItem[] = targetIds.map((botId) => ({
      botId,
      prompt: promptTextForAttachments(text, [...attachments]),
      sourceMessageId: userMessage.id,
      hop: 0,
      chain: [],
    }));
    const runs: GroupRunResult[] = [];
    try {
      while (queue.length > 0) {
        signal.throwIfAborted();
        const item = queue.shift()!;
        const result = await this.runBot(group, thread, item, signal, attachments, options.userId);
        runs.push(result);
        for (const handoff of result.handoffs) {
          if (botMessageHopExhausted(handoff.hop)) {
            continue;
          }
          queue.push({
            botId: handoff.botId,
            prompt: handoff.message,
            sourceMessageId: handoff.messageId,
            hop: handoff.hop,
            chain: handoff.chain,
            fromBotId: result.botId,
          });
        }
      }
      return { thread, userMessage, runs };
    } catch (error) {
      if (signal.aborted) throw new Error("Group run stopped.");
      throw error;
    } finally {
      this.active.delete(groupId);
    }
  }

  private async runBot(
    group: LocalGroupWithMembers,
    thread: GroupThread,
    item: GroupWorkItem,
    signal: AbortSignal,
    attachments: readonly LocalAttachment[],
    userId?: string,
  ): Promise<
    GroupRunResult & {
      handoffs: QueuedHandoff[];
    }
  > {
    const bot = group.members.find((member) => member.id === item.botId);
    if (!bot) throw new Error("Group member not found");
    if (bot.archivedAt) throw new Error("Group member is archived");
    const runId = randomUUID();
    const active = this.active.get(group.id);
    active?.runIds.add(runId);
    let text = "";
    let error: Error | null = null;
    let failed = false;
    const toolCalls: GroupBlock[] = [];
    const generatedArtifacts: LocalArtifact[] = [];
    const handoffs: QueuedHandoff[] = [];
    const history = this.groupHistory(group);
    const tools = (await this.options.tools.definitionsFor(bot)).filter(
      (tool) =>
        !LOCAL_FLEET_TOOL_NAMES.has(tool.name) &&
        tool.name !== "handoff_to_bot" &&
        !PRIVATE_MEMORY_TOOL_NAMES.has(tool.name) &&
        !ROUTINE_TOOL_NAMES.has(tool.name),
    );
    if (!bot.disabledBuiltinTools.includes("handoff_to_bot")) tools.push(handoffTool);
    let model: LocalAgentModel | null = null;

    await this.options.onRunStart?.({
      runId,
      botId: bot.id,
      threadId: thread.id,
      userMessageId: item.sourceMessageId,
    });
    try {
      model = await this.options.resolveModel(bot);
      for await (const event of this.options.engine.run(
        {
          botId: bot.id,
          threadId: thread.id,
          runId,
          sourceMessageId: item.sourceMessageId,
          prompt: this.options.skills?.expandPrompt(item.prompt) ?? item.prompt,
          instructions: [
            bot.instructions,
            this.options.skills?.catalogInstruction(),
            renderGroupMembersContext(
              group.name,
              group.members.map((member) => ({
                id: member.id,
                name: member.name,
                title: member.title,
                description: member.description,
              })),
              { id: bot.id, name: bot.name },
            ),
          ]
            .filter(Boolean)
            .join("\n\n"),
          history,
          currentTurnImages: attachments
            .filter(
              (attachment) =>
                attachment.mimeType === "image/jpeg" ||
                attachment.mimeType === "image/png" ||
                attachment.mimeType === "image/webp" ||
                attachment.mimeType === "image/gif",
            )
            .map((attachment) => ({
              name: attachment.name,
              mimeType: attachment.mimeType as
                | "image/jpeg"
                | "image/png"
                | "image/webp"
                | "image/gif",
              data: attachment.data,
            })),
          tools,
          model,
          executeTool: async (name, args, executionId) => {
            if (PRIVATE_MEMORY_TOOL_NAMES.has(name) || ROUTINE_TOOL_NAMES.has(name)) {
              throw new Error("Private memory and routine tools are not available in group chats");
            }
            if (LOCAL_FLEET_TOOL_NAMES.has(name)) {
              throw new Error("Fleet tools are not available in group chats");
            }
            if (name === "handoff_to_bot") {
              return this.executeHandoff({
                group,
                thread,
                runId,
                bot,
                item,
                args,
                executionId,
                handoffs,
              });
            }
            return this.options.tools.execute({
              botId: bot.id,
              runId,
              threadId: thread.id,
              name,
              args,
              executionId,
              signal,
              publishArtifact: (artifact) => generatedArtifacts.push(artifact),
              publishEvent: (event) => {
                void Promise.resolve(this.options.onEvent?.(event, runId)).catch(() => undefined);
              },
            });
          },
        },
        { signal, ...(userId ? { userId } : {}) },
      )) {
        await this.options.onEvent?.(event, runId);
        if (event.type === "text") text += event.text;
        if (event.type === "tool") {
          toolCalls.push({
            kind: "tool_call",
            executionId: event.executionId,
            name: event.name,
            arguments: toJson(event.args),
          });
        }
      }
    } catch (cause) {
      failed = true;
      error = cause instanceof Error ? cause : new Error(String(cause));
    }

    let message: GroupMessage | null = null;
    try {
      const blocks: GroupBlock[] = [
        ...(text ? [{ kind: "text" as const, text }] : []),
        ...generatedArtifacts.map((artifact) => messageBlockForArtifact(artifact)),
        ...toolCalls,
        ...(error ? [{ kind: "error" as const, message: error.message }] : []),
      ];
      if (blocks.length > 0) {
        message = this.options.db.groupMessages.append({
          threadId: thread.id,
          role: "bot",
          botId: bot.id,
          blocks,
        });
      }
    } finally {
      active?.runIds.delete(runId);
      await this.options.onRunEnd?.({
        runId,
        status: signal.aborted ? "stopped" : error ? "failed" : "completed",
        error: signal.aborted ? "Group run stopped." : (error?.message ?? null),
      });
    }
    return { runId, botId: bot.id, text, message, failed, handoffs };
  }

  private groupHistory(group: LocalGroupWithMembers): LocalAgentMessage[] {
    const thread = this.options.db.groupThreads.getOrCreate(group.id, group.name);
    const byId = new Map(group.members.map((member) => [member.id, member.name]));
    return this.options.db.groupMessages
      .list(thread.id, 100)
      .flatMap((message): LocalAgentMessage[] => {
        const text = textOfBlocks(message.blocks);
        if (message.role === "user") {
          return text
            ? [{ id: message.id, createdAt: message.createdAt, role: "user", content: text }]
            : [];
        }
        if (message.role === "bot") {
          const speaker = byId.get(message.botId ?? "") ?? "Bot";
          const handoff = message.blocks.find(
            (block): block is Extract<GroupBlock, { kind: "handoff" }> =>
              isRecord(block) && block.kind === "handoff",
          );
          const content = handoff
            ? `${speaker} handed off to ${byId.get(handoff.toBotId) ?? "another bot"}: ${handoff.text}`
            : text
              ? `${speaker}: ${text}`
              : "";
          return content
            ? [{ id: message.id, createdAt: message.createdAt, role: "assistant", content }]
            : [];
        }
        return text
          ? [{ id: message.id, createdAt: message.createdAt, role: "system", content: text }]
          : [];
      });
  }

  private executeHandoff(input: {
    group: LocalGroupWithMembers;
    thread: GroupThread;
    runId: string;
    bot: Bot;
    item: GroupWorkItem;
    args: Record<string, unknown>;
    executionId: string;
    handoffs: QueuedHandoff[];
  }) {
    const { group, thread, runId, bot, item, args, executionId, handoffs } = input;
    const recordActivity = this.options.db.runs.get(runId) !== null;
    if (recordActivity) {
      this.options.db.runs.startTool({
        runId,
        executionId,
        botId: bot.id,
        toolName: "handoff_to_bot",
        arguments: toJson(args),
      });
    }
    try {
      const targetId =
        typeof args.bot_id === "string"
          ? args.bot_id.trim()
          : group.members.find(
              (member) =>
                typeof args.confirm_name === "string" &&
                member.name.toLowerCase() === args.confirm_name.trim().toLowerCase(),
            )?.id;
      const message = typeof args.message === "string" ? args.message.trim() : "";
      if (!targetId) throw new Error("handoff target is required");
      if (targetId === bot.id) throw new Error("A bot cannot hand off to itself");
      if (item.fromBotId === targetId) {
        throw new Error("Do not hand the stage back to its previous owner");
      }
      if (!group.members.some((member) => member.id === targetId)) {
        throw new Error("Handoff target is not a group member");
      }
      const chain = [...item.chain, bot.id];
      if (chain.includes(targetId)) throw new Error("Group handoff cycle detected");
      if (!message) throw new Error("handoff message is required");
      const hop = nextBotMessageHop(item.hop);
      if (botMessageHopExhausted(hop)) throw new Error("Group handoff limit reached");
      const handoffMessage = this.options.db.groupMessages.append({
        threadId: thread.id,
        role: "bot",
        botId: bot.id,
        blocks: [{ kind: "handoff", fromBotId: bot.id, toBotId: targetId, text: message, hop }],
      });
      handoffs.push({
        botId: targetId,
        message,
        messageId: handoffMessage.id,
        hop,
        chain,
      });
      const result = {
        ok: true,
        note: "Handoff recorded. Finish this turn; the next bot will run automatically.",
      };
      if (recordActivity) this.options.db.runs.finishTool(runId, executionId, toJson(result));
      return result;
    } catch (error) {
      if (recordActivity) {
        this.options.db.runs.finishTool(
          runId,
          executionId,
          null,
          error instanceof Error ? error.message : String(error),
        );
      }
      throw error;
    }
  }
}
