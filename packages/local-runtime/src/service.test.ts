import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ModelGateway } from "./model-gateway.js";
import { LocalRuntimeService } from "./service.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

const gateway: ModelGateway = {
  async *stream() {
    yield { type: "text", text: "ok" };
    yield { type: "done" };
  },
};

async function tempDbPath(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "rakazo-local-runtime-"));
  directories.push(directory);
  return path.join(directory, "runtime.sqlite");
}

describe("local runtime service", () => {
  it("owns a database, creates bots, and survives reopen", async () => {
    const databasePath = await tempDbPath();
    const first = new LocalRuntimeService({ databasePath, gateway });
    const bot = first.createBot({ name: "Chief" });
    const result = await first.sendMessage(bot.id, "Hello");
    expect(result.text).toBe("ok");
    expect(first.listMessages(bot.id).map((message) => message.role)).toEqual(["user", "bot"]);
    first.close();

    const second = new LocalRuntimeService({ databasePath, gateway });
    expect(second.listBots().map((item) => item.id)).toEqual([bot.id]);
    expect(second.listMessages(bot.id).map((message) => message.role)).toEqual(["user", "bot"]);
    second.close();
  });

  it("returns no messages for an unknown bot", () => {
    const service = new LocalRuntimeService({ databasePath: ":memory:", gateway });
    expect(service.listMessages("missing")).toEqual([]);
    service.close();
  });
});
