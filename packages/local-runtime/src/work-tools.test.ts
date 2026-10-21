import { openLocalDatabase } from "@rakazo/local-db";
import { describe, expect, it, vi } from "vitest";
import { LocalToolRegistry } from "./tools.js";
import { LocalWorkToolProvider } from "./work-tools.js";

const bot = {
  id: "bot-1",
  name: "Operator",
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

describe("local work tools", () => {
  it("tracks scratchpad work and local tickets", async () => {
    const db = openLocalDatabase(":memory:");
    const created = db.bots.create({ name: "Operator" });
    const provider = new LocalWorkToolProvider(new LocalToolRegistry([]), db, () => true);
    const definitions = await provider.definitionsFor({ ...bot, id: created.id });
    expect(definitions.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["task_catalog", "scratchpad_add", "ticket_create", "ticket_comment"]),
    );
    const item = (await provider.execute({
      botId: created.id,
      name: "scratchpad_add",
      args: { title: "Review launch", notes: "Check rollback" },
      executionId: "scratch-add",
    })) as { id: string };
    expect(
      await provider.execute({
        botId: created.id,
        name: "scratchpad_complete",
        args: { itemId: item.id },
        executionId: "scratch-done",
      }),
    ).toEqual({ ok: true });
    expect(db.work.listScratchpad(created.id)).toEqual([]);

    const ticket = (await provider.execute({
      botId: created.id,
      name: "ticket_create",
      args: { title: "Prepare release", priority: "high" },
      executionId: "ticket-create",
    })) as { id: string; reference: string };
    expect(ticket.reference).toMatch(/^RAK-\d+$/);
    await provider.execute({
      botId: created.id,
      name: "ticket_update",
      args: { id: ticket.id, status: "doing" },
      executionId: "ticket-update",
    });
    await provider.execute({
      botId: created.id,
      name: "ticket_comment",
      args: { id: ticket.id, body: "Rollback verified." },
      executionId: "ticket-comment",
    });
    expect(db.work.getTicket(ticket.reference)).toMatchObject({
      status: "doing",
      comments: [{ body: "Rollback verified." }],
    });
    db.close();
  });

  it("requires approval to remove scratchpad work", async () => {
    const db = openLocalDatabase(":memory:");
    const created = db.bots.create({ name: "Operator" });
    const item = db.work.addScratchpad({ botId: created.id, title: "Temporary" });
    const approve = vi.fn(() => false);
    const provider = new LocalWorkToolProvider(new LocalToolRegistry([]), db, approve);
    await expect(
      provider.execute({
        botId: created.id,
        name: "scratchpad_remove",
        args: { itemId: item.id },
        executionId: "remove-1",
      }),
    ).rejects.toThrow("was not approved");
    expect(db.work.getScratchpad(item.id)).not.toBeNull();
    db.close();
  });
});
