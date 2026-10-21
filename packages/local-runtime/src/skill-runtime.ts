import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LocalSkillScript } from "@rakazo/local-db";
import { ensureWorkspaceRoot } from "./workspace-paths.js";

const MAX_OUTPUT_CHARS = 512 * 1024;
const MAX_INPUT_BYTES = 100_000;
const MAX_TIMEOUT_SECONDS = 120;

export interface SkillRunResult {
  ok: boolean;
  entrypoint: string;
  runtime: NonNullable<LocalSkillScript["runtime"]>;
  exitCode: number;
  stdout: string;
  stderr: string;
  workdir: string;
  network: boolean;
  outputTruncated: boolean;
  durationMs: number;
}

function appendBounded(current: string, chunk: Buffer): string {
  if (current.length >= MAX_OUTPUT_CHARS) return current;
  return (current + chunk.toString("utf8")).slice(0, MAX_OUTPUT_CHARS);
}

function commandFor(
  runtime: NonNullable<LocalSkillScript["runtime"]>,
  scriptPath: string,
): { command: string; args: string[]; env: NodeJS.ProcessEnv } {
  if (runtime === "node") {
    return {
      command: process.execPath,
      args: [scriptPath, "input.json"],
      env: { ELECTRON_RUN_AS_NODE: "1" },
    };
  }
  if (runtime === "python3") {
    return { command: "python3", args: [scriptPath, "input.json"], env: {} };
  }
  return { command: "/bin/sh", args: [scriptPath, "input.json"], env: {} };
}

function sandboxProfile(workdir: string): string {
  const escaped = workdir.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return [
    "(version 1)",
    "(allow default)",
    "(deny network*)",
    "(deny file-write*)",
    `(allow file-write* (subpath "${escaped}") (literal "/dev/null"))`,
  ].join("\n");
}

function childCommand(
  runtime: NonNullable<LocalSkillScript["runtime"]>,
  scriptPath: string,
  workdir: string,
  network: boolean,
) {
  const target = commandFor(runtime, scriptPath);
  if (process.platform !== "darwin" || network) return target;
  return {
    command: "/usr/bin/sandbox-exec",
    args: ["-p", sandboxProfile(workdir), target.command, ...target.args],
    env: target.env,
  };
}

function terminate(child: ReturnType<typeof spawn>): void {
  if (child.killed || child.exitCode !== null) return;
  if (process.platform !== "win32" && child.pid) {
    try {
      process.kill(-child.pid, "SIGKILL");
      return;
    } catch {
      // Fall through to the direct child kill.
    }
  }
  child.kill("SIGKILL");
}

function runProcess(input: {
  runtime: NonNullable<LocalSkillScript["runtime"]>;
  scriptPath: string;
  workdir: string;
  timeoutSeconds: number;
  network: boolean;
  environment?: Record<string, string>;
  signal?: AbortSignal;
}): Promise<Omit<SkillRunResult, "entrypoint" | "workdir" | "runtime">> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const target = childCommand(input.runtime, input.scriptPath, input.workdir, input.network);
    const child = spawn(target.command, target.args, {
      cwd: input.workdir,
      env: {
        PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
        HOME: input.workdir,
        TMPDIR: input.workdir,
        LANG: process.env.LANG ?? "en_US.UTF-8",
        ...input.environment,
        ...target.env,
      },
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let outputTruncated = false;
    const timer = setTimeout(() => {
      timedOut = true;
      terminate(child);
    }, input.timeoutSeconds * 1_000);
    const abort = () => terminate(child);
    input.signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      const next = appendBounded(stdout, chunk);
      outputTruncated ||= next.length === stdout.length && stdout.length >= MAX_OUTPUT_CHARS;
      stdout = next;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const next = appendBounded(stderr, chunk);
      outputTruncated ||= next.length === stderr.length && stderr.length >= MAX_OUTPUT_CHARS;
      stderr = next;
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", abort);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", abort);
      if (input.signal?.aborted) {
        reject(new Error("Skill run stopped."));
        return;
      }
      const exitCode = timedOut ? 124 : (code ?? 1);
      if (timedOut) stderr = `${stderr}\nSkill timed out after ${input.timeoutSeconds}s`.trim();
      resolve({
        ok: exitCode === 0,
        exitCode,
        stdout,
        stderr,
        network: input.network,
        outputTruncated,
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

export async function runSkillScript(input: {
  skillName: string;
  scripts: readonly LocalSkillScript[];
  entrypoint: string;
  args: unknown;
  workspaceDir: string;
  environment?: Record<string, string>;
  signal?: AbortSignal;
}): Promise<SkillRunResult> {
  const script = input.scripts.find((candidate) => candidate.path === input.entrypoint);
  if (!script) throw new Error("Skill entrypoint not found");
  if (!script.runtime) throw new Error("That skill file is not marked as runnable");
  const digest = createHash("sha256").update(script.content, "utf8").digest("hex");
  if (digest !== script.sha256) throw new Error("Skill entrypoint changed unexpectedly");
  const serialized = JSON.stringify(input.args ?? {}, null, 2);
  if (Buffer.byteLength(serialized, "utf8") > MAX_INPUT_BYTES) {
    throw new Error("Skill input is too large");
  }

  const root = await ensureWorkspaceRoot(input.workspaceDir);
  const safeSkill = input.skillName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const workdir = path.join(
    root,
    "skill-runs",
    `${safeSkill || "skill"}-${Date.now()}-${randomUUID().slice(0, 8)}`,
  );
  const filesDir = path.join(workdir, "skill");
  await mkdir(filesDir, { recursive: true });

  for (const file of input.scripts) {
    const target = path.resolve(filesDir, file.path);
    const relative = path.relative(filesDir, target);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Skill script path is invalid");
    }
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.content, { encoding: "utf8", mode: 0o444 });
    await chmod(target, 0o444);
  }
  await writeFile(path.join(workdir, "input.json"), serialized, {
    encoding: "utf8",
    mode: 0o444,
  });

  const timeoutSeconds = Math.min(
    MAX_TIMEOUT_SECONDS,
    Math.max(1, Math.trunc(script.timeoutSeconds)),
  );
  const result = await runProcess({
    runtime: script.runtime,
    scriptPath: path.join(filesDir, script.path),
    workdir,
    timeoutSeconds,
    network: script.network,
    environment: input.environment,
    signal: input.signal,
  });
  return {
    ...result,
    entrypoint: script.path,
    runtime: script.runtime,
    workdir: path.relative(root, workdir),
  };
}
