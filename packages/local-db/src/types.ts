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
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
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
