import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRevisionConflictError, openLocalDatabase } from "./index.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function tempDatabasePath(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "rakazo-local-db-"));
  directories.push(directory);
  return path.join(directory, "local.sqlite");
}

describe("local database", () => {
  it("persists bots, threads, and messages across reopen", async () => {
    const file = await tempDatabasePath();
    const first = openLocalDatabase(file);
    const bot = first.bots.create({
      name: "Researcher",
      instructions: "Verify sources.",
      templateKey: "researcher",
      templateVersion: 1,
    });
    const thread = first.threads.getOrCreateForBot(bot.id);
    first.messages.append({
      threadId: thread.id,
      role: "user",
      blocks: [{ kind: "text", text: "hello" }],
    });
    first.messages.append({
      threadId: thread.id,
      role: "bot",
      blocks: [{ kind: "text", text: "hi" }],
    });
    first.close();

    const second = openLocalDatabase(file);
    expect(second.bots.list()).toHaveLength(1);
    expect(second.bots.get(bot.id)?.instructions).toBe("Verify sources.");
    expect(second.threads.getForBot(bot.id)?.id).toBe(thread.id);
    expect(second.messages.list(thread.id).map((message) => message.role)).toEqual(["user", "bot"]);
    second.close();
  });

  it("is idempotent across migrations", async () => {
    const file = await tempDatabasePath();
    const first = openLocalDatabase(file);
    first.close();
    const second = openLocalDatabase(file);
    expect(second.sqlite.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get()).toEqual({
      count: 7,
    });
    second.close();
  });

  it("stores settings as JSON", async () => {
    const db = openLocalDatabase(":memory:");
    db.settings.set("ui", { theme: "dark", sidebar: 280 });
    expect(db.settings.get("ui")).toEqual({ theme: "dark", sidebar: 280 });
    db.settings.set("ui", { theme: "light" });
    expect(db.settings.get("ui")).toEqual({ theme: "light" });
    db.close();
  });

  it("updates only supplied bot fields and can clear nullable ones", async () => {
    const db = openLocalDatabase(":memory:");
    const bot = db.bots.create({
      name: "Researcher",
      title: "Research",
      instructions: "Verify sources.",
      modelProvider: "openrouter",
      modelId: "model-a",
      disabledBuiltinTools: ["shell"],
    });

    const updated = db.bots.update(bot.id, {
      title: "Deep research",
      modelProvider: null,
      modelId: null,
    });

    expect(updated).toMatchObject({
      id: bot.id,
      name: "Researcher",
      title: "Deep research",
      instructions: "Verify sources.",
      modelProvider: null,
      modelId: null,
      disabledBuiltinTools: ["shell"],
    });
    expect(db.bots.update("missing", { name: "Nope" })).toBeNull();
    db.close();
  });

  it("reuses one thread per bot and keeps message order", async () => {
    const db = openLocalDatabase(":memory:");
    const bot = db.bots.create({ name: "Chief" });
    const thread = db.threads.getOrCreateForBot(bot.id);
    expect(db.threads.getOrCreateForBot(bot.id).id).toBe(thread.id);
    expect(db.threads.getForBot(bot.id)?.id).toBe(thread.id);

    for (const text of ["one", "two", "three"]) {
      db.messages.append({
        threadId: thread.id,
        role: "user",
        blocks: [{ kind: "text", text }],
      });
    }

    expect(db.messages.list(thread.id).map((message) => message.sequence)).toEqual([1, 2, 3]);
    expect(db.messages.list(thread.id, { limit: 2 }).map((message) => message.sequence)).toEqual([
      2, 3,
    ]);
    expect(db.messages.list(thread.id, { limit: 0 }).map((message) => message.sequence)).toEqual([
      3,
    ]);
    db.close();
  });

  it("stores group membership and one ordered group thread", async () => {
    const db = openLocalDatabase(":memory:");
    const first = db.bots.create({ name: "Researcher" });
    const second = db.bots.create({ name: "Writer" });
    const group = db.groups.create({
      name: "Launch",
      botIds: [first.id, second.id],
    });
    const thread = db.groupThreads.getOrCreate(group.id, group.name);
    db.groupMessages.append({
      threadId: thread.id,
      role: "user",
      blocks: [{ kind: "text", text: "Start" }],
    });
    db.groupMessages.append({
      threadId: thread.id,
      role: "bot",
      botId: second.id,
      blocks: [{ kind: "text", text: "Done" }],
    });

    expect(group.members.map((member) => member.name)).toEqual(["Researcher", "Writer"]);
    expect(db.groupThreads.getOrCreate(group.id).id).toBe(thread.id);
    expect(db.groupMessages.list(thread.id).map((message) => message.sequence)).toEqual([1, 2]);
    expect(db.groupMessages.list(thread.id)[1]?.botId).toBe(second.id);
    db.close();
  });

  it("versions bot and shared memory and rejects stale writes", () => {
    const db = openLocalDatabase(":memory:");
    const bot = db.bots.create({ name: "Researcher" });
    const botMemory = db.memory.commit({
      scope: "bot",
      botId: bot.id,
      path: "MEMORY.md",
      content: "Prefers primary sources.\n",
      expectedRevision: 0,
      sourceRunId: "run-1",
    });
    const updated = db.memory.commit({
      scope: "bot",
      botId: bot.id,
      path: "MEMORY.md",
      content: "Prefers primary sources.\nWorks in Berlin.\n",
      expectedRevision: botMemory.revision,
      sourceRunId: "run-2",
    });
    const shared = db.memory.commit({
      scope: "user",
      path: "TEAM.md",
      content: "Use the shared launch date.\n",
      expectedRevision: 0,
    });

    expect(updated).toMatchObject({ revision: 2, botId: bot.id });
    expect(shared).toMatchObject({ revision: 1, botId: null });
    expect(
      db.memory.list({ scope: "bot", botId: bot.id }).map((document) => document.path),
    ).toEqual(["MEMORY.md"]);
    expect(db.memory.list({ scope: "user" }).map((document) => document.path)).toEqual(["TEAM.md"]);
    expect(() =>
      db.memory.commit({
        scope: "bot",
        botId: bot.id,
        path: "MEMORY.md",
        content: "stale",
        expectedRevision: 1,
      }),
    ).toThrow(MemoryRevisionConflictError);
    expect(
      db.sqlite
        .prepare("SELECT COUNT(*) AS count FROM memory_revisions WHERE document_id = ?")
        .get(botMemory.id),
    ).toEqual({ count: 2 });

    expect(db.memory.remove(shared.id)).toBe(true);
    expect(db.memory.get(shared.id)).toBeNull();
    db.close();
  });

  it("stores routine schedules and idempotent run claims", () => {
    const db = openLocalDatabase(":memory:");
    const bot = db.bots.create({ name: "Researcher" });
    const due = db.routines.create({
      botId: bot.id,
      name: "Morning brief",
      prompt: "Summarize the overnight changes.",
      cron: "0 9 * * 1-5",
      timezone: "Asia/Hong_Kong",
      enabled: true,
      nextRunAt: "2026-10-21T01:00:00.000Z",
    });
    db.routines.create({
      botId: bot.id,
      name: "Future",
      prompt: "Later.",
      cron: "0 10 * * 1-5",
      timezone: "Asia/Hong_Kong",
      enabled: true,
      nextRunAt: "2026-10-22T02:00:00.000Z",
    });

    expect(db.routines.listDue("2026-10-21T02:00:00.000Z").map((routine) => routine.id)).toEqual([
      due.id,
    ]);
    const started = db.routines.startRun({
      routineId: due.id,
      scheduledFor: due.nextRunAt!,
      trigger: "scheduled",
      startedAt: "2026-10-21T01:00:01.000Z",
    })!;
    expect(
      db.routines.startRun({
        routineId: due.id,
        scheduledFor: due.nextRunAt!,
        trigger: "scheduled",
        startedAt: "2026-10-21T01:00:02.000Z",
      }),
    ).toBeNull();
    db.runs.start({
      id: "run-1",
      kind: "direct",
      botId: bot.id,
      threadId: "thread-1",
    });
    db.routines.finishRun(started.id, {
      runId: "run-1",
      status: "completed",
      endedAt: "2026-10-21T01:00:03.000Z",
    });
    db.routines.finishSchedule({
      id: due.id,
      lastRunAt: "2026-10-21T01:00:03.000Z",
      nextRunAt: "2026-10-22T01:00:00.000Z",
    });

    expect(db.routines.getRun(started.id)).toMatchObject({
      runId: "run-1",
      status: "completed",
    });
    expect(db.routines.get(due.id)).toMatchObject({
      timezone: "Asia/Hong_Kong",
      nextRunAt: "2026-10-22T01:00:00.000Z",
    });
    expect(db.routines.listRuns(due.id)).toHaveLength(1);
    expect(db.routines.remove(due.id)).toBe(true);
    expect(db.routines.getRun(started.id)).toBeNull();
    db.close();
  });

  it("stores local artifact metadata and bytes", () => {
    const db = openLocalDatabase(":memory:");
    const bot = db.bots.create({ name: "Reader" });
    const artifact = db.artifacts.create({
      botId: bot.id,
      name: "notes.txt",
      mimeType: "text/plain",
      content: new TextEncoder().encode("local notes"),
    });

    expect(artifact).toMatchObject({
      botId: bot.id,
      groupId: null,
      name: "notes.txt",
      mimeType: "text/plain",
      size: 11,
    });
    expect(new TextDecoder().decode(db.artifacts.read(artifact.id)!.content)).toBe("local notes");
    expect(() =>
      db.artifacts.create({
        botId: bot.id,
        name: "empty.txt",
        mimeType: "text/plain",
        content: new Uint8Array(),
      }),
    ).toThrow("empty");
    db.close();
  });

  it("enables WAL and foreign keys for file databases", async () => {
    const file = await tempDatabasePath();
    const db = openLocalDatabase(file);
    expect(db.sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(db.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    db.close();
  });

  it("rejects messages for a missing thread", async () => {
    const db = openLocalDatabase(":memory:");
    expect(() =>
      db.messages.append({
        threadId: "missing",
        role: "user",
        blocks: [{ kind: "text", text: "orphan" }],
      }),
    ).toThrow();
    db.close();
  });

  it("backs up to a separate database", async () => {
    const file = await tempDatabasePath();
    const backup = path.join(path.dirname(file), "nested", "backup.sqlite");
    const db = openLocalDatabase(file);
    const bot = db.bots.create({ name: "Backup" });
    await db.backupTo(backup);
    db.close();

    const restored = openLocalDatabase(backup);
    expect(restored.bots.get(bot.id)?.name).toBe("Backup");
    restored.close();
  });
});
