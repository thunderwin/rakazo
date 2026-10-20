import {
  BROWSER_BRIDGE_DEFAULT_PORT,
  BROWSER_BRIDGE_PATH,
  BROWSER_BRIDGE_PORT_ATTEMPTS,
  BROWSER_BRIDGE_PROTOCOL_VERSION,
  type BrowserActionOutcome,
  type BrowserBridgeHello,
  type BrowserBridgeRequest,
  type BrowserBridgeResponse,
  type BrowserTabSummary,
  isBrowserBridgeHello,
  isBrowserBridgeRequest,
  isRecord,
} from "@rakazo/browser-protocol";
import { clickPage, observePage, scrollPage, typePage } from "./page-scripts.js";

const SETTINGS_KEY = "ericbot.bridge-settings";
const SESSIONS_KEY = "ericbot.agent-sessions";
const ALARM_NAME = "ericbot.bridge-keepalive";
const CLIENT = {
  name: "ericBot Browser Bridge" as const,
  version: chrome.runtime.getManifest().version,
};

interface BridgeSettings {
  port: number | null;
  token: string | null;
}

interface BorrowedTab {
  windowId: number;
  index: number;
}

interface AgentSession {
  windowId: number;
  tabId: number;
  observationId: string | null;
  borrowed: Record<string, BorrowedTab>;
}

type Sessions = Record<string, AgentSession>;

let settings: BridgeSettings = { port: null, token: null };
let settingsLoaded = false;
let sessions: Sessions = {};
let sessionsLoaded = false;
let socket: WebSocket | null = null;
let connectionTask: Promise<void> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let commandQueue = Promise.resolve();

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

async function loadSettings() {
  if (settingsLoaded) return;
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  const value = stored[SETTINGS_KEY];
  if (isRecord(value)) {
    settings = {
      port: Number.isInteger(value.port) ? (value.port as number) : null,
      token: typeof value.token === "string" ? value.token : null,
    };
  }
  settingsLoaded = true;
}

async function saveSettings() {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

async function loadSessions() {
  if (sessionsLoaded) return;
  const stored = await chrome.storage.session.get(SESSIONS_KEY);
  const value = stored[SESSIONS_KEY];
  sessions = isRecord(value) ? (value as Sessions) : {};
  sessionsLoaded = true;
}

async function saveSessions() {
  await chrome.storage.session.set({ [SESSIONS_KEY]: sessions });
}

function bridgeUrl(port: number): string {
  return `ws://127.0.0.1:${port}${BROWSER_BRIDGE_PATH}`;
}

function waitForSocketOpen(webSocket: WebSocket, timeoutMs = 1_500): Promise<void> {
  return new Promise((resolve, reject) => {
    if (webSocket.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      webSocket.close();
      reject(new Error("Timed out connecting to ericBot"));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      webSocket.removeEventListener("open", onOpen);
      webSocket.removeEventListener("error", onError);
      webSocket.removeEventListener("close", onClose);
    };
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("ericBot is not reachable on that port"));
    };
    const onClose = () => {
      cleanup();
      reject(new Error("ericBot closed the connection"));
    };
    webSocket.addEventListener("open", onOpen);
    webSocket.addEventListener("error", onError);
    webSocket.addEventListener("close", onClose);
  });
}

async function handshake(
  port: number,
  hello: BrowserBridgeHello,
): Promise<{ socket: WebSocket; pairedToken?: string }> {
  const webSocket = new WebSocket(bridgeUrl(port));
  try {
    await waitForSocketOpen(webSocket);
  } catch (error) {
    throw normalizeError(error);
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      webSocket.close();
      reject(new Error("ericBot did not answer the browser handshake"));
    }, 5_000);
    const cleanup = () => {
      clearTimeout(timer);
      webSocket.removeEventListener("message", onMessage);
      webSocket.removeEventListener("close", onClose);
      webSocket.removeEventListener("error", onError);
    };
    const onMessage = (event: MessageEvent) => {
      let value: unknown;
      try {
        value = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!isBrowserBridgeHello(value)) return;
      if (value.type === "error") {
        cleanup();
        webSocket.close();
        reject(new Error(value.message));
        return;
      }
      if (value.type === "ready") {
        cleanup();
        resolve({ socket: webSocket });
        return;
      }
      if (value.type === "paired") {
        cleanup();
        resolve({ socket: webSocket, pairedToken: value.token });
      }
    };
    const onClose = () => {
      cleanup();
      reject(new Error("ericBot rejected the browser handshake"));
    };
    const onError = () => {
      cleanup();
      reject(new Error("Browser handshake failed"));
    };
    webSocket.addEventListener("message", onMessage);
    webSocket.addEventListener("close", onClose);
    webSocket.addEventListener("error", onError);
    webSocket.send(JSON.stringify(hello));
  });
}

