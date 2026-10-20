import { openLocalDatabase } from "@rakazo/local-db";
import { describe, expect, it } from "vitest";
import type {
  LocalAgentEngine,
  LocalAgentEvent,
  LocalAgentRunContext,
  LocalAgentRunRequest,
} from "./agent.js";
import { LocalRuntime } from "./runtime.js";
import { SqliteConversationStore } from "./store.js";
import { type LocalTool, LocalToolRegistry } from "./tools.js";

class FakeEngine implements LocalAgentEngine {
  readonly requests: LocalAgentRunRequest[] = [];
  readonly aborted: string[] = [];

  constructor(
    private readonly respond: (
      request: LocalAgentRunRequest,
    ) => AsyncIterable<LocalAgentEvent> = async function* () {
      yield { type: "text", text: "ok" };
      yield { type: "done" };
    },
  ) {}

  run(
    request: LocalAgentRunRequest,
    _context?: LocalAgentRunContext,
  ): AsyncIterable<LocalAgentEvent> {
    this.requests.push(request);
    return this.respond(request);
  }

  async abort(runId: string): Promise<void> {
    this.aborted.push(runId);
  }
}

const model = {
  provider: "openai-compatible",
  id: "model-a",
  baseUrl: "https://gateway.example/v1/model/openai",
  apiKey: "session-token",
};

const probeTool: LocalTool = {
  definition: {
    name: "probe",
    description: "Return a probe value.",
    inputSchema: {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
    },
  },
  async execute({ args }) {
    return { echoed: args.value };
  },
};

function setup(engine: LocalAgentEngine, approve = true) {
  const db = openLocalDatabase(":memory:");
  const events: LocalAgentEvent[] = [];
  const runtime = new LocalRuntime({
    store: new SqliteConversationStore(db),
    engine,
    tools: new LocalToolRegistry([probeTool], () => approve),
    resolveModel: () => model,
    onEvent: (event) => {
      events.push(event);
    },
  });
  return { db, runtime, events };
}

describe("local runtime", () => {
  it("creates a bot with its thread", () => {
    const { db, runtime } = setup(new FakeEngine());
    const bot = runtime.createBot({ name: "Researcher" });

    expect(db.bots.get(bot.id)?.name).toBe("Researcher");
    expect(db.threads.getForBot(bot.id)).not.toBeNull();
    db.close();
  });

  it("sends prior history separately from the new prompt and persists the reply", async () => {
    const engine = new FakeEngine(async function* () {
      yield { type: "text", text: "Hello" };
      yield { type: "text", text: " world" };
      yield { type: "done" };
    });
    const { db, runtime, events } = setup(engine);
    const bot = runtime.createBot({
      name: "Researcher",
      instructions: "Verify sources.",
      modelProvider: "openai-compatible",
      modelId: "model-a",
      thinkingLevel: "medium",
    });

    const result = await runtime.sendMessage(bot.id, "Find the source.");

    expect(result.text).toBe("Hello world");
    expect(engine.requests).toHaveLength(1);
    expect(engine.requests[0]).toMatchObject({
      botId: bot.id,
      prompt: "Find the source.",
      instructions: "Verify sources.",
      history: [],
      model,
      sourceMessageId: result.userMessage.id,
    });
    expect(events.map((event) => event.type)).toEqual(["text", "text", "done"]);
    expect(db.messages.list(result.thread.id).map((message) => message.role)).toEqual([
      "user",
      "bot",
    ]);
    expect(result.assistantMessage?.blocks).toEqual([{ kind: "text", text: "Hello world" }]);

    await runtime.sendMessage(bot.id, "Continue.");
    expect(engine.requests[1]?.history).toEqual([
      {
        id: result.userMessage.id,
        createdAt: result.userMessage.createdAt,
        role: "user",
        content: "Find the source.",
      },
      expect.objectContaining({ role: "assistant", content: "Hello world" }),
    ]);
    db.close();
  });

  it("keeps the user message when the engine fails", async () => {
    const engine = new FakeEngine(async function* () {
      yield { type: "text", text: "partial" };
      throw new Error("engine failed");
    });
    const { db, runtime } = setup(engine);
    const bot = runtime.createBot({ name: "Researcher" });

    await expect(runtime.sendMessage(bot.id, "Try this")).rejects.toThrow("engine failed");
    const thread = db.threads.getForBot(bot.id);
    expect(thread).not.toBeNull();
    expect(db.messages.list(thread!.id).map((message) => message.role)).toEqual(["user"]);
    db.close();
  });

  it("runs an approved local tool and persists the invocation", async () => {
    const engine = new FakeEngine(async function* (request) {
      yield {
        type: "tool",
        name: "probe",
        args: { value: "hello" },
        executionId: "exec-1",
      };
      const output = await request.executeTool("probe", { value: "hello" }, "exec-1");
      expect(output).toEqual({ echoed: "hello" });
      yield { type: "text", text: "The probe worked." };
      yield { type: "done" };
    });
    const { db, runtime } = setup(engine);
    const bot = runtime.createBot({ name: "Chief" });

    const result = await runtime.sendMessage(bot.id, "Use the probe.");

    expect(result.text).toBe("The probe worked.");
    expect(result.toolCalls).toEqual([
      { executionId: "exec-1", name: "probe", arguments: { value: "hello" } },
    ]);
    expect(result.assistantMessage?.blocks).toEqual([
      { kind: "text", text: "The probe worked." },
      {
        kind: "tool_call",
        executionId: "exec-1",
        name: "probe",
        arguments: { value: "hello" },
      },
    ]);
    db.close();
  });

  it("does not expose disabled tools to the engine", async () => {
    const engine = new FakeEngine();
    const { db, runtime } = setup(engine);
    const bot = runtime.createBot({ name: "Chief", disabledBuiltinTools: ["probe"] });

    await runtime.sendMessage(bot.id, "Hello");

    expect(engine.requests[0]?.tools).toEqual([]);
    db.close();
  });

  it("rejects a tool when the approval gate denies it", async () => {
    const engine = new FakeEngine(async function* (request) {
      await request.executeTool("probe", { value: "blocked" }, "exec-1");
      yield { type: "done" };
    });
    const { db, runtime } = setup(engine, false);
    const bot = runtime.createBot({ name: "Chief" });

    await expect(runtime.sendMessage(bot.id, "Try the probe.")).rejects.toThrow(
      "Tool probe was not approved",
    );
    db.close();
  });

  it("delegates cancellation to the engine", async () => {
    const engine = new FakeEngine();
    const { db, runtime } = setup(engine);

    await runtime.abort("run-1");

    expect(engine.aborted).toEqual(["run-1"]);
    db.close();
  });

  it("rejects unknown bots and empty messages", async () => {
    const { db, runtime } = setup(new FakeEngine());
    await expect(runtime.sendMessage("missing", "hello")).rejects.toThrow("Bot not found");
    const bot = runtime.createBot({ name: "Chief" });
    await expect(runtime.sendMessage(bot.id, "   ")).rejects.toThrow("Message cannot be empty");
    db.close();
  });
});
