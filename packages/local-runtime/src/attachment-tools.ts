import { readFile } from "node:fs/promises";
import path from "node:path";
import { ATTACHMENT_MAX_BYTES } from "@rakazo/contracts";
import { inferAttachmentMimeType, validateAttachmentMimeType } from "@rakazo/core";
import type { LocalArtifact } from "@rakazo/local-db";
import type { LocalTool, LocalToolExecutionRequest } from "./tools.js";
import { resolveExistingWorkspacePath } from "./workspace-paths.js";

export function createLocalAttachFileTool(options: {
  workspaceDir: string;
  createArtifact: (
    request: LocalToolExecutionRequest,
    input: { name: string; mimeType: string; content: Uint8Array },
  ) => LocalArtifact;
}): LocalTool {
  return {
    definition: {
      name: "attach_file",
      requiresApproval: false,
      description:
        "Attach a workspace file to this chat. The file remains in the workspace and also becomes available in the local artifact store.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Workspace-relative file path." },
          name: { type: "string", description: "Optional display name." },
        },
        required: ["path"],
      },
    },
    async execute(request) {
      const requested = typeof request.args.path === "string" ? request.args.path.trim() : "";
      if (!requested) throw new Error("path is required");
      const resolved = await resolveExistingWorkspacePath(options.workspaceDir, requested);
      const name =
        typeof request.args.name === "string" && request.args.name.trim()
          ? request.args.name.trim()
          : path.basename(resolved.path);
      const mimeType = inferAttachmentMimeType(name);
      if (!mimeType) throw new Error("Unsupported attachment type");
      validateAttachmentMimeType(mimeType);
      const content = await readFile(resolved.path);
      if (content.byteLength > ATTACHMENT_MAX_BYTES) throw new Error("File is too large to attach");
      const artifact = options.createArtifact(request, { name, mimeType, content });
      request.publishArtifact?.(artifact);
      return {
        ok: true,
        artifactId: artifact.id,
        name: artifact.name,
        mimeType: artifact.mimeType,
        size: artifact.size,
      };
    },
  };
}
