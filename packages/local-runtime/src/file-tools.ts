import { lstat, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LocalTool } from "./tools.js";
import {
  ensureWorkspaceRoot,
  openWorkspaceFileReadonly,
  resolveExistingWorkspacePath,
  resolveWritableWorkspacePath,
} from "./workspace-paths.js";

const MAX_READ_BYTES = 512 * 1024;
const MAX_WRITE_BYTES = 1024 * 1024;
const MAX_LIST_ENTRIES = 1_000;

function requestedPath(args: Record<string, unknown>): string {
  return typeof args.path === "string" ? args.path : ".";
}

export function createFileTools(options: { workspaceDir: string }): LocalTool[] {
  return [
    {
      definition: {
        name: "list_files",
        description:
          "List files and folders in the local workspace. Paths are relative to the workspace root and symlinks are not followed.",
        readOnly: true,
        inputSchema: {
          type: "object",
          properties: { path: { type: "string" } },
        },
      },
      async execute({ args }) {
        const root = await ensureWorkspaceRoot(options.workspaceDir);
        const resolved = await resolveExistingWorkspacePath(
          options.workspaceDir,
          requestedPath(args),
        );
        if (!(await stat(resolved.path)).isDirectory()) throw new Error("Path is not a directory");
        const entries = await readdir(resolved.path, { withFileTypes: true });
        return {
          path: path.relative(root, resolved.path) || ".",
          entries: entries
            .filter((entry) => !entry.isSymbolicLink())
            .sort((left, right) => left.name.localeCompare(right.name))
            .slice(0, MAX_LIST_ENTRIES)
            .map((entry) => ({
              name: entry.name,
              kind: entry.isDirectory() ? "dir" : "file",
            })),
          ...(entries.length > MAX_LIST_ENTRIES ? { truncated: true } : {}),
        };
      },
    },
    {
      definition: {
        name: "read_file",
        description:
          "Read a UTF-8 text file from the local workspace. Output is capped at 512 KiB and symlinks are rejected.",
        readOnly: true,
        inputSchema: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
      },
      async execute({ args }) {
        const filePath = requestedPath(args);
        if (!filePath || filePath === ".") throw new Error("File path is required");
        const resolved = await resolveExistingWorkspacePath(options.workspaceDir, filePath);
        const info = await lstat(resolved.path);
        if (!info.isFile()) throw new Error("Path is not a file");
        const handle = await openWorkspaceFileReadonly(resolved.path);
        try {
          const buffer = Buffer.alloc(Math.min(info.size, MAX_READ_BYTES));
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
          const data = buffer.subarray(0, bytesRead);
          if (data.includes(0)) throw new Error("Binary files are not supported");
          return {
            path: path.relative(resolved.root, resolved.path),
            content: data.toString("utf8"),
            ...(info.size > MAX_READ_BYTES ? { truncated: true } : {}),
          };
        } finally {
          await handle.close();
        }
      },
    },
    {
      definition: {
        name: "write_file",
        description:
          "Write a UTF-8 text file inside the local workspace. Parent folders are created; writes are capped at 1 MiB.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string" },
            content: { type: "string" },
          },
          required: ["path", "content"],
        },
      },
      async execute({ args }) {
        const filePath = requestedPath(args);
        const content = typeof args.content === "string" ? args.content : null;
        if (!filePath || filePath === ".") throw new Error("File path is required");
        if (content === null) throw new Error("File content is required");
        const bytes = Buffer.byteLength(content, "utf8");
        if (bytes > MAX_WRITE_BYTES) throw new Error("File content exceeds the write limit");
        const target = await resolveWritableWorkspacePath(options.workspaceDir, filePath);
        await writeFile(target.path, content, { encoding: "utf8", flag: "w" });
        return {
          path: path.relative(target.root, target.path),
          bytes,
          created: !target.existed,
        };
      },
    },
  ];
}
