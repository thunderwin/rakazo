import type {
  Bot,
  CreateBotInput,
  JsonValue,
  LocalDatabase,
  LocalMessage,
  Thread,
} from "@rakazo/local-db";
import type { GatewayMessage, ModelGateway, ModelGatewayRequest } from "./model-gateway.js";

export interface LocalRuntimeOptions {
  db: LocalDatabase;
  gateway: ModelGateway;
}

export interface SendMessageResult {
  thread: Thread;
  userMessage: LocalMessage;
  assistantMessage: LocalMessage | null;
  text: string;
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

function toGatewayMessage(message: LocalMessage): GatewayMessage {
  const role = message.role === "bot" ? "assistant" : message.role;
  return { role, content: textFromBlocks(message.blocks) };
}

export class LocalRuntime {
  private readonly db: LocalDatabase;
  private readonly gateway: ModelGateway;

  constructor(options: LocalRuntimeOptions) {
    this.db = options.db;
    this.gateway = options.gateway;
  }

  createBot(input: CreateBotInput): Bot {
    const bot = this.db.bots.create(input);
    this.db.threads.getOrCreateForBot(bot.id);
    return bot;
  }

  async sendMessage(
    botId: string,
    text: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<SendMessageResult> {
    const content = text.trim();
    if (content.length === 0) throw new Error("Message cannot be empty");

    const bot = this.db.bots.get(botId);
    if (!bot) throw new Error("Bot not found");
    const thread = this.db.threads.getOrCreateForBot(bot.id);
    const userMessage = this.db.messages.append({
      threadId: thread.id,
      role: "user",
      blocks: [{ kind: "text", text: content }],
    });

    const history = this.db.messages
      .list(thread.id, { limit: 100 })
      .map(toGatewayMessage)
      .filter((message) => message.content.length > 0);
    const request: ModelGatewayRequest = {
      botId: bot.id,
      instructions: bot.instructions,
      messages: history,
      signal: options.signal,
    };

    let responseText = "";
    for await (const event of this.gateway.stream(request)) {
      if (event.type === "text") responseText += event.text;
      if (event.type === "error") throw new Error(event.message);
      if (event.type === "done") break;
    }

    const assistantMessage =
      responseText.length === 0
        ? null
        : this.db.messages.append({
            threadId: thread.id,
            role: "bot",
            blocks: [{ kind: "text", text: responseText }],
          });

    return { thread, userMessage, assistantMessage, text: responseText };
  }
}
