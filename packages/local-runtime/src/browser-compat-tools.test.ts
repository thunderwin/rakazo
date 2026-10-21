import { describe, expect, it, vi } from "vitest";
import { createBrowserCompatibilityTools } from "./browser-compat-tools.js";
import type { BrowserHost } from "./browser-tools.js";

const observation = {
  observation_id: "obs-1",
  tab_id: 1,
  title: "Login",
  url: "https://example.test/login",
  text: "Sign in",
  elements: [],
  truncated: false,
};

describe("browser compatibility tools", () => {
  it("fills a saved credential without returning its value", async () => {
    const host = {
      observe: vi.fn(async () => observation),
      type: vi.fn(async () => ({ tab_id: 1, title: "Login", url: observation.url })),
    } as unknown as BrowserHost;
    const resolveLoginSecret = vi.fn(async () => "protected-password");
    const tools = createBrowserCompatibilityTools({ host, resolveLoginSecret });
    const act = tools.find((tool) => tool.definition.name === "browser_act")!;
    const result = await act.execute({
      botId: "bot-1",
      runId: "run-1",
      name: "browser_act",
      args: {
        actions: [
          {
            kind: "fill_secret",
            ref: "e2",
            secret: "example-login",
            field: "password",
          },
        ],
      },
      executionId: "act-1",
    });
    expect(result).toEqual({
      ok: true,
      completed: 1,
      url: "https://example.test/login",
    });
    expect(host.type).toHaveBeenCalledWith(
      "run-1",
      { ref: "e2", text: "protected-password", clear: true },
      undefined,
    );
    expect(JSON.stringify(result)).not.toContain("protected-password");
  });
});
