import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { LocalAgentEngine } from "./agent.js";
import { LocalRuntimeService } from "./service.js";
import { LocalToolRegistry } from "./tools.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

const engine: LocalAgentEngine = {
  async *run() {
    yield { type: "text", text: "ok" };
    yield { type: "done" };
  },
  async abort() {},
};

const tools = new LocalToolRegistry([], () => true);
const resolveModel = () => ({
  provider: "openai-compatible",
  id: "test-model",
  baseUrl: "https://gateway.example/v1/model/openai",
  apiKey: "test-token",
});

async function tempDbPath(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "rakazo-local-runtime-"));
  directories.push(directory);
  return path.join(directory, "runtime.sqlite");
}

describe("local runtime service", () => {
  it("owns a database, creates bots, and survives reopen", async () => {
    const databasePath = await tempDbPath();
    const first = new LocalRuntimeService({ databasePath, engine, tools, resolveModel });
    const bot = first.createBot({ name: "Chief" });
    const result = await first.sendMessage(bot.id, "Hello");
    expect(result.text).toBe("ok");
    expect(first.listMessages(bot.id).map((message) => message.role)).toEqual(["user", "bot"]);
    first.close();

    const second = new LocalRuntimeService({ databasePath, engine, tools, resolveModel });
    expect(second.listBots().map((item) => item.id)).toEqual([bot.id]);
    expect(second.listMessages(bot.id).map((message) => message.role)).toEqual(["user", "bot"]);
    second.close();
  });

  it("returns no messages for an unknown bot", () => {
    const service = new LocalRuntimeService({
      databasePath: ":memory:",
      engine,
      tools,
      resolveModel,
    });
    expect(service.listMessages("missing")).toEqual([]);
    service.close();
  });

  it("persists client settings in the account database", async () => {
    const databasePath = await tempDbPath();
    const first = new LocalRuntimeService({ databasePath, engine, tools, resolveModel });
    expect(first.getUserSettings()).toEqual({
      theme: "system",
      sendWithEnter: true,
      defaultModelId: null,
    });
    first.updateUserSettings({
      theme: "light",
      sendWithEnter: false,
      defaultModelId: "model-a",
    });
    first.close();

    const second = new LocalRuntimeService({ databasePath, engine, tools, resolveModel });
    expect(second.getUserSettings()).toEqual({
      theme: "light",
      sendWithEnter: false,
      defaultModelId: "model-a",
    });
    second.close();
  });

  it("runs a persistent peer bot and records the request and reply", async () => {
    const service = new LocalRuntimeService({
      databasePath: ":memory:",
      engine,
      tools,
      resolveModel,
    });
    const source = service.createBot({ name: "Lead" });
    const target = service.createBot({ name: "Researcher" });

    await expect(
      service.sendPeerMessage({
        fromBotId: source.id,
        botId: target.id,
        message: "Check this finding.",
        intent: "request",
      }),
    ).resolves.toBe("ok");

    expect(service.listMessages(target.id).map((message) => message.role)).toEqual(["user", "bot"]);
    expect(service.db.peerMessages.listForBot(source.id)).toEqual([
      expect.objectContaining({
        fromBotId: source.id,
        toBotId: target.id,
        prompt: "Check this finding.",
        reply: "ok",
        status: "completed",
      }),
    ]);
    service.close();
  });

  it("stops peer bot cycles", () => {
    const service = new LocalRuntimeService({
      databasePath: ":memory:",
      engine,
      tools,
      resolveModel,
    });
    const source = service.createBot({ name: "Lead" });
    const target = service.createBot({ name: "Researcher" });

    return expect(
      service.sendPeerMessage({
        fromBotId: target.id,
        botId: source.id,
        message: "Loop",
        intent: "request",
        peerChain: [source.id, target.id],
      }),
    )
      .rejects.toThrow("cycle")
      .finally(() => service.close());
  });
});
