import { constants } from "node:fs";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import path from "node:path";

export async function ensureWorkspaceRoot(workspaceDir: string): Promise<string> {
  await mkdir(workspaceDir, { recursive: true });
  return realpath(workspaceDir);
}

export function workspacePath(root: string, requested: string): string {
  const candidate = path.resolve(root, requested.trim() || ".");
  if (!isInside(root, candidate)) throw new Error("Path must stay inside the local workspace");
  return candidate;
}

export function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function resolveExistingWorkspacePath(
  workspaceDir: string,
  requested: string,
): Promise<{ root: string; path: string }> {
  const root = await ensureWorkspaceRoot(workspaceDir);
  const candidate = workspacePath(root, requested);
  const candidateInfo = await lstat(candidate);
  if (candidateInfo.isSymbolicLink()) throw new Error("Workspace symlinks are not readable");
  const resolved = await realpath(candidate);
  if (!isInside(root, resolved)) throw new Error("Path must stay inside the local workspace");
  return { root, path: resolved };
}

export async function resolveWritableWorkspacePath(
  workspaceDir: string,
  requested: string,
): Promise<{ root: string; path: string; existed: boolean }> {
  const root = await ensureWorkspaceRoot(workspaceDir);
  const candidate = workspacePath(root, requested);
  const parent = path.dirname(candidate);
  await mkdir(parent, { recursive: true });
  const resolvedParent = await realpath(parent);
  if (!isInside(root, resolvedParent)) {
    throw new Error("Path must stay inside the local workspace");
  }
  try {
    const info = await lstat(candidate);
    if (info.isSymbolicLink()) throw new Error("Workspace symlinks are not writable");
    return { root, path: candidate, existed: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return { root, path: candidate, existed: false };
  }
}

export async function openWorkspaceFileReadonly(
  file: string,
): Promise<Awaited<ReturnType<typeof open>>> {
  const noFollow = "O_NOFOLLOW" in constants ? constants.O_NOFOLLOW : 0;
  return open(file, constants.O_RDONLY | noFollow);
}