function installSocket(webSocket: WebSocket) {
  if (socket !== null && socket !== webSocket) socket.close(1000, "Replaced");
  socket = webSocket;
  webSocket.addEventListener("message", (event) => {
    let value: unknown;
    try {
      value = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (isRecord(value) && value.type === "ping") {
      webSocket.send(JSON.stringify({ type: "pong" }));
      return;
    }
    if (isRecord(value) && value.type === "revoked") {
      settings = { ...settings, token: null };
      settingsLoaded = true;
      void saveSettings();
      webSocket.close(1000, "Disconnected by ericBot");
      return;
    }
    if (!isBrowserBridgeRequest(value)) return;
    const request = value;
    commandQueue = commandQueue.then(
      async () => {
        try {
          const result = await dispatch(request);
          sendResponse({
            type: "response",
            id: request.id,
            ok: true,
            result,
          });
        } catch (error) {
          sendResponse({
            type: "response",
            id: request.id,
            ok: false,
            error: { code: "failed", message: normalizeError(error).message },
          });
        }
      },
      () => undefined,
    );
  });
  webSocket.addEventListener("close", () => {
    if (socket !== webSocket) return;
    socket = null;
    scheduleReconnect();
  });
  webSocket.addEventListener("error", () => {
    if (socket === webSocket) webSocket.close();
  });
}

function sendResponse(value: BrowserBridgeResponse) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
}

function candidatePorts(preferred: number | null): number[] {
  const ports: number[] = [];
  if (preferred !== null) ports.push(preferred);
  for (let offset = 0; offset < BROWSER_BRIDGE_PORT_ATTEMPTS; offset += 1) {
    const port = BROWSER_BRIDGE_DEFAULT_PORT + offset;
    if (!ports.includes(port)) ports.push(port);
  }
  return ports;
}

async function connectWithToken(): Promise<void> {
  await loadSettings();
  if (!settings.token) return;
  if (socket?.readyState === WebSocket.OPEN) return;
  let lastError: Error | null = null;
  for (const port of candidatePorts(settings.port)) {
    try {
      const result = await handshake(port, {
        type: "hello",
        protocolVersion: BROWSER_BRIDGE_PROTOCOL_VERSION,
        token: settings.token,
        client: CLIENT,
      });
      settings.port = port;
      await saveSettings();
      installSocket(result.socket);
      return;
    } catch (error) {
      lastError = normalizeError(error);
    }
  }
  throw lastError ?? new Error("No ericBot desktop bridge is available");
}

function ensureConnection(): Promise<void> {
  if (socket?.readyState === WebSocket.OPEN) return Promise.resolve();
  if (connectionTask !== null) return connectionTask;
  connectionTask = connectWithToken().finally(() => {
    connectionTask = null;
  });
  return connectionTask;
}

function scheduleReconnect() {
  if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
  void loadSettings().then(() => {
    if (!settings.token) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      void ensureConnection().catch(() => scheduleReconnect());
    }, 3_000);
  });
}

async function status() {
  await loadSettings();
  return {
    connected: socket?.readyState === WebSocket.OPEN,
    port: settings.port,
    clientVersion: CLIENT.version,
    hasToken: settings.token !== null,
  };
}

async function pair(port: number, code: string) {
  if (socket !== null) {
    socket.close(1000, "Pairing again");
    socket = null;
  }
  const result = await handshake(port, {
    type: "pair",
    protocolVersion: BROWSER_BRIDGE_PROTOCOL_VERSION,
    code,
    client: CLIENT,
  });
  if (!result.pairedToken) throw new Error("ericBot did not return a bridge token");
  settings = { port, token: result.pairedToken };
  settingsLoaded = true;
  await saveSettings();
  installSocket(result.socket);
  return { connected: true, port };
}

async function disconnect() {
  settings = { ...settings, token: null };
  await saveSettings();
  if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  socket?.close(1000, "Disconnected by user");
  socket = null;
}

function allowedUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http:// and https:// URLs are supported");
  }
  if (url.username || url.password) {
    throw new Error("URLs with embedded credentials are not supported");
  }
  return url;
}

function sessionId(params: Record<string, unknown>): string {
  const value = params.session_id;
  if (typeof value !== "string" || value.trim() === "" || value.length > 200) {
    throw new Error("session_id is required");
  }
  return value;
}

function numberParam(params: Record<string, unknown>, key: string): number {
  const value = params[key];
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`${key} must be a non-negative integer`);
  }
  return value as number;
}

function stringParam(params: Record<string, unknown>, key: string, max = 20_000): string {
  const value = params[key];
  if (typeof value !== "string" || value.length > max) {
    throw new Error(`${key} must be a string up to ${max} characters`);
  }
  return value;
}

function booleanParam(params: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = params[key];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error(`${key} must be a boolean`);
  return value;
}

function summary(tab: chrome.tabs.Tab): BrowserTabSummary {
  if (tab.id === undefined || tab.windowId === undefined) {
    throw new Error("Chrome returned a tab without an id");
  }
  return {
    tab_id: tab.id,
    window_id: tab.windowId,
    title: tab.title ?? "",
    url: tab.url ?? "",
    active: tab.active,
  };
}

async function getTab(tabId: number): Promise<chrome.tabs.Tab> {
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    throw new Error("Browser tab is no longer available");
  }
}

async function requireSitePermission(tab: chrome.tabs.Tab): Promise<URL> {
  if (!tab.url) throw new Error("The current tab has no readable URL");
  const url = allowedUrl(tab.url);
  const granted = await chrome.permissions.contains({ origins: [`${url.origin}/*`] });
  if (!granted) {
    throw new Error("Open the ericBot extension and allow website access");
  }
  return url;
}

function requireSession(id: string): AgentSession {
  const session = sessions[id];
  if (!session) throw new Error("Open a browser page or borrow a tab before using this tool");
  return session;
}

async function activeSessionTab(
  id: string,
): Promise<{ session: AgentSession; tab: chrome.tabs.Tab }> {
  const session = requireSession(id);
  const tab = await getTab(session.tabId);
  if (tab.windowId !== session.windowId) {
    throw new Error("The session tab moved outside its Agent Window");
  }
  await requireSitePermission(tab);
  return { session, tab };
}

async function executeInTab<TArgs, TResult>(
  tabId: number,
  func: (input: TArgs) => TResult,
  input: TArgs,
): Promise<TResult> {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args: [input],
  });
  const result = results[0]?.result;
  if (result === undefined) throw new Error("The page did not return a result");
  return result as TResult;
}

async function sessionWindow(id: string): Promise<AgentSession["windowId"] | null> {
  const session = sessions[id];
  if (!session) return null;
  try {
    await chrome.windows.get(session.windowId);
    return session.windowId;
  } catch {
    delete sessions[id];
    await saveSessions();
    return null;
  }
}

async function listTabs(id: string): Promise<BrowserTabSummary[]> {
  void id;
  const agentWindows = new Set(Object.values(sessions).map((session) => session.windowId));
  const tabs = await chrome.tabs.query({});
  return tabs
    .filter(
      (tab) =>
        tab.id !== undefined &&
        !agentWindows.has(tab.windowId) &&
        typeof tab.url === "string" &&
        (tab.url.startsWith("http://") || tab.url.startsWith("https://")),
    )
    .slice(0, 200)
    .map(summary);
}

async function getTabForSession(id: string, tabId: number): Promise<BrowserTabSummary> {
  void id;
  return summary(await getTab(tabId));
}

async function openPage(id: string, rawUrl: string): Promise<BrowserActionOutcome> {
  const url = allowedUrl(rawUrl).toString();
  await loadSessions();
  const existingWindow = await sessionWindow(id);
  let tab: chrome.tabs.Tab;
  if (existingWindow !== null) {
    tab = await chrome.tabs.create({ windowId: existingWindow, url, active: true });
  } else {
    const created = await chrome.windows.create({ url, focused: false, type: "normal" });
    if (!created || created.id === undefined) {
      throw new Error("Chrome did not create an Agent Window");
    }
    const windowId = created.id;
    tab = created.tabs?.[0] ?? (await chrome.tabs.query({ windowId, active: true }))[0]!;
    sessions[id] = {
      windowId,
      tabId: tab.id!,
      observationId: null,
      borrowed: {},
    };
    await saveSessions();
  }
  if (tab.id === undefined) throw new Error("Chrome did not create an Agent tab");
  const session = requireSession(id);
  session.tabId = tab.id;
  session.observationId = null;
  await saveSessions();
  return summary(tab);
}

