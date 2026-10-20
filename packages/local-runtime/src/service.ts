import {
  type Bot,
  type CreateBotInput,
  type JsonValue,
  type LocalDatabase,
  openLocalDatabase,
} from "@rakazo/local-db";
import type { LocalAgentEngine, LocalAgentModel, LocalAgentRunContext } from "./agent.js";
import type { PeerBotMessageRequest } from "./message-bot-tool.js";
import { LocalRuntime, type SendMessageResult } from "./runtime.js";
import { type LocalUserSettings, parseLocalUserSettings } from "./settings.js";
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

  constructor(options: LocalRuntimeServiceOptions) {
    this.db = openLocalDatabase(options.databasePath);
    this.runtime = new LocalRuntime({
      store: new SqliteConversationStore(this.db),
      engine: options.engine,
      tools: options.tools,
      resolveModel: options.resolveModel,
      onRunStart: options.onRunStart,
      onEvent: options.onEvent,
      onRunEnd: options.onRunEnd,
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

  sendMessage(
    botId: string,
    text: string,
    options: LocalAgentRunContext = {},
  ): Promise<SendMessageResult> {
    return this.runtime.sendMessage(botId, text, options);
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
