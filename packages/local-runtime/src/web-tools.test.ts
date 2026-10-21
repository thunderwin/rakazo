import { describe, expect, it, vi } from "vitest";
import { LocalToolRegistry } from "./tools.js";
import { createLocalWebTools } from "./web-tools.js";

describe("local web tools", () => {
  it("routes bounded fetches through the provider", async () => {
    const fetch = vi.fn(async () => ({
      url: "https://example.com/page",
      title: "Example",
      text: "Readable content",
      truncated: false,
    }));
    const registry = new LocalToolRegistry(createLocalWebTools({ fetch }));

    await expect(
      registry.execute({
        name: "web_fetch",
        args: { url: "https://example.com/page", maxChars: 80_000 },
        executionId: "fetch-1",
      }),
    ).resolves.toMatchObject({ title: "Example", text: "Readable content" });
    expect(fetch).toHaveBeenCalledWith({
      url: "https://example.com/page",
      maxChars: 50_000,
      signal: undefined,
    });
  });

  it("exposes disabled read-only tools from the model schema", () => {
    const registry = new LocalToolRegistry(
      createLocalWebTools({
        search: async () => [],
        fetch: async () => ({ url: "", title: "", text: "", truncated: false }),
      }),
    );
    const bot = {
      id: "bot-1",
      name: "Bot",
      title: "",
      description: "",
      instructions: "",
      color: "blue",
      modelProvider: null,
      modelId: null,
      thinkingLevel: null,
      disabledBuiltinTools: ["web_search"],
      fleetManagement: false,
      createdByBotId: null,
      instructionsVersion: 1,
      templateKey: null,
      templateVersion: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    expect(registry.definitionsFor(bot)).toEqual([
      expect.objectContaining({ name: "web_fetch", readOnly: true }),
    ]);
  });
});
