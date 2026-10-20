import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  BrowserBridgeRequest,
  BrowserBridgeResponse,
  BrowserTabSummary,
} from "@rakazo/browser-protocol";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { DesktopBrowserBridge } from "./browser-bridge.js";

const directories: string[] = [];
const bridges: DesktopBrowserBridge[] = [];
const sockets: WebSocket[] = [];
const origin = `chrome-extension://${"a".repeat(32)}`;

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  await Promise.all(bridges.splice(0).map((bridge) => bridge.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function createBridge() {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "ericbot-browser-bridge-"));
  directories.push(userDataDir);
  const bridge = new DesktopBrowserBridge({
    userDataDir,
    port: 0,
    requestTimeoutMs: 1_000,
    allowedOrigin: (value) => value === origin,
  });
  bridges.push(bridge);
  const status = await bridge.start();
  expect(status.available).toBe(true);
  return bridge;
}

function openSocket(port: number, socketOrigin = origin) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/browser-bridge`, {
    headers: { Origin: socketOrigin },
  });
  sockets.push(socket);
  return socket;
}

function nextJson(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for bridge frame")), 2_000);
    socket.once("message", (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function pair(bridge: DesktopBrowserBridge) {
  const offer = bridge.startPairing();
  const socket = openSocket(offer.port);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  socket.send(
    JSON.stringify({
      type: "pair",
      protocolVersion: 1,
      code: offer.code,
      client: { name: "ericBot Browser Bridge", version: "0.1.0" },
    }),
  );
  const response = (await nextJson(socket)) as { type: string };
  expect(response.type).toBe("paired");
  return socket;
}

describe("desktop browser bridge", () => {
  it("pairs a Chrome extension and routes requests only to that socket", async () => {
    const bridge = await createBridge();
    const socket = await pair(bridge);
    const tab: BrowserTabSummary = {
      tab_id: 12,
      window_id: 4,
      title: "Account",
      url: "https://app.example.com/",
      active: true,
    };

    const requestSeen = new Promise<BrowserBridgeRequest>((resolve) => {
      socket.once("message", (data) => {
        const request = JSON.parse(data.toString()) as BrowserBridgeRequest;
        resolve(request);
        socket.send(
          JSON.stringify({
            type: "response",
            id: request.id,
            ok: true,
            result: tab,
          } satisfies BrowserBridgeResponse),
        );
      });
    });

    await expect(bridge.open("run-1", "https://app.example.com/")).resolves.toEqual(tab);
    await expect(requestSeen).resolves.toEqual(
      expect.objectContaining({
        type: "request",
        method: "browser.open",
        params: { session_id: "run-1", url: "https://app.example.com/" },
      }),
    );
    expect(bridge.status()).toEqual(
      expect.objectContaining({
        connected: true,
        clientVersion: "0.1.0",
      }),
    );
  });

  it("rejects non-extension origins before accepting a socket", async () => {
    const bridge = await createBridge();
    const port = bridge.status().port;
    expect(port).not.toBeNull();
    const socket = openSocket(port!, "https://example.com");
    await expect(
      new Promise((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
      }),
    ).rejects.toThrow(/403/);
    expect(bridge.status().connected).toBe(false);
  });

  it("reports an actionable error when Chrome is disconnected", async () => {
    const bridge = await createBridge();
    await expect(bridge.observe("run-1")).rejects.toThrow("Browser extension is not connected");
  });

  it("rejects a wrong extension token without exposing bridge requests", async () => {
    const bridge = await createBridge();
    const port = bridge.status().port;
    const socket = openSocket(port!);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    socket.send(
      JSON.stringify({
        type: "hello",
        protocolVersion: 1,
        token: "wrong-token",
        client: { name: "ericBot Browser Bridge", version: "0.1.0" },
      }),
    );
    await expect(
      new Promise((resolve, reject) => {
        socket.once("close", (code) => resolve(code));
        socket.once("error", reject);
      }),
    ).resolves.toBe(4003);
    expect(bridge.status().connected).toBe(false);
  });

  it("reconnects with the persisted token after the desktop restarts", async () => {
    const userDataDir = await mkdtemp(path.join(tmpdir(), "ericbot-browser-token-"));
    directories.push(userDataDir);
    const first = new DesktopBrowserBridge({ userDataDir, port: 0 });
    bridges.push(first);
    await first.start();
    await pair(first);
    await first.close();
    bridges.splice(bridges.indexOf(first), 1);

    const stored = JSON.parse(
      await readFile(path.join(userDataDir, "browser-bridge.json"), "utf8"),
    ) as { token: string };
    const second = new DesktopBrowserBridge({ userDataDir, port: 0 });
    bridges.push(second);
    const status = await second.start();
    const socket = openSocket(status.port!);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    socket.send(
      JSON.stringify({
        type: "hello",
        protocolVersion: 1,
        token: stored.token,
        client: { name: "ericBot Browser Bridge", version: "0.1.0" },
      }),
    );
    await expect(nextJson(socket)).resolves.toEqual(
      expect.objectContaining({ type: "ready", protocolVersion: 1 }),
    );
    expect(second.status().connected).toBe(true);
  });

  it("revokes the extension and replaces the persisted token", async () => {
    const bridge = await createBridge();
    const socket = await pair(bridge);
    const closed = new Promise<number>((resolve) => {
      socket.once("close", (code) => resolve(code));
    });

    await bridge.revoke();

    await expect(closed).resolves.toBe(4003);
    expect(bridge.status().connected).toBe(false);
    await expect(bridge.observe("run-1")).rejects.toThrow("Browser extension is not connected");
  });
});
