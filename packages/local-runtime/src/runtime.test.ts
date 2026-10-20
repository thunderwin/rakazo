import { openLocalDatabase } from "@rakazo/local-db";
import { describe, expect, it } from "vitest";
import type { ModelGateway, ModelGatewayRequest } from "./model-gateway.js";
import { LocalRuntime } from "./runtime.js";

class FakeGateway implements ModelGateway {
  readonly requests: ModelGatewayRequest[] = [];

  constructor(
    private readonly chunks: string[],
    private readonly fail = false,
  ) {}

  async *stream(request: ModelGatewayRequest) {
    this.requests.push(request);
    for (const text of this.chunks) yield { type: "text" as const, text };
    if (this.fail) yield { type: "error" as const, message: "gateway failed" };
    yield { type: "done" as const };
  }
}

describe("local runtime", () => {
  it("creates a bot with its thread", () => {
    const db = openLocalDatabase(":memory:");
    const runtime = new LocalRuntime({ db, gateway: new FakeGateway([]) });
    const bot = runtime.createBot({ name: "Researcher" });

    expect(db.bots.get(bot.id)?.name).toBe("Researcher");
    expect(db.threads.getForBot(bot.id)).not.toBeNull();
    db.close();
  });

  it("sends local history through the gateway and persists the reply", async () => {
    const db = openLocalDatabase(":memory:");
    const gateway = new FakeGateway(["Hello", " world"]);
    const runtime = new LocalRuntime({ db, gateway });
    const bot = runtime.createBot({
      name: "Researcher",
      instructions: "Verify sources.",
      modelProvider: "openrouter",
      modelId: "model-a",
      thinkingLevel: "medium",
    });

    const result = await runtime.sendMessage(bot.id, "Find the source.");

    expect(result.text).toBe("Hello world");
    expect(gateway.requests).toHaveLength(1);
    expect(gateway.requests[0]).toMatchObject({
      botId: bot.id,
      instructions: "Verify sources.",
      model: { provider: "openrouter", id: "model-a" },
      thinkingLevel: "medium",
      messages: [{ role: "user", content: "Find the source." }],
    });
    expect(db.messages.list(result.thread.id).map((message) => message.role)).toEqual([
      "user",
      "bot",
    ]);
    expect(result.assistantMessage?.blocks).toEqual([{ kind: "text", text: "Hello world" }]);

    await runtime.sendMessage(bot.id, "Continue.");
    expect(gateway.requests[1]?.messages).toEqual([
      { role: "user", content: "Find the source." },
      { role: "assistant", content: "Hello world" },
      { role: "user", content: "Continue." },
    ]);
    db.close();
  });

  it("keeps the user message when the gateway fails", async () => {
    const db = openLocalDatabase(":memory:");
    const runtime = new LocalRuntime({ db, gateway: new FakeGateway(["partial"], true) });
    const bot = runtime.createBot({ name: "Researcher" });

    await expect(runtime.sendMessage(bot.id, "Try this")).rejects.toThrow("gateway failed");
    const thread = db.threads.getForBot(bot.id);
    expect(thread).not.toBeNull();
    expect(db.messages.list(thread!.id).map((message) => message.role)).toEqual(["user"]);
    db.close();
  });

  it("preserves tool calls without executing them", async () => {
    const db = openLocalDatabase(":memory:");
    const gateway: ModelGateway = {
      async *stream() {
        yield {
          type: "tool_call",
          toolCall: {
            id: "call-1",
            type: "function",
            function: { name: "shell", arguments: '{"command":"pwd"}' },
          },
        };
        yield { type: "done" };
      },
    };
    const runtime = new LocalRuntime({ db, gateway });
    const bot = runtime.createBot({ name: "Chief" });
    const result = await runtime.sendMessage(bot.id, "Where am I?");

    expect(result.toolCalls).toHaveLength(1);
    expect(result.assistantMessage?.blocks).toEqual([
      { kind: "tool_call", id: "call-1", name: "shell", arguments: '{"command":"pwd"}' },
    ]);
    db.close();
  });

  it("rejects unknown bots and empty messages", async () => {
    const db = openLocalDatabase(":memory:");
    const runtime = new LocalRuntime({ db, gateway: new FakeGateway([]) });
    await expect(runtime.sendMessage("missing", "hello")).rejects.toThrow("Bot not found");
    const bot = runtime.createBot({ name: "Chief" });
    await expect(runtime.sendMessage(bot.id, "   ")).rejects.toThrow("Message cannot be empty");
    db.close();
  });
});
