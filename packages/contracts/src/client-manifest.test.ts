import { describe, expect, it } from "vitest";
import { ClientManifestContentSchema } from "./client-manifest.js";

describe("client manifest skill scripts", () => {
  it("accepts declared scripts inside a skill", () => {
    const parsed = ClientManifestContentSchema.parse({
      name: "Example",
      skills: [
        {
          key: "report",
          name: "Report",
          description: "Build a report",
          content: "---\nname: Report\ndescription: Build a report\n---\n\nRun it.",
          scripts: [
            {
              path: "scripts/main.py",
              content: "print('ok')",
              runtime: "python3",
            },
          ],
        },
      ],
    });
    expect(parsed.skills[0]?.scripts[0]).toMatchObject({
      path: "scripts/main.py",
      runtime: "python3",
      timeoutSeconds: 60,
      network: false,
    });
  });

  it("rejects path escape and runtime mismatch", () => {
    const base = {
      name: "Example",
      skills: [
        {
          key: "report",
          name: "Report",
          description: "Build a report",
          content: "---\nname: Report\ndescription: Build a report\n---\n\nRun it.",
        },
      ],
    };
    expect(() =>
      ClientManifestContentSchema.parse({
        ...base,
        skills: [
          {
            ...base.skills[0],
            scripts: [{ path: "scripts/../../secret.js", content: "" }],
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      ClientManifestContentSchema.parse({
        ...base,
        skills: [
          {
            ...base.skills[0],
            scripts: [
              {
                path: "scripts/main.js",
                content: "console.log('x')",
                runtime: "python3",
              },
            ],
          },
        ],
      }),
    ).toThrow();
  });
});
