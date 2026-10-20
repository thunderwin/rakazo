import {
  type Bot,
  type CreateBotInput,
  type JsonValue,
  type LocalDatabase,
  openLocalDatabase,
} from "@rakazo/local-db";
import type { LocalAgentEngine, LocalAgentModel, LocalAgentRunContext } from "./agent.js";
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
