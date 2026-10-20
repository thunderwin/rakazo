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
      auth: {
        status: vi.fn(async () => ({ signedIn: true, serverUrl: "https://app.example.com" })),
        login: vi.fn(async () => undefined),
        logout: vi.fn(async () => undefined),
      },
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

  it("requires sign-in when a server URL is configured", async () => {
    const html = await readFile(path.join(import.meta.dirname, "local.html"), "utf8");
    const script = await readFile(path.join(import.meta.dirname, "local.js"), "utf8");
    const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
    const login = vi.fn(async () => undefined);
    const listBots = vi.fn(async () => [bot]);
    const api = {
      auth: {
        status: vi.fn(async () => ({
          signedIn: false,
          serverUrl: "https://app.example.com",
        })),
        login,
        logout: vi.fn(async () => undefined),
      },
      bots: { list: listBots, create: vi.fn(async () => bot) },
      messages: { list: vi.fn(async () => [message]), send: vi.fn() },
    };
    Object.assign(dom.window, { rakazoDesktop: { platform: "linux", local: api } });

    dom.window.eval(script);
    await vi.waitFor(() =>
      expect(dom.window.document.getElementById("login")?.hasAttribute("hidden")).toBe(false),
    );
    expect(dom.window.document.getElementById("login-server")?.textContent).toBe(
      "https://app.example.com",
    );

    (dom.window.document.getElementById("login-email") as HTMLInputElement).value =
      "user@example.com";
    (dom.window.document.getElementById("login-password") as HTMLInputElement).value = "password12";
    dom.window.document
      .getElementById("login-form")
      ?.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));

    await vi.waitFor(() => expect(login).toHaveBeenCalledWith("user@example.com", "password12"));
    await vi.waitFor(() => expect(listBots).toHaveBeenCalled());
    dom.window.close();
  });

  it("creates an account from the local sign-in card", async () => {
    const html = await readFile(path.join(import.meta.dirname, "local.html"), "utf8");
    const script = await readFile(path.join(import.meta.dirname, "local.js"), "utf8");
    const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
    const signUp = vi.fn(async () => undefined);
    const api = {
      auth: {
        status: vi.fn(async () => ({
          signedIn: false,
          serverUrl: "https://app.example.com",
          userId: null,
          email: null,
          name: null,
        })),
        login: vi.fn(),
        signUp,
        logout: vi.fn(),
      },
      bots: { list: vi.fn(async () => [bot]), create: vi.fn(async () => bot) },
      messages: { list: vi.fn(async () => []), send: vi.fn() },
    };
    Object.assign(dom.window, { rakazoDesktop: { platform: "linux", local: api } });

    dom.window.eval(script);
    await vi.waitFor(() =>
      expect(dom.window.document.getElementById("login")?.hasAttribute("hidden")).toBe(false),
    );
    (dom.window.document.getElementById("login-toggle") as HTMLButtonElement).click();
    (dom.window.document.getElementById("login-name") as HTMLInputElement).value = "New User";
    (dom.window.document.getElementById("login-email") as HTMLInputElement).value =
      "new@example.com";
    (dom.window.document.getElementById("login-password") as HTMLInputElement).value = "password12";
    dom.window.document
      .getElementById("login-form")
      ?.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));

    await vi.waitFor(() =>
      expect(signUp).toHaveBeenCalledWith("New User", "new@example.com", "password12"),
    );
    dom.window.close();
  });

  it("streams run events and stops the active run", async () => {
    const html = await readFile(path.join(import.meta.dirname, "local.html"), "utf8");
    const script = await readFile(path.join(import.meta.dirname, "local.js"), "utf8");
    const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
    let startedListener: ((run: { runId: string }) => void) | undefined;
    let eventListener:
      | ((update: { runId: string; event: { type: string; text?: string } }) => void)
      | undefined;
    let finishSend: ((value: unknown) => void) | undefined;
    const sendMessage = vi.fn(
      () =>
        new Promise((resolve) => {
          finishSend = resolve;
        }),
    );
    const cancel = vi.fn(async () => undefined);
    const api = {
      auth: {
        status: vi.fn(async () => ({ signedIn: true, serverUrl: null })),
        login: vi.fn(),
        logout: vi.fn(),
      },
      bots: { list: vi.fn(async () => [bot]), create: vi.fn(async () => bot) },
      messages: { list: vi.fn(async () => []), send: sendMessage },
      runs: {
        cancel,
        onStarted: (listener) => {
          startedListener = listener;
        },
        onEvent: (listener) => {
          eventListener = listener;
        },
      },
    };
    Object.assign(dom.window, { rakazoDesktop: { platform: "linux", local: api } });

    dom.window.eval(script);
    await vi.waitFor(() =>
      expect(dom.window.document.querySelector(".bot")?.textContent).toBe("Chief"),
    );
    const text = dom.window.document.getElementById("message-text") as HTMLTextAreaElement;
    text.value = "Stream this";
    dom.window.document
      .getElementById("composer")
      ?.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith("bot-1", "Stream this"));

    startedListener?.({ runId: "run-1" });
    eventListener?.({ runId: "run-1", event: { type: "progress", text: "Reading files" } });
    eventListener?.({ runId: "run-1", event: { type: "text", text: "Partial answer" } });
    expect(dom.window.document.querySelector(".message.live")?.textContent).toContain(
      "Partial answer",
    );

    (dom.window.document.getElementById("stop") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledWith("run-1"));
    finishSend?.({});
    await vi.waitFor(() =>
      expect((dom.window.document.getElementById("stop") as HTMLButtonElement).hidden).toBe(true),
    );
    dom.window.close();
  });
});
