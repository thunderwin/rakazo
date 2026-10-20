import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFileTools } from "./file-tools.js";
import { LocalToolRegistry } from "./tools.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function workspace() {
  const directory = await mkdtemp(path.join(tmpdir(), "rakazo-file-tools-"));
  directories.push(directory);
  return directory;
}

describe("local file tools", () => {
  it("lists, reads, and writes workspace files", async () => {
    const root = await workspace();
    await mkdir(path.join(root, "notes"));
    await writeFile(path.join(root, "notes", "existing.txt"), "before", "utf8");
    const registry = new LocalToolRegistry(createFileTools({ workspaceDir: root }), () => true);

    await registry.execute({
      name: "write_file",
      args: { path: "notes/new.txt", content: "hello" },
      executionId: "write-1",
    });
    const listed = await registry.execute({
      name: "list_files",
      args: { path: "notes" },
      executionId: "list-1",
    });
    const read = await registry.execute({
      name: "read_file",
      args: { path: "notes/new.txt" },
      executionId: "read-1",
    });

    expect(listed).toEqual({
      path: "notes",
      entries: [
        { name: "existing.txt", kind: "file" },
        { name: "new.txt", kind: "file" },
      ],
    });
    expect(read).toEqual({ path: "notes/new.txt", content: "hello" });
  });

  it("allows read-only tools without an approval callback", async () => {
    const root = await workspace();
    await writeFile(path.join(root, "file.txt"), "text", "utf8");
    const registry = new LocalToolRegistry(createFileTools({ workspaceDir: root }));

    await expect(
      registry.execute({
        name: "read_file",
        args: { path: "file.txt" },
        executionId: "read-1",
      }),
    ).resolves.toEqual({ path: "file.txt", content: "text" });
  });

  it("requires approval before writing", async () => {
    const root = await workspace();
    const approve = vi.fn(() => false);
    const registry = new LocalToolRegistry(createFileTools({ workspaceDir: root }), approve);

    await expect(
      registry.execute({
        name: "write_file",
        args: { path: "blocked.txt", content: "no" },
        executionId: "write-1",
      }),
    ).rejects.toThrow("was not approved");
    expect(approve).toHaveBeenCalledOnce();
  });

  it("rejects traversal and symlink escapes", async () => {
    const root = await workspace();
    const outside = await workspace();
    await writeFile(path.join(outside, "secret.txt"), "secret", "utf8");
    await symlink(path.join(outside, "secret.txt"), path.join(root, "link.txt"));
    const registry = new LocalToolRegistry(createFileTools({ workspaceDir: root }));

    await expect(
      registry.execute({
        name: "read_file",
        args: { path: path.join("..", "secret.txt") },
        executionId: "read-1",
      }),
    ).rejects.toThrow("inside the local workspace");
    await expect(
      registry.execute({
        name: "read_file",
        args: { path: "link.txt" },
        executionId: "read-2",
      }),
    ).rejects.toThrow("symlinks");
  });
});
