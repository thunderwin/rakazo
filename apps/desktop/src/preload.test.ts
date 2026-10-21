import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import type { RakazoDesktop, RakazoSetup } from "@rakazo/contracts";
import { describe, expect, it, vi } from "vitest";

function runPreload(file: string, ipc: { invoke?: unknown; on?: unknown; off?: unknown } = {}) {
  const invoke =
    (ipc.invoke as ReturnType<typeof vi.fn>) ?? vi.fn(async (channel: string) => ({ channel }));
  const on = (ipc.on as ReturnType<typeof vi.fn>) ?? vi.fn();
  const off = (ipc.off as ReturnType<typeof vi.fn>) ?? vi.fn();
  const exposeInMainWorld = vi.fn();
  const source = readFileSync(path.join(import.meta.dirname, file), "utf8");

  vm.runInNewContext(source, {
    process: { platform: "linux" },
    require(moduleName: string) {
      if (moduleName !== "electron") throw new Error(`Unexpected preload import: ${moduleName}`);
      return { contextBridge: { exposeInMainWorld }, ipcRenderer: { invoke, on, off } };
    },
  });

  return { invoke, on, off, exposeInMainWorld };
}

describe("desktop preload bridge", () => {
  it("exposes the scoped desktop bridges", async () => {
    const { invoke, exposeInMainWorld } = runPreload("preload.cjs");

    expect(exposeInMainWorld).toHaveBeenCalledTimes(1);
    const [globalName, bridge] = exposeInMainWorld.mock.calls[0] as [string, RakazoDesktop];
    expect(globalName).toBe("rakazoDesktop");
    expect(bridge.platform).toBe("linux");
    expect(Object.keys(bridge).sort()).toEqual([
      "computer",
      "local",
      "localSettings",
      "oauth",
      "platform",
      "update",
      "window",
    ]);
    expect(Object.keys(bridge.local!).sort()).toEqual([
      "activity",
      "artifacts",
      "auth",
      "bots",
      "browser",
      "diagnostics",
      "groups",
      "knowledge",
      "manifest",
      "memory",
      "messages",
      "routines",
      "runs",
      "settings",
      "skills",
    ]);
    expect(Object.keys(bridge.window).sort()).toEqual([
      "close",
      "minimize",
      "state",
      "toggleMaximize",
    ]);
    expect(Object.keys(bridge.update).sort()).toEqual(["check", "download", "install", "state"]);

    await bridge.oauth.open?.("https://provider.example.com/authorize");
    await bridge.oauth.cancel?.("https://provider.example.com/authorize");
    await bridge.window.close();
    await bridge.window.minimize();
    await bridge.window.toggleMaximize();
    await bridge.window.state();
    await bridge.update.state();
    await bridge.update.check();
    await bridge.update.download();
    await bridge.update.install();
    await bridge.local?.bots.list();
    await bridge.local?.auth.status();
    await bridge.local?.auth.login("user@example.com", "password12");
    await bridge.local?.auth.signUp("User", "user@example.com", "password12");
    await bridge.local?.auth.logout();
    await bridge.local?.bots.create({ name: "Chief" });
    await bridge.local?.bots.update("bot-1", { name: "Chief" });
    await bridge.local?.messages.list("bot-1");
    await bridge.local?.messages.send("bot-1", "Hello");
    await bridge.local?.groups.list();
    await bridge.local?.groups.create({ name: "Team", botIds: ["bot-1", "bot-2"] });
    await bridge.local?.groups.update("group-1", { name: "Team" });
    await bridge.local?.groups.remove("group-1");
    await bridge.local?.groups.messages.list("group-1");
    await bridge.local?.groups.messages.send("group-1", "Hello team");
    await bridge.local?.groups.cancel("group-1");
    await bridge.local?.runs.cancel("run-1");
    await bridge.local?.settings.get();
    await bridge.local?.settings.update({ theme: "light" });
    await bridge.local?.browser.status();
    await bridge.local?.browser.startPairing();
    await bridge.local?.browser.revoke();
    await bridge.local?.diagnostics.copy();
    await bridge.local?.activity.list(20);
    await bridge.local?.memory.list({ botId: "bot-1", scope: "bot" });
    await bridge.local?.memory.update("memory-1", "fact", 1);
    await bridge.local?.memory.remove("memory-1");
    await bridge.local?.routines.list("bot-1");
    await bridge.local?.routines.create("bot-1", {
      name: "Daily",
      prompt: "Check",
      cron: "0 9 * * *",
    });
    await bridge.local?.routines.update("routine-1", { enabled: false });
    await bridge.local?.routines.remove("routine-1");
    await bridge.local?.routines.runNow("routine-1");
    await bridge.local?.routines.history("routine-1", 20);
    await bridge.local?.artifacts.create({
      botId: "bot-1",
      name: "notes.txt",
      mimeType: "text/plain",
      contentBase64: "aGVsbG8=",
    });
    await bridge.local?.artifacts.read("artifact-1");
    await bridge.local?.knowledge.list();
    await bridge.local?.knowledge.create({ title: "Guide", content: "Steps" });
    await bridge.local?.knowledge.update("knowledge-1", { content: "Updated" });
    await bridge.local?.knowledge.remove("knowledge-1");
    await bridge.local?.skills.list();
    await bridge.local?.skills.create({
      name: "Review",
      description: "Review work",
      body: "Check it.",
    });
    await bridge.local?.skills.update("Review", { description: "Review carefully" });
    await bridge.local?.skills.remove("Review");
    await bridge.local?.manifest.state();
    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
      "desktop.oauth.open",
      "desktop.oauth.cancel",
      "desktop.window.close",
      "desktop.window.minimize",
      "desktop.window.toggleMaximize",
      "desktop.window.state",
      "desktop.update.state",
      "desktop.update.check",
      "desktop.update.download",
      "desktop.update.install",
      "desktop.local.bots.list",
      "desktop.local.auth.status",
      "desktop.local.auth.login",
      "desktop.local.auth.signUp",
      "desktop.local.auth.logout",
      "desktop.local.bots.create",
      "desktop.local.bots.update",
      "desktop.local.messages.list",
      "desktop.local.messages.send",
      "desktop.local.groups.list",
      "desktop.local.groups.create",
      "desktop.local.groups.update",
      "desktop.local.groups.remove",
      "desktop.local.groups.messages.list",
      "desktop.local.groups.messages.send",
      "desktop.local.groups.cancel",
      "desktop.local.runs.cancel",
      "desktop.local.settings.get",
      "desktop.local.settings.update",
      "desktop.local.browser.status",
      "desktop.local.browser.startPairing",
      "desktop.local.browser.revoke",
      "desktop.local.diagnostics.copy",
      "desktop.local.activity.list",
      "desktop.local.memory.list",
      "desktop.local.memory.update",
      "desktop.local.memory.remove",
      "desktop.local.routines.list",
      "desktop.local.routines.create",
      "desktop.local.routines.update",
      "desktop.local.routines.remove",
      "desktop.local.routines.runNow",
      "desktop.local.routines.history",
      "desktop.local.artifacts.create",
      "desktop.local.artifacts.read",
      "desktop.local.knowledge.list",
      "desktop.local.knowledge.create",
      "desktop.local.knowledge.update",
      "desktop.local.knowledge.remove",
      "desktop.local.skills.list",
      "desktop.local.skills.create",
      "desktop.local.skills.update",
      "desktop.local.skills.remove",
      "desktop.local.manifest.state",
    ]);
  });

  it("forwards captured codes without leaking the IPC event to the renderer", () => {
    const listeners: Array<(event: unknown, callback: unknown) => void> = [];
    const on = vi.fn((_channel: string, handler: (event: unknown, callback: unknown) => void) => {
      listeners.push(handler);
    });
    const off = vi.fn();
    const { exposeInMainWorld } = runPreload("preload.cjs", { on, off });

    const [, bridge] = exposeInMainWorld.mock.calls[0] as [string, RakazoDesktop];
    const received: unknown[] = [];
    const unsubscribe = bridge.oauth.onCallback((callback) => received.push(callback));

    expect(on).toHaveBeenCalledWith("desktop.oauth.callback", expect.any(Function));
    listeners[0]?.({ sender: "ipc-event" }, { code: "ac_123", state: "verifier_456" });
    expect(received).toEqual([{ code: "ac_123", state: "verifier_456" }]);

    unsubscribe();
    expect(off).toHaveBeenCalledWith("desktop.oauth.callback", expect.any(Function));
  });
});