async function navigatePage(id: string, rawUrl: string): Promise<BrowserActionOutcome> {
  const { session, tab } = await activeSessionTab(id);
  if (tab.id === undefined) throw new Error("The Agent tab has no id");
  const url = allowedUrl(rawUrl).toString();
  const updated = await chrome.tabs.update(tab.id, { url, active: true });
  session.observationId = null;
  await saveSessions();
  return summary(updated ?? (await getTab(tab.id)));
}

async function borrowTab(id: string, tabId: number): Promise<BrowserActionOutcome> {
  await loadSessions();
  const source = await getTab(tabId);
  allowedUrl(source.url ?? "");
  for (const [ownerId, owner] of Object.entries(sessions)) {
    if (owner.borrowed[String(tabId)] && ownerId !== id) {
      throw new Error("That tab is already borrowed by another ericBot task");
    }
  }
  let session = sessions[id];
  if (!session) {
    const created = await chrome.windows.create({ tabId, focused: false, type: "normal" });
    if (!created || created.id === undefined) {
      throw new Error("Chrome did not create an Agent Window");
    }
    session = {
      windowId: created.id,
      tabId,
      observationId: null,
      borrowed: {},
    };
    sessions[id] = session;
  } else {
    if (source.windowId === session.windowId) return summary(source);
    await chrome.tabs.move(tabId, { windowId: session.windowId, index: -1 });
    session.tabId = tabId;
    session.observationId = null;
  }
  session.borrowed[String(tabId)] = {
    windowId: source.windowId,
    index: source.index,
  };
  session.tabId = tabId;
  session.observationId = null;
  await chrome.tabs.update(tabId, { active: true });
  await saveSessions();
  return summary(await getTab(tabId));
}

async function returnTab(id: string, tabId: number): Promise<BrowserActionOutcome> {
  const session = requireSession(id);
  const borrowed = session.borrowed[String(tabId)];
  if (!borrowed) throw new Error("That tab was not borrowed by this task");
  let tab = await getTab(tabId);
  try {
    await chrome.windows.get(borrowed.windowId);
    tab = await chrome.tabs.move(tabId, {
      windowId: borrowed.windowId,
      index: borrowed.index,
    });
  } catch {
    const created = await chrome.windows.create({ tabId, focused: false, type: "normal" });
    tab = created?.tabs?.[0] ?? tab;
  }
  delete session.borrowed[String(tabId)];
  if (session.tabId === tabId) {
    const remaining = await chrome.tabs.query({ windowId: session.windowId });
    const next = remaining.find((candidate) => candidate.id !== tabId);
    session.tabId = next?.id ?? 0;
    session.observationId = null;
  }
  await saveSessions();
  return summary(tab);
}

async function observe(id: string, params: Record<string, unknown>) {
  const { session, tab } = await activeSessionTab(id);
  if (tab.id === undefined) throw new Error("The Agent tab has no id");
  const observationId = crypto.randomUUID();
  const maxElements = Number.isInteger(params.max_elements)
    ? Math.max(1, Math.min(300, params.max_elements as number))
    : 120;
  const maxTextChars = Number.isInteger(params.max_text_chars)
    ? Math.max(500, Math.min(30_000, params.max_text_chars as number))
    : 12_000;
  const page = await executeInTab(tab.id, observePage, {
    observationId,
    maxElements,
    maxTextChars,
  });
  session.observationId = observationId;
  await saveSessions();
  return {
    observation_id: observationId,
    tab_id: tab.id,
    ...page,
  };
}

function observationInput(session: AgentSession, ref: string) {
  if (!session.observationId) throw new Error("Call browser_observe before using element refs");
  if (!/^e\d+$/.test(ref)) throw new Error("ref must look like e1");
  return { observationId: session.observationId, ref };
}

async function click(id: string, params: Record<string, unknown>): Promise<BrowserActionOutcome> {
  const { session, tab } = await activeSessionTab(id);
  if (tab.id === undefined) throw new Error("The Agent tab has no id");
  await executeInTab(tab.id, clickPage, observationInput(session, stringParam(params, "ref", 40)));
  session.observationId = null;
  await saveSessions();
  return summary(await getTab(tab.id));
}

