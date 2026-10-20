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
    tools: request.tools,
    model: request.model,
    contextStrategy: "current",
    executeTool: request.executeTool,
  };
}

async function* toLocalEvents(
  events: AsyncIterable<AgentRuntimeEvent>,
): AsyncIterable<LocalAgentEvent> {
  for await (const event of events) {
    if (event.type === "usage") {
      const { type: _type, ...usage } = event;
      yield { type: "usage", usage };
      continue;
    }
    yield event;
  }
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
    return toLocalEvents(this.runtime.run(toPiRequest(request), adapterContext));
  }

  abort(runId: string): Promise<void> {
    return this.runtime.abort(runId);
  }
}

export { toPiRequest };
