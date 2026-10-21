import type { BrowserObservation, BrowserTabSummary } from "@rakazo/browser-protocol";
import { describe, expect, it, vi } from "vitest";
import { type BrowserHost, createBrowserTools } from "./browser-tools.js";
import { LocalToolRegistry } from "./tools.js";

const bot = {
  id: "bot-1",
  name: "Chief",
  title: "",
  description: "",
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
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const tab: BrowserTabSummary = {
  tab_id: 7,
  window_id: 3,
  title: "Inbox",
  url: "https://mail.example.com/",
  active: true,
};

const observation: BrowserObservation = {
  observation_id: "obs-1",
  tab_id: 7,
  title: "Inbox",
  url: "https://mail.example.com/",
  text: "Inbox",
  elements: [],
  truncated: false,
};

function host() {
  return {
    listTabs: vi.fn(async () => [tab]),
    getTab: vi.fn(async () => tab),
    open: vi.fn(async () => tab),
    navigate: vi.fn(async () => tab),
    borrowTab: vi.fn(async () => tab),
    returnTab: vi.fn(async () => tab),
    observe: vi.fn(async () => observation),
    click: vi.fn(async () => tab),
    type: vi.fn(async () => tab),
    scroll: vi.fn(async () => tab),
    closeSession: vi.fn(async () => undefined),
  } satisfies BrowserHost;
}

describe("local browser tools", () => {
  it("keeps reads approval-free and scopes calls to the Agent run", async () => {
    const browser = host();
    const registry = new LocalToolRegistry(createBrowserTools(browser), () => false);

    await expect(
      registry.execute({
        runId: "run-1",
        name: "browser_observe",
        args: { max_elements: 12 },
        executionId: "exec-1",
      }),
    ).resolves.toEqual(observation);

    expect(browser.observe).toHaveBeenCalledWith(
      "run-1",
      { maxElements: 12, maxTextChars: undefined },
      undefined,
    );
  });

  it("requires approval before browser mutations and validates refs", async () => {
    const browser = host();
    const approve = vi.fn(() => false);
    const registry = new LocalToolRegistry(createBrowserTools(browser), approve);

    await expect(
      registry.execute({
        runId: "run-1",
        name: "browser_click",
        args: { ref: "e2" },
        executionId: "exec-1",
      }),
    ).rejects.toThrow("was not approved");
    expect(approve).toHaveBeenCalledWith(
      expect.objectContaining({ name: "browser_click", args: { ref: "e2" } }),
    );
    expect(browser.click).not.toHaveBeenCalled();

    approve.mockReturnValue(true);
    await expect(
      registry.execute({
        runId: "run-1",
        name: "browser_click",
        args: {},
        executionId: "exec-2",
      }),
    ).rejects.toThrow("ref is required");
  });

  it("passes typing and scrolling options through without dropping fields", async () => {
    const browser = host();
    const registry = new LocalToolRegistry(createBrowserTools(browser), () => true);

    await registry.execute({
      runId: "run-1",
      name: "browser_type",
      args: { ref: "e4", text: "hello", clear: true, submit: true },
      executionId: "exec-1",
    });
    await registry.execute({
      runId: "run-1",
      name: "browser_scroll",
      args: { ref: "e4", delta_y: 300 },
      executionId: "exec-2",
    });

    expect(browser.type).toHaveBeenCalledWith(
      "run-1",
      { ref: "e4", text: "hello", clear: true, submit: true },
      undefined,
    );
    expect(browser.scroll).toHaveBeenCalledWith("run-1", { ref: "e4", deltaY: 300 }, undefined);
  });

  it("filters browser tools when a bot disables them", () => {
    const registry = new LocalToolRegistry(createBrowserTools(host()), () => true);

    expect(
      registry
        .definitionsFor({ ...bot, disabledBuiltinTools: ["browser_click", "browser_observe"] })
        .map((tool) => tool.name),
    ).not.toContain("browser_click");
  });
});