describe("setup preload bridge", () => {
  it("exposes only the first-run setup operations", async () => {
    const { invoke, on, exposeInMainWorld } = runPreload("setup-preload.cjs");

    expect(exposeInMainWorld).toHaveBeenCalledTimes(1);
    const [globalName, bridge] = exposeInMainWorld.mock.calls[0] as [string, RakazoSetup];
    expect(globalName).toBe("rakazoSetup");
    expect(bridge.platform).toBe("linux");
    expect(Object.keys(bridge).sort()).toEqual([
      "openLink",
      "platform",
      "quit",
      "save",
      "stack",
      "state",
      "test",
    ]);
    expect(Object.keys(bridge.stack).sort()).toEqual(["onChange", "start", "state"]);

    await bridge.state();
    await bridge.test("http://127.0.0.1:5173");
    await bridge.save({ mode: "new", serverUrl: "http://127.0.0.1:5173" });
    await bridge.quit();
    await bridge.openLink("orbstack");
    await bridge.stack.state();
    await bridge.stack.start();
    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
      "desktop.setup.state",
      "desktop.setup.test",
      "desktop.setup.save",
      "desktop.setup.quit",
      "desktop.setup.openLink",
      "desktop.setup.stack.state",
      "desktop.setup.stack.start",
    ]);
    expect(invoke).toHaveBeenCalledWith("desktop.setup.openLink", "orbstack");

    const listener = vi.fn();
    bridge.stack.onChange(listener);
    const [channel, handler] = on.mock.calls.at(-1) as [string, (...args: unknown[]) => void];
    expect(channel).toBe("desktop.setup.stack.changed");
    handler({}, { phase: "pulling" });
    expect(listener).toHaveBeenCalledWith({ phase: "pulling" });
  });
});
