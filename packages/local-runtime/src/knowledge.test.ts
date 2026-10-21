import { openLocalDatabase } from "@rakazo/local-db";
import { describe, expect, it } from "vitest";
import { LocalKnowledge } from "./knowledge.js";

describe("local knowledge", () => {
  it("creates, searches, reads, and removes user knowledge", () => {
    const db = openLocalDatabase(":memory:");
    const knowledge = new LocalKnowledge(db.knowledge);
    const release = knowledge.create({
      title: "Launch checklist",
      content: "Verify release notes, rollback steps, and customer communication.",
    });
    knowledge.create({
      title: "Office map",
      content: "The meeting room is on floor three.",
    });
    db.knowledge.create({
      title: "Managed policy",
      content: "Follow the organization release policy.",
      source: "managed",
    });

    expect(knowledge.search("release rollback")[0]).toEqual(
      expect.objectContaining({
        id: release.id,
        title: "Launch checklist",
        source: "local",
      }),
    );
    expect(knowledge.search("release")[0]).toMatchObject({
      title: expect.stringMatching(/Launch checklist|Managed policy/),
    });
    expect(knowledge.get(release.id)?.content).toContain("rollback");
    expect(() => knowledge.update(release.id, { title: " " })).toThrow("title");

    const managed = knowledge.list().find((document) => document.source === "managed")!;
    expect(() => knowledge.update(managed.id, { title: "Changed" })).toThrow("read-only");
    expect(knowledge.remove(managed.id)).toBe(false);
    expect(knowledge.remove(release.id)).toBe(true);
    db.close();
  });
});
