// @vitest-environment jsdom
import type { RakazoDesktopLocal } from "@rakazo/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocalApp } from "./LocalApp";

const bot = {
  id: "bot-1",
  name: "Researcher",
  title: "",
  description: "Checks sources",
  instructions: "",
  color: "green",
  modelProvider: null,
  modelId: null,
  thinkingLevel: null,
  disabledBuiltinTools: [],
  templateKey: null,
  templateVersion: null,
  createdAt: "2026-10-20T00:00:00.000Z",
  updatedAt: "2026-10-20T00:00:00.000Z",
};

function bridge(): RakazoDesktopLocal {
  return {
    auth: {
      status: vi.fn(async () => ({
        signedIn: true,
        serverUrl: "https://api.example.com",
        userId: "user-1",
        email: "user@example.com",
        name: "User",
      })),
      login: vi.fn(),
      signUp: vi.fn(),
      logout: vi.fn(),
    },
    bots: {
      list: vi.fn(async () => [bot]),
      create: vi.fn(async () => bot),
      update: vi.fn(async () => bot),
    },
    messages: {
      list: vi.fn(async () => [
        {
          id: "message-user",
          threadId: "thread-1",
          sequence: 1,
          role: "user" as const,
          blocks: [{ kind: "text", text: "@Researcher check this" }],
          createdAt: "2026-10-20T11:59:00.000Z",
          updatedAt: "2026-10-20T11:59:00.000Z",
        },
        {
          id: "message-1",
          threadId: "thread-1",
          sequence: 2,
          role: "bot" as const,
          blocks: [{ kind: "text", text: "**Source checked**" }],
          createdAt: "2026-10-20T12:00:00.000Z",
          updatedAt: "2026-10-20T12:00:00.000Z",
        },
      ]),
      send: vi.fn(),
    },
    groups: {
      list: vi.fn(async () => []),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      messages: {
        list: vi.fn(async () => []),
        send: vi.fn(),
      },
      cancel: vi.fn(),
    },
    runs: {
      cancel: vi.fn(),
      onStarted: vi.fn(() => () => undefined),
      onEvent: vi.fn(() => () => undefined),
    },
    settings: {
      get: vi.fn(async () => ({
        theme: "dark" as const,
        sendWithEnter: true,
        defaultModelId: null,
      })),
      update: vi.fn(),
    },
    browser: {
      status: vi.fn(async () => ({
        available: true,
        connected: true,
        port: 47891,
        error: null,
        clientVersion: "0.1.0",
      })),
      startPairing: vi.fn(),
      revoke: vi.fn(),
    },
    diagnostics: { copy: vi.fn() },
    activity: { list: vi.fn(async () => []) },
    memory: {
      list: vi.fn(async () => []),
      update: vi.fn(),
      remove: vi.fn(),
    },
    routines: {
      list: vi.fn(async () => []),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      runNow: vi.fn(),
      history: vi.fn(async () => []),
    },
    artifacts: {
      create: vi.fn(),
      read: vi.fn(async () => null),
    },
  };
}

let root: ReturnType<typeof createRoot> | undefined;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  host.remove();
  vi.unstubAllGlobals();
});

it("renders the original bot identity, mentions, and Markdown message content", async () => {
  root = createRoot(host);
  await act(async () => root?.render(<LocalApp bridge={bridge()} />));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(host.textContent).toContain("Researcher");
  expect(host.textContent).toContain("Chrome connected");
  expect(host.querySelector("strong")?.textContent).toBe("Source checked");
  expect(host.querySelector("[data-working]")).not.toBeNull();
  expect(host.textContent).toContain("@Researcher");
});

