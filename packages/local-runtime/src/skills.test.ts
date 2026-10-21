import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildSkillMd } from "@rakazo/core";
import { openLocalDatabase } from "@rakazo/local-db";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalSkillRunTool, LocalSkills, LocalSkillToolProvider } from "./skills.js";
import { LocalToolRegistry } from "./tools.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

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

  it("stores hashed scripts and runs a declared Node entrypoint", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "rakazo-skill-run-"));
    directories.push(directory);
    const db = openLocalDatabase(":memory:");
    const skills = new LocalSkills(db.skills);
    const skill = skills.create({
      name: "JSON transform",
      description: "Transform JSON input.",
      body: "Run the declared script with the requested value.",
      scripts: [
        {
          path: "scripts/main.js",
          content:
            'const input = require(require("node:path").resolve(process.argv[2])); console.log(JSON.stringify({ doubled: input.value * 2 }));',
          timeoutSeconds: 10,
          network: false,
        },
      ],
    });
    expect(skill.scripts[0]).toMatchObject({
      path: "scripts/main.js",
      runtime: "node",
      network: false,
    });
    expect(skill.scripts[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);

    const provider = new LocalSkillToolProvider(
      new LocalToolRegistry(
        [
          createLocalSkillRunTool(async (request) =>
            skills.run({
              name: typeof request.args.name === "string" ? request.args.name : "",
              entrypoint:
                typeof request.args.entrypoint === "string" ? request.args.entrypoint : "",
              args: request.args.args,
              workspaceDir: directory,
            }),
          ),
        ],
        () => true,
      ),
      skills,
    );
    expect(
      await provider.definitionsFor({
        id: "bot-1",
        name: "Bot",
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
      }),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ name: "skill_run" })]));

    const result = await provider.execute({
      botId: "bot-1",
      name: "skill_run",
      args: { name: "JSON transform", entrypoint: "scripts/main.js", args: { value: 21 } },
      executionId: "run-1",
    });
    expect(result).toMatchObject({
      ok: true,
      runtime: "node",
      stdout: '{"doubled":42}\n',
      workdir: expect.stringMatching(/^skill-runs\//),
    });
    db.close();
  });
});
