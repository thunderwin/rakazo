import { describe, expect, it, vi } from "vitest";
import {
  createLocalComputerTools,
  type LocalComputerProvider,
  parseComputerActions,
} from "./computer-tools.js";

describe("local computer tools", () => {
  it("normalizes pointer, keyboard, and wait actions", () => {
    expect(
      parseComputerActions([
        { kind: "click", x: 10, y: 20 },
        { kind: "key", key: "Return", modifiers: ["Ctrl"] },
        { kind: "wait", ms: 50 },
      ]),
    ).toEqual([
      { kind: "pointer", x: 10, y: 20, type: "click", button: "left" },
      { kind: "key", key: "Return", modifiers: ["Ctrl"] },
      { kind: "wait", ms: 50 },
    ]);
  });

  it("returns screenshots as agent image content", async () => {
    const observation = {
      frameId: "frame-1",
      capturedAt: "2026-01-01T00:00:00.000Z",
      width: 2,
      height: 1,
      mimeType: "image/jpeg" as const,
      image: new Uint8Array([1, 2, 3]),
    };
    const provider: LocalComputerProvider = {
      observe: vi.fn(async () => observation),
      act: vi.fn(async () => ({ completed: 1, observation })),
    };
    const [observe, act] = createLocalComputerTools(provider);
    await expect(
      observe!.execute({ name: "computer_observe", args: {}, executionId: "observe-1" }),
    ).resolves.toMatchObject({
      kind: "agent_tool_result",
      content: [{ type: "text" }, { type: "image", mimeType: "image/jpeg", data: "AQID" }],
      details: { frameId: "frame-1", width: 2, height: 1 },
    });
    await act!.execute({
      name: "computer_act",
      args: { actions: [{ kind: "click", x: 1, y: 1 }] },
      executionId: "act-1",
    });
    expect(provider.act).toHaveBeenCalledWith(
      expect.objectContaining({
        actions: [{ kind: "pointer", x: 1, y: 1, type: "click", button: "left" }],
        observe: true,
      }),
    );
  });
});
