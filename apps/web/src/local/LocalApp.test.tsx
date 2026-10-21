// @vitest-environment jsdom
import type {
  DesktopLocalSecretRequest,
  RakazoDesktopLocal,
} from "@rakazo/contracts";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "../lib/i18n";
import { LocalApp } from "./LocalApp";

vi.mock("@lingui/react/macro", () => {
  const t = (strings: TemplateStringsArray, ...values: unknown[]) =>
    String.raw(strings, ...values);
  return {
    Trans: ({ children }: { children: ReactNode }) => children,
    useLingui: () => ({ t }),
  };
});

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
  fleetManagement: false,
  createdByBotId: null,
  instructionsVersion: 1,
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
      archived: vi.fn(async () => []),
      restore: vi.fn(async () => bot),
      deleteArchived: vi.fn(),
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
      list: vi.fn(async () => ({ items: [], nextCursor: null })),
      read: vi.fn(async () => null),
      remove: vi.fn(),
    },
    scratchpad: {
      list: vi.fn(async () => []),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    },
    tickets: {
      list: vi.fn(async () => []),
      comments: vi.fn(async () => []),
      create: vi.fn(),
      update: vi.fn(),
      comment: vi.fn(),
    },
    knowledge: {
      list: vi.fn(async () => []),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    },
    skills: {
      list: vi.fn(async () => []),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    },
    secrets: {
      list: vi.fn(async () => []),
      put: vi.fn(),
      remove: vi.fn(),
      onRequest: vi.fn(() => () => undefined),
      respond: vi.fn(),
    },
    prompts: {
      onChoiceRequest: vi.fn(() => () => undefined),
      respondChoice: vi.fn(),
    },
    manifest: {
      state: vi.fn(async () => null),
      onUpdated: vi.fn(() => () => undefined),
    },
  };
}

let root: ReturnType<typeof createRoot> | undefined;
let host: HTMLDivElement;

beforeEach(() => {
  i18n.load("en", {});
  i18n.activate("en");
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
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
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

it("keeps chat settings and app settings in separate dialogs", async () => {
  root = createRoot(host);
  await act(async () => root?.render(<LocalApp bridge={bridge()} />));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  await act(async () => {
    (
      host.querySelector(
        'button[aria-label="Chat settings"]',
      ) as HTMLButtonElement
    ).click();
  });
  await vi.waitFor(() =>
    expect(document.querySelector('[role="dialog"]')).not.toBeNull(),
  );
  const chatSettings = document.querySelector('[role="dialog"]');
  expect(chatSettings?.textContent).toContain("Chat settings");
  expect(chatSettings?.textContent).toContain("Bot model");
  expect(chatSettings?.textContent).not.toContain("Language");
  expect(chatSettings?.textContent).not.toContain("Sign out");
  expect(chatSettings?.textContent).not.toContain("Knowledge and skills");

  await act(async () => {
    [...document.body.querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === "Cancel")
      ?.click();
  });
  await act(async () => {
    (
      host.querySelector('button[aria-label="Account"]') as HTMLButtonElement
    ).click();
  });
  await vi.waitFor(() =>
    expect(
      document.querySelector('[data-slot="popover-content"]'),
    ).not.toBeNull(),
  );
  const accountMenu = document.querySelector('[data-slot="popover-content"]');
  expect(accountMenu?.textContent).toContain("Sign out");
  const appSettingsButton = accountMenu?.querySelector(
    'button[aria-label="App settings"]',
  );
  expect(appSettingsButton).not.toBeNull();
  await act(async () => {
    (appSettingsButton as HTMLButtonElement).click();
  });
  await vi.waitFor(() =>
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "App settings",
    ),
  );
  const appSettings = document.querySelector('[role="dialog"]');
  expect(appSettings?.textContent).toContain("Language");
  expect(appSettings?.textContent).toContain("Browser");
  expect(appSettings?.textContent).toContain("Knowledge and skills");
  expect(appSettings?.textContent).toContain("Shared memory");
  expect(appSettings?.textContent).not.toContain("Sign out");
  expect(appSettings?.textContent).not.toContain("Bot model");
  expect(host.querySelector('button[aria-label="Sign out"]')).toBeNull();
  expect(
    host.querySelector('button[aria-label="Knowledge and skills"]'),
  ).toBeNull();
});

it("enables fleet management from chat settings", async () => {
  const api = bridge();
  const updateBot = vi.fn(
    async (_id: string, input: Parameters<typeof api.bots.update>[1]) => ({
      ...bot,
      ...input,
      fleetManagement: Boolean(input.fleetManagement),
    }),
  );
  api.bots.update = updateBot;
  root = createRoot(host);
  await act(async () => root?.render(<LocalApp bridge={api} />));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  await act(async () => {
    (
      host.querySelector(
        'button[aria-label="Chat settings"]',
      ) as HTMLButtonElement
    ).click();
  });
  await vi.waitFor(() =>
    expect(document.querySelector('[role="dialog"]')).not.toBeNull(),
  );
  const checkbox = document.querySelector<HTMLInputElement>(
    '[role="dialog"] input[type="checkbox"]',
  );
  expect(checkbox).not.toBeNull();
  await act(async () => checkbox?.click());
  const save = [
    ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
  ].find((button) => button.textContent?.trim() === "Save");
  expect(save).not.toBeUndefined();
  await act(async () => {
    save?.click();
  });

  expect(updateBot).toHaveBeenCalledWith(
    bot.id,
    expect.objectContaining({ fleetManagement: true }),
  );
});

it("opens the local artifact library and ticket board through the shared screens", async () => {
  const api = bridge();
  root = createRoot(host);
  await act(async () => root?.render(<LocalApp bridge={api} />));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  await act(async () => {
    (
      host.querySelector('button[aria-label="Artifacts"]') as HTMLButtonElement
    ).click();
  });
  await vi.waitFor(() => expect(api.artifacts.list).toHaveBeenCalled());
  expect(host.textContent).toContain("Artifacts");

  await act(async () => {
    (
      host.querySelector('button[aria-label="Back"]') as HTMLButtonElement
    ).click();
  });
  await act(async () => {
    (
      host.querySelector('button[aria-label="Board"]') as HTMLButtonElement
    ).click();
  });
  await vi.waitFor(() => expect(api.tickets.list).toHaveBeenCalled());
  expect(host.textContent).toContain("Board");
});

it("opens the shared command palette with local bots", async () => {
  const api = bridge();
  const writer = {
    ...bot,
    id: "bot-2",
    name: "Writer",
    description: "Turns notes into copy",
  };
  api.bots.list = vi.fn(async () => [bot, writer]);
  root = createRoot(host);
  await act(async () => root?.render(<LocalApp bridge={api} />));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  await act(async () => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "k",
        metaKey: true,
        bubbles: true,
      }),
    );
  });
  await vi.waitFor(() =>
    expect(
      document.querySelector('[data-testid="command-palette"]'),
    ).not.toBeNull(),
  );
  const writerItem = document.querySelector(
    '[data-testid="command-palette-bot-bot-2"]',
  ) as HTMLElement | null;
  expect(writerItem?.textContent).toContain("Writer");
  await act(async () => writerItem?.click());
  await vi.waitFor(() =>
    expect(
      host.querySelector('button[aria-current="page"]')?.textContent,
    ).toContain("Writer"),
  );
});