async function type(id: string, params: Record<string, unknown>): Promise<BrowserActionOutcome> {
  const { session, tab } = await activeSessionTab(id);
  if (tab.id === undefined) throw new Error("The Agent tab has no id");
  await executeInTab(tab.id, typePage, {
    ...observationInput(session, stringParam(params, "ref", 40)),
    text: stringParam(params, "text"),
    clear: booleanParam(params, "clear", true),
    submit: booleanParam(params, "submit", false),
  });
  return summary(await getTab(tab.id));
}

async function scroll(id: string, params: Record<string, unknown>): Promise<BrowserActionOutcome> {
  const { session, tab } = await activeSessionTab(id);
  if (tab.id === undefined) throw new Error("The Agent tab has no id");
  const ref = params.ref === undefined ? undefined : stringParam(params, "ref", 40);
  if (ref && !session.observationId) {
    throw new Error("Call browser_observe before scrolling to an element");
  }
  const deltaY = Number.isInteger(params.delta_y)
    ? Math.max(-20_000, Math.min(20_000, params.delta_y as number))
    : 600;
  await executeInTab(tab.id, scrollPage, {
    observationId: session.observationId ?? "",
    ...(ref ? { ref } : {}),
    deltaY,
  });
  return summary(await getTab(tab.id));
}

async function closeSession(id: string): Promise<{ closed: true }> {
  const session = sessions[id];
  if (!session) return { closed: true };
  for (const tabId of Object.keys(session.borrowed)) {
    await returnTab(id, Number(tabId));
  }
  try {
    await chrome.windows.remove(session.windowId);
  } catch {
    // The user may already have closed the Agent Window.
  }
  delete sessions[id];
  await saveSessions();
  return { closed: true };
}

async function dispatch(request: BrowserBridgeRequest): Promise<unknown> {
  await loadSessions();
  const id = sessionId(request.params);
  switch (request.method) {
    case "browser.list_tabs":
      return listTabs(id);
    case "browser.get_tab":
      return getTabForSession(id, numberParam(request.params, "tab_id"));
    case "browser.open":
      return openPage(id, stringParam(request.params, "url", 4_000));
    case "browser.navigate":
      return navigatePage(id, stringParam(request.params, "url", 4_000));
    case "browser.borrow_tab":
      return borrowTab(id, numberParam(request.params, "tab_id"));
    case "browser.return_tab":
      return returnTab(id, numberParam(request.params, "tab_id"));
    case "browser.observe":
      return observe(id, request.params);
    case "browser.click":
      return click(id, request.params);
    case "browser.type":
      return type(id, request.params);
    case "browser.scroll":
      return scroll(id, request.params);
    case "browser.close_session":
      return closeSession(id);
  }
}

async function handleControl(message: unknown) {
  if (!isRecord(message) || typeof message.type !== "string") {
    throw new Error("Unknown extension request");
  }
  switch (message.type) {
    case "status":
      void ensureConnection().catch(() => undefined);
      return status();
    case "pair": {
      const port = message.port;
      const code = message.code;
      if (!Number.isInteger(port) || !/^\d{6}$/.test(String(code))) {
        throw new Error("A valid port and six-digit pairing code are required");
      }
      return pair(port as number, String(code));
    }
    case "disconnect":
      await disconnect();
      return { disconnected: true };
    default:
      throw new Error("Unknown extension request");
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  void handleControl(message)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: normalizeError(error).message }));
  return true;
});

chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) void ensureConnection().catch(() => scheduleReconnect());
});
chrome.runtime.onStartup.addListener(
  () => void ensureConnection().catch(() => scheduleReconnect()),
);
chrome.runtime.onInstalled.addListener(
  () => void ensureConnection().catch(() => scheduleReconnect()),
);
chrome.windows.onRemoved.addListener((windowId) => {
  const removed = Object.entries(sessions).filter(([, session]) => session.windowId === windowId);
  if (removed.length === 0) return;
  for (const [id] of removed) delete sessions[id];
  void saveSessions();
});
chrome.tabs.onRemoved.addListener((tabId) => {
  for (const session of Object.values(sessions)) {
    if (session.tabId === tabId) {
      session.tabId = 0;
      session.observationId = null;
    }
  }
  void saveSessions();
});

void ensureConnection().catch(() => scheduleReconnect());
