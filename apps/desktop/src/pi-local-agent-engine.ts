import type {
  AdapterContext,
  AgentRunRequest,
  AgentRuntime,
  AgentRuntimeEvent,
} from "@rakazo/adapter-kit";
import { PiAgentRuntime } from "@rakazo/adapters/pi-runtime";
import type {
  LocalAgentEngine,
  LocalAgentEvent,
  LocalAgentRunContext,
  LocalAgentRunRequest,
} from "@rakazo/local-runtime";

type PiRuntime = Pick<AgentRuntime, "run" | "abort">;

function toPiRequest(request: LocalAgentRunRequest): AgentRunRequest {
  return {
    botId: request.botId,
    threadId: request.threadId,
    runId: request.runId,
    sourceMessageId: request.sourceMessageId,
    prompt: request.prompt,
    instructions: request.instructions,
    history: request.history,
    currentTurnImages: request.currentTurnImages,
    tools: request.tools,
    model: request.model,
    contextStrategy: "current",
    resolveModel: async (_provider, modelId) => ({
      ...request.model,
      provider: "openai-compatible",
      id: modelId,
    }),
    executeTool: request.executeTool,
  };
}

async function* toLocalEvents(
  events: AsyncIterable<AgentRuntimeEvent>,
): AsyncIterable<LocalAgentEvent> {
  try {
    for await (const event of events) {
      if (event.type === "usage") {
        const { type: _type, ...usage } = event;
        yield { type: "usage", usage };
        continue;
      }
      yield event;
    }
  } catch (error) {
    throw new Error(localAgentErrorMessage(error));
  }
}

export function localAgentErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  if (
    normalized.includes("model gateway is not configured") ||
    normalized.includes("gateway unavailable") ||
    normalized.includes("new api is not configured") ||
    /\b503\b/.test(normalized)
  ) {
    return "The model gateway is not configured.";
  }
  if (
    normalized.includes("invalid model request") ||
    normalized.includes("invalid model") ||
    normalized.includes("model not found") ||
    normalized.includes("model id is invalid") ||
    /\b400\b/.test(normalized) ||
    /\b404\b/.test(normalized)
  ) {
    return "The selected model is unavailable or invalid.";
  }
  if (
    normalized.includes("access denied") ||
    normalized.includes("forbidden") ||
    /\b403\b/.test(normalized)
  ) {
    return "The model gateway denied this request.";
  }
  if (normalized.includes("request too large") || /\b413\b/.test(normalized)) {
    return "The model request is too large.";
  }
  if (
    normalized.includes("insufficient_quota") ||
    normalized.includes("insufficient quota") ||
    normalized.includes("quota exhausted") ||
    /\b402\b/.test(normalized)
  ) {
    return "Your model quota is exhausted. Check your plan or balance.";
  }
  if (
    normalized.includes("unauthorized") ||
    normalized.includes("session expired") ||
    normalized.includes("invalid token") ||
    /\b401\b/.test(normalized)
  ) {
    return "Your session is no longer valid. Sign out and sign in again.";
  }
  if (
    normalized.includes("rate limit") ||
    normalized.includes("too many requests") ||
    /\b429\b/.test(normalized)
  ) {
    return "The model service is busy. Try again shortly.";
  }
  if (
    normalized.includes("fetch failed") ||
    normalized.includes("econnrefused") ||
    normalized.includes("enotfound") ||
    normalized.includes("network error")
  ) {
    return "Could not reach the model service. Check your connection and try again.";
  }
  if (
    normalized.includes("timed out") ||
    normalized.includes("timeout") ||
    normalized.includes("aborterror")
  ) {
    return "The model request timed out. Try again.";
  }
  return "The model request failed. Try again.";
}

/** Pi remains an implementation detail of the desktop composition root. */
export class PiLocalAgentEngine implements LocalAgentEngine {
  constructor(private readonly runtime: PiRuntime = new PiAgentRuntime()) {}

  run(
    request: LocalAgentRunRequest,
    context: LocalAgentRunContext = {},
  ): AsyncIterable<LocalAgentEvent> {
    const adapterContext: Partial<AdapterContext> = {
      operationId: request.runId,
      traceId: request.runId,
      spaceId: "local",
      userId: context.userId ?? "local",
      botId: request.botId,
      runId: request.runId,
      signal: context.signal ?? new AbortController().signal,
    };
    return toLocalEvents(
      this.runtime.run(toPiRequest(request), adapterContext),
    );
  }

  abort(runId: string): Promise<void> {
    return this.runtime.abort(runId);
  }
}

export { toPiRequest };
