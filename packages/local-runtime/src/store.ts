import type {
  AppendMessageInput,
  Bot,
  CreateBotInput,
  LocalDatabase,
  LocalMessage,
  Thread,
} from "@rakazo/local-db";

/** Persistence boundary for the local Agent workflow. */
export interface LocalConversationStore {
  listBots(): Bot[];
  createBot(input: CreateBotInput): Bot;
  getBot(id: string): Bot | null;
  getOrCreateThread(botId: string): Thread;
  appendMessage(input: AppendMessageInput): LocalMessage;
  listMessages(threadId: string, options?: { limit?: number }): LocalMessage[];
}

/** SQLite implementation of the local conversation boundary. */
export class SqliteConversationStore implements LocalConversationStore {
  constructor(private readonly db: LocalDatabase) {}

  listBots(): Bot[] {
    return this.db.bots.list();
  }

  createBot(input: CreateBotInput): Bot {
    const bot = this.db.bots.create(input);
    this.db.threads.getOrCreateForBot(bot.id);
    return bot;
  }

  getBot(id: string): Bot | null {
    return this.db.bots.get(id);
  }

  getOrCreateThread(botId: string): Thread {
    return this.db.threads.getOrCreateForBot(botId);
  }

  appendMessage(input: AppendMessageInput): LocalMessage {
    return this.db.messages.append(input);
  }

  listMessages(threadId: string, options: { limit?: number } = {}): LocalMessage[] {
    return this.db.messages.list(threadId, options);
  }
}
