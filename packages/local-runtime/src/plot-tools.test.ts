import { describe, expect, it, vi } from "vitest";
import { createLocalPlotTools } from "./plot-tools.js";

describe("render_plot tool", () => {
  it("renders a chart and publishes the PNG artifact to the current message", async () => {
    const publishArtifact = vi.fn();
    const createArtifact = vi.fn(() => ({
      id: "artifact-1",
      botId: "bot-1",
      groupId: null,
      name: "plot.png",
      mimeType: "image/png",
      size: 3,
      createdAt: "2026-01-01T00:00:00.000Z",
    }));
    const renderPng = vi.fn(async () => new Uint8Array([1, 2, 3]));
    const tool = createLocalPlotTools({
      workspaceDir: "/tmp/workspace",
      renderPng,
      createArtifact,
    })[0]!;

    await expect(
      tool.execute({
        botId: "bot-1",
        name: "render_plot",
        args: {
          data: [{ quarter: "Q1", sales: 12 }],
          spec: {
            title: "Sales",
            marks: [{ type: "barY", options: { x: "quarter", y: "sales" } }],
          },
        },
        executionId: "plot-1",
        publishArtifact,
      }),
    ).resolves.toMatchObject({ ok: true, artifactId: "artifact-1", rows: 1 });
    expect(renderPng).toHaveBeenCalledWith(
      expect.objectContaining({
        marks: [expect.objectContaining({ type: "barY" })],
      }),
      [{ quarter: "Q1", sales: 12 }],
    );
    expect(publishArtifact).toHaveBeenCalledWith(expect.objectContaining({ id: "artifact-1" }));
  });

  it("returns the chart catalog without rendering", async () => {
    const renderPng = vi.fn();
    const tool = createLocalPlotTools({
      workspaceDir: "/tmp/workspace",
      renderPng,
      createArtifact: vi.fn(),
    })[0]!;
    await expect(
      tool.execute({
        name: "render_plot",
        args: { charts: "trend" },
        executionId: "plot-help",
      }),
    ).resolves.toMatchObject({ charts: expect.any(Array) });
    expect(renderPng).not.toHaveBeenCalled();
  });
});
