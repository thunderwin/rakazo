// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "../lib/i18n";
import { LocalComposer } from "./LocalComposer";
import type { LocalBot } from "./types";

vi.mock("@lingui/react/macro", () => {
  const t = (strings: TemplateStringsArray, ...values: unknown[]) => String.raw(strings, ...values);
  return {
    Trans: ({ children }: { children: ReactNode }) => children,
    useLingui: () => ({ t }),
  };
});

const assistant: LocalBot = {
  id: "bot-1",
  name: "Assistant",
  title: "",
  description: "Generalist",
  instructions: "",
  color: "blue",
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

const bots: LocalBot[] = [
  assistant,
  {
    ...assistant,
    id: "bot-2",
    name: "Researcher",
    description: "Checks sources",
    color: "green",
  },
];

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
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  host.remove();
  vi.unstubAllGlobals();
});

it("opens the mention picker, inserts a bot chip, and sends the mention text", async () => {
  const onSend = vi.fn(async () => true);
  root = createRoot(host);
  await act(async () =>
    root?.render(
      <LocalComposer
        bots={bots}
        activeBotName="Assistant"
        running={false}
        enterToSend
        onSend={onSend}
        onStop={vi.fn(async () => undefined)}
      />,
    ),
  );

  const textarea = host.querySelector("textarea")!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(textarea, "@Res");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(host.querySelector('[role="listbox"]')?.textContent).toContain("Researcher");

  await act(async () => {
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
  });
  expect(host.textContent).toContain("Researcher");
  expect((textarea as HTMLTextAreaElement).value).toBe("");

  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(textarea, "check this");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const send = host.querySelector('button[aria-label="Send"]') as HTMLButtonElement;
  await act(async () => send.click());

  expect(onSend).toHaveBeenCalledWith("@Researcher check this", []);
});

it("accepts a file attachment and can send it without text", async () => {
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:attachment"),
    revokeObjectURL: vi.fn(),
  });
  const onSend = vi.fn(async () => true);
  root = createRoot(host);
  await act(async () =>
    root?.render(
      <LocalComposer
        bots={bots}
        activeBotName="Assistant"
        running={false}
        enterToSend
        onSend={onSend}
        onStop={vi.fn(async () => undefined)}
      />,
    ),
  );
  const input = host.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(["hello"], "notes.txt", { type: "text/plain" });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));

  expect(host.textContent).toContain("notes.txt");
  const send = host.querySelector('button[aria-label="Send"]') as HTMLButtonElement;
  await act(async () => send.click());

  expect(onSend).toHaveBeenCalledWith("", [
    expect.objectContaining({ file, mimeType: "text/plain" }),
  ]);
});
