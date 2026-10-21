import type { JsonValue, RunRepository } from "@rakazo/local-db";
import type { LocalAgentTool } from "./agent.js";
import type { LocalToolExecutionRequest, LocalToolProvider } from "./tools.js";

const MAX_RECORDED_JSON_CHARS = 32_000;

function recordedJson(value: unknown): JsonValue {
  try {
    const serialized = JSON.stringify(value);
    return JSON.parse(
      serialized.length <= MAX_RECORDED_JSON_CHARS
        ? serialized
        : JSON.stringify({
            truncated: true,
            preview: serialized.slice(0, MAX_RECORDED_JSON_CHARS),
          }),
    ) as JsonValue;
  } catch {
    return { truncated: true, text: String(value).slice(0, MAX_RECORDED_JSON_CHARS) };
  }
}

/** Persists local tool activity around the provider without changing its behavior. */
export class RecordingToolProvider implements LocalToolProvider {
  constructor(
    private readonly tools: LocalToolProvider,
    private readonly runs: RunRepository,
  ) {}

  definitionsFor(
    bot: Parameters<LocalToolProvider["definitionsFor"]>[0],
  ): LocalAgentTool[] | Promise<LocalAgentTool[]> {
    return this.tools.definitionsFor(bot);
  }

  async execute(request: LocalToolExecutionRequest): Promise<unknown> {
    const recordable = Boolean(request.runId && request.botId);
    if (recordable) {
      this.runs.startTool({
        runId: request.runId!,
        executionId: request.executionId,
        botId: request.botId!,
        toolName: request.name,
        arguments: recordedJson(request.args),
      });
    }
    try {
      const result = await this.tools.execute(request);
      if (recordable) {
        this.runs.finishTool(request.runId!, request.executionId, recordedJson(result));
      }
      return result;
    } catch (error) {
      if (recordable) {
        this.runs.finishTool(
          request.runId!,
          request.executionId,
          null,
          error instanceof Error ? error.message : String(error),
        );
      }
      throw error;
    }
  }
}
