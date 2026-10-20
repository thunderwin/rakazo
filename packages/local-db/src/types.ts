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
