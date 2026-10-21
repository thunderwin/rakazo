import { readFile } from "node:fs/promises";
import {
  assertPlotDataWithinLimits,
  PLOT_TOOL_GUIDE,
  type PlotSpec,
  parsePlotData,
  searchChartCatalog,
} from "@rakazo/core/plot";
import type { LocalArtifact } from "@rakazo/local-db";
import type { LocalTool, LocalToolExecutionRequest } from "./tools.js";
import { resolveExistingWorkspacePath } from "./workspace-paths.js";

const MAX_DATA_FILE_BYTES = 5 * 1024 * 1024;

export interface LocalPlotOptions {
  workspaceDir: string;
  renderPng: (spec: PlotSpec, data: unknown[] | undefined) => Promise<Uint8Array>;
  createArtifact: (
    request: LocalToolExecutionRequest,
    input: { name: string; mimeType: string; content: Uint8Array },
  ) => LocalArtifact;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function createLocalPlotTools(options: LocalPlotOptions): LocalTool[] {
  return [
    {
      definition: {
        name: "render_plot",
        requiresApproval: false,
        description:
          'Render an Observable Plot chart from tabular data as a PNG attached to chat. Call with {"charts":true} for runnable examples or {"help":true} for the guide.',
        inputSchema: {
          type: "object",
          properties: {
            charts: {
              description: "true lists all chart examples; a string searches them.",
            },
            help: { type: "boolean" },
            spec: {
              type: "object",
              description: "Observable Plot spec with a marks array.",
            },
            data: {
              type: "array",
              description: "Rows shared by marks without their own data.",
            },
            data_path: {
              type: "string",
              description: "Workspace CSV, TSV, or JSON rows file.",
            },
          },
        },
      },
      async execute(request) {
        if (request.args.charts !== undefined) {
          return {
            charts: searchChartCatalog(
              typeof request.args.charts === "string" ? request.args.charts : undefined,
            ),
            note: "Each chart is a runnable example. Replace its rows and columns.",
          };
        }
        if (request.args.help === true || !isRecord(request.args.spec)) {
          return { guide: PLOT_TOOL_GUIDE };
        }
        const spec = request.args.spec as PlotSpec;
        let rows = Array.isArray(request.args.data) ? (request.args.data as unknown[]) : undefined;
        if (!rows && typeof request.args.data_path === "string" && request.args.data_path.trim()) {
          const resolved = await resolveExistingWorkspacePath(
            options.workspaceDir,
            request.args.data_path,
          );
          const content = await readFile(resolved.path);
          if (content.byteLength > MAX_DATA_FILE_BYTES)
            throw new Error("Plot data file is too large");
          rows = parsePlotData(resolved.path, content.toString("utf8"));
        }
        assertPlotDataWithinLimits(spec, rows);
        const png = await options.renderPng(spec, rows);
        const artifact = options.createArtifact(request, {
          name: `plot-${Date.now()}.png`,
          mimeType: "image/png",
          content: png,
        });
        request.publishArtifact?.(artifact);
        return {
          ok: true,
          artifactId: artifact.id,
          name: artifact.name,
          rows: rows?.length ?? spec.data?.length ?? 0,
        };
      },
    },
  ];
}
