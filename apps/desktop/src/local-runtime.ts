import {
  createMediaGenerationProvider,
  fetchSafeWebText,
  KeylessHttpWebProvider,
  McpSession,
  plotSvgToPng,
  renderPlotSpecToSvg,
} from "@rakazo/adapters";
import { OPENAI_COMPATIBLE_PROVIDER_ID } from "@rakazo/contracts";
import type { Bot } from "@rakazo/local-db";
import {
  type ApproveLocalTool,
  type BrowserHost,
  createBrowserCompatibilityTools,
  createBrowserTools,
  createFileTools,
  createLocalAttachFileTool,
  createLocalComputerTools,
  createLocalDesktopTools,
  createLocalFleetTools,
  createLocalForgetMemoryTool,
  createLocalImageTool,
  createLocalInstructionProposalTool,
  createLocalInteractionTools,
  createLocalMcpTools,
  createLocalPlotTools,
  createLocalSecretTools,
  createLocalSkillRunTool,
  createLocalVideoTool,
  createLocalWebTools,
  createMessageBotTool,
  createShellTool,
  createSubagentTool,
  type LocalAgentEngine,
  type LocalAgentModel,
  type LocalComputerProvider,
  type LocalMcpConnection,
  type LocalRuntimeOptions,
  LocalRuntimeService,
  type LocalSecretVault,
  type LocalToolExecutionRequest,
  LocalToolRegistry,
  type PromptForLocalSecret,
} from "@rakazo/local-runtime";
import { prepareLocalAccountData } from "./local-account-data.js";
import { createLocalComputerProvider } from "./local-computer-provider.js";
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
  secretVault?: LocalSecretVault;
  promptForSecret?: PromptForLocalSecret;
  allowPrivateHttpSecretOrigins?: boolean;
  openFile?: (path: string) => Promise<string>;
  openUrl?: (url: string) => Promise<void>;
  launchApp?: (application: string, uri?: string) => Promise<void>;
  promptForUserChoice?: (
    question: string,
    options: string[],
    signal?: AbortSignal,
  ) => Promise<string | null>;
  computerProvider?: LocalComputerProvider | false;
  enableTicketTools?: boolean;
}

