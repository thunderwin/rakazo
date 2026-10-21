import type { LocalTool } from "./tools.js";
import { resolveExistingWorkspacePath } from "./workspace-paths.js";

export interface LocalDesktopActions {
  workspaceDir: string;
  openFile: (path: string) => Promise<string>;
  openUrl: (url: string) => Promise<void>;
  launchApp: (application: string, uri?: string) => Promise<void>;
}

function safeUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS URLs are supported");
  }
  if (url.username || url.password) throw new Error("URL must not contain credentials");
  return url;
}

export function createLocalDesktopTools(actions: LocalDesktopActions): LocalTool[] {
  return [
    {
      definition: {
        name: "open_path",
        requiresApproval: true,
        description:
          "Open a workspace file or public HTTP(S) URL in its default application on this device.",
        inputSchema: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
      },
      async execute({ args }) {
        const requested = typeof args.path === "string" ? args.path.trim() : "";
        if (!requested) throw new Error("path is required");
        if (/^https?:\/\//i.test(requested)) {
          await actions.openUrl(safeUrl(requested).href);
          return { ok: true, target: requested };
        }
        const resolved = await resolveExistingWorkspacePath(actions.workspaceDir, requested);
        const error = await actions.openFile(resolved.path);
        if (error) throw new Error(error);
        return { ok: true, target: requested };
      },
    },
    {
      definition: {
        name: "launch_app",
        requiresApproval: true,
        description:
          "Launch or focus an installed application on this device, optionally opening a public HTTP(S) URI.",
        inputSchema: {
          type: "object",
          properties: {
            application: { type: "string" },
            uri: { type: "string" },
          },
          required: ["application"],
        },
      },
      async execute({ args }) {
        const application = typeof args.application === "string" ? args.application.trim() : "";
        if (!application || application.length > 200) {
          throw new Error("application is required");
        }
        const uri =
          typeof args.uri === "string" && args.uri.trim()
            ? safeUrl(args.uri.trim()).href
            : undefined;
        await actions.launchApp(application, uri);
        return { ok: true, application, ...(uri ? { uri } : {}) };
      },
    },
  ];
}
