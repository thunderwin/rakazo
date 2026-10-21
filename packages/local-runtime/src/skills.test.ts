import { buildSkillMd } from "@rakazo/core";
import { openLocalDatabase } from "@rakazo/local-db";
import { describe, expect, it } from "vitest";
import { LocalSkills } from "./skills.js";

describe("local skills", () => {
  it("merges builtins, expands forced skills, and keeps managed skills read-only", () => {
    const db = openLocalDatabase(":memory:");
    const skills = new LocalSkills(db.skills);
    expect(skills.findByName("Interrogate")).toMatchObject({
      source: "builtin",
      readOnly: true,
    });

    const release = skills.create({
      name: "Release review",
      description: "Review a release before it ships.",
      body: "1. Read the checklist.\n2. Verify rollback.",
    });
    expect(release).toMatchObject({ source: "user", readOnly: false });
    expect(skills.expandPrompt("/Release review\nCheck v1.2.")).toContain("2. Verify rollback.");
    expect(skills.expandPrompt("/Release review\nCheck v1.2.")).toContain("Check v1.2.");
    expect(skills.catalogInstruction()).toContain("- Interrogate:");
    expect(skills.catalogInstruction()).toContain("- Release review:");
    expect(
      skills.update("Release review", {
        newName: "Launch review",
        body: "Verify the final checklist.",
      }),
    ).toMatchObject({ name: "Launch review" });

    db.skills.create({
      name: "Managed policy",
      description: "Organization policy",
      content: buildSkillMd({
        name: "Managed policy",
        description: "Organization policy",
        body: "Follow it.",
      }),
      source: "managed",
    });
    expect(() => skills.remove("Managed policy")).toThrow("read-only");
    expect(skills.remove("Launch review")).toBe(true);
    db.close();
  });
});