it("shows an actionable error banner and keeps the composer available for retry", async () => {
  const api = bridge();
  api.messages.list = vi.fn(async () => []);
  api.messages.send = vi.fn(async () => {
    throw new Error(
      "Your model quota is exhausted. Check your plan or balance.",
    );
  });
  root = createRoot(host);
  await act(async () => root?.render(<LocalApp bridge={api} />));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  const textarea = host.querySelector("textarea")!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setter?.call(textarea, "Try again");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    (
      host.querySelector('button[aria-label="Send"]') as HTMLButtonElement
    ).click();
  });

  await vi.waitFor(() =>
    expect(host.textContent).toContain("Model quota exhausted"),
  );
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
  expect(
    host.querySelector('button[aria-label="Group settings"]'),
  ).not.toBeNull();
  expect(host.textContent).toContain("Researcher");
  expect(host.textContent).toContain("Writer");
  expect(host.textContent).toContain("Write the final draft.");
  expect(host.textContent).toContain("hop 1");
  const textarea = host.querySelector("textarea")!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setter?.call(textarea, "@ev");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(host.querySelector('[role="listbox"]')?.textContent).toContain(
    "everyone",
  );
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
    (
      host.querySelector('button[aria-label="Activity"]') as HTMLButtonElement
    ).click();
  });
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("browser_observe"),
  );
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
  api.memory.list = vi.fn(async (input) =>
    input?.scope === "user" ? [] : [memoryDocument],
  );
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
    (
      host.querySelector('button[aria-label="Memory"]') as HTMLButtonElement
    ).click();
  });
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("MEMORY.md"),
  );
  await act(async () => {
    [...document.body.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("MEMORY.md"))
      ?.click();
  });
  const textarea = document.body.querySelector(
    'textarea[aria-label="MEMORY.md"]',
  ) as HTMLTextAreaElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setter?.call(textarea, "Updated fact.\n");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    [...document.body.querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === "Save")
      ?.click();
  });

  expect(api.memory.update).toHaveBeenCalledWith(
    "memory-1",
    "Updated fact.\n",
    1,
  );
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
    (
      host.querySelector('button[aria-label="Routines"]') as HTMLButtonElement
    ).click();
  });
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("Morning brief"),
  );
  await act(async () => {
    [...document.body.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Morning brief"))
      ?.click();
  });
  const name = document.body.querySelector(
    "#local-routine-name",
  ) as HTMLInputElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
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
  expect(
    host.querySelector('button[aria-label="Download notes.txt"]'),
  ).not.toBeNull();
});