it("shows an actionable error banner and keeps the composer available for retry", async () => {
  const api = bridge();
  api.messages.list = vi.fn(async () => []);
  api.messages.send = vi.fn(async () => {
    throw new Error("Your model quota is exhausted. Check your plan or balance.");
  });
  root = createRoot(host);
  await act(async () => root?.render(<LocalApp bridge={api} />));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  const textarea = host.querySelector("textarea")!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(textarea, "Try again");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    (host.querySelector('button[aria-label="Send"]') as HTMLButtonElement).click();
  });

  await vi.waitFor(() => expect(host.textContent).toContain("Model quota exhausted"));
  expect(host.textContent).toContain("Retry");
  expect((textarea as HTMLTextAreaElement).value).toBe("Try again");
});

it("renders a group thread, bot-authored messages, and handoff events", async () => {
  const api = bridge();
  const writer = {
    ...bot,
    id: "bot-2",
    name: "Writer",
    description: "Turns notes into copy",
    color: "orange",
  };
  const group = {
    id: "group-1",
    name: "Launch team",
    description: "Research and writing",
    color: "violet",
    members: [bot, writer],
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
  };
  api.bots.list = vi.fn(async () => [bot, writer]);
  api.groups.list = vi.fn(async () => [group]);
  api.groups.messages.list = vi.fn(async () => [
    {
      id: "group-message-1",
      threadId: "group-thread",
      sequence: 1,
      role: "user" as const,
      botId: null,
      blocks: [{ kind: "text", text: "Prepare the launch notes" }],
      createdAt: "2026-10-20T12:00:00.000Z",
      updatedAt: "2026-10-20T12:00:00.000Z",
    },
    {
      id: "group-message-2",
      threadId: "group-thread",
      sequence: 2,
      role: "bot" as const,
      botId: bot.id,
      blocks: [
        {
          kind: "handoff",
          fromBotId: bot.id,
          toBotId: writer.id,
          text: "Write the final draft.",
          hop: 1,
        },
      ],
      createdAt: "2026-10-20T12:01:00.000Z",
      updatedAt: "2026-10-20T12:01:00.000Z",
    },
    {
      id: "group-message-3",
      threadId: "group-thread",
      sequence: 3,
      role: "bot" as const,
      botId: writer.id,
      blocks: [{ kind: "text", text: "**Draft ready**" }],
      createdAt: "2026-10-20T12:02:00.000Z",
      updatedAt: "2026-10-20T12:02:00.000Z",
    },
  ]);

  root = createRoot(host);
  await act(async () => root?.render(<LocalApp bridge={api} />));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => {
    [...host.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Launch team"))
      ?.click();
  });
  await vi.waitFor(() => expect(host.textContent).toContain("Draft ready"));
  expect(host.textContent).toContain("Researcher");
  expect(host.textContent).toContain("Writer");
  expect(host.textContent).toContain("Write the final draft.");
  expect(host.textContent).toContain("hop 1");
  const textarea = host.querySelector("textarea")!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(textarea, "@ev");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(host.querySelector('[role="listbox"]')?.textContent).toContain("everyone");
});

it("shows recent run and tool activity locally", async () => {
  const api = bridge();
  api.activity.list = vi.fn(async () => [
    {
      id: "run-1",
      kind: "direct" as const,
      botId: bot.id,
      groupId: null,
      threadId: "thread-1",
      status: "completed" as const,
      error: null,
      startedAt: "2026-10-20T12:00:00.000Z",
      endedAt: "2026-10-20T12:00:02.000Z",
      tools: [
        {
          id: "run-1:tool-1",
          runId: "run-1",
          executionId: "tool-1",
          botId: bot.id,
          toolName: "browser_observe",
          arguments: { max_elements: 20 },
          result: { elements: 3 },
          status: "completed" as const,
          error: null,
          startedAt: "2026-10-20T12:00:00.500Z",
          endedAt: "2026-10-20T12:00:01.000Z",
        },
      ],
    },
  ]);
  root = createRoot(host);
  await act(async () => root?.render(<LocalApp bridge={api} />));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => {
    (host.querySelector('button[aria-label="Activity"]') as HTMLButtonElement).click();
  });
  await vi.waitFor(() => expect(document.body.textContent).toContain("browser_observe"));
  expect(document.body.textContent).toContain("1 tool");
  expect(document.body.textContent).toContain("completed");
});

