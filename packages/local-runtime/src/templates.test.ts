import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { openLocalDatabase } from "@rakazo/local-db";
import { afterEach, describe, expect, it } from "vitest";
import { loadBotTemplatesFromDirectory, parseBotTemplate, seedBotTemplates } from "./templates.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function templateDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "rakazo-templates-"));
  directories.push(directory);
  return directory;
}

describe("bot templates", () => {
  it("loads JSON templates and seeds them idempotently", async () => {
    const directory = await templateDirectory();
    await writeFile(
      path.join(directory, "researcher.json"),
      JSON.stringify({
        key: "researcher",
        version: 1,
        name: "Researcher",
        instructions: "Verify sources.",
        disabledBuiltinTools: ["shell"],
      }),
    );
    await writeFile(
      path.join(directory, "writer.json"),
      JSON.stringify({
        key: "writer",
        version: 2,
        name: "Writer",
        instructions: "Write clearly.",
      }),
    );
    await writeFile(path.join(directory, "ignored.txt"), "not a template");

    const templates = await loadBotTemplatesFromDirectory(directory);
    expect(templates.map((template) => template.key)).toEqual(["researcher", "writer"]);

    const db = openLocalDatabase(":memory:");
    const first = seedBotTemplates(db, templates);
    expect(first).toHaveLength(2);
    expect(
      db.bots
        .list()
        .map((bot) => bot.templateKey)
        .sort(),
    ).toEqual(["researcher", "writer"]);
    expect(db.threads.getForBot(first[0]!.id)).not.toBeNull();

    const second = seedBotTemplates(db, templates);
    expect(second).toHaveLength(0);
    expect(db.bots.list()).toHaveLength(2);
    db.close();
  });

  it("does not overwrite a user-edited bot", async () => {
    const db = openLocalDatabase(":memory:");
    const template = parseBotTemplate({
      key: "helper",
      version: 1,
      name: "Helper",
      instructions: "Original instructions.",
    });
    const [bot] = seedBotTemplates(db, [template]);
    db.bots.update(bot!.id, { instructions: "User edited instructions." });

    seedBotTemplates(db, [{ ...template, instructions: "New template instructions." }]);

    expect(db.bots.get(bot!.id)?.instructions).toBe("User edited instructions.");
    db.close();
  });

  it("rejects malformed and duplicate templates", () => {
    expect(() => parseBotTemplate({ key: "x", version: 0, name: "X", instructions: "x" })).toThrow(
      "version",
    );
    const template = parseBotTemplate({
      key: "x",
      version: 1,
      name: "X",
      instructions: "x",
    });
    const db = openLocalDatabase(":memory:");
    expect(() => seedBotTemplates(db, [template, template])).toThrow("Duplicate");
    db.close();
  });

  it("returns an empty list for a missing directory", async () => {
    await expect(loadBotTemplatesFromDirectory("/definitely/missing/rakazo")).resolves.toEqual([]);
  });
});
