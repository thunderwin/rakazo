import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ClientManifestContentSchema } from "@rakazo/contracts";
import { afterEach, describe, expect, it } from "vitest";
import type { LocalAgentEngine, LocalAgentRunRequest } from "./agent.js";
import { LocalRuntimeService } from "./service.js";
import { type LocalTool, LocalToolRegistry } from "./tools.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

const engine: LocalAgentEngine = {
  async *run() {
    yield { type: "text", text: "ok" };
    yield { type: "done" };
  },
  async abort() {},
};

const tools = new LocalToolRegistry([], () => true);
const resolveModel = () => ({
  provider: "openai-compatible",
  id: "test-model",
  baseUrl: "https://gateway.example/v1/model/openai",
  apiKey: "test-token",
});

async function tempDbPath(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "rakazo-local-runtime-"));
  directories.push(directory);
  return path.join(directory, "runtime.sqlite");
}

describe("local runtime service", () => {
  it("owns a database, creates bots, and survives reopen", async () => {
    const databasePath = await tempDbPath();
    const first = new LocalRuntimeService({ databasePath, engine, tools, resolveModel });
    const bot = first.createBot({ name: "Chief" });
    const result = await first.sendMessage(bot.id, "Hello");
    expect(result.text).toBe("ok");
    expect(first.listMessages(bot.id).map((message) => message.role)).toEqual(["user", "bot"]);
    first.close();

    const second = new LocalRuntimeService({ databasePath, engine, tools, resolveModel });
    expect(second.listBots().map((item) => item.id)).toEqual([bot.id]);
    expect(second.listMessages(bot.id).map((message) => message.role)).toEqual(["user", "bot"]);
    second.close();
  });

  it("returns no messages for an unknown bot", () => {
    const service = new LocalRuntimeService({
      databasePath: ":memory:",
      engine,
      tools,
      resolveModel,
    });
    expect(service.listMessages("missing")).toEqual([]);
    service.close();
  });

  it("persists client settings in the account database", async () => {
    const databasePath = await tempDbPath();
    const first = new LocalRuntimeService({ databasePath, engine, tools, resolveModel });
    expect(first.getUserSettings()).toEqual({
      theme: "system",
      sendWithEnter: true,
      defaultModelId: null,
    });
    first.updateUserSettings({
      theme: "light",
      sendWithEnter: false,
      defaultModelId: "model-a",
    });
    first.close();

    const second = new LocalRuntimeService({ databasePath, engine, tools, resolveModel });
    expect(second.getUserSettings()).toEqual({
      theme: "light",
      sendWithEnter: false,
      defaultModelId: "model-a",
    });
    second.close();
  });

  it("runs a persistent peer bot and records the request and reply", async () => {
    const service = new LocalRuntimeService({
      databasePath: ":memory:",
      engine,
      tools,
      resolveModel,
    });
    const source = service.createBot({ name: "Lead" });
    const target = service.createBot({ name: "Researcher" });

    await expect(
      service.sendPeerMessage({
        fromBotId: source.id,
        botId: target.id,
        message: "Check this finding.",
        intent: "request",
      }),
    ).resolves.toBe("ok");

    expect(service.listMessages(target.id).map((message) => message.role)).toEqual(["user", "bot"]);
    expect(service.db.peerMessages.listForBot(source.id)).toEqual([
      expect.objectContaining({
        fromBotId: source.id,
        toBotId: target.id,
        prompt: "Check this finding.",
        reply: "ok",
        status: "completed",
      }),
    ]);
    service.close();
  });

  it("records run and tool activity locally", async () => {
    const probe: LocalTool = {
      definition: {
        name: "probe",
        description: "Probe",
        inputSchema: { type: "object" },
      },
      execute: async ({ args }) => ({ echoed: args.value }),
    };
    const activityEngine: LocalAgentEngine = {
      async *run(request) {
        yield {
          type: "tool",
          name: "probe",
          args: { value: "hello" },
          executionId: "tool-1",
        };
        await request.executeTool("probe", { value: "hello" }, "tool-1");
        yield { type: "text", text: "done" };
        yield { type: "done" };
      },
      async abort() {},
    };
    const service = new LocalRuntimeService({
      databasePath: ":memory:",
      engine: activityEngine,
      tools: new LocalToolRegistry([probe], () => true),
      resolveModel,
    });
    const bot = service.createBot({ name: "Researcher" });

    await service.sendMessage(bot.id, "Use the probe");

    expect(service.listActivity()).toEqual([
      expect.objectContaining({
        kind: "direct",
        botId: bot.id,
        status: "completed",
        tools: [
          expect.objectContaining({
            executionId: "tool-1",
            toolName: "probe",
            status: "completed",
            arguments: { value: "hello" },
            result: { echoed: "hello" },
          }),
        ],
      }),
    ]);
    service.close();
  });

  it("records group handoffs as tool activity", async () => {
    let firstBotId = "";
    const handoffEngine: LocalAgentEngine = {
      async *run(request) {
        if (request.botId === firstBotId) {
          yield {
            type: "tool",
            name: "handoff_to_bot",
            args: { confirm_name: "Writer", message: "Draft it" },
            executionId: "handoff-tool",
          };
          await request.executeTool(
            "handoff_to_bot",
            { confirm_name: "Writer", message: "Draft it" },
            "handoff-tool",
          );
        } else {
          yield { type: "text", text: "Drafted" };
        }
        yield { type: "done" };
      },
      async abort() {},
    };
    const service = new LocalRuntimeService({
      databasePath: ":memory:",
      engine: handoffEngine,
      tools,
      resolveModel,
    });
    const first = service.createBot({ name: "Researcher" });
    const second = service.createBot({ name: "Writer" });
    firstBotId = first.id;
    const group = service.createGroup({ name: "Launch", botIds: [first.id, second.id] });

    await service.sendGroupMessage(group.id, "Prepare the draft");
    const handoffRun = service
      .listActivity()
      .find((activity) => activity.botId === first.id && activity.kind === "group");

    expect(handoffRun).toEqual(
      expect.objectContaining({
        groupId: group.id,
        status: "completed",
        tools: [
          expect.objectContaining({
            toolName: "handoff_to_bot",
            status: "completed",
            result: expect.objectContaining({ ok: true }),
          }),
        ],
      }),
    );
    service.close();
  });

  it("persists private and shared memory and injects it into direct runs", async () => {
    const requests: LocalAgentRunRequest[] = [];
    let calls = 0;
    const memoryEngine: LocalAgentEngine = {
      async *run(request) {
        requests.push(request);
        calls += 1;
        if (calls === 1) {
          await request.executeTool(
            "remember",
            { content: "Prefers primary sources." },
            "memory-bot",
          );
          await request.executeTool(
            "save_shared_memory",
            { path: "TEAM.md", content: "Use the shared launch date." },
            "memory-shared",
          );
        }
        yield { type: "text", text: `reply ${calls}` };
        yield { type: "done" };
      },
      async abort() {},
    };
    const service = new LocalRuntimeService({
      databasePath: ":memory:",
      engine: memoryEngine,
      tools,
      resolveModel,
    });
    const bot = service.createBot({ name: "Researcher", instructions: "Verify sources." });

    await service.sendMessage(bot.id, "Remember these.");

    expect(service.listMemory({ scope: "bot", botId: bot.id })).toEqual([
      expect.objectContaining({
        path: "MEMORY.md",
        content: "Prefers primary sources.\n",
        revision: 1,
      }),
    ]);
    expect(service.listMemory({ scope: "user" })).toEqual([
      expect.objectContaining({
        path: "TEAM.md",
        content: "Use the shared launch date.",
        revision: 1,
      }),
    ]);

    await service.sendMessage(bot.id, "What do you know?");

    expect(requests[1]?.instructions).toContain("Verify sources.");
    expect(requests[1]?.instructions).toContain("bot: MEMORY.md");
    expect(requests[1]?.instructions).toContain("Prefers primary sources.");
    expect(requests[1]?.instructions).toContain("user: TEAM.md");
    expect(requests[1]?.instructions).toContain("Use the shared launch date.");
    service.close();
  });

  it("does not expose private memory tools in group chats", async () => {
    let groupTools: string[] = [];
    const groupEngine: LocalAgentEngine = {
      async *run(request) {
        groupTools = request.tools.map((tool) => tool.name);
        yield { type: "text", text: "ok" };
        yield { type: "done" };
      },
      async abort() {},
    };
    const service = new LocalRuntimeService({
      databasePath: ":memory:",
      engine: groupEngine,
      tools,
      resolveModel,
    });
    const first = service.createBot({ name: "Researcher" });
    const second = service.createBot({ name: "Writer" });
    const group = service.createGroup({ name: "Launch", botIds: [first.id, second.id] });

    await service.sendGroupMessage(group.id, "Prepare the draft");

    expect(groupTools).not.toContain("remember");
    expect(groupTools).not.toContain("save_shared_memory");
    expect(groupTools).not.toContain("schedule_create");
    expect(groupTools).not.toContain("schedule_list");
    expect(groupTools).not.toContain("schedule_cancel");
    service.close();
  });

  it("lets a direct bot create and list a local routine", async () => {
    let routineId = "";
    const routineEngine: LocalAgentEngine = {
      async *run(request) {
        const created = (await request.executeTool(
          "schedule_create",
          {
            name: "Morning brief",
            prompt: "Summarize overnight changes.",
            cron: "0 9 * * *",
            timezone: "UTC",
          },
          "schedule-tool",
        )) as { id: string };
        routineId = created.id;
        yield { type: "text", text: "Scheduled" };
        yield { type: "done" };
      },
      async abort() {},
    };
    const service = new LocalRuntimeService({
      databasePath: ":memory:",
      engine: routineEngine,
      tools,
      resolveModel,
    });
    const bot = service.createBot({ name: "Research assistant" });

    await service.sendMessage(bot.id, "Schedule a morning brief");

    expect(service.listRoutines(bot.id)).toEqual([
      expect.objectContaining({
        id: routineId,
        name: "Morning brief",
        prompt: "Summarize overnight changes.",
        cron: "0 9 * * *",
        enabled: true,
      }),
    ]);
    expect(service.listRoutineRuns(routineId)).toEqual([]);
    service.close();
  });

  it("stores attachments and sends images and file notes for the current turn", async () => {
    const observed: LocalAgentRunRequest[] = [];
    const attachmentEngine: LocalAgentEngine = {
      async *run(request) {
        observed.push(request);
        yield { type: "text", text: "Reviewed" };
        yield { type: "done" };
      },
      async abort() {},
    };
    const service = new LocalRuntimeService({
      databasePath: ":memory:",
      engine: attachmentEngine,
      tools,
      resolveModel,
    });
    const bot = service.createBot({ name: "Reader" });
    const image = service.createArtifact({
      botId: bot.id,
      name: "screen.png",
      mimeType: "image/png",
      contentBase64: "iVBORw0KGgo=",
    });
    const file = service.createArtifact({
      botId: bot.id,
      name: "notes.txt",
      mimeType: "text/plain",
      contentBase64: "aGVsbG8=",
    });

    await service.sendMessage(bot.id, "Review both", {}, [image.id, file.id]);

    expect(service.readArtifact(file.id)).toMatchObject({
      name: "notes.txt",
      contentBase64: "aGVsbG8=",
    });
    expect(observed[0]?.prompt).toContain('User attached file "notes.txt"');
    expect(observed[0]?.currentTurnImages).toEqual([
      expect.objectContaining({ name: "screen.png", mimeType: "image/png" }),
    ]);
    expect(service.listMessages(bot.id)[0]?.blocks).toEqual([
      { kind: "text", text: "Review both" },
      {
        kind: "image",
        artifactId: image.id,
        mimeType: "image/png",
        name: "screen.png",
      },
      {
        kind: "file",
        artifactId: file.id,
        mimeType: "text/plain",
        name: "notes.txt",
        size: 5,
      },
    ]);
    const other = service.createBot({ name: "Other" });
    await expect(service.sendMessage(other.id, "Wrong target", {}, [file.id])).rejects.toThrow(
      "Attachment not found",
    );
    service.close();
  });

  it("keeps group attachments scoped to the group and shares the current image", async () => {
    const observed: LocalAgentRunRequest[] = [];
    const groupEngine: LocalAgentEngine = {
      async *run(request) {
        observed.push(request);
        yield { type: "text", text: "Seen" };
        yield { type: "done" };
      },
      async abort() {},
    };
    const service = new LocalRuntimeService({
      databasePath: ":memory:",
      engine: groupEngine,
      tools,
      resolveModel,
    });
    const first = service.createBot({ name: "Researcher" });
    const second = service.createBot({ name: "Writer" });
    const group = service.createGroup({ name: "Launch", botIds: [first.id, second.id] });
    const image = service.createArtifact({
      groupId: group.id,
      name: "brief.png",
      mimeType: "image/png",
      contentBase64: "iVBORw0KGgo=",
    });

    await service.sendGroupMessage(group.id, "", {}, [image.id]);

    expect(observed[0]?.currentTurnImages).toEqual([
      expect.objectContaining({ name: "brief.png" }),
    ]);
    expect(service.listGroupMessages(group.id)[0]?.blocks).toEqual([
      {
        kind: "image",
        artifactId: image.id,
        mimeType: "image/png",
        name: "brief.png",
      },
    ]);
    service.close();
  });

  it("injects skills and exposes local knowledge search tools", async () => {
    const observed: LocalAgentRunRequest[] = [];
    let searchResult: unknown;
    const knowledgeEngine: LocalAgentEngine = {
      async *run(request) {
        observed.push(request);
        searchResult = await request.executeTool(
          "knowledge_search",
          { query: "rollback" },
          "knowledge-tool",
        );
        yield { type: "text", text: "Checked" };
        yield { type: "done" };
      },
      async abort() {},
    };
    const service = new LocalRuntimeService({
      databasePath: ":memory:",
      engine: knowledgeEngine,
      tools,
      resolveModel,
    });
    const bot = service.createBot({ name: "Operator" });
    service.createKnowledge({
      title: "Release checklist",
      content: "Verify rollback and release notes.",
    });
    service.createSkill({
      name: "Release review",
      description: "Review a release",
      body: "1. Read the checklist.\n2. Verify rollback.",
    });

    await service.sendMessage(bot.id, "/Release review\nUse the checklist");

    expect(observed[0]?.prompt).toContain("2. Verify rollback.");
    expect(observed[0]?.prompt).toContain("Use the checklist");
    expect(observed[0]?.instructions).toContain("- Release review:");
    expect(searchResult).toEqual({
      results: [
        expect.objectContaining({
          title: "Release checklist",
          snippet: expect.stringContaining("rollback"),
        }),
      ],
    });
    service.close();
  });

  it("applies a managed client manifest without deleting user data", () => {
    const service = new LocalRuntimeService({
      databasePath: ":memory:",
      engine,
      tools,
      resolveModel,
    });
    const userBot = service.createBot({ name: "My assistant" });
    const content = ClientManifestContentSchema.parse({
      name: "Example Company",
      minimumClientVersion: "0.3.0",
      botTemplates: [
        {
          key: "analyst",
          name: "Company analyst",
          instructions: "Use company sources.",
        },
        {
          key: "writer",
          name: "Company writer",
          instructions: "Write clearly.",
          color: "green",
        },
      ],
      groupPresets: [
        {
          key: "launch",
          name: "Launch team",
          botKeys: ["analyst", "writer"],
        },
      ],
      knowledge: [{ key: "policy", title: "Release policy", content: "Verify rollback." }],
      skills: [
        {
          key: "review",
          name: "Company review",
          description: "Review a release",
          content: "---\nname: Company review\ndescription: Review a release\n---\n\nCheck it.",
        },
      ],
      routines: [
        {
          key: "daily",
          botKey: "analyst",
          name: "Daily brief",
          prompt: "Summarize changes.",
          cron: "0 9 * * *",
          timezone: "UTC",
        },
      ],
    });
    const state = service.applyClientManifest({
      organization: { id: "org-1", name: "Example Company" },
      version: 3,
      hash: "abc",
      publishedAt: "2026-10-21T00:00:00.000Z",
      signature: null,
      content,
    });

    expect(state).toMatchObject({ organizationId: "org-1", version: 3 });
    expect(service.listBots().map((bot) => bot.name)).toEqual(
      expect.arrayContaining(["My assistant", "Company analyst", "Company writer"]),
    );
    expect(service.listGroups()[0]).toMatchObject({
      name: "Launch team",
      source: "managed",
      members: [{ name: "Company analyst" }, { name: "Company writer" }],
    });
    expect(service.listKnowledge()).toEqual([
      expect.objectContaining({ title: "Release policy", source: "managed" }),
    ]);
    expect(service.listSkills().find((skill) => skill.name === "Company review")).toMatchObject({
      source: "managed",
      readOnly: true,
    });
    const analyst = service.listBots().find((bot) => bot.name === "Company analyst")!;
    expect(service.db.routines.list(analyst.id)).toEqual([
      expect.objectContaining({ name: "Daily brief", source: "managed" }),
    ]);

    service.applyClientManifest({
      organization: { id: "org-1", name: "Example Company" },
      version: 4,
      hash: "def",
      publishedAt: "2026-10-22T00:00:00.000Z",
      signature: null,
      content: ClientManifestContentSchema.parse({ name: "Example Company" }),
    });
    expect(service.listBots().map((bot) => bot.id)).toEqual([userBot.id]);
    expect(service.listGroups()).toEqual([]);
    expect(service.listKnowledge()).toEqual([]);
    expect(service.listSkills().map((skill) => skill.source)).toEqual(["builtin"]);
    service.close();
  });

  it("stops peer bot cycles", () => {
    const service = new LocalRuntimeService({
      databasePath: ":memory:",
      engine,
      tools,
      resolveModel,
    });
    const source = service.createBot({ name: "Lead" });
    const target = service.createBot({ name: "Researcher" });

    return expect(
      service.sendPeerMessage({
        fromBotId: target.id,
        botId: source.id,
        message: "Loop",
        intent: "request",
        peerChain: [source.id, target.id],
      }),
    )
      .rejects.toThrow("cycle")
      .finally(() => service.close());
  });
});
