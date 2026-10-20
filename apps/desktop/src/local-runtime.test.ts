import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Bot } from "@rakazo/local-db";
import type { BrowserHost, LocalAgentEngine, LocalAgentEvent } from "@rakazo/local-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localAccountKey } from "./local-account-data.js";
import { createDesktopLocalRuntime, defaultLocalModel } from "./local-runtime.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

const engine: LocalAgentEngine = {
  async *run(): AsyncIterable<LocalAgentEvent> {
    yield { type: "text", text: "ok" };
    yield { type: "done" };
  },
  async abort() {},
};

const resolveModel = () => ({
  provider: "openai-compatible",
  id: "test-model",
  baseUrl: "https://gateway.example/v1/model/openai",
  apiKey: "test-token",
});

describe("desktop local runtime", () => {
  it("stores the local database under userData and survives reopen", async () => {
    const userDataDir = await mkdtemp(path.join(tmpdir(), "rakazo-desktop-local-"));
    directories.push(userDataDir);
    const first = await createDesktopLocalRuntime({
      userDataDir,
      accountId: "user-1",
      engine,
      approveTool: () => true,
      resolveModel,
    });
    const bot = first.createBot({ name: "Chief" });
    await first.sendMessage(bot.id, "Hello");
    expect(
      existsSync(
        path.join(userDataDir, "local", "accounts", localAccountKey("user-1"), "rakazo.sqlite"),
      ),
    ).toBe(true);
    first.close();

    const second = await createDesktopLocalRuntime({
      userDataDir,
      accountId: "user-1",
      engine,
      approveTool: () => true,
      resolveModel,
    });
    expect(second.listBots().map((item) => item.id)).toEqual([bot.id]);
    expect(second.listMessages(bot.id).map((message) => message.role)).toEqual(["user", "bot"]);
    second.close();
  });

  it("pins model requests to the trusted public gateway", () => {
    const bot: Bot = {
      id: "bot-1",
      name: "Chief",
      title: "",
      description: "",
      instructions: "",
      color: "blue",
      modelProvider: "ignored-provider",
      modelId: "model-a",
      thinkingLevel: "unsupported",
      disabledBuiltinTools: [],
      templateKey: null,
      templateVersion: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    expect(
      defaultLocalModel({
        baseUrl: "https://gateway.example/v1/model/openai",
        apiKey: "session-token",
        bot,
      }),
    ).toEqual({
      provider: "openai-compatible",
      id: "model-a",
      baseUrl: "https://gateway.example/v1/model/openai",
      apiKey: "session-token",
      allowPublicEndpoint: true,
      baseUrlIsExact: true,
    });
  });

  it("does not expose bots between local accounts", async () => {
    const userDataDir = await mkdtemp(path.join(tmpdir(), "rakazo-desktop-accounts-"));
    directories.push(userDataDir);
    const first = await createDesktopLocalRuntime({
      userDataDir,
      accountId: "user-1",
      engine,
      approveTool: () => true,
      resolveModel,
    });
    const firstBot = first.createBot({ name: "First user" });
    first.close();

    const second = await createDesktopLocalRuntime({
      userDataDir,
      accountId: "user-2",
      engine,
      approveTool: () => true,
      resolveModel,
    });
    const secondBot = second.createBot({ name: "Second user" });
    expect(second.listBots().map((bot) => bot.id)).toEqual([secondBot.id]);
    second.close();

    const firstAgain = await createDesktopLocalRuntime({
      userDataDir,
      accountId: "user-1",
      engine,
      approveTool: () => true,
      resolveModel,
    });
    expect(firstAgain.listBots().map((bot) => bot.id)).toEqual([firstBot.id]);
    firstAgain.close();
  });

  it("composes browser tools into the local Pi tool loop", async () => {
    const userDataDir = await mkdtemp(path.join(tmpdir(), "rakazo-desktop-browser-"));
    directories.push(userDataDir);
    const browserHost = {
      listTabs: vi.fn(async () => []),
      getTab: vi.fn(),
      open: vi.fn(),
      navigate: vi.fn(),
      borrowTab: vi.fn(),
      returnTab: vi.fn(),
      observe: vi.fn(async () => ({
        observation_id: "obs-1",
        tab_id: 7,
        title: "Inbox",
        url: "https://mail.example.com/",
        text: "Inbox",
        elements: [],
        truncated: false,
      })),
      click: vi.fn(),
      type: vi.fn(),
      scroll: vi.fn(),
      closeSession: vi.fn(async () => undefined),
    } satisfies BrowserHost;
    const browserEngine: LocalAgentEngine = {
      async *run(request): AsyncIterable<LocalAgentEvent> {
        expect(request.tools.map((tool) => tool.name)).toContain("browser_observe");
        const result = await request.executeTool("browser_observe", {}, "exec-1");
        yield { type: "text", text: (result as { text: string }).text };
        yield { type: "done" };
      },
      async abort() {},
    };
    const service = await createDesktopLocalRuntime({
      userDataDir,
      accountId: "browser-user",
      engine: browserEngine,
      browserHost,
      approveTool: () => true,
      resolveModel,
    });

    const bot = service.createBot({ name: "Browser bot" });
    await expect(service.sendMessage(bot.id, "Read the inbox")).resolves.toEqual(
      expect.objectContaining({ text: "Inbox" }),
    );
    expect(browserHost.observe).toHaveBeenCalledWith(
      expect.any(String),
      { maxElements: undefined, maxTextChars: undefined },
      undefined,
    );
    service.close();
  });
});
