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
