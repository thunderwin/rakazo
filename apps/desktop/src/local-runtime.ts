import path from "node:path";
import { OPENAI_COMPATIBLE_PROVIDER_ID } from "@rakazo/contracts";
import type { Bot } from "@rakazo/local-db";
import {
  type ApproveLocalTool,
  createShellTool,
  type LocalAgentEngine,
  type LocalAgentModel,
  LocalRuntimeService,
  LocalToolRegistry,
} from "@rakazo/local-runtime";
import { PiLocalAgentEngine } from "./pi-local-agent-engine.js";

export interface DesktopLocalRuntimeOptions {
  userDataDir: string;
  engine?: LocalAgentEngine;
  approveTool: ApproveLocalTool;
  resolveModel: (bot: Bot) => Promise<LocalAgentModel> | LocalAgentModel;
}

/** The desktop process owns one SQLite database under its userData directory. */
export function createDesktopLocalRuntime(
  options: DesktopLocalRuntimeOptions,
): LocalRuntimeService {
  const localDir = path.join(options.userDataDir, "local");
  const tools = new LocalToolRegistry(
    [
      createShellTool({
        workspaceDir: path.join(localDir, "workspace"),
      }),
    ],
    options.approveTool,
  );
  return new LocalRuntimeService({
    databasePath: path.join(localDir, "rakazo.sqlite"),
    engine: options.engine ?? new PiLocalAgentEngine(),
    tools,
    resolveModel: options.resolveModel,
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
