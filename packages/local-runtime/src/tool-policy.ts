import type { Bot } from "@rakazo/local-db";
import type { LocalAgentTool } from "./agent.js";
import type { LocalToolExecutionRequest, LocalToolProvider } from "./tools.js";

/** Applies organization-wide tool policy on top of every provider layer. */
export class LocalToolPolicyProvider implements LocalToolProvider {
  constructor(
    private readonly tools: LocalToolProvider,
    private readonly disabledTools: () => readonly string[],
    private readonly getBot?: (botId: string) => Bot | null,
  ) {}

  async definitionsFor(bot: Bot): Promise<LocalAgentTool[]> {
    const disabled = new Set([...bot.disabledBuiltinTools, ...this.disabledTools()]);
    return this.tools.definitionsFor({ ...bot, disabledBuiltinTools: [...disabled] });
  }

  async execute(request: LocalToolExecutionRequest): Promise<unknown> {
    if (request.botId) {
      const bot = this.getBot?.(request.botId);
      if (
        bot &&
        new Set([...bot.disabledBuiltinTools, ...this.disabledTools()]).has(request.name)
      ) {
        throw new Error(`Tool ${request.name} is disabled by policy`);
      }
    }
    return this.tools.execute(request);
  }
}
