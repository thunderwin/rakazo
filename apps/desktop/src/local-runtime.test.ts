import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Bot } from "@rakazo/local-db";
import type { LocalAgentEngine, LocalAgentEvent } from "@rakazo/local-runtime";
import { afterEach, describe, expect, it } from "vitest";
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
});
