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
  templateKey: string | null;
  templateVersion: number | null;
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
  templateKey?: string | null;
  templateVersion?: number | null;
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

export interface LocalGroup {
  id: string;
  name: string;
  description: string;
  color: string;
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