it("opens local bot memory and saves a revision", async () => {
  const api = bridge();
  const memoryDocument = {
    id: "memory-1",
    scope: "bot" as const,
    botId: bot.id,
    path: "MEMORY.md",
    content: "Prefers primary sources.\n",
    revision: 1,
    createdAt: "2026-10-20T12:00:00.000Z",
    updatedAt: "2026-10-20T12:00:00.000Z",
  };
  api.memory.list = vi.fn(async (input) => (input?.scope === "user" ? [] : [memoryDocument]));
  api.memory.update = vi.fn(async (_id, content) => ({
    ...memoryDocument,
    content,
    revision: 2,
  }));
  root = createRoot(host);
  await act(async () => root?.render(<LocalApp bridge={api} />));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => {
    (host.querySelector('button[aria-label="Memory"]') as HTMLButtonElement).click();
  });
  await vi.waitFor(() => expect(document.body.textContent).toContain("MEMORY.md"));
  await act(async () => {
    [...document.body.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("MEMORY.md"))
      ?.click();
  });
  const textarea = document.body.querySelector(
    'textarea[aria-label="MEMORY.md"]',
  ) as HTMLTextAreaElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(textarea, "Updated fact.\n");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    [...document.body.querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === "Save")
      ?.click();
  });

  expect(api.memory.update).toHaveBeenCalledWith("memory-1", "Updated fact.\n", 1);
});

it("opens local routines and saves an edited schedule", async () => {
  const api = bridge();
  const routine = {
    id: "routine-1",
    botId: bot.id,
    name: "Morning brief",
    prompt: "Summarize overnight changes.",
    cron: "0 9 * * 1-5",
    timezone: "Asia/Hong_Kong",
    source: "local" as const,
    enabled: true,
    lastRunAt: null,
    nextRunAt: "2026-10-22T01:00:00.000Z",
    createdAt: "2026-10-20T12:00:00.000Z",
    updatedAt: "2026-10-20T12:00:00.000Z",
  };
  api.routines.list = vi.fn(async () => [routine]);
  api.routines.update = vi.fn(async (_id, input) => ({ ...routine, ...input }));
  root = createRoot(host);
  await act(async () => root?.render(<LocalApp bridge={api} />));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => {
    (host.querySelector('button[aria-label="Routines"]') as HTMLButtonElement).click();
  });
  await vi.waitFor(() => expect(document.body.textContent).toContain("Morning brief"));
  await act(async () => {
    [...document.body.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Morning brief"))
      ?.click();
  });
  const name = document.body.querySelector("#local-routine-name") as HTMLInputElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(name, "Updated brief");
    name.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    [...document.body.querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === "Save")
      ?.click();
  });

  expect(api.routines.update).toHaveBeenCalledWith(
    "routine-1",
    expect.objectContaining({
      name: "Updated brief",
      prompt: "Summarize overnight changes.",
      cron: "0 9 * * 1-5",
    }),
  );
});

it("renders an attachment block from the local artifact store", async () => {
  const api = bridge();
  api.messages.list = vi.fn(async () => [
    {
      id: "message-attachment",
      threadId: "thread-1",
      sequence: 1,
      role: "user" as const,
      blocks: [
        {
          kind: "file",
          artifactId: "artifact-1",
          mimeType: "text/plain",
          name: "notes.txt",
          size: 5,
        },
      ],
      createdAt: "2026-10-20T12:00:00.000Z",
      updatedAt: "2026-10-20T12:00:00.000Z",
    },
  ]);
  root = createRoot(host);
  await act(async () => root?.render(<LocalApp bridge={api} />));
  await vi.waitFor(() => expect(host.textContent).toContain("notes.txt"));
  expect(host.querySelector('button[aria-label="Download notes.txt"]')).not.toBeNull();
});