/** The desktop process owns one SQLite database under its userData directory. */
export async function createDesktopLocalRuntime(
  options: DesktopLocalRuntimeOptions,
): Promise<LocalRuntimeService> {
  const account = await prepareLocalAccountData(
    options.userDataDir,
    options.accountId,
  );
  let service: LocalRuntimeService | undefined;
  const web = new KeylessHttpWebProvider();
  const media = createMediaGenerationProvider();
  const computerProvider =
    options.computerProvider === false
      ? undefined
      : (options.computerProvider ?? createLocalComputerProvider());
  const connectMcp = async (config: {
    name: string;
    transport: "streamable-http" | "sse" | "stdio";
    endpoint?: string;
    command?: string;
    args: string[];
    env: Record<string, string>;
    headers: Record<string, string>;
    secret?: string;
  }): Promise<LocalMcpConnection> => {
    const session = new McpSession({ name: `ericBot-${config.name}` });
    if (config.transport === "stdio") {
      if (!config.command) throw new Error("MCP stdio command is required");
      await session.connectStdio({
        command: config.command,
        args: config.args,
        env: config.env,
        allowedCommands: [config.command],
      });
    } else {
      if (!config.endpoint) throw new Error("MCP endpoint is required");
      const endpoint = new URL(config.endpoint);
      const loopback = ["127.0.0.1", "::1", "localhost"].includes(
        endpoint.hostname,
      );
      const headers = {
        ...config.headers,
        ...(config.secret ? { Authorization: `Bearer ${config.secret}` } : {}),
      };
      await session.connectRemote({
        url: endpoint,
        transport: config.transport,
        headerPolicy: { headers },
        allowLegacySse: true,
        fallbackToSse: true,
        urlPolicy: {
          allowHttpLocalhost: loopback,
          allowPrivateEndpoint: loopback,
        },
      });
    }
    return {
      async listTools(signal) {
        const result = await session.listTools({ signal });
        return result.tools.map((tool) => ({
          name: tool.name,
          ...(tool.description ? { description: tool.description } : {}),
          inputSchema: tool.inputSchema as Record<string, unknown>,
          ...(tool.annotations?.readOnlyHint === undefined
            ? {}
            : { readOnly: tool.annotations.readOnlyHint }),
        }));
      },
      async callTool(name, args, signal) {
        const result = await session.callTool(name, args, { signal });
        return {
          content: result.content as unknown[],
          isError: result.isError === true,
        };
      },
      close: () => session.close(),
    };
  };
  const secretHttp = async (request: {
    url: string;
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
    body?: string;
    headers: Record<string, string>;
    signal?: AbortSignal;
  }) => {
    const response = await fetchSafeWebText(request.url, {
      method: request.method,
      ...(request.body === undefined ? {} : { body: request.body }),
      headers: request.headers,
      maxBytes: 1_000_000,
      maxRedirects: 0,
      allowErrorStatus: true,
      timeoutMs: 30_000,
      signal: request.signal ?? new AbortController().signal,
    });
    return {
      status: response.status,
      body: response.body,
      contentType: response.contentType,
    };
  };
  const createArtifact = (
    request: LocalToolExecutionRequest,
    input: { name: string; mimeType: string; content: Uint8Array },
  ) => {
    if (!service) throw new Error("Local runtime is not ready");
    const group = request.threadId
      ? service.db.groupThreads.get(request.threadId)
      : null;
    if (group) {
      return service.attachments.createBytes({
        groupId: group.groupId,
        name: input.name,
        mimeType: input.mimeType,
        content: input.content,
      });
    }
    if (!request.botId) throw new Error("Attachment needs a bot or group");
    return service.attachments.createBytes({
      botId: request.botId,
      name: input.name,
      mimeType: input.mimeType,
      content: input.content,
    });
  };
  const tools = new LocalToolRegistry(
    [
      createShellTool({
        workspaceDir: account.workspaceDir,
        environment: async (request) => {
          if (!service?.secrets || !request.botId) return {};
          return service.secrets.commandEnvironment(request.botId);
        },
      }),
      ...(options.browserHost ? createBrowserTools(options.browserHost) : []),
      ...(options.browserHost && options.secretVault
        ? createBrowserCompatibilityTools({
            host: options.browserHost,
            resolveLoginSecret: async ({ botId, name, field, origin }) => {
              if (!service?.secrets)
                throw new Error("Credential storage is unavailable");
              return (
                await service.secrets.revealLogin(botId, name, field, origin)
              ).value;
            },
          })
        : []),
      createSubagentTool(),
      createMessageBotTool(async (request) => {
        if (!service) throw new Error("Local runtime is not ready");
        return service.sendPeerMessage(request);
      }),
      ...createLocalFleetTools(() => {
        if (!service) throw new Error("Local runtime is not ready");
        return service;
      }),
      ...(options.openFile && options.openUrl && options.launchApp
        ? createLocalDesktopTools({
            workspaceDir: account.workspaceDir,
            openFile: options.openFile,
            openUrl: options.openUrl,
            launchApp: options.launchApp,
          })
        : []),
      ...(computerProvider ? createLocalComputerTools(computerProvider) : []),
      createLocalSkillRunTool(async (request) => {
        if (!service) throw new Error("Local runtime is not ready");
        if (!request.botId) throw new Error("Skill runs require a bot");
        return service.runSkill({
          botId: request.botId,
          name: typeof request.args.name === "string" ? request.args.name : "",
          entrypoint:
            typeof request.args.entrypoint === "string"
              ? request.args.entrypoint
              : "",
          args: request.args.args,
          ...(request.signal ? { signal: request.signal } : {}),
        });
      }),
      ...createLocalInteractionTools({
        ask: (question, choices, signal) => {
          if (!service) throw new Error("Local runtime is not ready");
          return service.askUser(question, choices, signal);
        },
        message: (request, text) => {
          if (!service) throw new Error("Local runtime is not ready");
          return Promise.resolve(service.postUserMessage(request, text));
        },
        takeover: async (reason, signal) => {
          if (!service) throw new Error("Local runtime is not ready");
          const answer = await service.askUser(
            reason,
            ["I've completed it", "Cancel"],
            signal,
          );
          return answer === "I've completed it";
        },
      }),
      createLocalInstructionProposalTool(async (request) => {
        if (!service) throw new Error("Local runtime is not ready");
        if (!request.botId)
          throw new Error("Instruction updates require a bot");
        return service.proposeInstructions({
          botId: request.botId,
          instructions:
            typeof request.args.instructions === "string"
              ? request.args.instructions
              : "",
          reason:
            typeof request.args.reason === "string" ? request.args.reason : "",
          ...(typeof request.args.expected_version === "number"
            ? { expectedVersion: request.args.expected_version }
            : {}),
        });
      }),
      ...(options.secretVault
        ? createLocalSecretTools({
            list: async (botId) => service!.listSecrets(botId),
            forget: async (botId, name) => ({
              removed: await service!.removeSecret(botId, name),
            }),
            request: async (botId, args, signal) =>
              service!.requestSecret(botId, args, signal),
            requestFromUser: async (botId, args, signal) =>
              service!.requestSecretFromUser(botId, args, signal),
          })
        : []),
      ...(options.secretVault
        ? createLocalMcpTools(() => {
            if (!service?.mcp) throw new Error("MCP support is unavailable");
            return service.mcp;
          })
        : []),
      createLocalForgetMemoryTool(async (request) => {
        if (!service) throw new Error("Local runtime is not ready");
        return service.forgetMemoryForTool(
          typeof request.args.id === "string" ? request.args.id : "",
          request.botId,
        );
      }),
      ...createFileTools({ workspaceDir: account.workspaceDir }),
      createLocalAttachFileTool({
        workspaceDir: account.workspaceDir,
        createArtifact,
      }),
      ...createLocalWebTools({
        search: (input) =>
          web.search(
            {
              query: input.query,
              maxResults: input.maxResults,
              ...(input.signal ? { signal: input.signal } : {}),
            },
            {
              operationId: `search-${Date.now()}`,
              traceId: `search-${Date.now()}`,
              spaceId: "local",
              userId: options.accountId,
              signal: input.signal ?? new AbortController().signal,
            },
          ),
        fetch: (input) =>
          web.fetch(
            {
              url: input.url,
              maxChars: input.maxChars,
              ...(input.signal ? { signal: input.signal } : {}),
            },
            {
              operationId: `fetch-${Date.now()}`,
              traceId: `fetch-${Date.now()}`,
              spaceId: "local",
              userId: options.accountId,
              signal: input.signal ?? new AbortController().signal,
            },
          ),
      }),
      ...createLocalPlotTools({
        workspaceDir: account.workspaceDir,
        renderPng: async (spec, data) => {
          const { JSDOM } = await import("jsdom");
          const svg = renderPlotSpecToSvg(
            spec,
            data,
            new JSDOM("").window.document,
          );
          return plotSvgToPng(svg);
        },
        createArtifact,
      }),
      ...(media?.capabilities.images
        ? [
            createLocalImageTool({
              generate: async ({ prompt, signal }) => {
                const output = await media.generateImage(
                  { prompt },
                  {
                    operationId: `image-${Date.now()}`,
                    traceId: `image-${Date.now()}`,
                    spaceId: "local",
                    userId: options.accountId,
                    signal: signal ?? new AbortController().signal,
                  },
                );
                if (output.mimeType !== "image/png") {
                  throw new Error(
                    "Image provider returned an unsupported format",
                  );
                }
                return { bytes: output.bytes, mimeType: "image/png" as const };
              },
              createArtifact,
            }),
          ]
        : []),
      ...(media?.capabilities.video
        ? [
            createLocalVideoTool({
              provider: media.id,
              submit: async ({ prompt, signal }) => {
                const job = await media.generateVideo(
                  { prompt },
                  {
                    operationId: `video-${Date.now()}`,
                    traceId: `video-${Date.now()}`,
                    spaceId: "local",
                    userId: options.accountId,
                    signal: signal ?? new AbortController().signal,
                  },
                );
                if (job.status !== "completed") return job;
                if (job.output.mimeType !== "video/mp4") {
                  throw new Error(
                    "Video provider returned an unsupported format",
                  );
                }
                return {
                  ...job,
                  output: { ...job.output, mimeType: "video/mp4" as const },
                };
              },
              poll: async (id, signal) => {
                const job = await media.pollVideo(id, {
                  operationId: `video-poll-${Date.now()}`,
                  traceId: `video-poll-${Date.now()}`,
                  spaceId: "local",
                  userId: options.accountId,
                  signal: signal ?? new AbortController().signal,
                });
                if (job.status !== "completed") return job;
                if (job.output.mimeType !== "video/mp4") {
                  throw new Error(
                    "Video provider returned an unsupported format",
                  );
                }
                return {
                  ...job,
                  output: { ...job.output, mimeType: "video/mp4" as const },
                };
              },
              jobs: {
                create(request, provider) {
                  if (!service?.db)
                    throw new Error("Local runtime is not ready");
                  if (!request.botId || !request.runId) {
                    throw new Error("Video generation needs a bot and run");
                  }
                  const group = request.threadId
                    ? service.db.groupThreads.get(request.threadId)
                    : null;
                  return service.db.mediaJobs.create({
                    botId: request.botId,
                    ...(group ? { groupId: group.groupId } : {}),
                    runId: request.runId,
                    executionId: request.executionId,
                    kind: "video",
                    provider,
                  });
                },
                findForExecution(request) {
                  if (!service?.db || !request.runId) return null;
                  return service.db.mediaJobs.findByExecution(
                    request.runId,
                    request.executionId,
                  );
                },
                get(request, id) {
                  if (!service?.db || !request.botId) return null;
                  const job = service.db.mediaJobs.get(id);
                  return job?.botId === request.botId ? job : null;
                },
                countForRun(request) {
                  if (!service?.db || !request.runId) return 0;
                  return service.db.mediaJobs.countForRun(
                    request.runId,
                    "video",
                  );
                },
                update(id, input) {
                  if (!service?.db)
                    throw new Error("Local runtime is not ready");
                  service.db.mediaJobs.update(id, input);
                },
              },
              createArtifact,
            }),
          ]
        : []),
    ],
    options.approveTool,
  );
  service = new LocalRuntimeService({
    databasePath: account.databasePath,
    workspaceDir: account.workspaceDir,
    engine: options.engine ?? new PiLocalAgentEngine(),
    tools,
    approveTool: options.approveTool,
    enableTicketTools: options.enableTicketTools === true,
    resolveModel: options.resolveModel,
    ...(options.secretVault ? { secretVault: options.secretVault } : {}),
    secretHttp,
    ...(options.promptForSecret
      ? { promptForSecret: options.promptForSecret }
      : {}),
    allowPrivateHttpSecretOrigins:
      options.allowPrivateHttpSecretOrigins === true,
    ...(options.promptForUserChoice
      ? { promptForUserChoice: options.promptForUserChoice }
      : {}),
    ...(options.secretVault ? { mcpConnector: connectMcp } : {}),
    onRunStart: options.onRunStart,
    onEvent: options.onEvent,
    onRunEnd: options.onRunEnd,
  });
  service.startRoutineScheduler();
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
    ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(
      input.bot.thinkingLevel,
    )
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
