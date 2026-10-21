import { openLocalDatabase } from "@rakazo/local-db";
import { describe, expect, it, vi } from "vitest";
import type { LocalAgentEngine, LocalAgentEvent, LocalAgentRunRequest } from "./agent.js";
import { LocalGroupRuntime } from "./group-runtime.js";
import { LocalToolRegistry } from "./tools.js";

const model = {
  provider: "openai-compatible",
  id: "model-a",
  baseUrl: "https://gateway.example/v1/model/openai",
  apiKey: "session-token",
};

function setup(run: LocalAgentEngine["run"]) {
  const db = openLocalDatabase(":memory:");
  const first = db.bots.create({ name: "Researcher", color: "green" });
  const second = db.bots.create({ name: "Writer", color: "orange" });
  const third = db.bots.create({ name: "Reviewer", color: "blue" });
  const group = db.groups.create({
    name: "Launch team",
    botIds: [first.id, second.id, third.id],
  });
  const events: Array<{ event: LocalAgentEvent; runId: string }> = [];
  const runtime = new LocalGroupRuntime({
    db,
    engine: { run, abort: vi.fn(async () => undefined) },
    tools: new LocalToolRegistry([], () => false),
    resolveModel: () => model,
    onEvent: (event, runId) => {
      events.push({ event, runId });
    },
  });
  return { db, runtime, group, bots: [first, second, third], events };
}

describe("local group runtime", () => {
  it("wakes the first member when no bot is mentioned", async () => {
    const engine = async function* (request: LocalAgentRunRequest): AsyncIterable<LocalAgentEvent> {
      yield { type: "text", text: `reply from ${request.botId}` };
      yield { type: "done" };
    } satisfies LocalAgentEngine["run"];
    const { db, runtime, group, bots } = setup(engine);

    const result = await runtime.sendMessage(group.id, "Start without a mention");
    const messages = runtime.listMessages(group.id);

    expect(result.runs.map((run) => run.botId)).toEqual([bots[0]!.id]);
    expect(messages.map((message) => message.role)).toEqual(["user", "bot"]);
    expect(messages[1]).toMatchObject({ botId: bots[0]!.id });
    db.close();
  });

  it("wakes mentioned members and shares one ordered group thread", async () => {
    const engine = async function* (request: LocalAgentRunRequest): AsyncIterable<LocalAgentEvent> {
      yield { type: "text", text: `reply from ${request.botId}` };
      yield { type: "done" };
    } satisfies LocalAgentEngine["run"];
    const { db, runtime, group, bots } = setup(engine);
    const result = await runtime.sendMessage(group.id, "@Writer draft this. @Reviewer check it.");
    const messages = runtime.listMessages(group.id);
    expect(result.runs.map((run) => run.botId)).toEqual([bots[1]!.id, bots[2]!.id]);
    expect(messages.map((message) => message.sequence)).toEqual([1, 2, 3]);
    expect(messages.slice(1).map((message) => message.botId)).toEqual([bots[1]!.id, bots[2]!.id]);
    db.close();
  });

  it("persists a handoff and runs the target bot in the same thread", async () => {
    const requests: LocalAgentRunRequest[] = [];
    const engine = async function* (request: LocalAgentRunRequest): AsyncIterable<LocalAgentEvent> {
      requests.push(request);
      const handoff = request.tools.find((tool) => tool.name === "handoff_to_bot");
      expect(handoff).toBeDefined();
      if (request.botId === handoffBotId) {
        yield {
          type: "tool",
          name: "handoff_to_bot",
          args: { confirm_name: "Writer", message: "Write the final draft." },
          executionId: "handoff-1",
        };
        await request.executeTool(
          "handoff_to_bot",
          { confirm_name: "Writer", message: "Write the final draft." },
          "handoff-1",
        );
        yield { type: "text", text: "Research complete." };
      } else {
        yield { type: "text", text: "Draft ready." };
      }
      yield { type: "done" };
    } satisfies LocalAgentEngine["run"];
    const { db, runtime, group, bots } = setup(engine);
    const handoffBotId = bots[0]!.id;

    const result = await runtime.sendMessage(group.id, "Research and write this.");
    const messages = runtime.listMessages(group.id);

    expect(result.runs.map((run) => run.botId)).toEqual([bots[0]!.id, bots[1]!.id]);
    expect(requests[1]?.prompt).toBe("Write the final draft.");
    expect(
      messages.some((message) =>
        message.blocks.some(
          (block) =>
            typeof block === "object" &&
            block !== null &&
            !Array.isArray(block) &&
            block.kind === "handoff" &&
            block.toBotId === bots[1]!.id &&
            block.hop === 1,
        ),
      ),
    ).toBe(true);
    expect(messages.at(-1)?.botId).toBe(bots[1]!.id);
    db.close();
  });

  it("rejects an immediate handoff back to the previous bot", async () => {
    let firstId = "";
    const engine = async function* (request: LocalAgentRunRequest): AsyncIterable<LocalAgentEvent> {
      const targetName = request.botId === firstId ? "Writer" : "Researcher";
      yield {
        type: "tool",
        name: "handoff_to_bot",
        args: { confirm_name: targetName, message: "Continue." },
        executionId: `handoff-${request.botId}`,
      };
      await request.executeTool(
        "handoff_to_bot",
        { confirm_name: targetName, message: "Continue." },
        `handoff-${request.botId}`,
      );
      yield { type: "done" };
    } satisfies LocalAgentEngine["run"];
    const { db, runtime, group, bots } = setup(engine);
    firstId = bots[0]!.id;

    const result = await runtime.sendMessage(group.id, "Start the handoff chain.");
    const messages = runtime.listMessages(group.id);

    expect(result.runs).toHaveLength(2);
    expect(result.runs[1]).toMatchObject({ botId: bots[1]!.id, failed: true });
    expect(
      messages.some((message) =>
        message.blocks.some(
          (block) =>
            typeof block === "object" &&
            block !== null &&
            !Array.isArray(block) &&
            block.kind === "error" &&
            block.message === "Do not hand the stage back to its previous owner",
        ),
      ),
    ).toBe(true);
    db.close();
  });
});
