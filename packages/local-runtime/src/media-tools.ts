import type { LocalArtifact, LocalMediaJob } from "@rakazo/local-db";
import type { LocalTool, LocalToolExecutionRequest } from "./tools.js";

export interface LocalImageGenerationOptions {
  generate: (input: { prompt: string; signal?: AbortSignal }) => Promise<{
    bytes: Uint8Array;
    mimeType: "image/png";
  }>;
  createArtifact: (
    request: LocalToolExecutionRequest,
    input: { name: string; mimeType: string; content: Uint8Array },
  ) => LocalArtifact;
}

export interface LocalVideoGenerationOptions {
  provider: string;
  submit: (input: { prompt: string; signal?: AbortSignal }) => Promise<
    | { id: string; status: "queued" | "running"; progress?: number }
    | {
        id: string;
        status: "completed";
        output: { bytes: Uint8Array; mimeType: "video/mp4" };
      }
    | { id: string; status: "failed" }
  >;
  poll: (
    id: string,
    signal?: AbortSignal,
  ) => Promise<
    | { id: string; status: "queued" | "running"; progress?: number }
    | {
        id: string;
        status: "completed";
        output: { bytes: Uint8Array; mimeType: "video/mp4" };
      }
    | { id: string; status: "failed" }
  >;
  jobs: {
    create(request: LocalToolExecutionRequest, provider: string): LocalMediaJob;
    findForExecution(request: LocalToolExecutionRequest): LocalMediaJob | null;
    get(request: LocalToolExecutionRequest, id: string): LocalMediaJob | null;
    countForRun(request: LocalToolExecutionRequest): number;
    update(
      id: string,
      input: {
        providerJobId?: string | null;
        status?: "queued" | "running" | "completed" | "failed";
        artifactId?: string | null;
      },
    ): void;
  };
  createArtifact: (
    request: LocalToolExecutionRequest,
    input: { name: string; mimeType: string; content: Uint8Array },
  ) => LocalArtifact;
}

export function createLocalImageTool(options: LocalImageGenerationOptions): LocalTool {
  return {
    definition: {
      name: "generate_image",
      requiresApproval: true,
      description:
        "Generate one image from a prompt and attach it to chat. This may incur provider charges. Never retry an uncertain submission automatically.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", minLength: 1, maxLength: 4_000 },
        },
        required: ["prompt"],
      },
    },
    async execute(request) {
      const prompt = typeof request.args.prompt === "string" ? request.args.prompt.trim() : "";
      if (!prompt) throw new Error("prompt is required");
      if (prompt.length > 4_000) throw new Error("prompt is too long");
      const generated = await options.generate({ prompt, signal: request.signal });
      if (generated.bytes.byteLength === 0) throw new Error("Image provider returned no image");
      const artifact = options.createArtifact(request, {
        name: `image-${Date.now()}.png`,
        mimeType: generated.mimeType,
        content: generated.bytes,
      });
      request.publishArtifact?.(artifact);
      return {
        ok: true,
        artifactId: artifact.id,
        name: artifact.name,
        size: artifact.size,
      };
    },
  };
}

export function createLocalVideoTool(options: LocalVideoGenerationOptions): LocalTool {
  async function attach(
    request: LocalToolExecutionRequest,
    job: LocalMediaJob,
    output: { bytes: Uint8Array; mimeType: "video/mp4" },
  ) {
    if (job.status === "completed" && job.artifactId) {
      return { status: "completed" as const, artifactId: job.artifactId };
    }
    if (output.mimeType !== "video/mp4" || output.bytes.byteLength === 0) {
      throw new Error("Video provider returned an unsupported format");
    }
    const artifact = options.createArtifact(request, {
      name: `video-${job.id}.mp4`,
      mimeType: "video/mp4",
      content: output.bytes,
    });
    options.jobs.update(job.id, {
      status: "completed",
      artifactId: artifact.id,
    });
    request.publishArtifact?.(artifact);
    return { status: "completed" as const, artifactId: artifact.id };
  }

  return {
    definition: {
      name: "generate_video",
      requiresApproval: true,
      description:
        "Generate one short video from a prompt, or poll a previous job with jobId alone. Pending jobs return a local jobId. Do not resubmit a failed or uncertain job automatically.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", minLength: 1, maxLength: 4_000 },
          jobId: { type: "string", minLength: 1, maxLength: 200 },
        },
      },
    },
    async execute(request) {
      const jobId = typeof request.args.jobId === "string" ? request.args.jobId.trim() : "";
      const prompt = typeof request.args.prompt === "string" ? request.args.prompt.trim() : "";
      if (jobId && prompt) throw new Error("Pass prompt or jobId, not both");
      let job: LocalMediaJob;
      if (jobId) {
        const found = options.jobs.get(request, jobId);
        if (!found) throw new Error("Video job is unavailable");
        job = found;
      } else {
        if (!prompt) throw new Error("prompt is required");
        if (prompt.length > 4_000) throw new Error("prompt is too long");
        const prior = options.jobs.findForExecution(request);
        if (prior) {
          job = prior;
        } else {
          if (options.jobs.countForRun(request) >= 2) {
            throw new Error("Video generation limit reached for this run");
          }
          job = options.jobs.create(request, options.provider);
          try {
            const submitted = await options.submit({ prompt, signal: request.signal });
            options.jobs.update(job.id, {
              providerJobId: submitted.id,
              status: submitted.status,
            });
            job = options.jobs.get(request, job.id) ?? job;
            if (submitted.status === "completed") {
              return attach(request, job, submitted.output);
            }
            return {
              jobId: job.id,
              status: submitted.status,
              ...("progress" in submitted && submitted.progress !== undefined
                ? { progress: submitted.progress }
                : {}),
            };
          } catch (error) {
            options.jobs.update(job.id, { status: "failed" });
            throw error;
          }
        }
      }
      if (job.status === "completed" && job.artifactId) {
        return { status: "completed", artifactId: job.artifactId };
      }
      if (job.status === "failed")
        throw new Error("Video job failed; do not resubmit automatically");
      if (!job.providerJobId) {
        throw new Error("Video submission is uncertain; do not resubmit automatically");
      }
      try {
        const output = await options.poll(job.providerJobId, request.signal);
        options.jobs.update(job.id, {
          status: output.status,
        });
        if (output.status === "completed") {
          return attach(request, options.jobs.get(request, job.id) ?? job, output.output);
        }
        if (output.status === "failed") throw new Error("Video generation failed");
        return {
          jobId: job.id,
          status: output.status,
          ...("progress" in output && output.progress !== undefined
            ? { progress: output.progress }
            : {}),
        };
      } catch (error) {
        options.jobs.update(job.id, { status: "failed" });
        throw error;
      }
    },
  };
}
