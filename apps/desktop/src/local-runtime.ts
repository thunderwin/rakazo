import { OPENAI_COMPATIBLE_PROVIDER_ID } from "@rakazo/contracts";
import type { Bot } from "@rakazo/local-db";
import {
  type ApproveLocalTool,
  type BrowserHost,
  createBrowserTools,
  createFileTools,
  createMessageBotTool,
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
  browserHost?: BrowserHost;
  approveTool: ApproveLocalTool;
  resolveModel: (bot: Bot) => Promise<LocalAgentModel> | LocalAgentModel;
  onRunStart?: LocalRuntimeOptions["onRunStart"];
  onEvent?: LocalRuntimeOptions["onEvent"];
  onRunEnd?: LocalRuntimeOptions["onRunEnd"];
}

/** The desktop process owns one SQLite database under its userData directory. */
export async function createDesktopLocalRuntime(
  options: DesktopLocalRuntimeOptions,
): Promise<LocalRuntimeService> {
  const account = await prepareLocalAccountData(options.userDataDir, options.accountId);
  let service: LocalRuntimeService | undefined;
  const tools = new LocalToolRegistry(
    [
      createShellTool({ workspaceDir: account.workspaceDir }),
      ...(options.browserHost ? createBrowserTools(options.browserHost) : []),
      createSubagentTool(),
      createMessageBotTool(async (request) => {
        if (!service) throw new Error("Local runtime is not ready");
        return service.sendPeerMessage(request);
      }),
      ...createFileTools({ workspaceDir: account.workspaceDir }),
    ],
    options.approveTool,
  );
  service = new LocalRuntimeService({
    databasePath: account.databasePath,
    engine: options.engine ?? new PiLocalAgentEngine(),
    tools,
    resolveModel: options.resolveModel,
    onRunStart: options.onRunStart,
    onEvent: options.onEvent,
    onRunEnd: options.onRunEnd,
  });
  return service;
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
