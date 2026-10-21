import { openLocalDatabase } from "@rakazo/local-db";
import { describe, expect, it } from "vitest";
import { LocalHistoryToolProvider } from "./history-tools.js";
import { LocalToolRegistry } from "./tools.js";

const bot = {
  id: "bot-1",
  name: "Researcher",
  title: "",
  description: "",
  instructions: "",
  color: "blue",
  modelProvider: null,
  modelId: null,
  thinkingLevel: null,
  disabledBuiltinTools: [],
  fleetManagement: false,
  createdByBotId: null,
  instructionsVersion: 1,
  templateKey: null,
  templateVersion: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("local history tools", () => {
  it("searches and reads messages from the current bot thread", async () => {
    const db = openLocalDatabase(":memory:");
    const created = db.bots.create({ name: "Researcher" });
    const thread = db.threads.getOrCreateForBot(created.id);
    const message = db.messages.append({
      threadId: thread.id,
      role: "user",
      blocks: [{ kind: "text", text: "The launch codename is Aurora." }],
    });
    const provider = new LocalHistoryToolProvider(new LocalToolRegistry([]), db);
    expect(
      (await provider.definitionsFor({ ...bot, id: created.id })).map((tool) => tool.name),
    ).toEqual(["search_history", "read_history"]);
    await expect(
      provider.execute({
        botId: created.id,
        threadId: thread.id,
        name: "search_history",
        args: { query: "Aurora" },
        executionId: "search-1",
      }),
    ).resolves.toMatchObject({
      results: [expect.objectContaining({ id: message.id, role: "user" })],
    });
    await expect(
      provider.execute({
        botId: created.id,
        threadId: thread.id,
        name: "read_history",
        args: { message_id: message.id },
        executionId: "read-1",
      }),
    ).resolves.toMatchObject({
      id: message.id,
      text: "The launch codename is Aurora.",
    });
    db.close();
  });
});
