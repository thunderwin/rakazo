import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { migrate } from "./migrations.js";
import { ArtifactRepository } from "./repositories/artifacts.js";
import { BotRepository } from "./repositories/bots.js";
import { GroupMessageRepository } from "./repositories/group-messages.js";
import { GroupThreadRepository } from "./repositories/group-threads.js";
import { GroupRepository } from "./repositories/groups.js";
import { InstructionVersionRepository } from "./repositories/instruction-versions.js";
import { KnowledgeRepository } from "./repositories/knowledge.js";
import { McpServerRepository } from "./repositories/mcp-servers.js";
import { MediaJobRepository } from "./repositories/media-jobs.js";
import { MemoryRepository } from "./repositories/memory.js";
import { MessageRepository } from "./repositories/messages.js";
import { PeerMessageRepository } from "./repositories/peer-messages.js";
import { RoutineRepository } from "./repositories/routines.js";
import { RunRepository } from "./repositories/runs.js";
import { SettingsRepository } from "./repositories/settings.js";
import { SkillRepository } from "./repositories/skills.js";
import { ThreadRepository } from "./repositories/threads.js";
import { WorkRepository } from "./repositories/work.js";

export interface OpenLocalDatabaseOptions {
  /** Use ":memory:" for tests. */
  file: string;
}

export class LocalDatabase {
  readonly sqlite: Database.Database;
  readonly artifacts: ArtifactRepository;
  readonly bots: BotRepository;
  readonly groups: GroupRepository;
  readonly groupThreads: GroupThreadRepository;
  readonly groupMessages: GroupMessageRepository;
  readonly knowledge: KnowledgeRepository;
  readonly instructionVersions: InstructionVersionRepository;
  readonly threads: ThreadRepository;
  readonly messages: MessageRepository;
  readonly mediaJobs: MediaJobRepository;
  readonly mcpServers: McpServerRepository;
  readonly memory: MemoryRepository;
  readonly peerMessages: PeerMessageRepository;
  readonly runs: RunRepository;
  readonly routines: RoutineRepository;
  readonly settings: SettingsRepository;
  readonly skills: SkillRepository;
  readonly work: WorkRepository;

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
    this.artifacts = new ArtifactRepository(this.sqlite);
    this.bots = new BotRepository(this.sqlite);
    this.groups = new GroupRepository(this.sqlite);
    this.groupThreads = new GroupThreadRepository(this.sqlite);
    this.groupMessages = new GroupMessageRepository(this.sqlite);
    this.knowledge = new KnowledgeRepository(this.sqlite);
    this.instructionVersions = new InstructionVersionRepository(this.sqlite);
    this.threads = new ThreadRepository(this.sqlite);
    this.messages = new MessageRepository(this.sqlite);
    this.mediaJobs = new MediaJobRepository(this.sqlite);
    this.mcpServers = new McpServerRepository(this.sqlite);
    this.memory = new MemoryRepository(this.sqlite);
    this.peerMessages = new PeerMessageRepository(this.sqlite);
    this.runs = new RunRepository(this.sqlite);
    this.routines = new RoutineRepository(this.sqlite);
    this.settings = new SettingsRepository(this.sqlite);
    this.skills = new SkillRepository(this.sqlite);
    this.work = new WorkRepository(this.sqlite);
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
