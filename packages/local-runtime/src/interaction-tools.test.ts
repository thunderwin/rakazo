import { describe, expect, it, vi } from "vitest";
import { createLocalInteractionTools } from "./interaction-tools.js";

describe("local interaction tools", () => {
  it("returns the user's choice and posts a durable progress message", async () => {
    const ask = vi.fn(async () => "Keep the current design");
    const message = vi.fn(async () => ({ ok: true }));
    const publishEvent = vi.fn();
    const tools = createLocalInteractionTools({
      ask,
      message,
      takeover: vi.fn(async () => true),
    });
    const askTool = tools.find((tool) => tool.definition.name === "ask_user")!;
    const messageTool = tools.find((tool) => tool.definition.name === "message_user")!;

    await expect(
      askTool!.execute({
        name: "ask_user",
        args: {
          question: "Which direction?",
          options: ["Keep the current design", "Start over"],
        },
        executionId: "ask-1",
      }),
    ).resolves.toEqual({ answer: "Keep the current design" });

    await expect(
      messageTool!.execute({
        botId: "bot-1",
        threadId: "thread-1",
        name: "message_user",
        args: { message: "Checking the release notes." },
        executionId: "message-1",
        publishEvent,
      }),
    ).resolves.toEqual({ ok: true });
    expect(message).toHaveBeenCalledWith(
      expect.objectContaining({ name: "message_user" }),
      "Checking the release notes.",
    );
    expect(publishEvent).toHaveBeenCalledWith({
      type: "message",
      text: "Checking the release notes.",
    });
  });
});
