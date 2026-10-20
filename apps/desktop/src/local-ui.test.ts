import { readFile } from "node:fs/promises";
import path from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";

const bot = {
  id: "bot-1",
  name: "Chief",
  title: "",
  description: "Local helper",
  instructions: "",
  color: "blue",
  modelProvider: null,
  modelId: null,
  thinkingLevel: null,
  disabledBuiltinTools: [],
  templateKey: null,
  templateVersion: null,
  createdAt: "2026-10-20T00:00:00.000Z",
  updatedAt: "2026-10-20T00:00:00.000Z",
};

const message = {
  id: "message-1",
  threadId: "thread-1",
  sequence: 1,
  role: "user" as const,
  blocks: [{ kind: "text", text: "Hello local" }],
  createdAt: "2026-10-20T00:00:00.000Z",
  updatedAt: "2026-10-20T00:00:00.000Z",
};

describe("desktop local UI", () => {
  it("renders bots and history, then sends a message", async () => {
    const html = await readFile(path.join(import.meta.dirname, "local.html"), "utf8");
    const script = await readFile(path.join(import.meta.dirname, "local.js"), "utf8");
    const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
    const listMessages = vi.fn(async () => [message]);
    const sendMessage = vi.fn(async () => ({
      thread: { id: "thread-1", botId: bot.id, title: "", createdAt: "", updatedAt: "" },
      userMessage: message,
      assistantMessage: null,
      text: "",
    }));
    const api = {
      bots: {
        list: vi.fn(async () => [bot]),
        create: vi.fn(async () => bot),
      },
      messages: {
        list: listMessages,
        send: sendMessage,
      },
    };
    Object.assign(dom.window, {
      rakazoDesktop: { platform: "linux", local: api },
    });

    dom.window.eval(script);
    await vi.waitFor(() =>
      expect(dom.window.document.querySelector(".bot")?.textContent).toBe("Chief"),
    );
    expect(dom.window.document.querySelector(".message")?.textContent).toContain("Hello local");

    const text = dom.window.document.getElementById("message-text") as HTMLTextAreaElement;
    text.value = "Next message";
    dom.window.document
      .getElementById("composer")
      ?.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith("bot-1", "Next message"));
    expect(listMessages).toHaveBeenCalledWith("bot-1");
    dom.window.close();
  });
});
