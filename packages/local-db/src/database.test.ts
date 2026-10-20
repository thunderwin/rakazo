import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openLocalDatabase } from "./index.js";

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
      count: 2,
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
