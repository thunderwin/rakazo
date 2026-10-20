import { randomUUID } from "node:crypto";
import type { Bot, CreateBotInput, JsonValue, LocalMessage, Thread } from "@rakazo/local-db";
import type {
  LocalAgentEngine,
  LocalAgentEvent,
  LocalAgentMessage,
  LocalAgentModel,
  LocalAgentRunContext,
} from "./agent.js";
import type { LocalConversationStore } from "./store.js";
import type { LocalToolProvider } from "./tools.js";

export interface LocalRuntimeOptions {
  store: LocalConversationStore;
  engine: LocalAgentEngine;
  tools: LocalToolProvider;
  resolveModel: (bot: Bot) => Promise<LocalAgentModel> | LocalAgentModel;
  onEvent?: (event: LocalAgentEvent, runId: string) => void | Promise<void>;
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
      return block.kind === "text" && typeof block.text === "string" ? block.text : "";
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
  private readonly resolveModel: LocalRuntimeOptions["resolveModel"];
  private readonly onEvent: LocalRuntimeOptions["onEvent"];

  constructor(options: LocalRuntimeOptions) {
    this.store = options.store;
    this.engine = options.engine;
    this.tools = options.tools;
    this.resolveModel = options.resolveModel;
    this.onEvent = options.onEvent;
  }

  createBot(input: CreateBotInput): Bot {
    return this.store.createBot(input);
  }

  async sendMessage(
    botId: string,
    text: string,
    options: LocalAgentRunContext = {},
  ): Promise<SendMessageResult> {
    const content = text.trim();
    if (content.length === 0) throw new Error("Message cannot be empty");

    const bot = this.store.getBot(botId);
    if (!bot) throw new Error("Bot not found");
    const thread = this.store.getOrCreateThread(bot.id);
    const history = this.store
      .listMessages(thread.id, { limit: 100 })
      .map(toAgentMessage)
      .filter((message) => message.content.length > 0);
    const userMessage = this.store.appendMessage({
      threadId: thread.id,
      role: "user",
      blocks: [{ kind: "text", text: content }],
    });

    const runId = randomUUID();
    const model = await this.resolveModel(bot);
    const toolDefinitions = this.tools.definitionsFor(bot);
    let responseText = "";
    const events: LocalAgentEvent[] = [];
    const toolCalls: SendMessageResult["toolCalls"] = [];

    for await (const event of this.engine.run(
      {
        botId: bot.id,
        threadId: thread.id,
        runId,
        sourceMessageId: userMessage.id,
        prompt: content,
        instructions: bot.instructions,
        history,
        tools: toolDefinitions,
        model,
        executeTool: (name, args, executionId) =>
          this.tools.execute({ name, args, executionId, signal: options.signal }),
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

    const assistantMessage =
      responseText.length === 0 && toolCalls.length === 0
        ? null
        : this.store.appendMessage({
            threadId: thread.id,
            role: "bot",
            blocks: [
              ...(responseText.length > 0 ? [{ kind: "text" as const, text: responseText }] : []),
              ...toolCalls.map((toolCall) => ({
                kind: "tool_call" as const,
                executionId: toolCall.executionId,
                name: toolCall.name,
                arguments: toJsonValue(toolCall.arguments),
              })),
            ],
          });

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
    return this.engine.abort(runId);
  }
}
