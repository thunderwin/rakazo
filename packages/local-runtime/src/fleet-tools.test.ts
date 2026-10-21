import { type Bot, type LocalDatabase, openLocalDatabase } from "@rakazo/local-db";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createLocalFleetTools,
  LOCAL_FLEET_TOOL_NAMES,
  type LocalFleetService,
} from "./fleet-tools.js";
import { LocalToolRegistry } from "./tools.js";

function setup(fleetManagement = true) {
  const db = openLocalDatabase(":memory:");
  const createRoutine = vi.fn((botId: string) => ({
    id: "routine-1",
    botId,
    name: "Daily",
    prompt: "Summarize.",
    cron: "0 9 * * *",
    timezone: "UTC",
    enabled: true,
    source: "local" as const,
    managedKey: null,
    packageId: null,
    version: null,
    lastRunAt: null,
    nextRunAt: "2026-10-22T09:00:00.000Z",
    createdAt: "2026-10-21T00:00:00.000Z",
    updatedAt: "2026-10-21T00:00:00.000Z",
  }));
  const service: LocalFleetService = { db, createRoutine };
  const approve = vi.fn(() => true);
  const registry = new LocalToolRegistry(
    createLocalFleetTools(() => service),
    approve,
  );
  const manager = db.bots.create({
    name: "Chief",
    fleetManagement,
    instructions: "Manage the team.",
  });
  return { approve, createRoutine, db, manager, registry };
}

function execute(
  registry: LocalToolRegistry,
  manager: Bot,
  name: string,
  args: Record<string, unknown>,
  fleetManagementAllowed?: boolean,
) {
  return registry.execute({
    botId: manager.id,
    name,
    args,
    executionId: `${name}-1`,
    ...(fleetManagementAllowed === undefined ? {} : { fleetManagementAllowed }),
  });
}

const databases: LocalDatabase[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe("local fleet tools", () => {
  it("hides fleet tools unless the bot capability is enabled", () => {
    const { db, manager, registry } = setup(false);
    databases.push(db);
    expect(registry.definitionsFor(manager).map((tool) => tool.name)).not.toEqual(
      expect.arrayContaining([...LOCAL_FLEET_TOOL_NAMES]),
    );
  });

  it("creates a child bot behind approval and never inherits fleet management", async () => {
    const { approve, db, manager, registry } = setup();
    databases.push(db);
    expect(registry.definitionsFor(manager).map((tool) => tool.name)).toEqual(
      expect.arrayContaining([...LOCAL_FLEET_TOOL_NAMES]),
    );

    const result = (await execute(registry, manager, "spawn_bot", {
      name: "Researcher",
      instructions: "Find primary sources.",
    })) as { bot: Bot };

    expect(approve).toHaveBeenCalledOnce();
    expect(result.bot.createdByBotId).toBe(manager.id);
    expect(result.bot.fleetManagement).toBe(false);
    expect(db.bots.list().find((bot) => bot.id === result.bot.id)?.name).toBe("Researcher");
  });

  it("organizes bots and groups, and archives a child without deleting its data", async () => {
    const { db, manager, registry } = setup();
    databases.push(db);
    const child = db.bots.create({
      name: "Scout",
      createdByBotId: manager.id,
    });
    db.threads.getOrCreateForBot(child.id);
    const peer = db.bots.create({ name: "Writer" });
    const group = db.groups.create({ name: "Launch", botIds: [child.id, peer.id] });
    db.routines.create({
      botId: child.id,
      name: "Daily",
      prompt: "Report.",
      cron: "0 9 * * *",
      timezone: "UTC",
      enabled: true,
      nextRunAt: "2026-10-22T09:00:00.000Z",
    });

    await execute(registry, manager, "organize_bot", {
      bot_id: child.id,
      section: "Research",
      pinned: true,
    });
    expect(db.bots.get(child.id)).toMatchObject({ section: "Research", pinned: true });
    await execute(registry, manager, "organize_bot", {
      group_id: group.id,
      section: "Projects",
    });
    expect(db.groups.get(group.id)).toMatchObject({ section: "Projects" });

    await execute(registry, manager, "archive_bot", {
      bot_id: child.id,
      confirm_name: "Scout",
    });
    expect(db.bots.listActive().map((bot) => bot.id)).not.toContain(child.id);
    expect(db.bots.listArchived()).toEqual([
      expect.objectContaining({ id: child.id, name: "Scout" }),
    ]);
    expect(db.routines.list(child.id)[0]).toMatchObject({
      enabled: false,
      nextRunAt: null,
    });
    expect(db.threads.getForBot(child.id)).not.toBeNull();
  });

  it("reads and updates only child instructions with version checks", async () => {
    const { db, manager, registry } = setup();
    databases.push(db);
    const child = db.bots.create({
      name: "Writer",
      instructions: "Draft.",
      createdByBotId: manager.id,
    });

    const listed = (await execute(registry, manager, "list_fleet", {
      bot_id: child.id,
    })) as { bot: { instructions: string; instructionsVersion: number } };
    expect(listed.bot).toMatchObject({ instructions: "Draft.", instructionsVersion: 1 });

    const updated = (await execute(registry, manager, "set_child_instructions", {
      bot_id: child.id,
      instructions: "Draft carefully.",
      expected_version: 1,
    })) as { instructionsVersion: number };
    expect(updated.instructionsVersion).toBe(2);

    await expect(
      execute(registry, manager, "set_child_instructions", {
        bot_id: child.id,
        instructions: "Overwrite stale.",
        expected_version: 1,
      }),
    ).rejects.toThrow("child changed");
  });

  it("does not manage bots the user created", async () => {
    const { db, manager, registry } = setup();
    databases.push(db);
    const unrelated = db.bots.create({ name: "User bot" });
    await expect(
      execute(registry, manager, "update_bot", {
        bot_id: unrelated.id,
        name: "Changed",
      }),
    ).rejects.toThrow("Child bot not found");
  });

  it("creates and updates local groups", async () => {
    const { db, manager, registry } = setup();
    databases.push(db);
    const child = db.bots.create({ name: "Writer", createdByBotId: manager.id });
    const created = (await execute(registry, manager, "create_group", {
      name: "Launch",
      bot_ids: [manager.id, child.id],
    })) as { group: { id: string; name: string } };

    const updated = (await execute(registry, manager, "update_group", {
      group_id: created.group.id,
      name: "Launch team",
    })) as { group: { name: string } };
    expect(updated.group.name).toBe("Launch team");
  });

  it("creates routines only for a child and blocks fleet tools on automated runs", async () => {
    const { createRoutine, db, manager, registry } = setup();
    databases.push(db);
    const child = db.bots.create({ name: "Reporter", createdByBotId: manager.id });

    await execute(registry, manager, "create_child_routine", {
      bot_id: child.id,
      name: "Daily",
      prompt: "Summarize.",
      cron: "0 9 * * *",
    });
    expect(createRoutine).toHaveBeenCalledWith(
      child.id,
      expect.objectContaining({ name: "Daily", prompt: "Summarize.", cron: "0 9 * * *" }),
    );

    await expect(execute(registry, manager, "list_fleet", {}, false)).rejects.toThrow(
      "owner started",
    );
  });
});
