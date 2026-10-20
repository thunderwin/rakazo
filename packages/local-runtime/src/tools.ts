import type { Bot } from "@rakazo/local-db";
import type { LocalAgentTool } from "./agent.js";

export interface LocalToolExecutionRequest {
  name: string;
  args: Record<string, unknown>;
  executionId: string;
  signal?: AbortSignal;
}

export interface LocalTool {
  definition: LocalAgentTool;
  execute(request: LocalToolExecutionRequest): Promise<unknown>;
}

export interface LocalToolApprovalRequest {
  name: string;
  args: Record<string, unknown>;
  executionId: string;
}

export type ApproveLocalTool = (request: LocalToolApprovalRequest) => Promise<boolean> | boolean;

export interface LocalToolProvider {
  definitionsFor(bot: Bot): LocalAgentTool[];
  execute(request: LocalToolExecutionRequest): Promise<unknown>;
}

/** One registry owns tool schemas, bot-level filtering, and the approval gate. */
export class LocalToolRegistry implements LocalToolProvider {
  private readonly tools: Map<string, LocalTool>;

  constructor(
    tools: readonly LocalTool[],
    private readonly approve: ApproveLocalTool = () => false,
  ) {
    this.tools = new Map(tools.map((tool) => [tool.definition.name, tool]));
  }

  definitionsFor(bot: Bot): LocalAgentTool[] {
    const disabled = new Set(bot.disabledBuiltinTools);
    return [...this.tools.values()]
      .filter((tool) => !disabled.has(tool.definition.name))
      .map((tool) => tool.definition);
  }

  async execute(request: LocalToolExecutionRequest): Promise<unknown> {
    const tool = this.tools.get(request.name);
    if (!tool) throw new Error(`Tool ${request.name} is not available`);
    if (!tool.definition.readOnly && !(await this.approve(request))) {
      throw new Error(`Tool ${request.name} was not approved`);
    }
    request.signal?.throwIfAborted();
    return tool.execute(request);
  }
}
