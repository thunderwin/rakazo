import { randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import path from "node:path";
import {
  BROWSER_BRIDGE_DEFAULT_PORT,
  BROWSER_BRIDGE_PATH,
  BROWSER_BRIDGE_PORT_ATTEMPTS,
  BROWSER_BRIDGE_PROTOCOL_VERSION,
  type BrowserActionOutcome,
  type BrowserBridgeHello,
  type BrowserBridgeMethod,
  type BrowserBridgeRequest,
  type BrowserBridgeStatus,
  type BrowserObservation,
  type BrowserPairingOffer,
  type BrowserTabSummary,
  isBrowserBridgeHello,
  isBrowserBridgeResponse,
} from "@rakazo/browser-protocol";
import type { BrowserHost } from "@rakazo/local-runtime";
import { type RawData, WebSocket, WebSocketServer } from "ws";

const TOKEN_FILE = "browser-bridge.json";
const HANDSHAKE_TIMEOUT_MS = 5_000;
const REQUEST_TIMEOUT_MS = 30_000;
const PAIRING_TTL_MS = 5 * 60_000;

interface BrowserBridgeOptions {
  userDataDir: string;
  port?: number;
  portAttempts?: number;
  requestTimeoutMs?: number;
  allowedOrigin?: (origin: string) => boolean;
}

interface StoredBridgeToken {
  token: string;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  cleanup?: () => void;
}

function validExtensionOrigin(origin: string): boolean {
  if (!origin.startsWith("chrome-extension://")) return false;
  const extensionId = origin.slice("chrome-extension://".length);
  return /^[a-p]{32}$/.test(extensionId);
}

function sameSecret(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function parseJson(raw: RawData): unknown {
  try {
    return JSON.parse(raw.toString());
  } catch {
    return undefined;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Browser bridge did not receive a TCP port"));
        return;
      }
      resolve(address.port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

function asTabs(value: unknown): BrowserTabSummary[] {
  if (!Array.isArray(value)) throw new Error("Browser bridge returned invalid tab data");
  return value as BrowserTabSummary[];
}

function asOutcome(value: unknown): BrowserActionOutcome {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Browser bridge returned an invalid action result");
  }
  return value as BrowserActionOutcome;
}

function asTab(value: unknown): BrowserTabSummary {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Browser bridge returned an invalid tab");
  }
  return value as BrowserTabSummary;
}

function asObservation(value: unknown): BrowserObservation {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Browser bridge returned an invalid observation");
  }
  return value as BrowserObservation;
}

/**
 * Loopback-only transport between the desktop Agent runtime and the ericBot
 * Chrome extension. It never accepts remote connections or forwards browser
 * credentials.
 */
export class DesktopBrowserBridge implements BrowserHost {
  private readonly server: Server;
  private readonly webSockets = new WebSocketServer({
    noServer: true,
    maxPayload: 2 * 1024 * 1024,
  });
  private readonly tokenPath: string;
  private readonly requestTimeoutMs: number;
  private readonly allowedOrigin: (origin: string) => boolean;
  private readonly port: number;
  private readonly portAttempts: number;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly sessions = new Set<string>();
  private token = "";
  private socket: WebSocket | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private pairing: { code: string; expiresAt: number; attempts: number } | null = null;
  private boundPort: number | null = null;
  private connectedClientVersion: string | null = null;
  private startError: string | null = null;
  private started = false;

  constructor(options: BrowserBridgeOptions) {
    this.tokenPath = path.join(options.userDataDir, TOKEN_FILE);
    this.requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
    this.allowedOrigin = options.allowedOrigin ?? validExtensionOrigin;
    this.port = options.port ?? BROWSER_BRIDGE_DEFAULT_PORT;
    this.portAttempts = options.portAttempts ?? BROWSER_BRIDGE_PORT_ATTEMPTS;
    this.server = createServer({ maxHeaderSize: 16 * 1024 }, (_request, response) => {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
    });
    this.installWebSocketHandling();
  }

  async start(): Promise<BrowserBridgeStatus> {
    if (this.started) return this.status();
    this.started = true;
    try {
      this.token = await this.loadOrCreateToken();
      const attempts = this.port === 0 ? 1 : this.portAttempts;
      let lastError: unknown;
      for (let offset = 0; offset < attempts; offset += 1) {
        const candidate = this.port === 0 ? 0 : this.port + offset;
        try {
          this.boundPort = await listen(this.server, candidate);
          return this.status();
        } catch (error) {
          lastError = error;
          if (this.server.listening) break;
        }
      }
      this.startError = `Could not start the browser bridge: ${errorMessage(lastError)}`;
    } catch (error) {
      this.startError = `Could not prepare the browser bridge: ${errorMessage(error)}`;
    }
    return this.status();
  }

  status(): BrowserBridgeStatus {
    return {
      available: this.boundPort !== null,
      connected: this.socket?.readyState === WebSocket.OPEN,
      port: this.boundPort,
      error: this.startError,
      clientVersion: this.connectedClientVersion,
    };
  }

  startPairing(): BrowserPairingOffer {
    if (this.boundPort === null) {
      throw new Error(this.startError ?? "Browser bridge is not available");
    }
    const expiresAt = Date.now() + PAIRING_TTL_MS;
    this.pairing = {
      code: String(randomInt(100_000, 1_000_000)),
      expiresAt,
      attempts: 0,
    };
    return {
      port: this.boundPort,
      code: this.pairing.code,
      expires_at: new Date(expiresAt).toISOString(),
    };
  }

  async revoke(): Promise<void> {
    for (const sessionId of this.sessions) {
      await this.closeSession(sessionId).catch(() => undefined);
    }
    this.token = randomBytes(32).toString("base64url");
    this.pairing = null;
    await this.saveToken(this.token);
    if (this.socket !== null) this.socket.close(4003, "Authorization revoked");
  }

  async listTabs(sessionId: string, signal?: AbortSignal): Promise<BrowserTabSummary[]> {
    return asTabs(await this.request("browser.list_tabs", { session_id: sessionId }, signal));
  }

  async getTab(sessionId: string, tabId: number, signal?: AbortSignal): Promise<BrowserTabSummary> {
    return asTab(
      await this.request("browser.get_tab", { session_id: sessionId, tab_id: tabId }, signal),
    );
  }

  async open(sessionId: string, url: string, signal?: AbortSignal): Promise<BrowserActionOutcome> {
    this.sessions.add(sessionId);
    return asOutcome(await this.request("browser.open", { session_id: sessionId, url }, signal));
  }

  async navigate(
    sessionId: string,
    url: string,
    signal?: AbortSignal,
  ): Promise<BrowserActionOutcome> {
    this.sessions.add(sessionId);
    return asOutcome(
      await this.request("browser.navigate", { session_id: sessionId, url }, signal),
    );
  }

  async borrowTab(
    sessionId: string,
    tabId: number,
    signal?: AbortSignal,
  ): Promise<BrowserActionOutcome> {
    this.sessions.add(sessionId);
    return asOutcome(
      await this.request("browser.borrow_tab", { session_id: sessionId, tab_id: tabId }, signal),
    );
  }

  async returnTab(
    sessionId: string,
    tabId: number,
    signal?: AbortSignal,
  ): Promise<BrowserActionOutcome> {
    return asOutcome(
      await this.request("browser.return_tab", { session_id: sessionId, tab_id: tabId }, signal),
    );
  }

  async observe(
    sessionId: string,
    options: { maxElements?: number; maxTextChars?: number } = {},
    signal?: AbortSignal,
  ): Promise<BrowserObservation> {
    this.sessions.add(sessionId);
    return asObservation(
      await this.request(
        "browser.observe",
        {
          session_id: sessionId,
          ...(options.maxElements === undefined ? {} : { max_elements: options.maxElements }),
          ...(options.maxTextChars === undefined ? {} : { max_text_chars: options.maxTextChars }),
        },
        signal,
      ),
    );
  }

  async click(sessionId: string, ref: string, signal?: AbortSignal): Promise<BrowserActionOutcome> {
    this.sessions.add(sessionId);
    return asOutcome(await this.request("browser.click", { session_id: sessionId, ref }, signal));
  }

  async type(
    sessionId: string,
    input: { ref: string; text: string; clear?: boolean; submit?: boolean },
    signal?: AbortSignal,
  ): Promise<BrowserActionOutcome> {
    this.sessions.add(sessionId);
    return asOutcome(
      await this.request(
        "browser.type",
        {
          session_id: sessionId,
          ref: input.ref,
          text: input.text,
          ...(input.clear === undefined ? {} : { clear: input.clear }),
          ...(input.submit === undefined ? {} : { submit: input.submit }),
        },
        signal,
      ),
    );
  }

  async scroll(
    sessionId: string,
    input: { ref?: string; deltaY?: number },
    signal?: AbortSignal,
  ): Promise<BrowserActionOutcome> {
    this.sessions.add(sessionId);
    return asOutcome(
      await this.request(
        "browser.scroll",
        {
          session_id: sessionId,
          ...(input.ref === undefined ? {} : { ref: input.ref }),
          ...(input.deltaY === undefined ? {} : { delta_y: input.deltaY }),
        },
        signal,
      ),
    );
  }

  async closeSession(sessionId: string, signal?: AbortSignal): Promise<void> {
    this.sessions.delete(sessionId);
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    await this.request("browser.close_session", { session_id: sessionId }, signal);
  }

  async close(): Promise<void> {
    for (const sessionId of this.sessions) {
      await this.request(
        "browser.close_session",
        { session_id: sessionId },
        undefined,
        2_000,
      ).catch(() => undefined);
    }
    this.sessions.clear();
    this.pairing = null;
    if (this.heartbeat !== null) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.socket?.close(1001, "ericBot is closing");
    this.socket = null;
    this.rejectPending(new Error("Browser bridge closed"));
    await new Promise<void>((resolve) => {
      if (!this.server.listening) {
        resolve();
        return;
      }
      this.server.close(() => resolve());
    });
    this.webSockets.close();
  }

  private async request(
    method: BrowserBridgeMethod,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    timeoutMs = this.requestTimeoutMs,
  ): Promise<unknown> {
    const socket = this.socket;
    if (socket === null || socket.readyState !== WebSocket.OPEN) {
      throw new Error("Browser extension is not connected");
    }
    signal?.throwIfAborted();
    const id = randomUUID();
    const frame: BrowserBridgeRequest = { type: "request", id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.pending.get(id);
        pending?.cleanup?.();
        this.pending.delete(id);
        reject(new Error(`Browser action timed out: ${method}`));
      }, timeoutMs);
      const abort = signal
        ? () => {
            clearTimeout(timer);
            this.pending.delete(id);
            reject(
              signal.reason instanceof Error ? signal.reason : new Error("Browser action aborted"),
            );
          }
        : undefined;
      if (abort) signal?.addEventListener("abort", abort, { once: true });
      const cleanup = abort
        ? () => {
            signal?.removeEventListener("abort", abort);
          }
        : undefined;
      this.pending.set(id, { resolve, reject, timer, ...(cleanup ? { cleanup } : {}) });
      socket.send(JSON.stringify(frame), (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(id);
        cleanup?.();
        reject(error);
      });
    });
  }

  private installWebSocketHandling() {
    this.server.on("upgrade", (request, socket, head) => {
      const origin = request.headers.origin;
      let requestUrl: URL;
      try {
        requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      } catch {
        socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      if (
        requestUrl.pathname !== BROWSER_BRIDGE_PATH ||
        typeof origin !== "string" ||
        !this.allowedOrigin(origin)
      ) {
        socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      this.webSockets.handleUpgrade(request, socket, head, (webSocket) => {
        this.acceptConnection(webSocket);
      });
    });
  }

  private acceptConnection(socket: WebSocket) {
    let authenticated = false;
    const timer = setTimeout(() => socket.close(4008, "Handshake timed out"), HANDSHAKE_TIMEOUT_MS);

    socket.on("message", (raw) => {
      const value = parseJson(raw);
      if (!authenticated) {
        if (!isBrowserBridgeHello(value)) {
          socket.close(4002, "Invalid handshake");
          return;
        }
        if (value.type === "pair") {
          const paired = this.verifyPairing(value.code);
          if (!paired) {
            socket.close(4003, "Invalid or expired pairing code");
            return;
          }
          authenticated = true;
          clearTimeout(timer);
          socket.send(
            JSON.stringify({
              type: "paired",
              protocolVersion: BROWSER_BRIDGE_PROTOCOL_VERSION,
              token: this.token,
            } satisfies BrowserBridgeHello),
          );
          this.attachSocket(socket, value.client.version);
          return;
        }
        if (value.type === "hello" && sameSecret(value.token, this.token)) {
          authenticated = true;
          clearTimeout(timer);
          socket.send(
            JSON.stringify({
              type: "ready",
              protocolVersion: BROWSER_BRIDGE_PROTOCOL_VERSION,
            } satisfies BrowserBridgeHello),
          );
          this.attachSocket(socket, value.client.version);
          return;
        }
        socket.close(4003, "Unauthorized");
        return;
      }
      if (!isBrowserBridgeResponse(value)) return;
      const pending = this.pending.get(value.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      pending.cleanup?.();
      this.pending.delete(value.id);
      if (value.ok) {
        pending.resolve(value.result);
      } else {
        pending.reject(new Error(value.error?.message ?? "Browser action failed"));
      }
    });
    socket.on("close", () => {
      clearTimeout(timer);
      if (this.socket !== socket) return;
      this.socket = null;
      this.connectedClientVersion = null;
      if (this.heartbeat !== null) clearInterval(this.heartbeat);
      this.heartbeat = null;
      this.rejectPending(new Error("Browser extension disconnected"));
    });
    socket.on("error", () => socket.close());
  }

  private attachSocket(socket: WebSocket, clientVersion: string) {
    if (this.socket !== null && this.socket !== socket) {
      this.socket.close(4001, "Replaced by a newer connection");
    }
    this.socket = socket;
    this.connectedClientVersion = clientVersion;
    if (this.heartbeat !== null) clearInterval(this.heartbeat);
    this.heartbeat = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping" }));
    }, 20_000);
    this.heartbeat.unref();
  }

  private verifyPairing(code: string): boolean {
    const pairing = this.pairing;
    if (pairing === null || Date.now() > pairing.expiresAt) {
      this.pairing = null;
      return false;
    }
    pairing.attempts += 1;
    if (pairing.attempts > 5) {
      this.pairing = null;
      return false;
    }
    if (!sameSecret(code, pairing.code)) return false;
    this.pairing = null;
    return true;
  }

  private rejectPending(error: Error) {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.cleanup?.();
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  private async loadOrCreateToken(): Promise<string> {
    try {
      const stored = JSON.parse(
        await readFile(this.tokenPath, "utf8"),
      ) as Partial<StoredBridgeToken>;
      if (typeof stored.token === "string" && stored.token.length >= 32) return stored.token;
    } catch {
      // A missing or malformed token is replaced below.
    }
    const token = randomBytes(32).toString("base64url");
    await this.saveToken(token);
    return token;
  }

  private async saveToken(token: string): Promise<void> {
    await mkdir(path.dirname(this.tokenPath), { recursive: true });
    const temporary = `${this.tokenPath}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify({ token }), { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.tokenPath);
  }
}
