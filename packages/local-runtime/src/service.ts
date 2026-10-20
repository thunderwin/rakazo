import {
  type Bot,
  type CreateBotInput,
  type LocalDatabase,
  openLocalDatabase,
} from "@rakazo/local-db";
import type { ModelGateway } from "./model-gateway.js";
import { LocalRuntime, type SendMessageResult } from "./runtime.js";

export interface LocalRuntimeServiceOptions {
  databasePath: string;
  gateway: ModelGateway;
}

/** Owns the local DB and runtime for one desktop process. */
export class LocalRuntimeService {
  readonly db: LocalDatabase;
  readonly runtime: LocalRuntime;

  constructor(options: LocalRuntimeServiceOptions) {
    this.db = openLocalDatabase(options.databasePath);
    this.runtime = new LocalRuntime({ db: this.db, gateway: options.gateway });
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
    options: { signal?: AbortSignal } = {},
  ): Promise<SendMessageResult> {
    return this.runtime.sendMessage(botId, text, options);
  }

  close(): void {
    this.db.close();
  }
}
