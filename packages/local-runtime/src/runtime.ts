import { randomUUID } from "node:crypto";
import { messageBlockForArtifact, promptTextForAttachments } from "@rakazo/core";
import type { Bot, CreateBotInput, JsonValue, LocalMessage, Thread } from "@rakazo/local-db";
import type {
  LocalAgentEngine,
  LocalAgentEvent,
  LocalAgentMessage,
  LocalAgentModel,
  LocalAgentRunContext,
} from "./agent.js";
import type { LocalAttachment } from "./attachments.js";
import type { LocalConversationStore } from "./store.js";
import type { LocalToolProvider } from "./tools.js";

export interface LocalRuntimeOptions {
  store: LocalConversationStore;
  engine: LocalAgentEngine;
  tools: LocalToolProvider;
  memory?: {
    contextFor(botId: string): string | undefined;
  };
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
  onRunEnd?: (run: LocalRunEnd) => void | Promise<void>;
}

export interface LocalRunEnd {
  runId: string;
  status: "completed" | "failed" | "stopped";
  error: string | null;
}

export interface SendMessageResult {
  thread: Thread;
  userMessage: LocalMessage;
  assistantMessage: LocalMessage | null;
  text: string;
  runId: string;
  events: LocalAgentEvent[];
  toolCalls: Array<{
    executionId: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
}

function isRecord(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textFromBlocks(blocks: JsonValue[]): string {
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
    .filter((text) => text.length > 0)
    .join("\n");
}

function toAgentMessage(message: LocalMessage): LocalAgentMessage {
  const role = message.role === "bot" ? "assistant" : message.role;
  return {
    id: message.id,
    createdAt: message.createdAt,
    role,
    content: textFromBlocks(message.blocks),
  };
}

function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

export class LocalRuntime {
  private readonly store: LocalConversationStore;
  private readonly engine: LocalAgentEngine;
  private readonly tools: LocalToolProvider;
  private readonly memory: LocalRuntimeOptions["memory"];
  private readonly skills: LocalRuntimeOptions["skills"];
  private readonly resolveModel: LocalRuntimeOptions["resolveModel"];
  private readonly onRunStart: LocalRuntimeOptions["onRunStart"];
  private readonly onEvent: LocalRuntimeOptions["onEvent"];
  private readonly onRunEnd: LocalRuntimeOptions["onRunEnd"];
  private readonly abortedRuns = new Set<string>();
  private readonly activeRuns = new Set<string>();

  constructor(options: LocalRuntimeOptions) {
    this.store = options.store;
    this.engine = options.engine;
    this.tools = options.tools;
    this.memory = options.memory;
    this.skills = options.skills;
    this.resolveModel = options.resolveModel;
    this.onRunStart = options.onRunStart;
    this.onEvent = options.onEvent;
    this.onRunEnd = options.onRunEnd;
  }

  createBot(input: CreateBotInput): Bot {
    return this.store.createBot(input);
  }

  async sendMessage(
    botId: string,
    text: string,
    options: LocalAgentRunContext = {},
    attachments: readonly LocalAttachment[] = [],
  ): Promise<SendMessageResult> {
    const content = text.trim();
    if (content.length === 0 && attachments.length === 0) {
      throw new Error("Message cannot be empty");
    }

    const bot = this.store.getBot(botId);
    if (!bot) throw new Error("Bot not found");
    const thread = this.store.getOrCreateThread(bot.id);
    const history = this.store
      .listMessages(thread.id, { limit: 100 })
      .map(toAgentMessage)
      .filter((message) => message.content.length > 0);
    const memoryContext = this.memory?.contextFor(bot.id);
    const taskPrompt = promptTextForAttachments(content, [...attachments]);
    const skillCatalog = this.skills?.catalogInstruction();
    const userMessage = this.store.appendMessage({
      threadId: thread.id,
      role: "user",
      blocks: [
        ...(content ? [{ kind: "text" as const, text: content }] : []),
        ...attachments.map((attachment) => messageBlockForArtifact(attachment)),
      ],
    });

    const runId = randomUUID();
    const toolDefinitions = this.tools.definitionsFor(bot);
    let responseText = "";
    const events: LocalAgentEvent[] = [];
    const toolCalls: SendMessageResult["toolCalls"] = [];
    let runError: Error | null = null;
    let assistantMessage: LocalMessage | null = null;

    await this.onRunStart?.({
      runId,
      botId: bot.id,
      threadId: thread.id,
      userMessageId: userMessage.id,
    });
    this.activeRuns.add(runId);
    try {
      let model: LocalAgentModel | null = null;
      try {
        model = await this.resolveModel(bot);
      } catch (error) {
        runError = error instanceof Error ? error : new Error(String(error));
      }
      if (!runError && model) {
        try {
          for await (const event of this.engine.run(
            {
              botId: bot.id,
              threadId: thread.id,
              runId,
              sourceMessageId: userMessage.id,
              prompt: this.skills?.expandPrompt(taskPrompt) ?? taskPrompt,
              instructions: [bot.instructions.trim(), memoryContext, skillCatalog]
                .filter((instruction): instruction is string => Boolean(instruction))
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
              tools: toolDefinitions,
              model,
              executeTool: (name, args, executionId) =>
                this.tools.execute({
                  botId: bot.id,
                  runId,
                  threadId: thread.id,
                  name,
                  args,
                  executionId,
                  signal: options.signal,
                  peerChain: options.peerChain,
                }),
            },
            options,
          )) {
            events.push(event);
            await this.onEvent?.(event, runId);
            if (event.type === "text") responseText += event.text;
            if (event.type === "tool") {
              toolCalls.push({
                executionId: event.executionId,
                name: event.name,
                arguments: event.args,
              });
            }
            if (event.type === "done") break;
          }
        } catch (error) {
          runError = error instanceof Error ? error : new Error(String(error));
        }
      }

      const stopped = this.abortedRuns.has(runId);
      const errorBlock =
        stopped || runError
          ? {
              kind: "error" as const,
              message: stopped ? "Run stopped." : (runError?.message ?? "Run failed."),
            }
          : null;
      const blocks = [
        ...(responseText.length > 0 ? [{ kind: "text" as const, text: responseText }] : []),
        ...toolCalls.map((toolCall) => ({
          kind: "tool_call" as const,
          executionId: toolCall.executionId,
          name: toolCall.name,
          arguments: toJsonValue(toolCall.arguments),
        })),
        ...(errorBlock ? [errorBlock] : []),
      ];
      if (blocks.length > 0) {
        try {
          assistantMessage = this.store.appendMessage({
            threadId: thread.id,
            role: "bot",
            blocks,
          });
        } catch (error) {
          runError ??= error instanceof Error ? error : new Error(String(error));
        }
      }
    } finally {
      const stopped = this.abortedRuns.delete(runId);
      this.activeRuns.delete(runId);
      const error = stopped ? "Run stopped." : (runError?.message ?? null);
      try {
        await this.onRunEnd?.({
          runId,
          status: stopped ? "stopped" : runError ? "failed" : "completed",
          error,
        });
      } catch {
        // Lifecycle cleanup must not turn a completed model run into a failure.
      }
    }

    if (runError) throw runError;

    return {
      thread,
      userMessage,
      assistantMessage,
      text: responseText,
      runId,
      events,
      toolCalls,
    };
  }

  abort(runId: string): Promise<void> {
    if (this.activeRuns.has(runId)) this.abortedRuns.add(runId);
    return this.engine.abort(runId);
  }
}
