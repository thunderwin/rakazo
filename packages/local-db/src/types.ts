export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type MessageRole = "user" | "bot" | "system";

export interface Bot {
  id: string;
  name: string;
  title: string;
  description: string;
  instructions: string;
  color: string;
  modelProvider: string | null;
  modelId: string | null;
  thinkingLevel: string | null;
  disabledBuiltinTools: string[];
  fleetManagement: boolean;
  createdByBotId: string | null;
  instructionsVersion: number;
  archivedAt?: string | null;
  section?: string | null;
  pinned?: boolean;
  templateKey: string | null;
  templateVersion: number | null;
  source?: "local" | "managed";
  managedKey?: string | null;
  packageVersion?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBotInput {
  name: string;
  title?: string;
  description?: string;
  instructions?: string;
  color?: string;
  modelProvider?: string | null;
  modelId?: string | null;
  thinkingLevel?: string | null;
  disabledBuiltinTools?: string[];
  fleetManagement?: boolean;
  createdByBotId?: string | null;
  templateKey?: string | null;
  templateVersion?: number | null;
  source?: "local" | "managed";
  managedKey?: string | null;
  packageVersion?: number | null;
  archivedAt?: string | null;
  section?: string | null;
  pinned?: boolean;
}

export interface Thread {
  id: string;
  botId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface LocalMessage {
  id: string;
  threadId: string;
  sequence: number;
  role: MessageRole;
  blocks: JsonValue[];
  createdAt: string;
  updatedAt: string;
}

export interface AppendMessageInput {
  threadId: string;
  role: MessageRole;
  blocks: JsonValue[];
}

export interface Routine {
  id: string;
  botId: string;
  name: string;
  prompt: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  source: "local" | "managed";
  managedKey: string | null;
  packageId: string | null;
  version: number | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type RoutineRunTrigger = "scheduled" | "missed" | "manual";
export type RoutineRunStatus = "running" | "completed" | "failed" | "stopped";

export interface RoutineRun {
  id: string;
  routineId: string;
  runId: string | null;
  scheduledFor: string;
  trigger: RoutineRunTrigger;
  status: RoutineRunStatus;
  error: string | null;
  startedAt: string;
  endedAt: string | null;
  createdAt: string;
}

export interface LocalArtifact {
  id: string;
  botId: string | null;
  groupId: string | null;
  name: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export interface LocalArtifactWithContent extends LocalArtifact {
  content: Uint8Array;
}

export type LocalMediaJobKind = "image" | "video";
export type LocalMediaJobStatus = "queued" | "running" | "completed" | "failed";

export interface LocalMediaJob {
  id: string;
  botId: string;
  groupId: string | null;
  runId: string;
  executionId: string;
  kind: LocalMediaJobKind;
  provider: string;
  providerJobId: string | null;
  status: LocalMediaJobStatus;
  artifactId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LocalMcpServer {
  id: string;
  botId: string;
  name: string;
  slug: string;
  transport: "streamable-http" | "sse" | "stdio";
  endpoint: string | null;
  command: string | null;
  args: string[];
  secretName: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ScratchpadStatus = "open" | "parked" | "done";

export interface ScratchpadItem {
  id: string;
  botId: string;
  title: string;
  status: ScratchpadStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export type TicketStatus = "todo" | "doing" | "review" | "blocked" | "done" | "closed";
export type TicketPriority = "low" | "normal" | "high" | "urgent";

export interface TicketComment {
  id: string;
  ticketId: string;
  botId: string;
  body: string;
  createdAt: string;
}

export interface Ticket {
  id: string;
  sequence: number;
  reference: string;
  botId: string;
  ownerBotId: string | null;
  title: string;
  description: string;
  priority: TicketPriority;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
  comments?: TicketComment[];
}

export type ManagedContentSource = "local" | "managed";

export interface LocalKnowledgeDocument {
  id: string;
  title: string;
  content: string;
  source: ManagedContentSource;
  packageId: string | null;
  version: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface LocalSkill {
  id: string;
  name: string;
  description: string;
  content: string;
  scripts: LocalSkillScript[];
  source: "user" | "managed";
  packageId: string | null;
  version: number | null;
  createdAt: string;
  updatedAt: string;
}

export type LocalSkillRuntime = "node" | "python3" | "sh";

export interface LocalSkillScript {
  path: string;
  content: string;
  runtime: LocalSkillRuntime | null;
  timeoutSeconds: number;
  network: boolean;
  sha256: string;
}

export interface LocalGroup {
  id: string;
  name: string;
  description: string;
  color: string;
  source?: "local" | "managed";
  managedKey?: string | null;
  packageVersion?: number | null;
  section?: string | null;
  pinned?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GroupMember {
  groupId: string;
  botId: string;
  position: number;
  createdAt: string;
}

export interface LocalGroupWithMembers extends LocalGroup {
  members: Bot[];
}

export interface CreateGroupInput {
  name: string;
  description?: string;
  color?: string;
  botIds: string[];
  section?: string | null;
  pinned?: boolean;
}

export interface GroupThread {
  id: string;
  groupId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface GroupMessage {
  id: string;
  threadId: string;
  sequence: number;
  role: MessageRole;
  botId: string | null;
  blocks: JsonValue[];
  createdAt: string;
  updatedAt: string;
}

export interface AppendGroupMessageInput {
  threadId: string;
  role: MessageRole;
  botId?: string | null;
  blocks: JsonValue[];
}

export type LocalRunKind = "direct" | "group";
export type LocalRunStatus = "running" | "completed" | "failed" | "stopped";
export type LocalToolRunStatus = "running" | "completed" | "failed";

export interface LocalRunRecord {
  id: string;
  kind: LocalRunKind;
  botId: string;
  groupId: string | null;
  threadId: string;
  status: LocalRunStatus;
  error: string | null;
  startedAt: string;
  endedAt: string | null;
}

export interface LocalToolRunRecord {
  id: string;
  runId: string;
  executionId: string;
  botId: string;
  toolName: string;
  arguments: JsonValue;
  result: JsonValue | null;
  status: LocalToolRunStatus;
  error: string | null;
  startedAt: string;
  endedAt: string | null;
}

export interface LocalActivityRun extends LocalRunRecord {
  tools: LocalToolRunRecord[];
}

export type LocalMemoryScope = "bot" | "user";

export interface LocalMemoryDocument {
  id: string;
  scope: LocalMemoryScope;
  botId: string | null;
  path: string;
  content: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface CommitMemoryInput {
  scope: LocalMemoryScope;
  botId?: string;
  path: string;
  content: string;
  expectedRevision?: number;
  sourceRunId?: string;
  sourceThreadId?: string;
}