it("opens local knowledge and skills with read-only built-ins", async () => {
  const api = bridge();
  const knowledge = {
    id: "knowledge-1",
    title: "Release checklist",
    content: "Verify rollback.",
    source: "local" as const,
    packageId: null,
    version: null,
    createdAt: "2026-10-20T12:00:00.000Z",
    updatedAt: "2026-10-20T12:00:00.000Z",
  };
  api.knowledge.list = vi.fn(async () => [knowledge]);
  api.knowledge.update = vi.fn(async (_id, input) => ({
    ...knowledge,
    ...input,
  }));
  api.skills.list = vi.fn(async () => [
    {
      id: "builtin:Interrogate",
      name: "Interrogate",
      description: "Review a change",
      content:
        "---\nname: Interrogate\ndescription: Review a change\n---\n\nReview it.",
      scripts: [],
      source: "builtin" as const,
      readOnly: true,
      createdAt: "1970-01-01T00:00:00.000Z",
      updatedAt: "1970-01-01T00:00:00.000Z",
    },
  ]);
  root = createRoot(host);
  await act(async () => root?.render(<LocalApp bridge={api} />));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => {
    (
      host.querySelector('button[aria-label="Account"]') as HTMLButtonElement
    ).click();
  });
  await vi.waitFor(() =>
    expect(
      document.querySelector('[data-slot="popover-content"]'),
    ).not.toBeNull(),
  );
  await act(async () => {
    (
      document.querySelector(
        '[data-slot="popover-content"] button[aria-label="App settings"]',
      ) as HTMLButtonElement
    ).click();
  });
  await vi.waitFor(() =>
    expect(document.querySelector('[role="dialog"]')).not.toBeNull(),
  );
  const resourcesButton = [
    ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
  ].find((button) => button.textContent?.includes("Knowledge and skills"));
  expect(resourcesButton).not.toBeUndefined();
  await act(async () => {
    resourcesButton?.click();
  });
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("Release checklist"),
  );
  await act(async () => {
    [...document.body.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Release checklist"))
      ?.click();
  });
  const content = document.body.querySelector(
    "#local-knowledge-content",
  ) as HTMLTextAreaElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setter?.call(content, "Verify rollback and notes.");
    content.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    [...document.body.querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === "Save")
      ?.click();
  });
  expect(api.knowledge.update).toHaveBeenCalledWith("knowledge-1", {
    title: "Release checklist",
    content: "Verify rollback and notes.",
  });
  await act(async () => {
    [...document.body.querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === "Skills")
      ?.click();
  });
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("Interrogate"),
  );
});

it("manages bot credentials from chat settings", async () => {
  const api = bridge();
  root = createRoot(host);
  await act(async () => root?.render(<LocalApp bridge={api} />));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => {
    (
      host.querySelector(
        'button[aria-label="Chat settings"]',
      ) as HTMLButtonElement
    ).click();
  });
  const credentials = [...document.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === "Credentials",
  );
  await act(async () => credentials?.click());
  await vi.waitFor(() =>
    expect(api.secrets.list).toHaveBeenCalledWith("bot-1"),
  );
  expect(document.body.textContent).toContain(
    "No credentials saved for this bot.",
  );
});

it("keeps protected prompt values out of the model-facing response path", async () => {
  const api = bridge();
  let listener: ((request: DesktopLocalSecretRequest) => void) | undefined;
  api.secrets.onRequest = vi.fn((next) => {
    listener = next;
    return () => undefined;
  });
  root = createRoot(host);
  await act(async () => root?.render(<LocalApp bridge={api} />));
  await act(async () => {
    listener?.({
      requestId: "secret-request-1",
      name: "example",
      origin: "https://api.example.com",
      auth: { type: "bearer" },
    });
  });
  await vi.waitFor(() =>
    expect(document.body.textContent).toContain("Protected input"),
  );
  const value = document.querySelector(
    "#local-secret-prompt-value",
  ) as HTMLInputElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(value, "secret-value");
    value.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const continueButton = [...document.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === "Continue",
  );
  await act(async () => continueButton?.click());
  await vi.waitFor(() =>
    expect(api.secrets.respond).toHaveBeenCalledWith("secret-request-1", {
      value: "secret-value",
    }),
  );
});
