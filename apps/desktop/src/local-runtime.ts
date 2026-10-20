import { OPENAI_COMPATIBLE_PROVIDER_ID } from "@rakazo/contracts";
import type { Bot } from "@rakazo/local-db";
import {
  type ApproveLocalTool,
  createFileTools,
  createShellTool,
  createSubagentTool,
  type LocalAgentEngine,
  type LocalAgentModel,
  type LocalRuntimeOptions,
  LocalRuntimeService,
  LocalToolRegistry,
} from "@rakazo/local-runtime";
import { prepareLocalAccountData } from "./local-account-data.js";
import { PiLocalAgentEngine } from "./pi-local-agent-engine.js";

export interface DesktopLocalRuntimeOptions {
  userDataDir: string;
  accountId: string;
  engine?: LocalAgentEngine;
  approveTool: ApproveLocalTool;
  resolveModel: (bot: Bot) => Promise<LocalAgentModel> | LocalAgentModel;
  onRunStart?: LocalRuntimeOptions["onRunStart"];
  onEvent?: LocalRuntimeOptions["onEvent"];
}

/** The desktop process owns one SQLite database under its userData directory. */
export async function createDesktopLocalRuntime(
  options: DesktopLocalRuntimeOptions,
): Promise<LocalRuntimeService> {
  const account = await prepareLocalAccountData(options.userDataDir, options.accountId);
  const tools = new LocalToolRegistry(
    [
      createShellTool({ workspaceDir: account.workspaceDir }),
      createSubagentTool(),
      ...createFileTools({ workspaceDir: account.workspaceDir }),
    ],
    options.approveTool,
  );
  return new LocalRuntimeService({
    databasePath: account.databasePath,
    engine: options.engine ?? new PiLocalAgentEngine(),
    tools,
    resolveModel: options.resolveModel,
    onRunStart: options.onRunStart,
    onEvent: options.onEvent,
  });
}

export function defaultLocalModel(input: {
  baseUrl: string;
  apiKey: string;
  bot: Bot;
  fallbackModelId?: string;
}): LocalAgentModel {
  const thinkingLevel =
    input.bot.thinkingLevel &&
    ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(input.bot.thinkingLevel)
      ? (input.bot.thinkingLevel as LocalAgentModel["thinkingLevel"])
      : undefined;
  return {
    provider: OPENAI_COMPATIBLE_PROVIDER_ID,
    id: input.bot.modelId?.trim() || input.fallbackModelId || "default",
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    allowPublicEndpoint: true,
    baseUrlIsExact: true,
    ...(thinkingLevel ? { thinkingLevel } : {}),
  };
}
