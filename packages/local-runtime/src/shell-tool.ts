import { spawn } from "node:child_process";
import type { LocalTool } from "./tools.js";
import { resolveWritableWorkspacePath } from "./workspace-paths.js";

const MAX_OUTPUT_CHARS = 1_000_000;

export interface ShellCommandInput {
  command: string;
  cwd?: string;
  signal?: AbortSignal;
}

export interface ShellCommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

export type RunShellCommand = (input: ShellCommandInput) => Promise<ShellCommandResult>;

function appendBounded(current: string, chunk: Buffer): string {
  if (current.length >= MAX_OUTPUT_CHARS) return current;
  return (current + chunk.toString("utf8")).slice(0, MAX_OUTPUT_CHARS);
}

export const runShellCommand: RunShellCommand = (input) =>
  new Promise((resolve, reject) => {
    const child = spawn(input.command, {
      shell: true,
      cwd: input.cwd,
      env: process.env,
      windowsHide: true,
      signal: input.signal,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = appendBounded(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = appendBounded(stderr, chunk);
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ stdout, stderr, code: code ?? 1 }));
  });

export interface ShellToolOptions {
  workspaceDir: string;
  run?: RunShellCommand;
}

export function createShellTool(options: ShellToolOptions): LocalTool {
  const run = options.run ?? runShellCommand;
  return {
    definition: {
      name: "shell",
      description:
        "Run a command in the local workspace on this device. cwd is relative to the workspace root. Use it for terminal and filesystem work; ask before destructive or privileged commands.",
      inputSchema: {
        type: "object",
        properties: {
          command: { type: "string" },
          cwd: { type: "string" },
        },
        required: ["command"],
      },
    },
    async execute({ args, signal }) {
      const command = typeof args.command === "string" ? args.command.trim() : "";
      if (!command) throw new Error("Shell command cannot be empty");
      const target = await resolveWritableWorkspacePath(
        options.workspaceDir,
        typeof args.cwd === "string" ? args.cwd : ".",
      );
      return run({ command, cwd: target.path, signal });
    },
  };
}
