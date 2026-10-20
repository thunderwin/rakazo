import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ModelGateway } from "@rakazo/local-runtime";
import { afterEach, describe, expect, it } from "vitest";
import { createDesktopLocalRuntime } from "./local-runtime.js";

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

describe("desktop local runtime", () => {
  it("stores the local database under userData and survives reopen", async () => {
    const userDataDir = await mkdtemp(path.join(tmpdir(), "rakazo-desktop-local-"));
    directories.push(userDataDir);
    const first = createDesktopLocalRuntime({ userDataDir, gateway });
    const bot = first.createBot({ name: "Chief" });
    await first.sendMessage(bot.id, "Hello");
    expect(existsSync(path.join(userDataDir, "local", "rakazo.sqlite"))).toBe(true);
    first.close();

    const second = createDesktopLocalRuntime({ userDataDir, gateway });
    expect(second.listBots().map((item) => item.id)).toEqual([bot.id]);
    expect(second.listMessages(bot.id).map((message) => message.role)).toEqual(["user", "bot"]);
    second.close();
  });
});
