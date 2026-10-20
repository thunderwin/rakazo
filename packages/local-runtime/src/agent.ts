export type LocalAgentRole = "user" | "assistant" | "system";

export interface LocalAgentMessage {
  id?: string;
  createdAt?: string;
  role: LocalAgentRole;
  content: string;
}

export interface LocalAgentTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly?: boolean;
}

export interface LocalAgentModel {
  provider: string;
  id: string;
  baseUrl: string;
  apiKey: string;
  /** Only the desktop composition root may enable this for its fixed gateway URL. */
  allowPublicEndpoint?: boolean;
  /** Only the desktop composition root may set this for its fixed gateway URL. */
  baseUrlIsExact?: boolean;
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
}

export interface LocalAgentRunRequest {
  botId: string;
  threadId: string;
  runId: string;
  sourceMessageId: string;
  prompt: string;
  instructions: string;
  history: LocalAgentMessage[];
  tools: LocalAgentTool[];
  model: LocalAgentModel;
  executeTool: (
    name: string,
    args: Record<string, unknown>,
    executionId: string,
  ) => Promise<unknown>;
}

export interface LocalAgentRunContext {
  signal?: AbortSignal;
  userId?: string;
}

export type LocalAgentEvent =
  | { type: "text"; text: string }
  | { type: "progress"; text: string; activity?: true }
  | { type: "tool"; name: string; args: Record<string, unknown>; executionId: string }
  | { type: "ask"; text: string; detail?: string; actions?: Array<{ id: string; label: string }> }
  | { type: "takeover"; reason: string }
  | { type: "usage"; usage: unknown }
  | { type: "checkpoint"; blob: string }
  | {
      type: "subagent";
      agentId: string;
      name: string;
      task: string;
      status: "running" | "completed" | "failed";
      progress?: string;
      result?: string;
    }
  | { type: "done"; text?: string };

/** Provider-neutral local Agent loop. Desktop composes this with Pi today. */
export interface LocalAgentEngine {
  run(
    request: LocalAgentRunRequest,
    context?: LocalAgentRunContext,
  ): AsyncIterable<LocalAgentEvent>;
  abort(runId: string): Promise<void>;
}
