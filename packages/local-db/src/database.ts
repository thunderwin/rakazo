import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { migrate } from "./migrations.js";
import { BotRepository } from "./repositories/bots.js";
import { GroupMessageRepository } from "./repositories/group-messages.js";
import { GroupThreadRepository } from "./repositories/group-threads.js";
import { GroupRepository } from "./repositories/groups.js";
import { MessageRepository } from "./repositories/messages.js";
import { PeerMessageRepository } from "./repositories/peer-messages.js";
import { RunRepository } from "./repositories/runs.js";
import { SettingsRepository } from "./repositories/settings.js";
import { ThreadRepository } from "./repositories/threads.js";

export interface OpenLocalDatabaseOptions {
  /** Use ":memory:" for tests. */
  file: string;
}

export class LocalDatabase {
  readonly sqlite: Database.Database;
  readonly bots: BotRepository;
  readonly groups: GroupRepository;
  readonly groupThreads: GroupThreadRepository;
  readonly groupMessages: GroupMessageRepository;
  readonly threads: ThreadRepository;
  readonly messages: MessageRepository;
  readonly peerMessages: PeerMessageRepository;
  readonly runs: RunRepository;
  readonly settings: SettingsRepository;

  constructor(options: OpenLocalDatabaseOptions) {
    if (options.file !== ":memory:") {
      mkdirSync(path.dirname(options.file), { recursive: true });
    }
    this.sqlite = new Database(options.file);
    this.sqlite.pragma("journal_mode = WAL");
    this.sqlite.pragma("synchronous = NORMAL");
    this.sqlite.pragma("busy_timeout = 5000");
    this.sqlite.pragma("foreign_keys = ON");
    migrate(this.sqlite);
    this.bots = new BotRepository(this.sqlite);
    this.groups = new GroupRepository(this.sqlite);
    this.groupThreads = new GroupThreadRepository(this.sqlite);
    this.groupMessages = new GroupMessageRepository(this.sqlite);
    this.threads = new ThreadRepository(this.sqlite);
    this.messages = new MessageRepository(this.sqlite);
    this.peerMessages = new PeerMessageRepository(this.sqlite);
    this.runs = new RunRepository(this.sqlite);
    this.settings = new SettingsRepository(this.sqlite);
  }

  async backupTo(destination: string): Promise<void> {
    if (destination === ":memory:") throw new Error("Cannot back up to :memory:");
    mkdirSync(path.dirname(destination), { recursive: true });
    await this.sqlite.backup(destination);
  }

  close(): void {
    this.sqlite.close();
  }
}

export function openLocalDatabase(file: string): LocalDatabase {
  return new LocalDatabase({ file });
}
