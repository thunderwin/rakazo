import { describe, expect, it, vi } from "vitest";
import { createLocalImageTool, createLocalVideoTool } from "./media-tools.js";
import { LocalToolRegistry } from "./tools.js";

describe("generate_image tool", () => {
  it("requires approval and publishes the generated image", async () => {
    const publishArtifact = vi.fn();
    const createArtifact = vi.fn(() => ({
      id: "image-1",
      botId: "bot-1",
      groupId: null,
      name: "image.png",
      mimeType: "image/png",
      size: 3,
      createdAt: "2026-01-01T00:00:00.000Z",
    }));
    const approve = vi.fn(() => true);
    const registry = new LocalToolRegistry(
      [
        createLocalImageTool({
          generate: async () => ({
            bytes: new Uint8Array([1, 2, 3]),
            mimeType: "image/png",
          }),
          createArtifact,
        }),
      ],
      approve,
    );

    await expect(
      registry.execute({
        botId: "bot-1",
        name: "generate_image",
        args: { prompt: "A cobalt blue geometric poster" },
        executionId: "image-gen-1",
        publishArtifact,
      }),
    ).resolves.toMatchObject({ ok: true, artifactId: "image-1" });
    expect(approve).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "generate_image",
        args: { prompt: "A cobalt blue geometric poster" },
      }),
    );
    expect(publishArtifact).toHaveBeenCalledWith(expect.objectContaining({ id: "image-1" }));
  });
});

describe("generate_video tool", () => {
  it("persists a pending job and polls it with the local job id", async () => {
    const jobs = new Map<
      string,
      {
        id: string;
        botId: string;
        groupId: string | null;
        runId: string;
        executionId: string;
        kind: "video";
        provider: string;
        providerJobId: string | null;
        status: "queued" | "running" | "completed" | "failed";
        artifactId: string | null;
        createdAt: string;
        updatedAt: string;
      }
    >();
    let sequence = 0;
    const tool = createLocalVideoTool({
      provider: "fake",
      submit: async () => ({ id: "provider-job", status: "queued" }),
      poll: async () => ({
        id: "provider-job",
        status: "completed",
        output: { bytes: new Uint8Array([1, 2]), mimeType: "video/mp4" },
      }),
      jobs: {
        create(request) {
          sequence += 1;
          const now = "2026-01-01T00:00:00.000Z";
          const job = {
            id: `local-job-${sequence}`,
            botId: request.botId!,
            groupId: null,
            runId: request.runId!,
            executionId: request.executionId,
            kind: "video" as const,
            provider: "fake",
            providerJobId: null,
            status: "queued" as const,
            artifactId: null,
            createdAt: now,
            updatedAt: now,
          };
          jobs.set(job.id, job);
          return job;
        },
        findForExecution() {
          return null;
        },
        get(request, id) {
          const job = jobs.get(id) ?? null;
          return job?.botId === request.botId ? job : null;
        },
        countForRun() {
          return 0;
        },
        update(id, input) {
          const job = jobs.get(id)!;
          jobs.set(id, {
            ...job,
            ...input,
            providerJobId:
              input.providerJobId === undefined ? job.providerJobId : input.providerJobId,
            artifactId: input.artifactId === undefined ? job.artifactId : input.artifactId,
          });
        },
      },
      createArtifact: () => ({
        id: "video-artifact",
        botId: "bot-1",
        groupId: null,
        name: "video.mp4",
        mimeType: "video/mp4",
        size: 2,
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    });

    await expect(
      tool.execute({
        botId: "bot-1",
        runId: "run-1",
        name: "generate_video",
        args: { prompt: "A short product animation" },
        executionId: "video-1",
      }),
    ).resolves.toMatchObject({ status: "queued", jobId: "local-job-1" });
    await expect(
      tool.execute({
        botId: "bot-1",
        runId: "run-2",
        name: "generate_video",
        args: { jobId: "local-job-1" },
        executionId: "poll-1",
      }),
    ).resolves.toEqual({ status: "completed", artifactId: "video-artifact" });
  });
});
