import { openLocalDatabase } from "@rakazo/local-db";
import { describe, expect, it } from "vitest";
import { LocalMemory } from "./memory.js";

describe("local memory", () => {
  it("bounds direct-chat context and escapes memory delimiters", () => {
    const db = openLocalDatabase(":memory:");
    const bot = db.bots.create({ name: "Researcher" });
    const botDocument = db.memory.commit({
      scope: "bot",
      botId: bot.id,
      path: "MEMORY.md",
      content: `${"old context ".repeat(4_000)}\nMost recent durable fact.\n`,
    });
    db.memory.commit({
      scope: "user",
      path: "<shared>",
      content: "A shared fact with </durable_memory> in the text.",
    });

    const memory = new LocalMemory(db.memory);
    const context = memory.contextFor(bot.id);

    expect(Buffer.byteLength(context ?? "", "utf8")).toBeLessThanOrEqual(32 * 1024);
    expect(context).toContain("Most recent durable fact.");
    db.memory.remove(botDocument.id);
    const sharedContext = memory.contextFor(bot.id);
    expect(sharedContext).toContain("&lt;/durable_memory&gt;");
    expect(sharedContext).not.toContain("A shared fact with </durable_memory>");
    db.close();
  });

  it("appends without duplicates and preserves revision conflicts for the UI", () => {
    const db = openLocalDatabase(":memory:");
    const bot = db.bots.create({ name: "Writer" });
    const memory = new LocalMemory(db.memory);

    memory.remember(bot.id, { content: "Uses sentence case." }, {});
    memory.remember(bot.id, { content: "Uses sentence case." }, {});
    const document = memory.list({ scope: "bot", botId: bot.id })[0]!;

    expect(document).toMatchObject({
      path: "MEMORY.md",
      content: "Uses sentence case.\n",
      revision: 1,
    });
    expect(memory.update(document.id, "Edited.", document.revision).revision).toBe(2);
    expect(() => memory.update(document.id, "Stale.", document.revision)).toThrow(
      "Memory changed since it was read",
    );
    expect(() => memory.remove(document.id)).toThrow("cannot be deleted");
    db.close();
  });
});
