import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createShellTool, type ShellCommandResult } from "./shell-tool.js";
import { LocalToolRegistry } from "./tools.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function workspace() {
  const directory = await mkdtemp(path.join(tmpdir(), "rakazo-shell-tool-"));
  directories.push(directory);
  return directory;
}

const bot = {
  id: "bot-1",
  name: "Chief",
  title: "",
  description: "",
  instructions: "",
  color: "blue",
  modelProvider: null,
  modelId: null,
  thinkingLevel: null,
  disabledBuiltinTools: [],
  templateKey: null,
  templateVersion: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("local shell tool", () => {
  it("runs inside the workspace and returns bounded output", async () => {
    const root = await workspace();
    const result: ShellCommandResult = { stdout: "hello\n", stderr: "", code: 0 };
    const run = vi.fn(async () => result);
    const registry = new LocalToolRegistry(
      [createShellTool({ workspaceDir: root, run })],
      () => true,
    );

    await expect(
      registry.execute({
        name: "shell",
        args: { command: "pwd", cwd: "work" },
        executionId: "exec-1",
      }),
    ).resolves.toEqual(result);

    expect(run).toHaveBeenCalledWith({
      command: "pwd",
      cwd: expect.stringMatching(/\/work$/),
      signal: undefined,
    });
  });

  it("rejects cwd outside the workspace", async () => {
    const root = await workspace();
    const run = vi.fn();
    const registry = new LocalToolRegistry(
      [createShellTool({ workspaceDir: root, run })],
      () => true,
    );

    await expect(
      registry.execute({
        name: "shell",
        args: { command: "pwd", cwd: ".." },
        executionId: "exec-1",
      }),
    ).rejects.toThrow("inside the local workspace");
    expect(run).not.toHaveBeenCalled();
  });

  it("runs no tool without an approval", async () => {
    const root = await workspace();
    const run = vi.fn();
    const registry = new LocalToolRegistry([createShellTool({ workspaceDir: root, run })]);

    await expect(
      registry.execute({
        name: "shell",
        args: { command: "pwd" },
        executionId: "exec-1",
      }),
    ).rejects.toThrow("was not approved");
    expect(run).not.toHaveBeenCalled();
  });

  it("filters disabled tools from the model-facing schemas", async () => {
    const root = await workspace();
    const registry = new LocalToolRegistry([createShellTool({ workspaceDir: root })], () => true);

    expect(registry.definitionsFor(bot).map((tool) => tool.name)).toEqual(["shell"]);
    expect(
      registry.definitionsFor({ ...bot, disabledBuiltinTools: ["shell"] }).map((tool) => tool.name),
    ).toEqual([]);
  });
});
